#!/usr/bin/env python3
"""Attack 3: conservative offline metadata-only typed occurrence hypotheses.

Research-only. No source fetch, database writes, V10.11 inference or contradictions.
Depends on the unchanged Attack-2 signatures.py vocabulary.
"""
from __future__ import annotations
import argparse
from datetime import date
import hashlib
from itertools import combinations
import json
from pathlib import Path
import re
from signatures import normalize, signature

VERSION = 'typed-occurrence-metadata-v3-preprospective'
MAX_ARTICLES = 48
THREAD_PUBLICATION_WINDOW_DAYS = 4
SPEECH = re.compile(r'\b(alcalde|alcaldesa|ministro|ministra|presidente|presidenta|anuncia|anuncio|asegura|aseguro|afirma|afirmo|declara|declaro|proyecta|proyecto|instruye|instruyo|explica|explico|advierte|advirtio|senala|dijo)\b')
RETROSPECTIVE = re.compile(r'\b(imagenes|fotografias|registro|muestran|causo|causados|tras|despues|danos)\b')
MULTI_ACT = re.compile(r'\b(otro atacado|varios incidentes|hechos de violencia|y un intento de saqueo|al menos dos incendios)\b')

def evidence(row: dict) -> dict:
    """Article-local observations: not authoritative occurrence IDs."""
    prior = signature(row)
    title = normalize(row['headline'])
    speech = bool(SPEECH.search(title))
    retrospective = bool(RETROSPECTIVE.search(title))
    multi = bool(prior['multi'] or MULTI_ACT.search(title))
    primary = ('UNKNOWN' if multi else
               'COMMUNICATION' if speech else
               'PHYSICAL_REPORT' if prior['hazard'] and not retrospective else
               'RETROSPECTIVE_PHYSICAL_REPORT' if prior['hazard'] and retrospective else
               'UNKNOWN')
    observations = [{'relation': 'REPORTS_PRIMARY', 'action_kind': primary,
                     'evidence_field': 'headline', 'evidence_text': row['headline']}]
    if primary == 'COMMUNICATION' and prior['hazard'] is not None:
        observations.append({'relation': 'MENTIONS_CONTEXT', 'action_kind': 'PHYSICAL_EVENT',
                             'evidence_field': 'headline', 'evidence_text': row['headline']})
    return {'id': row['id'], 'publisher': row['publisher'],
            'canonical_url': row['canonical_url'], 'published_on': row['published_on'],
            'event_time': None, 'event_time_status': 'UNRESOLVED_FROM_METADATA',
            'place': prior['place'], 'hazard': prior['hazard'], 'venue': prior['venue'],
            'primary_action': primary, 'multi_occurrence_or_ambiguous': multi,
            'observations': observations, 'claim_extraction': 'NOT_PERFORMED_METADATA_ONLY'}

def classify(a: dict, b: dict) -> tuple[str, str]:
    """Four-way hypothesis, never authoritative equivalence."""
    if a['canonical_url'] == b['canonical_url']:
        return 'UNKNOWN', 'DUPLICATE_CANONICAL_URL'
    if a['multi_occurrence_or_ambiguous'] or b['multi_occurrence_or_ambiguous']:
        return 'UNKNOWN', 'MULTI_OCCURRENCE_NOT_RESOLVED'
    if not a['place'] or not b['place'] or not a['hazard'] or not b['hazard']:
        return 'UNKNOWN', 'MISSING_EXPLICIT_ANCHOR'
    if a['place'] != b['place'] or a['hazard'] != b['hazard']:
        return 'UNRELATED', 'DIFFERENT_EXPLICIT_PLACE_OR_HAZARD'
    if a['venue'] and b['venue'] and a['venue'] != b['venue']:
        return 'UNKNOWN', 'DIFFERENT_VENUE_WITHIN_TOPIC'
    window = abs((date.fromisoformat(a['published_on']) -
                  date.fromisoformat(b['published_on'])).days)
    if window > THREAD_PUBLICATION_WINDOW_DAYS:
        return 'UNKNOWN', 'OUTSIDE_RETRIEVAL_WINDOW_NOT_EVENT_TIME_PROOF'
    x, y = a['primary_action'], b['primary_action']
    physical = {'PHYSICAL_REPORT', 'RETROSPECTIVE_PHYSICAL_REPORT'}
    if x in physical and y in physical and a['venue'] and a['venue'] == b['venue'] and window <= 2:
        return 'SAME_OCCURRENCE', 'EXPLICIT_SHARED_PLACE_HAZARD_VENUE_PHYSICAL_REFERENCE'
    if (x == 'COMMUNICATION' and y in physical) or (y == 'COMMUNICATION' and x in physical):
        return 'SAME_THREAD_DIFFERENT_OCCURRENCE', 'COMMUNICATIVE_ACT_MENTIONS_PHYSICAL_INCIDENT'
    if x == 'COMMUNICATION' and y == 'COMMUNICATION':
        return 'UNKNOWN', 'SAME_TOPIC_SPEECH_ACT_IDENTITY_UNRESOLVED'
    if x == 'UNKNOWN' or y == 'UNKNOWN':
        return 'UNKNOWN', 'ACTION_NOT_RESOLVED'
    return 'UNKNOWN', 'INSUFFICIENT_BOUNDED_OCCURRENCE_EVIDENCE'

