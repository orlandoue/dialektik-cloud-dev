# ATTACK 4 — pre-registered prospective metadata probe

Registered on 2026-10-20 BEFORE selecting any new evaluation corpus for ATTACK 4.

## Freeze
- Model development branch: `codex/attack4-generalized-retrieval-20261020`.
- Frozen implementation commit: `3186a846a8cf6c3bc3afe1234c71ab8c44c80a71`.
- Authenticated candidate blob `attack4.py`: `91a0b6195691280e4ddd1ced197e9e4ea4ff46f4`.
- Synthetic tests blob `test_attack4.py`: `d7863893ae92da41fc236cfdcb8fda77c135f169`.
- Engineering CI [run 39448168228](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39448168228): 12 tests PASS, no Gold.
- ATTACK 1, 2 and 3B inputs were previously seen **during development diagnostics** and can never support prospective ATTACK 4 claims.
- Changes to frozen candidate after looking at new test headlines produce a **new candidate** and require a different previously unseen evaluation corpus.

## Scope and outcome definitions
- Only headline, publisher, public HTTPS URL and date published. Not full source text, no autonomous collection or legal ingestion approval.
- Two distinct stages: broad RETRIEVAL of candidate pairs, then conservative verification with outcomes `SAME_OCCURRENCE`, `SAME_THREAD_DIFFERENT_OCCURRENCE`, `UNRELATED`, `UNKNOWN`.
- `UNKNOWN` is explicitly non-equivalence. No claims, no contradictions, no automatic persistence.
- The verifier uses orthographic title-name spans; **NOT** geocoded verified places. Same-place/hazard/object may still conflate distinct incidents; time-of-publication is not event time.
- Zero fresh-Gold labels supplied to predictor.

## New real-news metadata selection plan
- Select a NEW convenience corpus **after this pre-registration**: target 24–40 distinct exact publisher headlines, from at least six publishers, with 4+ real-world threads/incidents plus difficult negative and retrospective/statement cases.
- Restrict to public metadata shown on original publisher pages or current reliable index links and dates. Record provenance limitations honestly; no invented URLs/headlines/dates.
- Exclude every exact article URL used in experiments 1 (16 items), 2 (20 items), 3B (48 items), duplicate URLs, future articles, unverifiable metadata, and nonpublisher mirrors.
- Sample by event/thread categories rather than by model prediction; do not view v4 outputs while gathering.
- Corpus does not contain answer-bearing labels. Run isolated Gold-free GitHub Actions checkout with authenticated candidate SHA; save exact input and output hashes and a short-lived predictions artifact.
- Report coverage, candidate retrieval rate, abstentions, number of groups, and reasons. These are **engineering diagnostics** only and may establish NO_GO; NOT precision, recall, F1, or scientific validation.

## Independent scientific qualification
- Two real independent adjudicators, source-evidence references, conflict ledger and an exhaustive all-pair 4-way reference are required to estimate precision, recall and false-merge risk.
- Only after frozen prediction artifact and independent reference exists, run a separate evaluator with no candidate code. No same-corpus retuning.
- Initial necessary thresholds for consideration: zero false merged occurrence pairs / impure clusters, >=80% recall on scorable same-occurrence pairs, >=50% selective pair coverage. Small samples and labels may preclude production approval regardless of threshold.
- If human Gold is absent, verdict stays `UNSCORED_PENDING_INDEPENDENT_ADJUDICATION` even if other engineering checks PASS.

## Operational isolation
- Supabase #4 RESTORE-GATE remains open. No migrations 043/044, no Supabase writer, no Render or Flutter change.
- V10.11 requires authorized exact full publisher text and protected exclusion registry. No use of R14 holdout or formal V10.11 inference; this is an independent heuristic development baseline.
