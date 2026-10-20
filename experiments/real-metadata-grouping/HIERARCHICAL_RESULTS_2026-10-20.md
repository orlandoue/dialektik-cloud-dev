# Exploratory hierarchical grouping: second real-publication attack — 2026-10-20

## Immutable experimental record

Run: https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39376937841 (workflow PASS, research criterion **FAIL_NO_GO**).
Candidate version `hierarchical-headline-baseline-v1` implements **two independently labeled levels**: bounded occurrence versus larger evolving news thread. This version is **metadata-only**, using published titles, dates, publisher and canonical URL; no full article bodies. It does NOT run V10.11, R14 formal holdout, approved acquisition/scheduler, Supabase SQL, contradiction detector, or Flutter changes.

Freeze evidence: `signatures.py` commit `d8dd0b29b41bcdfec12c9e8cb13fd6590027e6c7`, `hierarchy.py` commit `91c0d482a1d825dc8eb9b5de6ed7bed900828ec9`; subsequent edits changed the workflow's synthetic test wording but **not these source files**. First CI attempt failed on an illustrative sentence with the unsupported form “rescatan”. No model update was made; this lexical gap remains a limitation.

Fresh diagnostic corpus: `new-corpus-20261020.json`, 20 public metadata records, original URLs, headline-only. Reviewer inspected some potential titles during search before freezing the code, so the corpus **is not strictly prospective nor independently blinded**. The evaluator references `new-reference-20261020.evaluator-only.json` separately from candidate checkout. These are exploratory single-researcher labels, not formal Gold. The event boundaries (physical fire, mayor speech, damage imagery, technical investigation, protest roundup) can be disputed and require an external annotator for a reliable acceptance decision.

## Observed metrics (independent evaluation job)

| Scope | TP | FP | FN | Pair precision | Pair recall | Pair F1 |
|---|---:|---:|---:|---:|---:|---:|
| Same bounded occurrence | 21 | 7 | 10 | 0.750000 | 0.677419 | 0.711864 |
| Same evolving news thread | 58 | 0 | 14 | 1.000000 | 0.805556 | 0.892308 |

Labeled occurrence documents: 18/20; two multi-event protest roundups lack one bounded-occurrence label and are omitted from occurrence-pair scoring. All 20 articles are used for thread scoring. The model proposed **one occurrence cluster, two thread clusters and five explicit abstentions**. The 7 occurrence false positives were **same thread / different event/action**. Provenance: report SHA256 `68df81c01824c9a2abaa2f34a41582aa5845907244509fa9895b200a394d16ad`, corpus SHA256 `b77d3f6d1ddb81a193a029662a161bd6c5f65c61bdba6c1b4e5c44574aede650`.

Important: a technical workflow PASS means code/test/evaluator completion; **research gate FAIL_NO_GO**, production permission false. Small handpicked sample and highly imbalanced same-topic pairs mean no credible population-level accuracy inference. The earlier experiment on 16 different articles is not directly comparable.

## Observed error mechanisms and third attack

1. **Mayor quotations** following the Maipú theatre fire are conflated with reports about the physical fire. The system needs an attribution-aware **claim/action predicate**, not just location + hazard; “the mayor speaks after an incident” is not “the physical incident occurs.”
2. **“Rescatar”** can refer to property recovered from a burned building, not a trapped person. Lexical pattern matching alone cannot reliably distinguish rescue operations from property valuations.
3. **Retrospective images/damage** can describe the *same incident* without being a fresh incident, despite language suggestive of an aftermath. Distinguish the article's editorial focus from the physical-world event it references.
4. **Common thread is not occurrence equivalence**; never use a connected-components chain to transitively turn a related thread into one occurrence.
5. Generic headlines or multi-incident reports must preserve `UNKNOWN` rather than forcing occurrence identities.

Next: introduce a typed evidence graph (Article -> mentions Occurrence, Article -> reports Claim, Claim -> supports/updates/contradicts), origin-relative event-time versus publication-time and entity/coreference resolution, and separately scored `SAME_OCCURRENCE`, `SAME_THREAD_DIFFERENT_OCCURRENCE`, `UNRELATED`, `UNKNOWN`. Freeze against an independently sampled and adjudicated **new third corpus**. Contradiction claims require source-authorized text and temporal context; they were not evaluated here.

## Reproduce offline (Python 3.11, no external packages)

```bash
python3 experiments/real-metadata-grouping/hierarchy.py --input experiments/real-metadata-grouping/new-corpus-20261020.json --output /tmp/hierarchy.json
python3 experiments/real-metadata-grouping/score_hierarchy.py --corpus experiments/real-metadata-grouping/new-corpus-20261020.json --predictions /tmp/hierarchy.json --reference experiments/real-metadata-grouping/new-reference-20261020.evaluator-only.json --out /tmp/hierarchy-report.json
```

This experiment did not alter Supabase, Render, R14, the consumer APK or any application data. There is **no permit** to persist or publish automatically grouped Events.
