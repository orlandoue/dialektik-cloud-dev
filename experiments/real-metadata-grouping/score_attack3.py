#!/usr/bin/env python3
"""Separated Attack-3 evaluator. NEVER imported by attack3.py/predictor job.

Consumes frozen prediction JSON and independently adjudicated all-pairs
reference, checks hashes/coverage and computes pair and cluster diagnostics.
Not an R14/V10.11 evaluator.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
from itertools import combinations
import json
from pathlib import Path

LABELS = ('SAME_OCCURRENCE', 'SAME_THREAD_DIFFERENT_OCCURRENCE', 'UNRELATED', 'UNKNOWN')
KEYS = {'ids', 'expected'}

def pair(a: str, b: str) -> tuple[str, str]:
    if a == b: raise ValueError('SELF_PAIR')
    return tuple(sorted((a, b)))

def read_json(path: str):
    content = Path(path).read_bytes()
    return json.loads(content), sha256(content).hexdigest()

def score(corpus: dict, predictions: dict, reference: dict, corpus_digest: str) -> dict:
    if corpus.get('schema') != 'public-real-metadata-only-v1':
        raise ValueError('CORPUS_SCHEMA')
    docs = corpus.get('articles', [])
    ids = [x['id'] for x in docs]
    if len(set(ids)) != len(ids) or not ids: raise ValueError('CORPUS_IDS')
    if predictions.get('version') != 'typed-occurrence-metadata-v3-preprospective' or (
        predictions.get('metadata_only') is not True or
        predictions.get('production_permission') is not False or
        predictions.get('database_writes') != 0 or
        predictions.get('semantic_model_executed') is not False or
        predictions.get('input_count') != len(ids)
    ):
        raise ValueError('PREDICTION_CONTRACT')
    if reference.get('schema') != 'attack3-independent-pair-reference-v1':
        raise ValueError('REFERENCE_SCHEMA')
    if reference.get('corpus_sha256') != corpus_digest:
        raise ValueError('REFERENCE_CORPUS_HASH_MISMATCH')
    adjudication = reference.get('adjudication', {})
    if not isinstance(adjudication, dict) or adjudication.get('independent_annotators', 0) < 2 or not adjudication.get('conflicts_resolved'):
        raise ValueError('INDEPENDENT_ADJUDICATION_NOT_PROVEN')
    expected_pairs = {pair(a,b) for a,b in combinations(sorted(ids), 2)}
    predicted = {}
    for p in predictions.get('pair_decisions', []):
        ab = pair(*p['ids'])
        if ab in predicted or p['decision'] not in LABELS:
            raise ValueError('INVALID_PREDICTED_PAIRS')
        predicted[ab] = p['decision']
    if set(predicted) != expected_pairs: raise ValueError('INCOMPLETE_PREDICTIONS')
    gold = {}
    for p in reference.get('pairs', []):
        if set(p) != KEYS or p['expected'] not in LABELS:
            raise ValueError('INVALID_REFERENCE_ROW')
        ab = pair(*p['ids'])
        if ab in gold: raise ValueError('DUPLICATE_REFERENCE_PAIR')
        gold[ab] = p['expected']
    if set(gold) != expected_pairs: raise ValueError('REFERENCE_NOT_EXHAUSTIVE_ALL_PAIRS')

    confusion = {g: {p:0 for p in LABELS} for g in LABELS}
    disagreements = []
    for ab in sorted(expected_pairs):
        g, p = gold[ab],predicted[ab]
        confusion[g][p] += 1
        if g != p: disagreements.append({'ids':list(ab), 'expected':g, 'predicted':p})
    per_class = {}
    for label in LABELS:
        tp = confusion[label][label]
        fp = sum(confusion[truth][label] for truth in LABELS if truth != label)
        fn = sum(confusion[label][guess] for guess in LABELS if guess != label)
        precision = tp/(tp+fp) if tp+fp else None
        recall = tp/(tp+fn) if tp+fn else None
        f1 = (2*precision*recall/(precision+recall) if precision is not None and
              recall is not None and precision+recall else None)
        per_class[label] = {'tp':tp,'fp':fp,'fn':fn,'precision':precision,'recall':recall,'f1':f1}
    scorable = [k for k in expected_pairs if gold[k] != 'UNKNOWN']
    covered = [k for k in scorable if predicted[k] != 'UNKNOWN']
    wrong = [k for k in covered if predicted[k] != gold[k]]
    # Exact matching on fully adjudicated pairs only; include selective risk.
    predicted_groups = predictions.get('occurrence_groups', [])
    members = set()
    pgroup_pairs = set()
    for group in predicted_groups:
        gg = group.get('members', [])
        if len(gg) < 2 or len(set(gg)) != len(gg) or not set(gg).issubset(ids) or members.intersection(gg):
            raise ValueError('INVALID_GROUP_PARTITION')
        members.update(gg)
        pgroup_pairs.update(pair(a,b) for a,b in combinations(gg,2))
    impure = sum(any(gold[ab] not in ('SAME_OCCURRENCE','UNKNOWN') for ab in
                    (pair(a,b) for a,b in combinations(group['members'],2)))
                 for group in predicted_groups)
    known_positives = {ab for ab in expected_pairs if gold[ab] == 'SAME_OCCURRENCE'}
    return {
      'execution':'SCORER_EXECUTED',
      'scientific_gate':'NO_GO_PENDING_EXTERNAL_REVIEW',
      'production_permission':False,
      'documents':len(ids),'pairs':len(expected_pairs),
      'confusion_matrix':confusion, 'per_class':per_class,
      'eligible_pairs':len(scorable),'covered_pairs':len(covered),
      'selective_coverage':len(covered)/len(scorable) if scorable else None,
      'selective_error_rate':len(wrong)/len(covered) if covered else None,
      'group_precision':len(pgroup_pairs & known_positives)/len(pgroup_pairs) if pgroup_pairs else None,
      'group_recall':len(pgroup_pairs & known_positives)/len(known_positives) if known_positives else None,
      'impure_predicted_clusters':impure,
      'false_group_joins':len({ab for ab in pgroup_pairs if gold[ab] not in ('SAME_OCCURRENCE','UNKNOWN')}),
      'missed_positive_group_pairs':len(known_positives - pgroup_pairs),
      'disagreements':disagreements,
      'limits':['Requires two independently collected and conflict-resolved annotations.',
                'UNKNOWN gold pairs excluded from selective-coverage denominator.',
                'Cluster errors with UNKNOWN gold are not adjudicated as false merges.',
                'Scientific gate deliberately remains NO_GO until protocol review.']}

def main():
    p = argparse.ArgumentParser()
    for name in ('corpus','predictions','reference','out'):
        p.add_argument('--'+name,required=True)
    args=p.parse_args()
    corpus,corpus_digest=read_json(args.corpus)
    predictions,pred_digest=read_json(args.predictions)
    reference,ref_digest=read_json(args.reference)
    result=score(corpus,predictions,reference,corpus_digest)
    result.update({'corpus_sha256':corpus_digest,'predictions_sha256':pred_digest,'reference_sha256':ref_digest})
    Path(args.out).write_text(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)+'\n',encoding='utf-8')
    print('SCORER_EXECUTED=true')
    print('SCIENTIFIC_GATE=NO_GO_PENDING_EXTERNAL_REVIEW')
    print('PRODUCTION_PERMISSION=FALSE')

if __name__=='__main__':main()
