# Dialektik | real Chilean headline-only occurrence-linking baseline

Date: 2026-10-20. Execution: GitHub Actions, disposable Linux runner, Python standard library. Branch: `codex/real-metadata-grouping-probe-20261020`.

## What this IS

A real-publication, small-corpus **engineering experiment**. `corpus.json` contains 16 public headlines, original publisher labels, public URLs and publication dates manually checked against their sources. It has **no answer-bearing event IDs**, no excerpts, article bodies, embedding vectors, API keys, Auth data, or database credentials. The corpus intentionally contains potential event conflation: a tornado in Estación Central, an earlier different-location tornado in Mulchén, a Las Condes mudslide, background Santiago weather, a power outage and an unrelated avalanche.

The `group.py` baseline extracts a generic municipality/hazard signature from visible metadata. It links different publishers only when the *specific geographic area*, hazard and a two-day publication-date window agree; then uses connected components to propose clusters. Headlines with insufficient signatures are left unassigned. It produces candidate clusters only, NOT committed Events, decisions by R14, full semantic inference, contradiction findings, authoritative occurrence equivalences or persistent database rows.

Evaluator `evaluate.py` operates in a **separate job** from the predictor. The predictor's checkout is sparse and excludes `reference.private-to-evaluator.json`. The reference is a single-editor human annotation distinguishing **bounded occurrences** from broader evolving news threads; a real source about rescue or municipal damage assessment can refer to the tornado yet describe a *different* bounded occurrence. Two broad storm titles without bounded meaning are labeled ambiguous and excluded from pairwise denominators. Labels are an exploratory human review and **not independently blinded scientific Gold**.

## Evaluation

- Candidate job loads corpus and baseline only, emits immutable JSON prediction plus SHA-256 and verifies shuffled input ordering yields identical outputs.
- Independent evaluation job checks every occurrence-labeled pair, reports precision/recall/F1, false merges, and within-thread/different-occurrence errors. It produces a machine-readable report and a **NO_GO** if any false-merge pair is found or recall < 0.80. A successful CI means the *experiment executed correctly*, NOT that the semantic model passed the deployment gate.
- Stage is fully offline. No external HTTP performed by scripts, no actions using DB credentials or Supabase; no migrations; no source acquisition loops. Private beta, current GOV.UK previews, R14 final holdout and V10.11 frozen scientific artifacts are out of scope.

## Key nonclaims and release gates

This is NOT autonomous source acquisition: humans selected and checked the headlines; input is a deliberately bounded convenience corpus. It does not validate collection rights beyond publicly readable metadata, continuous scheduler, dedup ingestion, storage, QNMs or scientifically frozen semantic model. No automated contradiction extraction is performed because merely different numbers or headline wording is not contradictory evidence.

Advancing to authoritative multi-publisher automated Events requires (1) legal permission and operational rights for each independently acquired source, (2) an independently adjudicated previously unseen multi-event sample, (3) source-text representation appropriate to the scientific candidate (V10.11 explicitly requires full publisher-authorized original text), (4) low or zero false merges at the defined acceptance threshold, and (5) safe Supabase recovery and core credential migration before persisted writes. The current R14 formal holdout must remain sealed.

## Corpus provenance (public titles/links only)

- Tornado Estación Central, Chile: BioBioChile, La Tercera, Cooperativa, T13, El País and Gobierno de Santiago (13–14 October 2026).
- Tornado in Mulchén: BioBioChile (published 3 October; *occurrence* 27 September).
- Las Condes mudslide (8 October): BioBioChile, Emol, 24 Horas and El País.
- Storm background, electric outage and unrelated avalanche: publicly published articles in October 2026.

Canonical URLs are stored alongside the exact public headlines in `corpus.json`. Where the same storm generated multiple reports, 'same broad thread' is not treated as proof of 'same exact bounded occurrence'. Automatic decisions must preserve this distinction.

## Run locally (no other project dependencies)

```bash
python3 experiments/real-metadata-grouping/group.py --input experiments/real-metadata-grouping/corpus.json --output /tmp/predictions.json
python3 experiments/real-metadata-grouping/evaluate.py --corpus experiments/real-metadata-grouping/corpus.json --predictions /tmp/predictions.json --reference experiments/real-metadata-grouping/reference.private-to-evaluator.json --out /tmp/report.json
```
