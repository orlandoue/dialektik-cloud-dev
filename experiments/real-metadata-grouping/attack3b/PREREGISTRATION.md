# ATTACK 3B — Pre-registration and collection protocol (BEFORE source selection)

Registered: 2026-10-20, branch `codex/attack3b-prospective-metadata-20261020`.
Immutable model base: `80797b963e266161a404c8fa611c9e6c300fc211`.
Candidate module `attack3.py` Git blob `8ed5442839bd009f3a0095b1e27beef326eaea5a`.
Dependency `signatures.py` Git blob `f55230d22348c888a864976d66349f58d0192f5c`.
Scorer `score_attack3.py` Git blob `a3f50aff412a405e827ffcf3cddf8d56a4b9f7e6`.
Do not modify these frozen modules for this candidate.

## Hypothesis, risk and decision
- Test whether non-authoritative metadata-only v3 can distinguish bounded-incident identity vs evolving-thread relation on **new** public publication metadata, without editorial reference leakage.
- This is an exploratory, convenience sample. No population-level claim or authoritative Events/contradictions.
- A diagnostic zero false occurrence joins, >=0.80 recall on *independently adjudicated scorable pairs*, >=0.50 selective coverage, and no impure automatic groups are **necessary, not sufficient**, engineering criteria for further consideration. Also report full multiclass confusion, pairwise F1, group joins/splits, source/time errors; a small sample cannot establish production safety. Scientific gate stays NO_GO until independent assessment.
- Hard stop if 2 truly independent annotators and conflict resolution or publication metadata provenance cannot be documented. Don't forge `independent_annotators`. Frozen predictions may be generated even when independent Gold is absent; report `UNSCORED_PENDING_ADJUDICATION`.

## Sampling plan
- 40–48 *new-to-these-experiments* authentic publication metadata records from verifiable public publisher pages/search results, ideally 2024–2026 and with emphasis on Chile, plus materially useful international negatives.
- Target coverage strata: urban fire/emergency; natural hazard; power outage; social protest/civic event; institutional statement; aftermath/retrospective; same-place same-hazard different date; multi-incident article.
- Target >=8 distinct bounded occurrences and >=6 distinct publishers; >=5 same-occurrence cross-publisher candidate clusters, >=6 difficult negatives, >=4 ambiguous/multi-occurrence headlines. Stratum quotas are targets, not license to invent articles; log shortfalls transparently.
- Gather only public: exact publisher headline as visible, publisher name, publisher-stated publication date (YYYY-MM-DD), canonical HTTPS URL; no article body, unlicensed excerpts or rights claims. Distinguish 404 and unavailable site from unverified results. Record verification mode per row separately (public page, indexed title, search snippet), with citation/search provenance. Metadata public visibility is **not** standing permission for continuous crawling or reuse of body.
- EXCLUDE all 16 + 20 original corpus URLs, duplicated canonical URLs, unverifiable dates or nonpublisher mirrors. Do not see v3 predictions during corpus selection, and do not use labels from previous experiments.
- Prospective relative to prior model freeze means *new sampled metadata*, not necessarily articles first published after 2026-10-20; do not claim newly published.
- No edits to candidate after looking at new corpus/predictions; any change creates candidate v4 requiring a fresh corpus.

## Leakage-controlled sequence
1. Hash & seal the new metadata corpus (40–48 new rows) in candidate-only path.
2. GitHub Actions predictor job sparse-checkouts `attack3.py`, `signatures.py`, corpus; assert no reference/scorer; record version/hash/predictions into short-retention artifact. Replay permutation invariance. Output non-authoritative.
3. Separate reviewers produce **independent** article-level occurrence and thread labels and exhaustive all-pair 4-way Gold using source links as evidence; log individual decisions/disagreements; true external reviewers required for independence.
4. Only after prediction artifact is frozen, independent evaluation job receives candidate predictions + editorial reference. Verify hashes + pair coverage and score with separate `score_attack3.py`.
5. Publish execution and scientific verdict distinctly. No Supabase/Flutter/Render, no migrations 043/044, no R14/V10.11 or holdout, no contradictions.

## Pre-registration limitations
Human-selected stories can be intentionally hard; convenience sample prone to spectrum and ascertainment bias. Original article titles may themselves be ambiguous; resolving occurrence requires warranted source access. The 4-way labels `SAME_THREAD_DIFFERENT_OCCURRENCE` require thread identity evidence, not generic topical similarity. A provider's publication timestamp is **not** automatically event occurrence time.
