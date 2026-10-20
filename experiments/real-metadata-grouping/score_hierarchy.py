#!/usr/bin/env python3
"""Independent exploratory scorer; model code absent from this job."""
import argparse
from itertools import combinations
from pathlib import Path
import hashlib
import json

def grouped_pairs(groups,ids):
    seen=set()
    pairs=set()
    for cluster in groups:
        members=cluster["members"]
        if len(members)<2 or len(members)!=len(set(members)):
            raise ValueError("CORRUPT_GROUP")
        for a in members:
            if a not in ids or a in seen:raise ValueError("NOT_A_PARTITION")
            seen.add(a)
        pairs.update(frozenset((a,b)) for a,b in combinations(members,2))
    return pairs

def score_pairs(predicted,reference,eligible):
    truth={frozenset((a,b)) for a,b in combinations(sorted(eligible),2)
           if reference[a]==reference[b] and reference[a] is not None}
    proposed={p for p in predicted if p.issubset(eligible)}
    tp=proposed&truth
    fp=proposed-truth
    fn=truth-proposed
    precision=len(tp)/len(proposed) if proposed else 0.0
    recall=len(tp)/len(truth) if truth else 0.0
    f1=2*precision*recall/(precision+recall) if precision+recall else 0.0
    return {
      "tp":len(tp),"fp":len(fp),"fn":len(fn),
      "positive_reference_pairs":len(truth),
      "proposed_pairs":len(proposed),
      "precision":round(precision,6),"recall":round(recall,6),"f1":round(f1,6),
      "incorrect_pairs":[sorted(p) for p in sorted(fp,key=lambda x:sorted(x))],
      "missed_pairs":[sorted(p) for p in sorted(fn,key=lambda x:sorted(x))],
    }

def main():
    p=argparse.ArgumentParser()
    for arg in ("corpus","predictions","reference","out"):
        p.add_argument("--"+arg,required=True)
    a=p.parse_args()
    corpus_b=Path(a.corpus).read_bytes()
    pred_b=Path(a.predictions).read_bytes()
    gold_b=Path(a.reference).read_bytes()
    corpus=json.loads(corpus_b)
    pred=json.loads(pred_b)
    gold=json.loads(gold_b)
    ids={row["id"] for row in corpus["articles"]}
    labels={row["id"]:row for row in gold["adjudications"]}
    if gold.get("schema")!="hierarchy-metadata-exploratory-reference-v1" or set(labels)!=ids:
        raise ValueError("GOLD_INPUT_MISMATCH")
    if pred.get("input_count")!=len(ids) or pred.get("metadata_only") is not True or pred.get("semantic_model_executed") is not False or pred.get("database_writes")!=0:
        raise ValueError("UNAUTHORIZED_PREDICTION_CONTRACT")
    occurrence=grouped_pairs(pred["occurrence_groups"],ids)
    thread=grouped_pairs(pred["thread_groups"],ids)
    occ_labels={id_:row["occurrence_id"] for id_,row in labels.items()}
    thread_labels={id_:row["thread_id"] for id_,row in labels.items()}
    occurrence_report=score_pairs(occurrence,occ_labels,{id_ for id_,label in occ_labels.items() if label is not None})
    thread_report=score_pairs(thread,thread_labels,ids)
    cross_level_false_merges=sum(
        thread_labels[pair[0]]==thread_labels[pair[1]] and
        occ_labels[pair[0]]!=occ_labels[pair[1]]
        for pair in occurrence_report["incorrect_pairs"]
    )
    criteria=(occurrence_report["fp"]==0 and
              occurrence_report["recall"]>=0.80 and
              thread_report["fp"]==0 and thread_report["recall"]>=0.50)
    report={
      "execution":"PASS_EVALUATOR_EXECUTED",
      "research_criterion":"PASS_EXPLORATORY_ONLY" if criteria else "FAIL_NO_GO",
      "production_permission":False,
      "corpus_sha256":hashlib.sha256(corpus_b).hexdigest(),
      "prediction_sha256":hashlib.sha256(pred_b).hexdigest(),
      "reference_sha256":hashlib.sha256(gold_b).hexdigest(),
      "input_docs":len(ids),"occurrence_labeled_docs":sum(x is not None for x in occ_labels.values()),
      "occurrence_unscorable_docs":sum(x is None for x in occ_labels.values()),
      "occurrence":occurrence_report,"thread":thread_report,
      "occurrence_false_merges_inside_same_thread":cross_level_false_merges,
      "occurrence_group_count":len(pred["occurrence_groups"]),
      "thread_group_count":len(pred["thread_groups"]),
      "abstentions":len(pred["abstentions"]),
      "limitations":[
        "Newsroom selection not random; curator had seen some candidate titles before code freeze.",
        "Reference was assigned by one researcher, not blinded multi-rater adjudication.",
        "Headline-only source metadata; publisher-authorized body access and V10.11 semantic inference absent.",
        "Thread membership is editorial judgment and can evolve; timelines not inferred from actual event timestamps.",
        "No contradictions, live acquisition, persisted Article/Event records, or R14 formal holdout use.",
      ]
    }
    result=json.dumps(report,indent=2,ensure_ascii=False,sort_keys=True)+"\n"
    Path(a.out).write_text(result,encoding="utf-8")
    for tag,part in (("OCC",occurrence_report),("THREAD",thread_report)):
        for k in ("tp","fp","fn","precision","recall","f1"):
            print(tag+"_"+k.upper()+"="+str(part[k]))
    for k in ("input_docs","occurrence_labeled_docs","occurrence_unscorable_docs",
              "occurrence_false_merges_inside_same_thread","occurrence_group_count",
              "thread_group_count","abstentions","research_criterion"):
        print(k.upper()+"="+str(report[k]))
    print("EVALUATION_EXECUTED=TRUE")
    print("PRODUCTION_PERMISSION=FALSE")
    print("REPORT_SHA256="+hashlib.sha256(result.encode()).hexdigest())

if __name__=="__main__":main()
