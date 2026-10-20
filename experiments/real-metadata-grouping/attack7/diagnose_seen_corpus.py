#!/usr/bin/env python3
"""Developer diagnostic on ALREADY EXPOSED Attack-6 public metadata, no Gold."""
from __future__ import annotations
from collections import Counter,defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from attack7 import make_graph

def main():
    folder=Path(__file__).resolve().parent
    raw=(folder.parent/"attack6-prospective/corpus.json").read_bytes()
    corpus=json.loads(raw)
    strata=json.loads((folder.parent/"attack6-prospective/collection_evidence.json").read_text(encoding="utf8"))
    s={a["id"]:a["grouping_stratum"] for a in strata["rows"]}
    output=make_graph(corpus)
    articles=output["article_facets"]
    role=defaultdict(Counter)
    family=defaultdict(Counter)
    facilities=defaultdict(Counter)
    observation=defaultdict(Counter)
    for a in articles:
        group=s[a["article_id"]]
        role[group][a["primary_documentary_action"]]+=1
        for k in a["phenomena"]: family[group][k]+=1
        for k in a["facility_aliases"]:facilities[group][k]+=1
        for k in a["reported_numeric_observations"]:
            observation[group][k["kind"]]+=1
    links=defaultdict(int)
    for a in output["retrieval_candidates"]:
        left,right=a["ids"]
        key=s[left] if s[left]==s[right] else "CROSS_DOMAIN"
        links[key]+=1
    res={
      "scope":"KNOWN_DEV_CORPUS_NOT_SCIENTIFIC_EVALUATION",
      "documents":output["article_count"],"graph_nodes":len(output["nodes"]),
      "graph_edges":len(output["edges"]),
      "candidate_review_pairs":output["candidate_count"],
      "primary_documentary_actions":{k:dict(v) for k,v in role.items()},
      "phenomenon_mentions":{k:dict(v) for k,v in family.items()},
      "facility_mentions":{k:dict(v) for k,v in facilities.items()},
      "observation_proposals":{k:dict(v) for k,v in observation.items()},
      "retrieved_by_domain":dict(links),
      "input_sha256":sha256(raw).hexdigest(),
      "scientific_gold":"NOT_USED",
      "asserted_same_occurrence_edges":output["asserted_same_occurrence_edges"],
      "asserted_contradictions":output["asserted_contradictions"],
      "writes":output["database_writes"],
      "production_permission":output["production_permission"],
    }
    print("ATTACK7_DEV_DIAGNOSTIC="+json.dumps(res,ensure_ascii=False,sort_keys=True))

if __name__=="__main__":
    main()
