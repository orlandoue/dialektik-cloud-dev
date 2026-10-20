# DIALEKTIK — ATTACK 7 engineering closeout and controlled scaling gates

**Recorded 2026-10-20. Branch:** `codex/attack7-evidence-graph-20261020`.

## Status verdict

**PASS: isolated engineering prototype. NO_GO: autonomous scientific assertions, persistence, and scaling.**

ATTACK 7 is a **typed HEADLINE-METADATA evidence graph**, not an operational multi-source news intelligence model. It does not fetch publishers or extract from licensed article bodies, does not infer occurrence identity or contradictory truth, and writes no Events. Avoid claiming semantically validated F1, contradiction detection, or legal ingestion.

- Candidate module `experiments/real-metadata-grouping/attack7.py`: Git blob `9860f1da8d20ec137617d2857cd266bffee131fb`.
- Adversarial regression tests `test_attack7.py`: Git blob `aa76ca66757304f1591bc4d19e9be651d7d5b42b`.
- [Final isolated 16/16 engineering tests PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39471716399).
- [Gold-free, known-corpus coverage diagnostic PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39471880102). The source corpus has already been exposed by ATTACK 6: **NOT a new independent holdout**.

## What was actually implemented

A deterministic graph with:
- **Article** nodes and explicit metadata publisher/source URL/publication date.
- **DocumentaryAction** nodes distinct from a physical world's identity; the article can contain report, confirmation, investigation, official balance, rescue operation, emergency order, testimony or retrospective documentation.
- **PhysicalPhenomenonMention** nodes, multiple per Article, with exact Unicode headline offsets; no invented occurrence IDs.
- **GeographicalMention** nodes using typed Chilean municipal/region matches from third-party DPA snapshot.
- **FacilityMention** nodes as UNVERIFIED name cues (e.g., El Teniente, a *facility candidate*, not a commune); no external facility registry check.
- **ActorMention** nodes (SML, Senapred, Fiscalía, government, PDI, Codelco, role names), *lexical/UNVERIFIED*, never automatically attributed as true speakers of numeric claims.
- **NumericObservationProposal** nodes with source-verbatim position and proposed value, but unresolved observation-as-of time, event identity, independent attribution or world truth.
- **REVIEW_CANDIDATE_ONLY** article-pair retrieval, not automatic same-occurrence or contradiction edges.

The graph separates `published_on` from unknown event-time and unknown claim observation-as-of. Two different numerical reports at different times are preserved as distinct sourced proposal records; cannot be marked contradictory without entity, metric/unit, scope, source and time alignment.

## Observed engineering-only coverage on previously exposed 31-news corpus

- **31** articles -> **133** nodes and **102** evidence edges.
- **42** review candidate pairs; mine 36, flood 5, fire 1. The review candidates have NO verified same-occurrence label.
- Facility cue `el teniente` found in 9 mining article titles.
- Action roles now include rescue, investigation, official balances and emergency orders; lexical unknown remains (mining 1, fire 2) as expected.
- Only **two** tentative numeric observation proposals in this sample. This is a limited prototype, not a broadly reliable measurement extractor.
- Claimed same-occurrence edges **0**, claimed contradictions **0**, remote writes **0**.
- No human independent adjudication performed. No semantic precision/recall/F1.
- This reused corpus may be used for development diagnostics only; any subsequent changed candidate requires a **new** independent corpus.

## Separate product blockers verified from repository's currently OPEN issues

**[#4 RESTORE-GATE](https://github.com/orlandoue/dialektik-cloud-dev/issues/4)** remains open:
- Actual encrypted backup coverage must include Supabase-managed Auth and migrations ledger plus product data;
- disposable PG17/Supabase-compatible restore replay, ACL/RLS and role reconciliation pass;
- Core dedicated DB role rotation verified without downtime;
- separate owner approval before 043/044 and authoritative ingestion.

**[#6 autonomous pipeline](https://github.com/orlandoue/dialektik-cloud-dev/issues/6)** remains open:
- 2–3 sources with documented rights/terms/robots and allowed metadata;
- bounded scheduler, idempotent acquisitions, monitored worker/backoff and kill switch;
- provenance-rich persisted Articles then evidence-backed Event grouping with independent negative checks;
- only genuine comparable attributed contradiction claims can produce cards;
- real Flutter/Android end-to-end screenshot and rollback.

The existing official GOV.UK private-beta preview has no remote persistence and is not a demonstration of autonomous ingestion. No migration 043/044, Render/Flutter writes, R14 holdout or V10.11 full-source-text execution here.

## Proposed minimum viable scaling-readiness gates

**Gate A — recovery and credentials.** Issue #4 signed off + tested rollback, backups; no bypass.
**Gate B — 2 approved sources.** Independent publishers/official sources with source-rights ledger, fetch limits and metadata-only receipts.
**Gate C — autonomous DEV ingestion.** Scheduler and outbox, retries/idempotency, source and article dedup, auditability, operator stop control. Measure drift/freshness and failed fetches.
**Gate D — semantic shadow and human safety.** ATTACK-7 graph integrated behind read-only candidate API; labels clearly `generated-candidate` vs `human-reviewed`; at least two actual blind editorial annotators; no forced occurrence link or contradiction. Independent no-leak quality gate then limited approved persistence.
**Gate E — verified mobile beta.** Flutter renders actual persistent Articles and approved Events plus provenance, original link, confidence/unknown, empty contradictions when unproven, screenshots, login roles, real Android test.
**Gate F — operational readiness.** Observability (acquisition throughput/lag, DB load, backlog/dead letters, false-merge audit rate, API p95, crash-free sessions, per-article compute cost), rehearsed rollback, rate-limit/abuse controls, staged traffic.

Not all six are complete today. Prototype regression PASS is NOT Gate D. The owner chooses minimum quality and safety levels in consultation with actual reviewers and may begin a preview-only alpha without authoritative occurrence grouping while more rigorous science runs in parallel.

## Planning estimate, not a commitment

Assuming one dedicated competent engineer working with Codex, access to the repository and credentials, two permitted sources, responsive reviewers, and reasonably short external approvals:

- **Controlled developer pilot / alpha** (2 sources, autonomous DEV metadata, evidence/candidate UI with human verification): *approximately 4–8 working weeks* after safety/source access prerequisites are actionable.
- **Private beta ready for gradual user growth** (restore gates closed, persistence, independent semantic QA, real Android E2E, monitoring/rollback): *approximately 8–16 working weeks*, allowing parallel tracks. This is a rough range based on outstanding acceptance work, NOT measured historical cycle time or a guaranteed delivery date.
- **Production scale-out** (many media, sustained ingestion, cost/load engineering, security and retention reviews): *additional 2–6+ months*, highly dependent on media licensing and whether claims/contradictions must be fully automatic. Fifty inventoried news sources are not fifty production-approved sources.

If a solo part-time developer, legal restrictions or provider approval delays apply, these durations can increase substantially. Scientific formal R14/V10.11 qualification is an independent effort and does not need to block **clearly labeled read-only/curated DEV previews**, but must not be represented as completed automated semantics.

## Next recommended move

**Stop a chain of stand-alone Attack-N prototypes.** Turn ATTACK-7 into a **bounded shadow service with a source-evidence UI** and build the first genuinely autonomous 2-source DEV pilot once #4 is closed for persistence. Execute independent human adjudication in parallel. Escalate to new model work only for measured failure patterns; do not use unreviewed headline shortcuts to merge Events or assert contradictions.