def complete_link(ids: list[str], positive: set[tuple[str, str]]) -> list[list[str]]:
    """Deterministic conservative clique partition, never single-link closure."""
    groups: list[list[str]] = []
    for current in sorted(ids):
        candidates = [i for i, g in enumerate(groups)
                      if all(tuple(sorted((current, x))) in positive for x in g)]
        if len(candidates) == 1:
            groups[candidates[0]].append(current)
        else:
            groups.append([current])
    return [g for g in groups if len(g) > 1]

def run(corpus: dict) -> dict:
    if corpus.get('schema') != 'public-real-metadata-only-v1' or corpus.get('source_text_acquired') is not False:
        raise ValueError('INVALID_METADATA_CONTRACT')
    rows = corpus.get('articles')
    if not isinstance(rows, list) or not 2 <= len(rows) <= MAX_ARTICLES:
        raise ValueError('CORPUS_SIZE')
    docs: dict[str, dict] = {}
    seen_urls: set[str] = set()
    for r in rows:
        if not isinstance(r, dict) or set(r) != {'id', 'publisher', 'headline', 'published_on', 'canonical_url'}:
            raise ValueError('UNAPPROVED_FIELDS')
        if not all(isinstance(v, str) and v for v in r.values()) or not re.fullmatch(r'[a-z][0-9]{2,3}', r['id']):
            raise ValueError('INVALID_ROW')
        date.fromisoformat(r['published_on'])
        if r['id'] in docs or r['canonical_url'] in seen_urls:
            raise ValueError('DUPLICATE_INPUT')
        seen_urls.add(r['canonical_url'])
        docs[r['id']] = evidence(r)
    ids = sorted(docs)
    pairs = []
    positives: set[tuple[str, str]] = set()
    for a, b in combinations(ids, 2):
        status, reason = classify(docs[a], docs[b])
        pairs.append({'ids': [a, b], 'decision': status, 'reason': reason, 'authority': 'CANDIDATE_ONLY'})
        if status == 'SAME_OCCURRENCE':
            positives.add((a, b))
    groups = complete_link(ids, positives)
    return {'version': VERSION, 'input_count': len(ids), 'metadata_only': True,
            'semantic_model_executed': False, 'database_writes': 0,
            'contradictions_detected': 0, 'production_permission': False,
            'articles': [docs[k] for k in ids], 'pair_decisions': pairs,
            'occurrence_groups': [{'members': g, 'status': 'UNVERIFIED_COMPLETE_LINK_HYPOTHESIS'}
                                  for g in groups],
            'no_group': sorted(set(ids) - set(x for group in groups for x in group)),
            'limitations': [
                'Metadata-only action interpretation is heuristic.',
                'No extracted event time, actor identity, claims, or contradictions.',
                'Fixed Attack-2 place/hazard lexicon; unknown outside coverage.',
                'No licensed body, live ingestion, or authoritative Event writes.'
            ]}

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    raw = Path(args.input).read_bytes()
    result = run(json.loads(raw))
    out = (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')
    Path(args.output).write_bytes(out)
    print('VERSION=' + VERSION)
    print('INPUT_SHA256=' + hashlib.sha256(raw).hexdigest())
    print('OUTPUT_SHA256=' + hashlib.sha256(out).hexdigest())
    print('GROUP_COUNT=' + str(len(result['occurrence_groups'])))
    print('DATABASE_WRITES=0')
    print('PRODUCTION_PERMISSION=FALSE')

if __name__ == '__main__':
    main()
