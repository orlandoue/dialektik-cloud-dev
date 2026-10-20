# ATTACK 3B — Frozen candidate on new real-publication metadata

Experiment date 2026-10-20. **Engineering execution PASS; scientific gate NO_GO_ZERO_COVERAGE.**

## Provenance and experimental sequence

1. Pre-registration committed BEFORE candidate corpus selection: `95586c2c0426d1da12ae7ee3c9a8d07d514a0215`.
2. Immutable v3 candidate base `80797b963e266161a404c8fa611c9e6c300fc211`; `attack3.py` blob `8ed5442839bd009f3a0095b1e27beef326eaea5a`; `signatures.py` blob `f55230d22348c888a864976d66349f58d0192f5c`. All authenticated in Actions.
3. Corpus of **48 newly selected public headline metadata** records from **12 publishers/official institutions**, dated 2025 or 2026, committed `96ed2fe68c20bb6ab5bc9ac3509e565a6f2e331b`. The 48 canonical strings do not duplicate any URL in the earlier 16- and 20-item experiments; no article was dated after 2026-10-20. Editorially curated public search results, **not autonomous acquisition**. Not all links were independently re-fetched for an HTTP 200/source-rights audit.
4. Isolated predictor workflow: https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39442934007 — SUCCESS; candidate-only checkout; no evaluator or Gold. Input order determinism PASS. Zero database writes.
5. Independent-of-Gold diagnostic workflow: https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39443305109 — SUCCESS; no change to frozen candidate; same prediction output. Pair and source signal summaries obtained after predictions. Artifacts are short-lived (7-day).
6. **No editorial Gold was created or accessed. No second adjudicator was involved, so no scientifically independent precision/recall/F1 are claimed.** Scorer `score_attack3.py` was NOT called with any real reference.

## Authenticated frozen results (without Gold)

- Input rows: **48**.
- Pair hypotheses: `48 * 47 / 2 = 1128`.
- `UNKNOWN`: **1128**.
- `SAME_OCCURRENCE`: **0**.
- `SAME_THREAD_DIFFERENT_OCCURRENCE`: **0**.
- `UNRELATED`: **0**.
- Complete-link occurrence groups: **0**.
- Corpus SHA256: `99cc2b4d376a6c51b64f3ae60f1c8847b8e628089db291c121cad22324d78b14`.
- Predictions SHA256: `7230df49dc7f5ca387fd36ef0fcad6a9f773664aa571de7fed759da3feef1968`.
- Candidate production permission: **FALSE**.

### Failure diagnosis (post-hoc, no reference labels)

- **40/48** headlines/URL slugs yielded **no recognized place**.
- **43/48** yielded **no recognized venue**; only five venue signals were `houses`.
- **5/48** had a recognized place AND hazard.
- **0/48** had place AND hazard AND venue, a prerequisite for the current v3 automatic same-occurrence rule.
- Of 1,128 unknown pairs: **1,118** returned `MISSING_EXPLICIT_ANCHOR`; **10** returned `INSUFFICIENT_BOUNDED_OCCURRENCE_EVIDENCE`.
- Recognized places were only eight references to `santiago`; this reflects the intentionally small v2 geographic dictionary frozen into the candidate.
- This is a **coverage failure** under distribution shift, not evidence of perfect precision, successful false-merge prevention, or correct semantic understanding. Zero proposed positives make the preset coverage criterion impossible.

## Scientific disposition

**NO_GO_ZERO_COVERAGE** for this exact frozen candidate on the collected real-publication metadata corpus. A full independent Gold reference would still be necessary to quantify recall and false merges in general. Because there is *zero* ability to make a non-UNKNOWN pair prediction here, do not spend reviewer effort claiming that independent validation can redeem this candidate's 0% predicted coverage. Preserve corpus/predictions as diagnostic evidence.

## Next research candidate (ATTACK 4, not implemented or benchmarked here)

1. Build a wide-domain entity resolver for Spanish news titles with correct geographic levels and relative mentions; support candidate event identity without requiring a small hand-coded venue dictionary.
2. Explicitly distinguish **event_time** vs `published_on`, action/predicate and actor attribution, retrospective reports, and multi-incident documents. No inferred contradiction from titles.
3. Introduce conservative retrieval separately from high-precision occurrence verifier. Pair relation `UNKNOWN` must be allowed but *measured* with selective-coverage floor.
4. Preserve `Occurrence`/`EventThread` semantic contracts and R14/V10.11 full-source-text rights gates; no SQL writes, no forced clustering.
5. Freeze candidate **before a fourth unseen real-publication sample** and acquire independent pair labels by two separate human reviewers for final precision, recall and false-merge acceptance. ATTACK 3B labels must not be repurposed as a fresh fourth holdout after this report.
6. For product deployment, continue to honor RESTORE-GATE #4 and source rights; no Supabase 043/044, no Core authoritative Events, no autonomous scheduler, no Flutter changes.

## Boundary

No Supabase, Render, Flutter, R14, V10.11 or formal holdout was used or modified. This is an engineering experiment and source metadata probe, **not** successful product ingestion or contradiction detection.
