#!/usr/bin/env python3
"""ATTACK5 development-only diagnostic on an ALREADY-SEEN prior corpus.

This is explicitly NOT prospective, independent, or an accuracy/quality score.
No reference labels and no changes to the frozen candidate.
"""
from collections import Counter
from pathlib import Path
import json, sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from attack5 import run

def main():
    root=Path(__file__).resolve().parents[1]
    input_path=root/"attack4-prospective/corpus.json"
    data=json.loads(input_path.read_text(encoding="utf-8"))
    pred=run(data)
    d=Counter(x["decision"] for x in pred["pair_decisions"])
    why=Counter(x["reason"] for x in pred["pair_decisions"])
    roles=Counter(x["role"] for x in pred["articles"])
    geo=Counter(x["kind"] for doc in pred["articles"] for x in doc["geography"])
    known_geo=sum(bool(x["geography"]) for x in pred["articles"])
    candidates=[{"ids":x["ids"],"decision":x["decision"],"reason":x["reason"],
                 "geo":x["evidence"]["geo_relation"]}
                for x in pred["pair_decisions"]
                if x["decision"]!="UNKNOWN"][:30]
    result={"scope":"REUSED_ATTACK4_CORPUS_NOT_A_HOLDOUT",
            "science_score":"NOT_COMPUTED",
            "old_corpus_docs":len(pred["articles"]),
            "geo_supported_articles":known_geo,
            "retrieved_pairs":pred["retrieved_pairs"],
            "predicted_decisions":dict(d),
            "reason_counts":dict(why),
            "role_counts":dict(roles),
            "typed_geo_mentions":dict(geo),
            "nonunknown_examples":candidates,
            "confidence":"UNVERIFIED_RESEARCH_HYPOTHESES",
            "production_permission":False}
    print("DEVELOPMENT_ONLY="+json.dumps(result,ensure_ascii=False,sort_keys=True))

if __name__=="__main__":main()
