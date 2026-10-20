#!/usr/bin/env python3
"""AFTER frozen prediction: source-stratified failure analysis, no Gold and no tuning."""
from __future__ import annotations
from collections import Counter,defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import attack6

ROOT=Path(__file__).resolve().parent
EXPECTED_INPUT_SHA="a999efe12709fdf38354bb3e17a8350bbfe8996dd3789f2458c89a3451006105"
EXPECTED_PRED_SHA="b2912cfe7882102a45fd380df444136ca6aa609bf21abcaabd328d5af95bfe57"

def main():
    b=(ROOT/"corpus.json").read_bytes()
    assert sha256(b).hexdigest()==EXPECTED_INPUT_SHA
    corpus=json.loads(b)
    evidence=json.loads((ROOT/"collection_evidence.json").read_text(encoding="utf8"))
    pred=attack6.run(corpus)
    canonical=(json.dumps(pred,ensure_ascii=False,indent=2,sort_keys=True)+"\n").encode()
    assert sha256(canonical).hexdigest()==EXPECTED_PRED_SHA, "CANDIDATE_OUTPUT_CHANGED"
    strata={x["id"]:x["grouping_stratum"] for x in evidence["rows"]}
    role_counts=defaultdict(Counter); geography=defaultdict(Counter)
    for article in pred["articles"]:
        group=strata[article["id"]]
        role_counts[group][article["primary_action"]]+=1
        geography[group]["GEO_PRESENT" if article["geography"] else "GEO_ABSENT"]+=1
    by_pair=defaultdict(Counter)
    for p in pred["pair_decisions"]:
        left,right=p["ids"]; a,b=strata[left],strata[right]
        key=a if a==b else "CROSS_STRATUM"
        by_pair[key]["PAIRS_TOTAL"]+=1
        if p["retrieved"]:by_pair[key]["RETRIEVED"]+=1
        by_pair[key][p["decision"]]+=1
        by_pair[key]["REASON:"+p["reason"]]+=1
    summary={
      "scientific_gate":"NO_GO_ZERO_COVERAGE",
      "scope":"POST_PREDICTION_CATEGORICAL_DIAGNOSTIC_NOT_GOLD",
      "input_sha256":EXPECTED_INPUT_SHA,"prediction_sha256":EXPECTED_PRED_SHA,
      "per_stratum_role_counts":{k:dict(v) for k,v in sorted(role_counts.items())},
      "per_stratum_geography_counts":{k:dict(v) for k,v in sorted(geography.items())},
      "per_stratum_pair_counts":{k:dict(v) for k,v in sorted(by_pair.items())},
      "independent_annotation_performed":False,
      "candidate_modified":False,"production_permission":False
    }
    print("ATTACK6_FROZEN_DIAGNOSTIC="+json.dumps(summary,ensure_ascii=False,sort_keys=True))

if __name__=="__main__":
    main()
