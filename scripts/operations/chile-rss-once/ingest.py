#!/usr/bin/env python3
"""One bounded, metadata-only acquisition; use --prepare, --dry-run, then --apply."""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

HERE = Path(__file__).resolve().parent
RUN_DIR = Path(os.environ.get('DIALEKTIK_RSS_RUN_DIR', '/tmp/dialektik-rss-metadata-once'))
PREPARED = RUN_DIR / 'prepared.json'
DRY_RUN = RUN_DIR / 'dry-run.json'
BATCH_KEY = RUN_DIR / 'batch-key.bin'
PROJECT = 'vclsswwfhljczxgnsciq'
SOURCE_IDS = [
    '01M4YDQK00CH1000C1PERCH11E', '01M4YDQK00CH100C00PERAT1VA',
    '01M4YDQK00CH100D1AR10E1D1A', '01M4YDQK00CH100001ATERCERA',
]
AGENT = 'DialektikRSSMetadata/1.0'


def serialized(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def signature(value):
    try:
        key = BATCH_KEY.read_bytes()
    except OSError as error:
        raise RuntimeError('PREPARED_BATCH_KEY_MISSING') from error
    if len(key) != 32:
        raise RuntimeError('PREPARED_BATCH_KEY_INVALID')
    return hmac.new(key, serialized(value), hashlib.sha256).hexdigest()


def create_batch_key():
    RUN_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(mode='wb', dir=RUN_DIR, delete=False)
    try:
        with handle:
            handle.write(secrets.token_bytes(32))
        os.chmod(handle.name, 0o600)
        os.replace(handle.name, BATCH_KEY)
    finally:
        if os.path.exists(handle.name):
            os.unlink(handle.name)


def write_private_json(path, value):
    RUN_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=RUN_DIR, delete=False)
    try:
        with handle:
            json.dump(value, handle, ensure_ascii=False)
        os.chmod(handle.name, 0o600)
        os.replace(handle.name, path)
    finally:
        if os.path.exists(handle.name):
            os.unlink(handle.name)


def query(sql, read_only=False):
    url = f'https://api.supabase.com/v1/projects/{PROJECT}/database/query'
    payload = json.dumps({'query': sql, 'read_only': read_only}).encode()
    req = urllib.request.Request(url, data=payload, method='POST', headers={
        'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'],
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'SUPABASE_QUERY_HTTP_{error.code}: {error.read(1600).decode()}') from error


def sources():
    ids = ','.join("'" + value + "'" for value in SOURCE_IDS)
    return query(f"""select s.id,s.name,s.canonical_domain,p.id policy_id,p.registry_key,
      p.policy->>'endpoint' endpoint from sources s
      join lateral (select * from live_source_policies where source_id=s.id
        order by recorded_at desc,id desc limit 1) p on true
      where s.id in ({ids}) and s.origin='LIVE_REAL' and p.active
        and p.rights_class='LIVE_READY' and p.storage_policy='METADATA_ONLY'
        and p.policy->>'rightsReviewStatus'='APPROVED'
        and nullif(p.policy->>'authorizationReference','') is not null
        and nullif(p.policy->>'rightsEvidenceUrl','') is not null
        and p.policy->>'rightsEvidenceUrl'<>'https://supabase.com'
        and p.policy->>'endpoint'<>'https://supabase.com'
      order by s.id""", True)


