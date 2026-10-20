#!/usr/bin/env python3
"""ATTACK 6 — nonauthoritative event-role hypotheses with headline span provenance.

Uses frozen Attack-5 geographic candidate layer unchanged. No source content
beyond public metadata, no new IDs, writes, claims, contradiction or R14.
"""
from __future__ import annotations
import argparse
from collections import Counter
from itertools import combinations
import json
import hashlib
from pathlib import Path
from attack5 import run as run_v5, cliques
from attack6_roles import extract, VERSION as ROLE_VERSION

VERSION="attack6-evidence-action-separated-v1"
PHYSICAL={"PHYSICAL_EVENT_REPORT"}
COMMUNICATIVE={"CORRECTION","RETRACTION_OR_DENIAL","CONFIRMATION",
               "ALERT_CANCELLED","ALERT_ISSUED","EXPLANATION",
               "TESTIMONY","ATTRIBUTED_STATEMENT",
               "RETROSPECTIVE_DOCUMENTATION"}
ACTION_REFERENCE={"CORRECTION","RETRACTION_OR_DENIAL","CONFIRMATION",
                  "EXPLANATION","TESTIMONY","ATTRIBUTED_STATEMENT",
                  "RETROSPECTIVE_DOCUMENTATION",
                  "ALERT_CANCELLED","ALERT_ISSUED"}

def classify(previous: dict, a: dict, b: dict) -> tuple[str,str]:
    gr=previous["evidence"]["geo_relation"]
    same_kind=previous["evidence"]["same_kind"]
    gap=previous["evidence"]["published_gap_days"]
    pa,pb=a["primary_action"],b["primary_action"]
    if a["multi_incident_lexical_cue"] or b["multi_incident_lexical_cue"]:
        return "UNKNOWN","MULTI_OCCURRENCE_HEADLINE_NEEDS_DECOMPOSITION"
    if previous["reason"]=="MULTI_MENTION_NOT_RESOLVED":
        return "UNKNOWN","V5_MULTIPLE_GEO_OR_PHENOMENA"
    if gr in ("DISTINCT_COMMUNES","DISTINCT_REGIONS"):
        return "UNKNOWN","DISTINCT_EXPLICIT_LOCATION_NOT_GLOBAL_UNRELATED"
    if pa in COMMUNICATIVE or pb in COMMUNICATIVE:
        # A report about an emergency and a press statement about that
        # emergency are DIFFERENT primary actions; no occurrence equality.
        if pa in COMMUNICATIVE and pb in COMMUNICATIVE:
            return "UNKNOWN","TWO_COMMUNICATIVE_ACTS_NO_IDENTICAL_ACT_PROOF"
        # Weak context never suffices for same thread.
        if (gr=="SAME_COMMUNE" and same_kind and gap<=7 and previous["retrieved"]
            and ((pa in ACTION_REFERENCE and a["contextual_physical_mentions"])
                 or (pb in ACTION_REFERENCE and b["contextual_physical_mentions"]))):
            return "SAME_THREAD_DIFFERENT_OCCURRENCE","TITLE_REPORTS_CONTEXTUAL_PHYSICAL_EVENT_AND_DISTINCT_ACTION"
        return "UNKNOWN","ACTION_CONTEXT_UNRESOLVED"
    if pa=="UNKNOWN" or pb=="UNKNOWN":
        return "UNKNOWN","UNRESOLVED_PRIMARY_ACTION"
    if pa not in PHYSICAL or pb not in PHYSICAL:
        return "UNKNOWN","NONPHYSICAL_PRIMARY_ACTION"
    if previous["decision"]=="SAME_OCCURRENCE":
        return "SAME_OCCURRENCE","INHERITED_V5_RARE_EVENT_CANDIDATE_NOT_VERIFIED"
    return "UNKNOWN","MISSING_BOUNDED_OCCURRENCE_IDENTITY"

def run(corpus: dict) -> dict:
    prev=run_v5(corpus)
    extracted={r["id"]:extract(r) for r in corpus["articles"]}
    labels={}
    pairs=[]
    for old in prev["pair_decisions"]:
        a,b=old["ids"]
        label,reason=classify(old,extracted[a],extracted[b])
        pair=(a,b)
        labels[pair]=label
        pairs.append({
          "ids":[a,b],"retrieved":old["retrieved"],
          "decision":label,"reason":reason,
          "previous_candidate_decision":old["decision"],
          "geo_evidence":old["evidence"]["geo_evidence"],
          "geo_relation":old["evidence"]["geo_relation"],
          "publication_gap_days":old["evidence"]["published_gap_days"],
          "left_primary_action_evidence_id":(
            extracted[a]["primary_action_evidence"] or {}).get("evidence_id"),
          "right_primary_action_evidence_id":(
            extracted[b]["primary_action_evidence"] or {}).get("evidence_id"),
          "authority":"UNVERIFIED_METADATA_HYPOTHESIS"
        })
    groups=cliques(sorted(extracted),labels)
    return {
      "version":VERSION,"roles_version":ROLE_VERSION,
      "input_count":prev["input_count"],"metadata_only":True,
      "geography_source":prev["geography_source"],
      "geography_entries":prev["geography_entries"],
      "retrieved_pairs":prev["retrieved_pairs"],
      "articles":[{"id":k,"geography":next(x["geography"] for x in prev["articles"]
                                                if x["id"]==k),**extracted[k]}
                  for k in sorted(extracted)],
      "pair_decisions":pairs,
      "occurrence_groups":[{"members":g,"status":"UNVERIFIED_ONLY"} for g in groups],
      "scientific_precision":"NOT_MEASURED",
      "source_body_used":False,"claim_extraction_performed":False,
      "contradictions_detected":0,"event_time_inferred":False,
      "database_writes":0,"production_permission":False,
      "r14_or_v10_11_executed":False,
      "limits":[
        "An article reporting a statement can also mention the original event.",
        "Headline evidence cannot uniquely identify event episodes or verify statements.",
        "Publication date and source wording do not establish event-time or contradiction.",
        "Legacy v5 same-incident proposals remain hypotheses and may be false.",
        "All references to persons, institutions and facilities remain lexical/unverified."
      ]}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args()
    raw=Path(a.input).read_bytes()
    pred=run(json.loads(raw))
    output=json.dumps(pred,ensure_ascii=False,indent=2,sort_keys=True)+"\n"
    Path(a.output).write_text(output,encoding="utf-8")
    print("MODEL="+VERSION)
    print("CORPUS_SHA256="+hashlib.sha256(raw).hexdigest())
    print("PREDICTIONS_SHA256="+hashlib.sha256(output.encode()).hexdigest())
    print("PAIR_CLASSES="+json.dumps(dict(Counter(x["decision"] for x in pred["pair_decisions"])),sort_keys=True))
    print("GROUP_COUNT="+str(len(pred["occurrence_groups"])))
    print("PERSISTENT_WRITES=0")
    print("CONTRADICTIONS=0")
    print("SCIENTIFIC_GATE=UNSCORED")
    print("PRODUCTION_PERMISSION=FALSE")

if __name__=="__main__":
    main()
