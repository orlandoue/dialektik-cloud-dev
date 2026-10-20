# DIALEKTIK — ATTACK 4 result (2026-10-20)

**ENGINEERING EXECUTION PASS; SCIENTIFIC/DEPLOYMENT GATE NO_GO_ZERO_NON_UNKNOWN_COVERAGE.**
Do not call this a validated semantic engine or positive clustering result.

## Exact freeze and protocol
- Source of frozen implementation: commit `3186a846a8cf6c3bc3afe1234c71ab8c44c80a71`, blob `91a0b6195691280e4ddd1ced197e9e4ea4ff46f4`.
- 12 synthetic/metamorphic tests PASS: [Actions 39448168228](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39448168228).
- Pre-registration committed at `811ae804ae355287f2618c0886506d308ab93915` **before** new public-metadata selection.
- 30 original publisher metadata records collected after freeze from six sources; corpus commit `d19f674f1ffd73b4bc0178ca189d71fbd0f984d3`.
- 30 unique canonical URLs; zero overlap by URL string with prior 16-, 20-, 48-row research corpora. Source articles dated in 2025; convenience selection is NOT representative and does NOT grant automated source collection rights.
- Frozen-only sparse prediction checkout, no reference or scorer: [Actions 39448851003](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39448851003).
- Same frozen model, blind postprediction diagnostics: [Actions 39449122962](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39449122962).

## Frozen predictions (before any independent Gold)
- Corpus size = 30, possible pairs = 435.
- Retrieval candidates = **46/435** (10.57%). Important: a retrieval proposal is **not** an occurrence assignment.
- `SAME_OCCURRENCE` = 0; `SAME_THREAD_DIFFERENT_OCCURRENCE` = 0; `UNRELATED` = 0; `UNKNOWN` = **435/435**.
- Automatically linked complete-link occurrence groups = **0**.
- No independent editorial references; thus precision, recall, F1, false merge incidence against Gold are **NOT MEASURED**.
- Corpus SHA256 = `57d492166c0a5320b46e9aa27681c77a1fcc34af19a3294992278a9dccb63454`.
- Prediction SHA256 = `9fa0ccf6495a85210944268d2e98941de28a1d24b692b5bfdda387e8c747662a`.

## Root-cause audit (without labels or changing the candidate)
- `named_anchors` empty in **28/30** articles.
- `objects` empty in **29/30** articles.
- Hazard kind present in **21/30**; absent 9/30.
- Only detected orthographic multiword anchors: `arica y magallanes` and `carolina toha`. These are *not* verified bounded occurrence location anchors: one denotes an area span and the other a person. Generic capitalization does **not** supply entity type.
- Of all 435 pairs: 360 not retrieved, 29 blocked by multi-event ambiguity, 46 retrieved but blocked by `NO_SHARED_DISTINCTIVE_NAMED_ANCHOR`.
- Distinguish **retrieval feasibility** from **verified occurrence identity**. The new candidate recovered many topical neighbors but did not generalize an anchor verifiable enough to accept an equivalence. Classifying all pairs as UNKNOWN does not justify saying it has zero false positives against Gold.

## Why this is not evidence against the larger scientific program
Model is a *metadata-only* heuristic, not formal V10.11 or R14. Exposed evaluation samples deliberately include evolving alert states, a physical earthquake vs interview reaction vs aftermath, and a different local tornado. A headline can lack verified actor/trigger/venue/event timestamp. Proper nouns may be people, organizations, locations, multiple sites or geographic ranges. Strong identifiers cannot be invented.
Execution isolation PASS does not make the scientific candidate useful: non-UNKNOWN coverage is 0%.

## Next mathematically meaningful attack (ATTACK 5)
1. Separate explicit **entity typing and alias resolution** (PERSON vs GEO vs FACILITY vs ORGANIZATION vs EVENT_ID; geocoding/gazetteer with verified provenance and hierarchical location paths) from lexical named phrases; resist grouping merely because a person, region or large location matches.
2. Separate `RETRIEVES_CANDIDATE`, `SAME_THREAD`, `SAME_BOUNDED_OCCURRENCE` and `UNKNOWN` with independent thresholds and explicit evidence; no direct links by publication date.
3. Require an identity ledger of event trigger/action, participants, precise place, event-time range/source attribution and disambiguating venue/external ID, with multi-occurrence articles represented by typed mention edges. If metadata cannot establish identity, abstain or request authorized source text; do not fabricate.
4. Add hard negative challenge tests for same city / same hazard / same date but distinct buildings; different stages of tsunami warning; official statement vs physical disaster; edited/retrospective publication; broad geographic range; person/location name collision.
5. Freeze next candidate before a **separate fifth** untouched real-publication set. The 30 records above are already used diagnostically and MUST NOT be treated as novel/independent after any development on the observed result.
6. For scientific acceptance arrange two genuine independent annotators + reconciliation with evidence and score previously frozen predictions in a separate process. Synthetically passing tests alone never passes.
7. Keep Supabase restore gate #4 and formal V10.11 original licensed text prerequisite unchanged. No Article/Event persistent writes, no contradictory claims, no remote migrations, no R14 holdout.

**Final ATTACK 4 status:** local/CI engineering verified; new-publication blind prediction captured; scientific quality insufficient/not quantified; DEPLOY NO_GO. 
