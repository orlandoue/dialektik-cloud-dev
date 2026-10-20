#!/usr/bin/env python3
"""Prediction-free blank human reviewer packets for ATTACK 6 prospective metadata.

No automatic answer labels, reviewer identities, gold construction, or fake independence.
Only article title/date/publisher/link copied from a committed metadata corpus.
"""
from __future__ import annotations
import argparse
from itertools import combinations
from pathlib import Path
import hashlib
import json

VALID_KEYS={"id","headline","published_on","publisher","canonical_url"}
LABELS=["SAME_OCCURRENCE","SAME_THREAD_DIFFERENT_OCCURRENCE","UNRELATED","UNKNOWN"]

def build(raw:bytes,slot:str)->dict:
    obj=json.loads(raw)
    docs=obj["articles"]
    if obj["schema"]!="public-real-metadata-only-v1" or obj["source_text_acquired"] is not False or len(docs)!=31:
        raise ValueError("CORPUS_NOT_REGISTERED")
    ids=[x["id"] for x in docs]
    if len(set(ids))!=31 or any(set(a)!=VALID_KEYS for a in docs):
        raise ValueError("SOURCE_CONTRACT_OR_DUPLICATE_IDS")
    return {
      "schema":"attack6-blank-independent-review-v1",
      "scope":"SOURCE_METADATA_ONLY_NOT_WORLD_GOLD",
      "source_corpus_sha256":hashlib.sha256(raw).hexdigest(),
      "reviewer_slot":slot,
      "reviewer_actual_identity":None,
      "review_start_time":None,"review_end_time":None,
      "prediction_access":False,
      "other_reviewer_labels_access":False,
      "reviewer_independence_attested":None,
      "review_instructions":[
        "Two separate REAL humans must independently review original publisher material where authorized.",
        "No model predictions, other reviewer's conclusions or prior episode labels are visible.",
        "An original physical occurrence may be MENTIONED in an article whose primary action is a separate correction, official statement or report.",
        "Explicitly separate event-time source evidence from publication date; no fabricated event time.",
        "Different numerical balances at different observation times are not contradictions by themselves.",
        "A statement/denial is not automatically evidence that the referenced proposition is false.",
        "Articles reporting multiple bounded occurrences may require multiple links; do not force a single event.",
        "UNKNOWN is required where primary identity or thread cannot be established.",
        "For each pair give support URLs, quote locations or abstention reason; copyright and source rights apply.",
        "Record actual reviewer identity, independent timestamps, evidence access limits and conflicts truthfully.",
        "This file is BLANK; leaving it blank is never evaluation PASS."
      ],
      "articles":[{
        **{k:x[k] for k in ("id","publisher","headline","published_on","canonical_url")},
        "primary_action_label":None,
        "primary_action_evidence_url":None,
        "context_occurrence_ids":None,
        "primary_occurrence_id":None,
        "thread_ids":None,
        "event_time_evidence":None,
        "multi_occurrence_annotation":None,
        "source_access_status":None,
        "reviewer_comment":None
      } for x in docs],
      "pairs":[{
        "ids":[a,b],"label":None,
        "evidence_urls":None,"temporal_scope_rationale":None,
        "adjudicator_explanation":None
      } for a,b in combinations(sorted(ids),2)],
      "allowed_pair_labels":LABELS,
      "complete":False,"gold":False,
      "independent_editorial_review_performed":False
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--corpus",required=True)
    p.add_argument("--output-dir",required=True)
    a=p.parse_args()
    raw=Path(a.corpus).read_bytes()
    root=Path(a.output_dir)
    root.mkdir(parents=True,exist_ok=True)
    for slot in "AB":
        data=build(raw,slot)
        path=root/f"reviewer_{slot}_BLANK.json"
        path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(f"PACKET={path.name},ITEMS={len(data['articles'])},PAIRS={len(data['pairs'])},GOLD=false")
    print("ACTUAL_REVIEWERS=0")
    print("EDITORIAL_GOLD=NOT_CREATED")

if __name__=="__main__":
    main()