def get(source):
    endpoint = source['endpoint']
    parsed = urllib.parse.urlsplit(endpoint)
    allowed_hosts = {source['canonical_domain'], 'www.' + source['canonical_domain']}
    if parsed.scheme != 'https' or parsed.hostname not in allowed_hosts or parsed.username or parsed.password:
        raise ValueError('SOURCE_ENDPOINT_IDENTITY_INVALID')
    robots_url = f'https://{parsed.netloc}/robots.txt'
    with urllib.request.urlopen(urllib.request.Request(robots_url, headers={'User-Agent': AGENT}), timeout=20) as response:
        robot_final = urllib.parse.urlsplit(response.geturl())
        if robot_final.scheme != 'https' or robot_final.hostname not in allowed_hosts:
            raise ValueError('ROBOTS_REDIRECT_INVALID')
        robots = response.read(100001)
        if len(robots) > 100000:
            raise ValueError('ROBOTS_TOO_LARGE')
    robot_parser = urllib.robotparser.RobotFileParser()
    robot_parser.parse(robots.decode('utf-8', 'strict').splitlines())
    if not robot_parser.can_fetch(AGENT, endpoint):
        raise ValueError('ROBOTS_DISALLOWS_FEED')
    req = urllib.request.Request(endpoint, headers={
        'User-Agent': AGENT, 'Accept': 'application/rss+xml, application/xml, text/xml',
    })
    with urllib.request.urlopen(req, timeout=25) as response:
        final = urllib.parse.urlsplit(response.geturl())
        if final.scheme != 'https' or final.hostname not in allowed_hosts:
            raise ValueError('FEED_REDIRECT_INVALID')
        if not any(part in response.headers.get('Content-Type', '').lower() for part in ('xml', 'rss')):
            raise ValueError('FEED_CONTENT_TYPE_INVALID')
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('FEED_TOO_LARGE')
    input_json = json.dumps({'source': source, 'xml': raw.decode('utf-8', 'strict')}, ensure_ascii=False)
    result = subprocess.run(['node', str(HERE / 'prepare.mjs')], input=input_json, text=True,
                            capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def prepare():
    records = sources()
    if {row['id'] for row in records} != set(SOURCE_IDS):
        raise RuntimeError('REVIEWED_SOURCE_SET_INCOMPLETE')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(get, records))
    if any(not result['items'] for result in results):
        raise RuntimeError('SOURCE_HAS_NO_ELIGIBLE_RECENT_ITEMS')
    items = [item for result in results for item in result['items']]
    all_urls = [item['canonicalUrl'] for item in items]
    if not items or len(set(all_urls)) != len(all_urls):
        raise RuntimeError('EMPTY_OR_CROSS_SOURCE_DUPLICATE_BATCH')
    create_batch_key()
    prepared = {'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'items': items}
    prepared['signature'] = signature(prepared)
    write_private_json(PREPARED, prepared)
    DRY_RUN.unlink(missing_ok=True)
    for result in results:
        print(f"{result['source']}: {len(result['items'])} candidatos actuales de {result['parsed']} admitidos; metadatos solamente")
    print('Candidatos totales:', len(items))


def sql_for(items, dry_run):
    literal = json.dumps(items, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
    ending = 'rollback;' if dry_run else 'commit;'
    tag = '$dialektik_' + secrets.token_hex(16) + '$'
    while tag in literal:
        tag = '$dialektik_' + secrets.token_hex(16) + '$'
    return f"""
begin;
do {tag}
declare
  entry jsonb;
  source_entry record;
begin
  for source_entry in select distinct r->>'sourceId' as source_id from jsonb_array_elements('{literal}'::jsonb) r
      order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('live-source:' || source_entry.source_id, 0));
  end loop;
  for entry in select value from jsonb_array_elements('{literal}'::jsonb) loop
    if (entry->>'capturedAt')::timestamptz < clock_timestamp() - interval '15 minutes'
        or (entry->>'capturedAt')::timestamptz > clock_timestamp() + interval '5 minutes' then
      raise exception 'BATCH_EXPIRED';
    end if;
    if not exists (select 1 from live_source_policies p join sources s on s.id=p.source_id
        where p.id=entry->>'policyId' and p.source_id=entry->>'sourceId'
          and p.id=(select id from live_source_policies where source_id=s.id order by recorded_at desc,id desc limit 1)
          and p.registry_key=entry->>'registryKey' and s.name=entry->>'publisher'
          and s.canonical_domain=entry->>'domain' and s.origin='LIVE_REAL'
          and p.active and p.rights_class='LIVE_READY' and p.storage_policy='METADATA_ONLY'
          and p.policy->>'rightsReviewStatus'='APPROVED'
          and nullif(p.policy->>'authorizationReference','') is not null
          and nullif(p.policy->>'rightsEvidenceUrl','') is not null
          and p.policy->>'rightsEvidenceUrl'<>'https://supabase.com'
          and p.policy->>'endpoint'<>'https://supabase.com'
          and p.policy->>'endpoint'=entry->>'discoveryUrl') then
      raise exception 'SOURCE_REVIEW_CHANGED_OR_NOT_AUTHORIZED';
    end if;
    if exists(select 1 from articles where url_canonical=entry->>'canonicalUrl')
       or exists(select 1 from articles a join live_acquisition_receipts r on r.exclusion_id=a.live_exposure_id
         where r.source_id=entry->>'sourceId' and r.source_item_id=entry->>'sourceItemId') then
      continue;
    end if;
    insert into live_exposure_exclusions(id,registry_key,publisher_name,canonical_url,source_item_id,
      published_at,first_seen_at,discovery_url,reason,content_hash,near_duplicate_signature)
    values
      (entry->>'exclusionId',entry->>'registryKey',entry->>'publisher',entry->>'canonicalUrl',entry->>'sourceItemId',
       (entry->>'publishedAt')::timestamptz,(entry->>'capturedAt')::timestamptz,entry->>'discoveryUrl',
       'live_feed_discovery',entry->>'contentHash',entry->>'signature'),
      (entry->>'versionExclusionId',entry->>'registryKey',entry->>'publisher',entry->>'canonicalUrl',entry->>'sourceItemId',
       (entry->>'publishedAt')::timestamptz,(entry->>'capturedAt')::timestamptz,entry->>'discoveryUrl',
       'live_feed_discovery',entry->>'contentHash',entry->>'signature'),
      (entry->>'guidExclusionId',entry->>'registryKey',entry->>'publisher',null,entry->>'sourceItemId',
       (entry->>'publishedAt')::timestamptz,(entry->>'capturedAt')::timestamptz,entry->>'discoveryUrl',
       'live_feed_source_item_identity',entry->>'contentHash',entry->>'signature')
    on conflict (id) do nothing;
    insert into live_acquisition_receipts(id,source_id,policy_id,exclusion_id,discovery_channel,discovery_url,
      discovered_url,canonical_url,source_item_id,published_at,modified_at,original_published_at,
      original_modified_at,seen_at,raw_payload_hash,adapter_version,disposition,error_code)
    values (entry->>'receiptId',entry->>'sourceId',entry->>'policyId',entry->>'exclusionId','rss_atom',entry->>'discoveryUrl',
      entry->>'discoveredUrl',entry->>'canonicalUrl',entry->>'sourceItemId',
      (entry->>'publishedAt')::timestamptz,(entry->>'modifiedAt')::timestamptz,entry->>'originalPublishedAt',
      entry->>'originalModifiedAt',(entry->>'capturedAt')::timestamptz,entry->>'rawPayloadHash',
      entry->>'adapterVersion','PERSISTED',null);
    insert into articles(id,source_id,event_id,url_canonical,text_original,text_normalized,lang,published_at,
      captured_at,updated_at_source,declares_wire,syndication_of,syndication_confidence,clustering_score,
      processing_error,origin,live_exposure_id)
    values (entry->>'articleId',entry->>'sourceId',null,entry->>'canonicalUrl',entry->>'headline',entry->>'headline',
      entry->>'language',(entry->>'publishedAt')::timestamptz,(entry->>'capturedAt')::timestamptz,
      (entry->>'modifiedAt')::timestamptz,entry->>'declaredUpstream',null,null,null,null,'LIVE_REAL',entry->>'exclusionId');
    insert into live_article_versions(id,article_id,receipt_id,version_number,metadata_hash,headline,excerpt,
      author,published_at,modified_at,declared_upstream,content_hash,near_duplicate_signature,recorded_at)
    values (entry->>'versionId',entry->>'articleId',entry->>'receiptId',1,entry->>'metadataHash',entry->>'headline',null,
      entry->>'author',(entry->>'publishedAt')::timestamptz,(entry->>'modifiedAt')::timestamptz,entry->>'declaredUpstream',
      entry->>'contentHash',entry->>'signature',(entry->>'capturedAt')::timestamptz);
  end loop;
end
{tag};
{ending}
"""


def write(dry_run):
    prepared = json.loads(PREPARED.read_text(encoding='utf-8'))
    recorded_signature = prepared.pop('signature', None)
    if not isinstance(recorded_signature, str) or not hmac.compare_digest(recorded_signature, signature(prepared)):
        raise RuntimeError('PREPARED_BATCH_SIGNATURE_INVALID')
    items = prepared['items']
    created = dt.datetime.fromisoformat(prepared['createdAt'])
    age = dt.datetime.now(dt.timezone.utc) - created
    if not 1 <= len(items) <= 48 or age > dt.timedelta(minutes=15) or age < dt.timedelta(minutes=-5):
        raise RuntimeError('PREPARED_BATCH_MISSING_OR_EXPIRED')
    if {item.get('sourceId') for item in items} != set(SOURCE_IDS):
        raise RuntimeError('PREPARED_SOURCE_SET_INVALID')
    if len({item.get('canonicalUrl') for item in items}) != len(items):
        raise RuntimeError('PREPARED_URLS_NOT_UNIQUE')
    all_ids = [item.get(key) for item in items for key in ('articleId', 'receiptId', 'versionId')]
    if len(set(all_ids)) != len(all_ids) or not all(
        isinstance(value, str) and re.fullmatch(r'[0-9A-HJKMNP-TV-Z]{26}', value)
        for value in all_ids
    ):
        raise RuntimeError('PREPARED_IDS_INVALID')
    digest = hashlib.sha256(serialized(prepared)).hexdigest()
    if not dry_run:
        if not DRY_RUN.exists():
            raise RuntimeError('CURRENT_BATCH_MUST_PASS_DRY_RUN')
        verification = json.loads(DRY_RUN.read_text(encoding='utf-8'))
        if verification.get('digest') != digest:
            raise RuntimeError('CURRENT_BATCH_MUST_PASS_DRY_RUN')
    query(sql_for(items, dry_run))
    if dry_run:
        write_private_json(DRY_RUN, {'digest': digest})
        print(f'Simulación correcta; {len(items)} candidatos; transacción revertida.')
        return
    DRY_RUN.unlink(missing_ok=True)
    ids = ','.join("'" + item['articleId'] + "'" for item in items)
    results = query(f"""select s.name,count(*)::int inserted from articles a join sources s on s.id=a.source_id
      where a.id in ({ids}) and a.origin='LIVE_REAL' group by s.name order by s.name""", True)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'dry-run', 'apply'])
    action = parser.parse_args().action
    try:
        prepare() if action == 'prepare' else write(action == 'dry-run')
    except Exception as error:
        print(f'INGESTION_FAILED: {error}', file=sys.stderr)
        sys.exit(1)
