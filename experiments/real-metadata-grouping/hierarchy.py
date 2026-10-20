#!/usr/bin/env python3
"""Two-level metadata-only hypotheses; never invoke semantic model or write DB."""
import argparse
from datetime import date
from itertools import combinations
import hashlib
import json
from pathlib import Path
import re
from signatures import signature

VERSION="hierarchical-headline-baseline-v1"

def compatible(a,b,kind):
    if a["publisher"]==b["publisher"]:
        return False,"SAME_PUBLISHER"
    gap=abs((date.fromisoformat(a["date"])-date.fromisoformat(b["date"])).days)
    if kind=="occurrence":
        if a["multi"] or b["multi"]:
            return False,"MULTIPLE_FACTS_IN_ONE_TITLE"
        if not a["place"] or not b["place"] or not a["hazard"] or not b["hazard"]:
            return False,"UNKNOWN_PLACE_OR_HAZARD"
        if (a["place"],a["hazard"])!=(b["place"],b["hazard"]):
            return False,"DIFFERENT_PLACE_OR_HAZARD"
        if a["focus"]!=b["focus"]:
            return False,"DIFFERENT_FOCAL_ACTION"
        if (a["venue"] or b["venue"]) and a["venue"]!=b["venue"]:
            return False,"MISSING_SHARED_VENUE"
        if gap>2:
            return False,"PUBLICATION_GAP"
        return True,"SAME_PLACE_HAZARD_ACTION_AND_VENUE"
    if gap>4:
        return False,"PUBLICATION_GAP"
    if a["oct18"] and b["oct18"]:
        return True,"SHARED_NAMED_PUBLIC_PROTEST_THREAD"
    if not a["place"] or not b["place"] or not a["hazard"] or not b["hazard"]:
        return False,"UNKNOWN_THREAD_ANCHOR"
    if (a["place"],a["hazard"])!=(b["place"],b["hazard"]):
        return False,"DIFFERENT_THREAD"
    if a["venue"] and b["venue"] and a["venue"]!=b["venue"]:
        return False,"DIFFERENT_NAMED_VENUE"
    return True,"SAME_PLACE_AND_TOPIC_NOT_SAME_OCCURRENCE"

def grouped(ids,edges):
    parent={x:x for x in ids}
    def find(x):
        while x!=parent[x]:
            parent[x]=parent[parent[x]]
            x=parent[x]
        return x
    for item in edges:
        a,b=item["ids"]
        a,b=find(a),find(b)
        if a!=b:parent[max(a,b)]=min(a,b)
    groups={}
    for x in ids:groups.setdefault(find(x),[]).append(x)
    return sorted((sorted(m) for m in groups.values() if len(m)>1),key=lambda g:g[0])

def run(corpus):
    if corpus.get("schema")!="public-real-metadata-only-v1" or corpus.get("source_text_acquired") is not False:
        raise ValueError("NOT_APPROVED_METADATA_INPUT")
    rows=corpus.get("articles")
    if not isinstance(rows,list) or not 2<=len(rows)<=48:
        raise ValueError("CORPUS_SIZE")
    seen,urls,sigs=set(),set(),{}
    for item in rows:
        if set(item)!={"id","publisher","headline","published_on","canonical_url"}:
            raise ValueError("UNAPPROVED_SOURCE_FIELDS")
        id_=item["id"]
        if not isinstance(id_,str) or not re.fullmatch("[a-z][0-9]{2,3}",id_):
            raise ValueError("DOCUMENT_ID")
        if any(not isinstance(item[k],str) or not item[k] for k in item):
            raise ValueError("INCOMPLETE_METADATA")
        if id_ in seen or item["canonical_url"] in urls:
            raise ValueError("DUPLICATE_SOURCE")
        seen.add(id_);urls.add(item["canonical_url"])
        sigs[id_]=signature(item)
    occ,thread=[],[]
    ids=sorted(seen)
    for a,b in combinations(ids,2):
        for kind,destination in (("occurrence",occ),("thread",thread)):
            yes,why=compatible(sigs[a],sigs[b],kind)
            if yes:
                destination.append({"ids":[a,b],"reason":why,"status":"UNVERIFIED_CANDIDATE"})
    occurrences=grouped(ids,occ)
    threads=grouped(ids,thread)
    return {
      "version":VERSION,"input_count":len(ids),"metadata_only":True,
      "semantic_model_executed":False,"database_writes":0,
      "contradictions_detected":0,"unverified":True,
      "occurrence_edges":occ,"thread_edges":thread,
      "occurrence_groups":[{"members":g,"kind":"BOUNDED_OCCURRENCE_HYPOTHESIS"} for g in occurrences],
      "thread_groups":[{"members":g,"kind":"EVOLVING_THREAD_HYPOTHESIS"} for g in threads],
      "occurrence_singletons":sorted(set(ids)-set(sum(occurrences,[]))),
      "thread_singletons":sorted(set(ids)-set(sum(threads,[]))),
      "abstentions":{id_:"UNKNOWN_BOUNDED_OCCURRENCE"
                     for id_,s in sorted(sigs.items()) if s["multi"] or not s["place"] or not s["hazard"]},
      "signals":sigs,
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args()
    path=Path(a.input); dest=Path(a.output)
    result=run(json.loads(path.read_text(encoding="utf-8")))
    dest.write_text(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf-8")
    print("VERSION="+VERSION)
    print("INPUT_SHA256="+hashlib.sha256(path.read_bytes()).hexdigest())
    print("OUTPUT_SHA256="+hashlib.sha256(dest.read_bytes()).hexdigest())
    print("OCCURRENCE_GROUPS="+str(len(result["occurrence_groups"])))
    print("THREAD_GROUPS="+str(len(result["thread_groups"])))
    print("OCCURRENCE_EDGES="+str(len(result["occurrence_edges"])))
    print("THREAD_EDGES="+str(len(result["thread_edges"])))
    print("SQL_WRITES=0")
    print("V10_11_R14_CALLS=0")

if __name__=="__main__":main()
