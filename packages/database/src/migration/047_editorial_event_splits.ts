import { sql, type Migration } from 'kysely';

/** Preserves an editor's split decision while new events remain unpublished. */
const EDITORIAL_SPLITS_SQL = String.raw`
create table if not exists public.editorial_event_splits (
  original_event_id dialektik_ulid primary key references public.events(id),
  first_successor_id dialektik_ulid not null unique references public.events(id),
  second_successor_id dialektik_ulid not null unique references public.events(id),
  editor_user_id dialektik_ulid not null references public.users(id),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  constraint editorial_event_split_distinct_events check (
    original_event_id <> first_successor_id
    and original_event_id <> second_successor_id
    and first_successor_id <> second_successor_id
  )
);

-- A pre-existing table must be the exact shape before the migration continues.
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'editorial_event_splits') <> 6
    or (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'editorial_event_splits' and is_nullable = 'NO'
      and ((column_name in ('original_event_id', 'first_successor_id', 'second_successor_id', 'editor_user_id')
              and domain_name = 'dialektik_ulid')
        or (column_name = 'reason' and data_type = 'text')
        or (column_name = 'created_at' and data_type = 'timestamp with time zone'))) <> 6
    or (select count(*) from pg_constraint where conrelid = 'public.editorial_event_splits'::regclass
      and conname in ('editorial_event_splits_pkey', 'editorial_event_splits_first_successor_id_key',
        'editorial_event_splits_second_successor_id_key', 'editorial_event_splits_original_event_id_fkey',
        'editorial_event_splits_first_successor_id_fkey', 'editorial_event_splits_second_successor_id_fkey',
        'editorial_event_splits_editor_user_id_fkey', 'editorial_event_splits_reason_check',
        'editorial_event_split_distinct_events')) <> 9
    or exists (
      select 1 from (values
        ('editorial_event_splits_pkey', 'PRIMARY KEY (original_event_id)'),
        ('editorial_event_splits_first_successor_id_key', 'UNIQUE (first_successor_id)'),
        ('editorial_event_splits_second_successor_id_key', 'UNIQUE (second_successor_id)'),
        ('editorial_event_splits_original_event_id_fkey', 'FOREIGN KEY (original_event_id) REFERENCES events(id)'),
        ('editorial_event_splits_first_successor_id_fkey', 'FOREIGN KEY (first_successor_id) REFERENCES events(id)'),
        ('editorial_event_splits_second_successor_id_fkey', 'FOREIGN KEY (second_successor_id) REFERENCES events(id)'),
        ('editorial_event_splits_editor_user_id_fkey', 'FOREIGN KEY (editor_user_id) REFERENCES users(id)'),
        ('editorial_event_splits_reason_check', 'CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 1000)))'),
        ('editorial_event_split_distinct_events', 'CHECK ((((original_event_id)::text <> (first_successor_id)::text) AND ((original_event_id)::text <> (second_successor_id)::text) AND ((first_successor_id)::text <> (second_successor_id)::text)))')
      ) expected(name, definition)
      where not exists (select 1 from pg_constraint c
        where c.conrelid = 'public.editorial_event_splits'::regclass
          and c.conname = expected.name and c.convalidated
          and pg_get_constraintdef(c.oid) = expected.definition)
    ) then
    raise exception 'Existing editorial split table has an incompatible schema';
  end if;
end
$$;

alter table public.editorial_event_splits enable row level security;
revoke all on public.editorial_event_splits from public, anon, authenticated, dialektik_core_app;
grant select on public.editorial_event_splits to dialektik_core_app;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.editorial_event_splits from service_role;
  end if;
end
$$;

do $$
declare p record;
begin
  if exists (select 1 from pg_policy where polrelid = 'public.editorial_event_splits'::regclass
    and polname <> 'editorial_event_splits_core_read') then
    raise exception 'Unexpected editorial split policy';
  end if;
  select polcmd, polroles, pg_get_expr(polqual, polrelid) as condition into p
    from pg_policy where polrelid = 'public.editorial_event_splits'::regclass
      and polname = 'editorial_event_splits_core_read';
  if not found then
    create policy editorial_event_splits_core_read on public.editorial_event_splits
      for select to dialektik_core_app using (true);
  elsif p.polcmd <> 'r' or p.polroles <> array['dialektik_core_app'::regrole::oid]
    or p.condition <> 'true' then
    raise exception 'Existing editorial split policy has unexpected permissions';
  end if;
end
$$;

create or replace function public.dialektik_guard_editorial_event_split()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'editorial split decisions are retained history';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dialektik:editorial-event-splits', 0));
  perform public.dialektik_require_audit_context(array['split']::audit_action_type[]);
  perform public.dialektik_require_phase6_actor('editor', new.editor_user_id);
  if exists (select 1 from public.editorial_event_splits split
    where new.first_successor_id in (split.original_event_id, split.first_successor_id, split.second_successor_id)
       or new.second_successor_id in (split.original_event_id, split.first_successor_id, split.second_successor_id)) then
    raise exception using errcode = '23514', message = 'editorial split event is already part of a split';
  end if;
  return new;
end;
$$;

create or replace function public.dialektik_audit_editorial_event_split()
returns trigger language plpgsql as $$
begin
  perform public.dialektik_emit_audit('EditorialEventSplit', new.original_event_id::text,
    null, to_jsonb(new), array['split']::audit_action_type[]);
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_trigger t
    where t.tgrelid = 'public.editorial_event_splits'::regclass and not t.tgisinternal
      and ((t.tgname = 'editorial_event_splits_guarded'
            and (t.tgfoid <> 'public.dialektik_guard_editorial_event_split()'::regprocedure
              or t.tgtype <> 31 or t.tgenabled <> 'O'))
        or (t.tgname = 'editorial_event_splits_no_truncate'
            and (t.tgfoid <> 'public.dialektik_guard_editorial_event_split()'::regprocedure
              or t.tgtype <> 34 or t.tgenabled <> 'O'))
        or (t.tgname = 'editorial_event_splits_audited'
            and (t.tgfoid <> 'public.dialektik_audit_editorial_event_split()'::regprocedure
              or t.tgtype <> 5 or t.tgenabled <> 'O')))) then
    raise exception 'Existing editorial split trigger has unexpected behavior';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.editorial_event_splits'::regclass
    and tgname = 'editorial_event_splits_guarded' and not tgisinternal) then
    create trigger editorial_event_splits_guarded before insert or update or delete
      on public.editorial_event_splits for each row execute function public.dialektik_guard_editorial_event_split();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.editorial_event_splits'::regclass
    and tgname = 'editorial_event_splits_no_truncate' and not tgisinternal) then
    create trigger editorial_event_splits_no_truncate before truncate
      on public.editorial_event_splits for each statement execute function public.dialektik_guard_editorial_event_split();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.editorial_event_splits'::regclass
    and tgname = 'editorial_event_splits_audited' and not tgisinternal) then
    create trigger editorial_event_splits_audited after insert
      on public.editorial_event_splits for each row execute function public.dialektik_audit_editorial_event_split();
  end if;
end
$$;
`;

export const editorialEventSplitsMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(EDITORIAL_SPLITS_SQL).execute(database);
  },
  down(): Promise<void> {
    throw new Error('Editorial split history is forward-only.');
  },
};
