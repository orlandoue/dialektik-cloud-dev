import { sql, type Migration } from 'kysely';

/**
 * Owner-authorized Phase 4A canonical source-offset contract. PostgreSQL text
 * character operations are exercised against the shared cross-runtime fixture;
 * no normalization occurs before the exact source slice is compared.
 */
const PHASE_4A_UNICODE_OFFSET_SQL = String.raw`
create function dialektik_unicode_code_point_length(source_text text)
returns integer
language sql
immutable
strict
parallel safe
as $$
  select char_length(source_text);
$$;

create function dialektik_unicode_code_point_slice(
  source_text text,
  start_offset integer,
  end_offset integer
)
returns text
language plpgsql
immutable
strict
parallel safe
as $$
begin
  if start_offset < 0 or end_offset < start_offset
    or end_offset > dialektik_unicode_code_point_length(source_text) then
    raise exception using errcode = '22023', message = 'canonical offsets are out of source bounds';
  end if;
  return substring(source_text from start_offset + 1 for end_offset - start_offset);
end;
$$;

alter table assertion_extraction_generations
  add constraint assertion_extraction_generations_offset_encoding_canonical
  check (offset_encoding = 'unicode_code_point_v1');

create or replace function dialektik_validate_assertion_extraction_generation()
returns trigger
language plpgsql
as $$
declare article_text text;
declare source_hash text;
declare span jsonb;
declare span_start integer;
declare span_end integer;
declare span_text text;
begin
  select text_original into article_text from articles where id = new.article_id;
  if article_text is null then
    raise exception using errcode = '23503', message = 'Article not found for extraction generation';
  end if;
  source_hash := encode(digest(article_text, 'sha256'), 'hex');
  if new.input_hash <> source_hash then
    raise exception using
      errcode = '23514',
      message = 'extraction generation input_hash must match Article.text_original';
  end if;
  if new.outcome not in ('proposed', 'no_claim_worthy_content') then
    return new;
  end if;
  if new.proposal_payload ->> 'schema_version' <> new.schema_version
    or jsonb_typeof(new.proposal_payload -> 'spans') <> 'array' then
    raise exception using
      errcode = '23514',
      message = 'extraction proposal payload must have matching schema_version and spans array';
  end if;
  for span in select value from jsonb_array_elements(new.proposal_payload -> 'spans') loop
    if jsonb_typeof(span) <> 'object'
      or not (span ? 'start' and span ? 'end' and span ? 'quoted_text') then
      raise exception using errcode = '23514', message = 'extraction proposal span is malformed';
    end if;
    begin
      span_start := (span ->> 'start')::integer;
      span_end := (span ->> 'end')::integer;
    exception when invalid_text_representation then
      raise exception using errcode = '23514', message = 'extraction proposal offsets must be integers';
    end;
    span_text := span ->> 'quoted_text';
    if span_start < 0 or span_end <= span_start
      or span_end > dialektik_unicode_code_point_length(article_text)
      or dialektik_unicode_code_point_slice(article_text, span_start, span_end) <> span_text then
      raise exception using
        errcode = '23514',
        message = 'extraction proposal span must exactly resolve from Article.text_original';
    end if;
  end loop;
  return new;
end;
$$;
`;

export const phase4aUnicodeOffsetAuthorityMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_4A_UNICODE_OFFSET_SQL).execute(database);
  },
};
