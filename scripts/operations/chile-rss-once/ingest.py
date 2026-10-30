#!/usr/bin/env python3
"""One bounded, source-policy-gated RSS/Atom acquisition; use prepare, dry-run, then apply."""
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
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
RUN_DIR = Path(os.environ.get('DIALEKTIK_RSS_RUN_DIR', '/tmp/dialektik-rss-metadata-once'))
PREPARED = RUN_DIR / 'prepared.json'
DRY_RUN = RUN_DIR / 'dry-run.json'
BATCH_KEY = RUN_DIR / 'batch-key.bin'
PROJECT = 'vclsswwfhljczxgnsciq'
CHILE_SOURCE_IDS = [
    '01M4YDQK00CH1000C1PERCH11E', '01M4YDQK00CH100C00PERAT1VA',
    '01M4YDQK00CH100D1AR10E1D1A', '01M4YDQK00CH100001ATERCERA',
    '01M4YDQK00CH1000B10B10CH11', '01M4YDQK00CH100E1M0STRAD0R',
]
YOUTUBE_SOURCE_IDS = [
        "01M4YDQK00YT01MEGAN0T1C1AS",
        "01M4YDQK00YT02TE1ETRECE013",
        "01M4YDQK00YT03TVN24H0RAS01",
        "01M4YDQK00YT04CHVN0T1C1AS1",
        "01M4YDQK00YT05CNNCH11E0001",
        "01M4YDQK00YT06B10B10CH11E1",
        "01M4YDQK00YT07CANA19B10B10",
        "01M4YDQK00YT08C00PERAT1VA1",
        "01M4YDQK00YT09ADNRAD10CH11",
        "01M4YDQK00YT10AGR1CV1TVRA1",
        "01M4YDQK00YT11RAD10PAVTA01",
        "01M4YDQK00YT12TE1E13RAD101",
        "01M4YDQK00YT13RAD101NF1N1T",
        "01M4YDQK00YT14RAD10DVNA001",
        "01M4YDQK00YT15E1M0STRAD0R1",
        "01M4YDQK00YT16C1PERCH11E01",
        "01M4YDQK00YT17THEC11N1CTV1",
        "01M4YDQK00YT18V0ZS0BRAN001",
        "01M4YDQK00YT19S1NF11TR0STV",
        "01M4YDQK00YT20CANA1V1AX001",
        "01M4YDQK00YT21E111BER0TV01",
        "01M4YDQK00YT22DESC0NC1ERT0",
        "01M4YDQK00YT23E1C1VDADAN01",
        "01M4YDQK00YT24TVRN0C0PAN01",
        "01M4YDQK00YT25FASTCHECKC11",
        "01M4YDQK00YT26RAD10VCH11E1",
        "01M4YDQK00YT271ATERCERATV1",
        "01M4YDQK00YT28DF11VECH11E1",
        "01M4YDQK00YT29CAMARAD1PVT1",
        "01M4YDQK00YT30TVSENAD0CH11",
        "01M4YDQK00YT31P0DERJVD1C1A",
        "01M4YDQK00YT32V0CER1AG0BC1"
    ]
SOURCE_IDS = [*CHILE_SOURCE_IDS, *YOUTUBE_SOURCE_IDS]
BIOBIO_ID = '01M4YDQK00CH1000B10B10CH11'
BIOBIO_FEED = 'https://feeds.feedburner.com/radiobiobio/NNeJ'
BIOBIO_FEED_HOST = 'feeds.feedburner.com'
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


def allowed_fetch_hosts(source):
    hosts = {source['canonical_domain'], 'www.' + source['canonical_domain']}
    if source['id'] == BIOBIO_ID and source['endpoint'] == BIOBIO_FEED:
        hosts.add(BIOBIO_FEED_HOST)
    return hosts


def sources():
    ids = ','.join("'" + value + "'" for value in SOURCE_IDS)
    return query(f"""select s.id,s.name,s.canonical_domain,p.id policy_id,p.registry_key,
      p.policy->>'endpoint' endpoint,p.storage_policy,
      coalesce(p.policy->>'discoveryChannel','rss_atom') discovery_channel,
      coalesce(p.policy->'canonicalPathAliases','{{}}'::jsonb) canonical_path_aliases,
      coalesce(p.policy->>'language','es') language from sources s
      join lateral (select * from live_source_policies where source_id=s.id
        order by recorded_at desc,id desc limit 1) p on true
      where s.id in ({ids}) and s.origin='LIVE_REAL' and p.active
        and p.rights_class='LIVE_READY' and p.storage_policy in ('METADATA_ONLY','METADATA_AND_FEED_EXCERPT')
        and p.policy->>'rightsReviewStatus'='APPROVED'
        and nullif(p.policy->>'authorizationReference','') is not null
        and nullif(p.policy->>'rightsEvidenceUrl','') is not null
        and p.policy->>'rightsEvidenceUrl'<>'https://supabase.com'
        and p.policy->>'endpoint'<>'https://supabase.com'
      order by s.id""", True)


