#!/usr/bin/env python3
"""Separate adjudication stage: no baseline code imported; never tunes predictions."""
from __future__ import annotations
import argparse
from collections import Counter
from itertools import combinations
from pathlib import Path
import hashlib
import json

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--corpus",required=True)
    p.add_argument("--predictions",required=True)
    p.add_argument("--reference",required=True)
    p.add_argument("--out",required=True)
    args=p.parse_args()
    corpus_bytes=Path(args.corpus).read_bytes()
    predictions_bytes=Path(args.predictions).read_bytes()
    reference_bytes=Path(args.reference).read_bytes()
    corpus=json.loads(corpus_bytes)
    predictions=json.loads(predictions_bytes)
    reference=json.loads(reference_bytes)
    rows=corpus["articles"]
    ids={a["id"] for a in rows}
    labels={a["id"]:a for a in reference["adjudications"]}
    if ids != set(labels) or reference.get("schema")!="occurrence-reference-v1":
        raise ValueError("reference does not cover exactly the frozen input")
    if predictions.get("input_count") != len(ids) or predictions.get("metadata_only") is not True:
        raise ValueError("prediction/input mismatch")
    if predictions.get("semantic_model_used") is not False or predictions.get("persistent_event_ids_created")!=0:
        raise ValueError("candidate/authoritative semantic boundary violation")
    predicted_pairs=set()
    seen=set()
    for group in predictions["groups"]:
        members=group["members"]
        if len(members)<2 or len(set(members)) != len(members):
            raise ValueError("invalid or duplicate group")
        if any(item not in ids or item in seen for item in members):
            raise ValueError("overlapping clusters or fake input")
        seen.update(members)
        predicted_pairs.update(frozenset(pair) for pair in combinations(members,2))
    singletons=set(predictions["singletons"])
    if singletons&seen or seen | singletons != ids:
        raise ValueError("prediction did not partition the input exactly")
    true_pairs=set()
    labeled=[a for a in sorted(ids) if labels[a]["occurrence_id"] is not None]
    negative_count=0
    for a,b in combinations(labeled,2):
        if labels[a]["occurrence_id"]==labels[b]["occurrence_id"]:
            true_pairs.add(frozenset((a,b)))
        else:
            negative_count+=1
    labeled_predictions={pair for pair in predicted_pairs if pair.issubset(labeled)}
    correct=labeled_predictions & true_pairs
    false_merges=labeled_predictions-true_pairs
    missed=true_pairs-labeled_predictions
    precision=len(correct)/len(labeled_predictions) if labeled_predictions else 0
    recall=len(correct)/len(true_pairs) if true_pairs else 0
    f1=(2*precision*recall/(precision+recall)) if precision+recall else 0
    same_thread_different_occurrence=sum(
        labels[a]["thread_id"] == labels[b]["thread_id"]
        for a,b in (tuple(sorted(pair)) for pair in false_merges)
    )
    sample_errors=[]
    for a,b in sorted((tuple(sorted(p)) for p in false_merges)):
        sample_errors.append({
            "document_ids":[a,b],
            "error":"FALSE_OCCURRENCE_MERGE",
            "same_evolving_thread":labels[a]["thread_id"]==labels[b]["thread_id"],
            "first_reference_note":labels[a]["note"],
            "second_reference_note":labels[b]["note"],
        })
    go=not false_merges and recall>=.80 and len(predictions["groups"])>=2
    report={
        "experiment_status":"EXECUTED_NOT_A_PRODUCTION_MODEL",
        "deployment_gate":"PASS" if go else "NO_GO_FALSE_MERGE_OR_RECALL",
        "input_sha256":hashlib.sha256(corpus_bytes).hexdigest(),
        "predictions_sha256":hashlib.sha256(predictions_bytes).hexdigest(),
        "reference_sha256":hashlib.sha256(reference_bytes).hexdigest(),
        "labeled_items":len(labeled),
        "ambiguous_excluded_items":len(ids)-len(labeled),
        "total_articles":len(ids),
        "true_occurrence_positive_pairs":len(true_pairs),
        "true_negative_pairs":negative_count,
        "predicted_positive_pairs_in_labeled_scope":len(labeled_predictions),
        "true_positive_pairs":len(correct),
        "false_merge_pairs":len(false_merges),
        "missed_positive_pairs":len(missed),
        "false_merges_same_thread_different_occurrence":same_thread_different_occurrence,
        "pair_precision":round(precision,6),
        "pair_recall":round(recall,6),
        "pair_f1":round(f1,6),
        "predicted_group_count":len(predictions["groups"]),
        "predicted_singletons":len(predictions["singletons"]),
        "abstention_count":len(predictions["abstentions"]),
        "false_merges":sample_errors,
        "missed_pairs":sorted([list(sorted(x)) for x in missed]),
        "limitations":[
            "Small manually selected public headline/URL/date corpus; not independently sampled live stream.",
            "Single-editor reference labels and bounded-event interpretation have not been independently adjudicated.",
            "No source bodies, original fulltext processing authorization, claims, temporal contradictions or LLM.",
            "Pairwise estimates cannot be extrapolated to production scale; they are exploratory engineering diagnostics.",
            "V10.11 scientific freeze and final R14 holdout untouched; no database writes."
        ]
    }
    encoded=json.dumps(report,sort_keys=True,ensure_ascii=False,indent=2)+"\n"
    Path(args.out).write_text(encoded,encoding="utf-8")
    print("EVALUATION_EXECUTION=PASS")
    for field in ["total_articles","labeled_items","ambiguous_excluded_items","true_occurrence_positive_pairs",
                  "predicted_positive_pairs_in_labeled_scope","true_positive_pairs","false_merge_pairs",
                  "missed_positive_pairs","false_merges_same_thread_different_occurrence",
                  "pair_precision","pair_recall","pair_f1","deployment_gate"]:
        print(field.upper()+"="+str(report[field]))
    print("REPORT_SHA256="+hashlib.sha256(encoded.encode()).hexdigest())

if __name__=="__main__":
    main()
