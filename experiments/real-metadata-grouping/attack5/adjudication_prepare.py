#!/usr/bin/env python3
"""Create independent, prediction-free Attack-5 adjudication workbooks in JSON.

Never auto-populate occurrence labels, reviewer identities, consensus or gold.
Source cards are public metadata only; evidence is limited to available title.
"""
import argparse
from datetime import datetime
from itertools import combinations
import json
from pathlib import Path

def build(corpus,reviewer_slot):
    rows=corpus["articles"]
    ids=[r["id"] for r in rows]
    if len(rows)!=26 or len(ids)!=len(set(ids)):raise ValueError("NOT_ATTACK5_CORPUS")
    return {
      "schema":"attack5-independent-annotation-workbook-v1",
      "reviewer_slot":reviewer_slot,
      "reviewer_identity":None,
      "started_at":None,"completed_at":None,"conflict_of_interest":None,
      "prediction_artifact_access":False,
      "independent_human_adjudication":None,
      "independence_evidence":None,
      "instructions":[
        "Do NOT read ATTACK5_RESULTS, frozen predictions, or the other reviewer's workbook.",
        "Look at original publisher URL and publication date; keep source citation and uncertainty.",
        "A physical incident and the mayor/government later confirming it are different primary actions.",
        "One article may MENTION many occurrences while reporting a different primary act.",
        "Distinguish occurrence event_time (source-supported only) from published_on.",
        "Use UNKNOWN when headline/source cannot establish bounded occurrence identity.",
        "Political or institutional statements do not automatically contradict earlier casualty estimates.",
        "Use UNRELATED only for warranted distinct unrelated threads, not low text similarity.",
        "Fill reviewer identity/time independently. Do not fabricate source text or second reviewer."
      ],
      "articles":[{
        "id":r["id"],"publisher":r["publisher"],"headline":r["headline"],
        "published_on":r["published_on"],"canonical_url":r["canonical_url"],
        "article_primary_action":None,"mentions_occurrence_ids":None,
        "primary_occurrence_id":None,"thread_ids":None,"event_time_evidence":None,
        "source_evidence":None,"annotation_comment":None
      } for r in rows],
      "pairs":[{
        "ids":[a,b],
        "label":None,
        "rationale":None,
        "source_evidence_urls":None,
        "insufficient_evidence_reason":None
      } for a,b in combinations(sorted(ids),2)],
      "approved_labels":[
        "SAME_OCCURRENCE","SAME_THREAD_DIFFERENT_OCCURRENCE",
        "UNRELATED","UNKNOWN"
      ],
      "complete":False,"is_gold":False
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--corpus",required=True)
    p.add_argument("--output-dir",required=True)
    a=p.parse_args()
    corpus=json.loads(Path(a.corpus).read_text(encoding="utf8"))
    folder=Path(a.output_dir);folder.mkdir(parents=True,exist_ok=True)
    for slot in ("A","B"):
        packet=build(corpus,slot)
        path=folder/("reviewer_"+slot+"_BLANK.json")
        path.write_text(json.dumps(packet,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
        print(f"REVIEW_PACKET={path.name}; ARTICLES={len(packet['articles'])}; PAIRS={len(packet['pairs'])}; GOLD=false")
    print("REVIEWER_IDENTITIES=NOT_CREATED")
    print("INDEPENDENT_ADJUDICATION=NOT_PERFORMED")

if __name__=="__main__":main()