def get(source):
    endpoint = source['endpoint']
    parsed = urllib.parse.urlsplit(endpoint)
    allowed_hosts = allowed_fetch_hosts(source)
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
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('FEED_TOO_LARGE')
        content_type = response.headers.get('Content-Type', '').lower()
        xml_mime = any(part in content_type for part in ('xml', 'rss'))
        biofeed_octet_stream = (
            source['id'] == BIOBIO_ID and endpoint == BIOBIO_FEED
            and 'application/octet-stream' in content_type
            and re.match(rb'^\s*(?:<\?xml\b[^>]*\?>\s*)?<rss\b', raw, re.I) is not None
        )
        if not xml_mime and not biofeed_octet_stream:
            raise ValueError('FEED_CONTENT_TYPE_INVALID')
    input_json = json.dumps({'source': source, 'xml': raw.decode('utf-8', 'strict')}, ensure_ascii=False)
    result = subprocess.run(['node', str(HERE / 'prepare.mjs')], input=input_json, text=True,
                            capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def prepare():
    records = sources()
    if {row['id'] for row in records} != set(SOURCE_IDS):
        raise RuntimeError('REVIEWED_SOURCE_SET_INCOMPLETE')
    target_date = os.environ.get('DIALEKTIK_RSS_PUBLICATION_DATE') or \
        dt.datetime.now(ZoneInfo('America/Santiago')).date().isoformat()
    ids = ','.join("'" + value + "'" for value in SOURCE_IDS)
    existing = query(f"""select a.id::text article_id,a.source_id::text source_id,a.origin,a.url_canonical,
        (a.published_at at time zone 'America/Santiago')::date='{target_date}'::date as is_today
      from public.articles a where a.origin='LIVE_REAL' and a.source_id in ({ids})
      order by a.source_id,a.url_canonical""", True)
    existing_by_url = {row['url_canonical']: row for row in existing}
    today_counts = {source_id: 0 for source_id in SOURCE_IDS}
    for row in existing:
        if row['is_today']:
            today_counts[row['source_id']] += 1

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(records))) as pool:
        futures = {pool.submit(get, source): source for source in records}
        for future in concurrent.futures.as_completed(futures):
            source = futures[future]
            try:
                result = future.result()
                result['source_id'] = source['id']
                result['status'] = 'succeeded'
            except Exception as error:
                result = {
                    'source': source['name'], 'source_id': source['id'],
                    'status': 'failed', 'error_code': type(error).__name__, 'items': [],
                }
            results.append(result)
    results.sort(key=lambda result: result['source_id'])

    candidate_urls = sorted({
        item['canonicalUrl']
        for result in results
        for item in result['items']
    })
    if candidate_urls:
        urls_json = json.dumps(candidate_urls, ensure_ascii=False).replace("'", "''")
        collisions = query(f"""select a.id::text article_id,a.source_id::text source_id,
            a.origin,a.url_canonical from public.articles a
          where a.url_canonical in (
            select value from jsonb_array_elements_text('{urls_json}'::jsonb)
          )""", True)
        existing_by_url.update({row['url_canonical']: row for row in collisions})

    selected_items = []
    selected_urls = set()
    matched_counts = {source_id: 0 for source_id in SOURCE_IDS}
    collision_counts = {source_id: 0 for source_id in SOURCE_IDS}
    for result in results:
        source_id = result['source_id']
        source = next(source for source in records if source['id'] == source_id)
        kept = []
        for item in result['items']:
            canonical_url = item['canonicalUrl']
            if canonical_url in selected_urls:
                collision_counts[source_id] += 1
                continue
            existing_row = existing_by_url.get(canonical_url)
            if existing_row is not None:
                if existing_row['source_id'] != source_id or existing_row['origin'] != 'LIVE_REAL':
                    collision_counts[source_id] += 1
                    continue
                matched_counts[source_id] += 1
                if item.get('excerpt') is None:
                    continue
                item['articleId'] = existing_row['article_id']
            selected_urls.add(canonical_url)
            kept.append(item)
            selected_items.append(item)
        result['items'] = kept
        result['feed_candidates_today'] = len(kept)
        result['existing_articles_today'] = today_counts[source_id]
        result['matched_articles_today'] = matched_counts[source_id]
        result['new_articles_today'] = sum(
            1 for item in kept if item['canonicalUrl'] not in existing_by_url
        )
        result['canonical_collisions_skipped'] = collision_counts[source_id]
        result['with_feed_excerpt'] = sum(1 for item in kept if item.get('excerpt') is not None)

    items = selected_items
    all_urls = [item['canonicalUrl'] for item in items]
    for result in results:
        if result['status'] == 'failed':
            print(f"{result['source']}: no disponible ({result['error_code']})")
        else:
            print(
                f"{result['source']}: {result['matched_articles_today']}/"
                f"{result['existing_articles_today']} artículos de hoy encontrados; "
                f"{result['new_articles_today']} nuevos; "
                f"{result['with_feed_excerpt']} con extracto; "
                f"{result['canonical_collisions_skipped']} colisiones omitidas"
            )
    print(
        f"Ingesta de hoy: {len(items)} artículos nuevos o actualizados; "
        f"{sum(today_counts.values())} existentes en el catálogo."
    )
    if not items:
        PREPARED.unlink(missing_ok=True)
        DRY_RUN.unlink(missing_ok=True)
        raise RuntimeError('NO_FEED_ARTICLES_READY_FOR_INGESTION')
    if len(set(all_urls)) != len(all_urls):
        raise RuntimeError('INGESTION_CANONICAL_URL_COLLISION')
    create_batch_key()
    prepared = {
        'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'targetDate': target_date,
        'expectedArticleCount': sum(today_counts.values()),
        'matchedArticleCount': len(items),
        'sourceResults': [
            {key: value for key, value in result.items() if key != 'items'}
            for result in results
        ],
        'items': items,
    }
    prepared['signature'] = signature(prepared)
    write_private_json(PREPARED, prepared)
    DRY_RUN.unlink(missing_ok=True)


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
  existing_article record;
  latest_version record;
  receipt_exclusion_id text;
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
          and p.active and p.rights_class='LIVE_READY' and p.storage_policy=entry->>'storagePolicy'
          and p.policy->>'rightsReviewStatus'='APPROVED'
          and nullif(p.policy->>'authorizationReference','') is not null
          and nullif(p.policy->>'rightsEvidenceUrl','') is not null
          and p.policy->>'rightsEvidenceUrl'<>'https://supabase.com'
          and p.policy->>'endpoint'<>'https://supabase.com'
          and p.policy->>'endpoint'=entry->>'discoveryUrl'
          and coalesce(p.policy->>'discoveryChannel','rss_atom')=entry->>'discoveryChannel') then
      raise exception 'SOURCE_REVIEW_CHANGED_OR_NOT_AUTHORIZED';
    end if;
    select a.id,a.source_id,a.origin,a.live_exposure_id
      into existing_article from articles a
      where a.url_canonical=entry->>'canonicalUrl'
        or exists(select 1 from live_acquisition_receipts r where r.source_id=entry->>'sourceId'
          and r.source_item_id=entry->>'sourceItemId' and r.exclusion_id=a.live_exposure_id)
      order by case when a.url_canonical=entry->>'canonicalUrl' then 0 else 1 end
      limit 1 for update;
    if found then
      if existing_article.source_id::text<>entry->>'sourceId' or existing_article.origin<>'LIVE_REAL'
          or existing_article.live_exposure_id is null or existing_article.id::text<>entry->>'articleId' then
        raise exception 'ARTICLE_IDENTITY_CONFLICT';
      end if;
      if entry->>'excerpt' is null then continue; end if;
      select v.id,v.version_number,v.headline,v.excerpt,r.policy_id into latest_version
        from live_article_versions v join live_acquisition_receipts r on r.id=v.receipt_id
        where v.article_id=existing_article.id order by v.version_number desc limit 1;
      if latest_version.id is null then raise exception 'LIVE_VERSION_MISSING'; end if;
      if latest_version.headline=entry->>'headline' and latest_version.excerpt=entry->>'excerpt'
          and latest_version.policy_id=entry->>'policyId' then
        continue;
      end if;
      insert into live_exposure_exclusions(id,registry_key,publisher_name,canonical_url,source_item_id,
        published_at,first_seen_at,discovery_url,reason,content_hash,near_duplicate_signature)
      values (entry->>'versionExclusionId',entry->>'registryKey',entry->>'publisher',entry->>'canonicalUrl',
        entry->>'sourceItemId',(entry->>'publishedAt')::timestamptz,(entry->>'capturedAt')::timestamptz,
        entry->>'discoveryUrl','live_feed_discovery',entry->>'contentHash',entry->>'signature')
      on conflict (id) do nothing;
      receipt_exclusion_id := existing_article.live_exposure_id;
    else
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
      receipt_exclusion_id := entry->>'exclusionId';
    end if;
    insert into live_acquisition_receipts(id,source_id,policy_id,exclusion_id,discovery_channel,discovery_channel_detail,discovery_url,
      discovered_url,canonical_url,source_item_id,published_at,modified_at,original_published_at,
      original_modified_at,seen_at,raw_payload_hash,adapter_version,disposition,error_code)
    values (entry->>'receiptId',entry->>'sourceId',entry->>'policyId',receipt_exclusion_id,
      case when entry->>'discoveryChannel'='news_sitemap' then 'rss_atom' else entry->>'discoveryChannel' end,
      entry->>'discoveryChannel',entry->>'discoveryUrl',
      entry->>'discoveredUrl',entry->>'canonicalUrl',entry->>'sourceItemId',
      (entry->>'publishedAt')::timestamptz,(entry->>'modifiedAt')::timestamptz,entry->>'originalPublishedAt',
      entry->>'originalModifiedAt',(entry->>'capturedAt')::timestamptz,entry->>'rawPayloadHash',
      entry->>'adapterVersion','PERSISTED',null);
    if existing_article.id is not null then
      insert into live_article_versions(id,article_id,receipt_id,version_number,metadata_hash,headline,excerpt,
        author,published_at,modified_at,declared_upstream,content_hash,near_duplicate_signature,recorded_at)
      values (entry->>'versionId',existing_article.id,entry->>'receiptId',latest_version.version_number+1,
        entry->>'metadataHash',entry->>'headline',entry->>'excerpt',entry->>'author',
        (entry->>'publishedAt')::timestamptz,(entry->>'modifiedAt')::timestamptz,entry->>'declaredUpstream',
        entry->>'contentHash',entry->>'signature',(entry->>'capturedAt')::timestamptz);
      continue;
    end if;
    insert into articles(id,source_id,event_id,url_canonical,text_original,text_normalized,lang,published_at,
      captured_at,updated_at_source,declares_wire,syndication_of,syndication_confidence,clustering_score,
      processing_error,origin,live_exposure_id)
    values (entry->>'articleId',entry->>'sourceId',null,entry->>'canonicalUrl',entry->>'articleText',entry->>'normalizedText',
      entry->>'language',(entry->>'publishedAt')::timestamptz,(entry->>'capturedAt')::timestamptz,
      (entry->>'modifiedAt')::timestamptz,entry->>'declaredUpstream',null,null,null,null,'LIVE_REAL',entry->>'exclusionId');
    insert into live_article_versions(id,article_id,receipt_id,version_number,metadata_hash,headline,excerpt,
      author,published_at,modified_at,declared_upstream,content_hash,near_duplicate_signature,recorded_at)
    values (entry->>'versionId',entry->>'articleId',entry->>'receiptId',1,entry->>'metadataHash',entry->>'headline',entry->>'excerpt',
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
    if not 1 <= len(items) <= 1200 or age > dt.timedelta(minutes=15) or age < dt.timedelta(minutes=-5):
        raise RuntimeError('PREPARED_BATCH_MISSING_OR_EXPIRED')
    for item in items:
        storage_policy = item.get('storagePolicy')
        excerpt = item.get('excerpt')
        if storage_policy not in ('METADATA_ONLY', 'METADATA_AND_FEED_EXCERPT'):
            raise RuntimeError('PREPARED_STORAGE_POLICY_INVALID')
        if storage_policy == 'METADATA_ONLY' and excerpt is not None:
            raise RuntimeError('PREPARED_BATCH_CONTAINS_UNAUTHORIZED_EXCERPT')
        if excerpt is not None and (
            not isinstance(excerpt, str) or not excerpt.strip() or len(excerpt) > 700
        ):
            raise RuntimeError('PREPARED_FEED_EXCERPT_INVALID')
    target_date = prepared.get('targetDate')
    if not isinstance(target_date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', target_date):
        raise RuntimeError('PREPARED_TARGET_DATE_INVALID')
    if prepared.get('matchedArticleCount') != len(items) or not isinstance(prepared.get('expectedArticleCount'), int):
        raise RuntimeError('PREPARED_BATCH_COUNTS_INVALID')
    if not {item.get('sourceId') for item in items}.issubset(set(SOURCE_IDS)):
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
    results = query(f"""select s.name,count(*)::int articles_today,
        count(*) filter (where v.excerpt is not null)::int with_feed_excerpt
      from articles a join sources s on s.id=a.source_id
      join lateral (select excerpt from live_article_versions where article_id=a.id order by version_number desc limit 1) v on true
      where a.origin='LIVE_REAL' and (a.published_at at time zone 'America/Santiago')::date='{target_date}'::date
        and a.source_id in ({','.join(chr(39)+value+chr(39) for value in SOURCE_IDS)})
      group by s.name order by s.name""", True)
    print(json.dumps(results, ensure_ascii=False))
    PREPARED.unlink(missing_ok=True)
    BATCH_KEY.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'dry-run', 'apply'])
    action = parser.parse_args().action
    try:
        prepare() if action == 'prepare' else write(action == 'dry-run')
    except Exception as error:
        print(f'INGESTION_FAILED: {error}', file=sys.stderr)
        sys.exit(1)
