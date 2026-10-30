#!/usr/bin/env python3
"""Fetch the 32 reviewed public YouTube Atom feeds for a short-lived GitHub artifact."""
import datetime as dt
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / 'packages/database/src/migration/054_chile_feed_excerpt_and_youtube_sources.ts'
AGENT = 'DialektikRSSMetadata/1.0'
MAX_FEED_BYTES = 2_000_000


def serialized(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def channel_catalog():
    content = CATALOG.read_text(encoding='utf-8')
    match = re.search(r'const YOUTUBE_CHANNELS = (\[.*?\]) as const;', content, re.S)
    if not match:
        raise RuntimeError('YOUTUBE_CATALOG_NOT_FOUND')
    channels = json.loads(match.group(1))
    if len(channels) != 32 or len({entry.get('source_id') for entry in channels}) != 32:
        raise RuntimeError('YOUTUBE_CATALOG_INVALID')
    return channels


def fetch(channel):
    endpoint = channel.get('atom_feed_endpoint', '')
    parsed = urllib.parse.urlsplit(endpoint)
    if (parsed.scheme != 'https' or parsed.hostname != 'www.youtube.com'
            or parsed.path != '/feeds/videos.xml' or parsed.username or parsed.password
            or parsed.fragment or not (parsed.query.startswith('channel_id=') or parsed.query.startswith('user='))):
        raise ValueError('SOURCE_ENDPOINT_IDENTITY_INVALID')

    robots_url = 'https://www.youtube.com/robots.txt'
    request = urllib.request.Request(robots_url, headers={'User-Agent': AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        final = urllib.parse.urlsplit(response.geturl())
        if final.scheme != 'https' or final.hostname not in ('youtube.com', 'www.youtube.com'):
            raise ValueError('ROBOTS_REDIRECT_INVALID')
        raw_robots = response.read(100_001)
        if len(raw_robots) > 100_000:
            raise ValueError('ROBOTS_TOO_LARGE')
    robots = urllib.robotparser.RobotFileParser()
    robots.parse(raw_robots.decode('utf-8', 'strict').splitlines())
    if not robots.can_fetch(AGENT, endpoint):
        raise ValueError('ROBOTS_DISALLOWS_FEED')

    request = urllib.request.Request(endpoint, headers={
        'User-Agent': AGENT,
        'Accept': 'application/atom+xml, application/xml, text/xml',
    })
    with urllib.request.urlopen(request, timeout=25) as response:
        final = urllib.parse.urlsplit(response.geturl())
        if final.scheme != 'https' or final.hostname != 'www.youtube.com' or final.path != '/feeds/videos.xml':
            raise ValueError('FEED_REDIRECT_INVALID')
        raw = response.read(MAX_FEED_BYTES + 1)
        if len(raw) > MAX_FEED_BYTES:
            raise ValueError('FEED_TOO_LARGE')
        if 'xml' not in response.headers.get('Content-Type', '').lower():
            raise ValueError('FEED_CONTENT_TYPE_INVALID')
    xml = raw.decode('utf-8', 'strict')
    if '<feed' not in xml[:4096] or 'www.youtube.com/xml/schemas/2015' not in xml[:8192]:
        raise ValueError('YOUTUBE_ATOM_IDENTITY_INVALID')
    return xml


def parse_channel(channel, xml):
    source = {
        'id': channel['source_id'],
        'policy_id': channel['policy_id'],
        'name': channel['name'],
        'canonical_domain': channel['canonical_domain'],
        'registry_key': channel['registry_key'],
        'endpoint': channel['atom_feed_endpoint'],
        'discovery_channel': 'rss_atom',
        'language': 'es',
        'storage_policy': 'METADATA_AND_FEED_EXCERPT',
        'canonical_path_aliases': {},
    }
    process = subprocess.run(
        ['node', str(ROOT / 'scripts/operations/chile-rss-once/prepare.mjs')],
        input=json.dumps({'source': source, 'xml': xml}, ensure_ascii=False),
        text=True, capture_output=True, timeout=30, check=True,
        env=os.environ.copy(),
    )
    result = json.loads(process.stdout)
    return result['items']


def main():
    output_path = Path(sys.argv[1] if len(sys.argv) > 1 else 'youtube-feed-manifest.json')
    entries = []
    for channel in channel_catalog():
        source_id = channel['source_id']
        endpoint = channel['atom_feed_endpoint']
        try:
            xml = fetch(channel)
            entries.append({
                'source_id': source_id,
                'endpoint': endpoint,
                'status': 'succeeded',
                'items': parse_channel(channel, xml),
            })
        except (ValueError, urllib.error.URLError, TimeoutError, UnicodeError,
                subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            entries.append({
                'source_id': source_id,
                'endpoint': endpoint,
                'status': 'failed',
                'error_code': str(error) if isinstance(error, ValueError) else type(error).__name__.upper(),
            })
    manifest = {
        'schema': 'dialektik-youtube-feed-manifest-v1',
        'fetched_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'channels': entries,
    }
    manifest['sha256'] = hashlib.sha256(serialized(manifest)).hexdigest()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    succeeded = sum(entry['status'] == 'succeeded' for entry in entries)
    candidates = sum(len(entry.get('items', [])) for entry in entries if entry['status'] == 'succeeded')
    print(f'YouTube Atom feeds fetched: {succeeded}/32; current-day candidates: {candidates}; feed content omitted from logs.')
    failures = Counter(entry['error_code'] for entry in entries if entry['status'] == 'failed')
    if failures:
        print('Feed failure codes: ' + ', '.join(
            f'{code}={count}' for code, count in sorted(failures.items())))
    if succeeded == 0:
        raise SystemExit('NO_YOUTUBE_FEEDS_FETCHED')


if __name__ == '__main__':
    main()
