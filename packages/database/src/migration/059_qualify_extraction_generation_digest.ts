import { sql, type Migration } from "kysely";

const UP = String.raw`
create or replace function public.dialektik_validate_assertion_extraction_generation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  article_text text;
  source_hash text;
  span jsonb;
  span_start integer;
  span_end integer;
  span_text text;
begin
  select article.text_original into article_text
  from public.articles article
  where article.id = new.article_id;
  if article_text is null then
    raise exception using errcode = '23503', message = 'Article not found for extraction generation';
  end if;
  source_hash := encode(extensions.digest(convert_to(article_text, 'UTF8'), 'sha256'), 'hex');
  if new.input_hash <> source_hash then
    raise exception using errcode = '23514', message = 'extraction generation input_hash must match Article.text_original';
  end if;
  if new.outcome not in ('proposed', 'no_claim_worthy_content') then
    return new;
  end if;
  if new.proposal_payload ->> 'schema_version' <> new.schema_version
    or jsonb_typeof(new.proposal_payload -> 'spans') <> 'array' then
    raise exception using errcode = '23514', message = 'extraction proposal payload must have matching schema_version and spans array';
  end if;
  for span in select value from jsonb_array_elements(new.proposal_payload -> 'spans') loop
    if jsonb_typeof(span) <> 'object' or not (span ? 'start' and span ? 'end' and span ? 'quoted_text') then
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
      or span_end > public.dialektik_unicode_code_point_length(article_text)
      or public.dialektik_unicode_code_point_slice(article_text, span_start, span_end) <> span_text then
      raise exception using errcode = '23514', message = 'extraction proposal span must exactly resolve from Article.text_original';
    end if;
  end loop;
  return new;
end;
$$;
`;

export const qualifyExtractionGenerationDigestMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(UP).execute(database);
  },
  async down(): Promise<void> {
    throw new Error(
      "Extraction proposal source-fidelity validation must keep its qualified digest function.",
    );
  },
};
