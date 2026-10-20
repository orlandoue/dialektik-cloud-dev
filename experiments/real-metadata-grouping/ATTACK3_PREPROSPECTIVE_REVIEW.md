# Attack 3 — typed occurrence identity (research-only, preprospective)

Date: 2026-10-20. Experimental base: 04a563a343540171be28172413e42684bfc7f98c.
Branch: codex/typed-occurrence-attack3-20261020.

## Audited predecessor results — NOT new benchmark evidence

- Attack 1: 16 metadata-only real-publication headlines; 14 occurrence-scorable;
  16 TP / 11 FP / 0 FN; pair P=59.26%, R=100%, F1=74.42%.
  GitHub Action 39374656869; deployment NO_GO.
- Attack 2: 20 DIFFERENT real-publication headline records; 18 occurrence-scorable;
  occurrence 21 TP / 7 FP / 10 FN; P=75%, R=67.74%, F1=71.19%.
  Thread 58 TP / 0 FP / 14 FN; P=100%, R=80.56%, F1=89.23%.
  GitHub Action 39376937841; research FAIL_NO_GO.
- The two samples are convenience samples with single-researcher labels; metrics
  are NOT directly comparable, unbiased, or an estimate of deployment performance.

## Mechanistic error decomposition of Attack 2

The frozen predictor used compatible() pair edges plus union-find single-link
closure. The seven false positive *cluster pairs* are six direct mistaken edges
p11↔{p01,p02,p03,p04,p06,p07}, plus the p05↔p11 inferred transitive pair
(p05 and p11 are both 24 Horas and never directly linked by that code).
p11 is an attributed mayoral statement following the fire, not the fire.

Ten missed pairs: seven p08↔{p01,...,p07} (retrospective photos of the same
physical incident), and three among p09,p10,p11 (different lexical signatures
for editorially same mayoral reaction). These are *pair* omissions, not ten
independent lost stories. They include both structural action/focus errors
and legacy lexical gaps (e.g. 'rescatan' unsupported by v2).

## Existing authority and compatibility

- services/core-api/src/semantic/semantic.contracts.ts already defines
  Occurrence, EventThread, SemanticMembership/Observation and MATCH/DISTINCT/UNKNOWN.
- semantic.service.ts permits fixture-only semantic ingestion outside production;
  the repository assigns a single articles.event_id on matching fixture states.
- semantic-shadow/shadow.contracts.ts requires source-rights-authorized **full
  original text** for V10.11, and a verified exclusion registry.
- This experiment is an isolated Python *metadata-only candidate*, not the
  Core semantic contract, not a SQL schema update or formal R14/V10.11 run.
- No article-level multi-occurrence write migration has been authorized; model
  mentions remain local, typed hypotheses with no fabricated occurrence IDs.
- Historical Event/Storyline/Episode meanings need an authority reconciliation
  before proposing a persistent schema. Avoid treating EventThread as proven
  equivalent to every historical use of Storyline.

## v3 algorithm: typed evidence but no imaginary semantics

attack3.py uses the **frozen** signatures.py lexicon from Attack 2 and adds:
1. Article-local REPORTS_PRIMARY and MENTIONS_CONTEXT observations.
2. COMMUNICATION vs PHYSICAL_REPORT vs RETROSPECTIVE_PHYSICAL_REPORT
   vs UNKNOWN. One article can contain multiple mention roles.
3. Four pair labels: SAME_OCCURRENCE, SAME_THREAD_DIFFERENT_OCCURRENCE,
   UNRELATED, UNKNOWN; every edge is explicitly CANDIDATE_ONLY.
4. Abstentions on multi-incident articles, missing anchors and unresolved
   speech-act identities. Publisher identity is never a hard exclusion.
5. Separate event_time=null and source published_on; date distance is ONLY
   a retrieval heuristic, never proof of time of occurrence.
6. Deterministic complete-link clique partition rather than treating
   same-news-thread transitive paths as occurrence equivalence.
7. No claim extraction, support/contradiction inference, new Events, DB writes,
   source access, provider calls or public authority.

Known limitations: fixed Chile place/venue/hazard lexicon is extremely sparse;
headline-only predicates are ambiguous; 'tras' or 'imágenes' can be misleading;
same venue can see multiple incidents; same actor may issue multiple statements.
Complete-link greedy partition is conservative but not uniquely optimal. Strong
pair similarity is not a formal occurrence identity proof. Any new benchmarks
must report UNKNOWN coverage, false merges, all-pair and cluster-level errors,
and source leakage. A synthetically passing test is NOT a research PASS.

## Reproduce synthetic implementation checks only

cd experiments/real-metadata-grouping
python3 -m unittest -v test_attack3.py

The prior two real corpora have already been inspected. Do NOT run v3 against
those and present the result as a prospective improvement or select parameters
from their reference annotations.

## Third independent evaluation gate — NOT EXECUTED

1. Freeze commit SHA of attack3.py and its dependencies BEFORE collecting
   *new* independently sourced metadata.
2. Register the corpus sampling strategy, date window, diversity strata,
   allowed source rights, exclusion criteria, and annotation instructions.
3. Collect new article metadata WITHOUT showing its editorial reference to
   the predictor; keep two independent adjudicators + conflict ledger.
4. Validate explicit occurrence boundaries (actor/action/object/venue and
   event time) and independent evolving-thread membership. Use UNKNOWN for
   insufficient evidence; multi-event articles may need multiple relations.
5. Run predictor on clean candidate-only checkout; store content hashes.
6. In a separate job, score frozen predictions against adjudicated reference.
   Report per-class pair P/R/F1 and confusion; pairwise TP/FP/FN for occurrence
   and thread; clusters' false joins/splits; B-cubed or CEAF-like metric;
   abstention rate/coverage and conditional risk; by-source and time errors.
7. No threshold tuning after reference reveal. A second run on changed code
   becomes a new candidate requiring another untouched corpus.

**Current verdict:** Attack-3 draft candidate implemented with synthetic
checks. Prospective independent evaluation NOT EXECUTED. Scientific model
qualification and deployment permission remain NO_GO.

## Operations remain blocked

Supabase managed recovery GitHub issue #4 is open. No migration 043/044,
no persistence, no autonomous acquisition scheduler, no R14 final holdout use,
no V10.11 candidate execution and no Flutter modifications.
