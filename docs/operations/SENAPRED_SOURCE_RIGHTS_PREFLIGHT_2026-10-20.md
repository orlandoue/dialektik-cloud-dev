# Dialektik — second-source qualification candidate (SENAPRED Chile)

**Research-only candidate; NOT AUTHORIZED FOR AUTOMATED COLLECTION.**
Date of source review: 2026-10-20.

## Public identity and observable material

- Official Chilean public agency **Servicio Nacional de Prevención y Respuesta ante Desastres (SENAPRED)**: https://www.senapred.cl/ and https://www.senapred.cl/noticias/
- Publisher listing has titles, publication dates and links in plain public HTML. Source reviewed against publicly indexed `senapred.cl/noticias/` page, with examples dated October 2026. Independent from GOV.UK RSH, useful for Chile emergency/disaster context.
- Agency also provides public event/event-catalog pages, e.g. https://web.senapred.cl/eventos/ . Do not conflate news posts, alerts and physical incidents; a closure bulletin can refer to a previously reported occurrence.
- A request to `https://senapred.cl/feed/` through the research browser returned HTML rather than a usable verified RSS/XML feed; **RSS is NOT accredited** from that observation.
- `robots.txt` content for the canonical hostname was NOT retrievable/verified through our current research access. This does NOT prove that automated access is allowed or forbidden.
- No publication-specific redistribution, automated polling, API usage/rights or rate-limit grant has been verified. Government agency status does **not** automatically grant a blanket scraper or commercial reuse license.

## Decision

`SOURCE_CANDIDATE_IDENTIFIED / ROBOTS_UNVERIFIED / RIGHTS_UNVERIFIED / AUTOMATED_FETCH_DISABLED`.

No SENAPRED site polling, crawling, content acquisition, or persistent Article writes executed. It must remain out of enabled GitHub Actions, Core adapters and Supabase source-policies until the following are completed:

1. Verify canonical host, redirects, live `robots.txt` and user-agent rules, acceptable official API or sanctioned RSS/feed path, plus endpoint and content-type behavior.
2. Establish source-specific allowed fields (headline, canonical URL, publication timestamps, attribution), reuse/persistence license, allowed automation frequency and bounded retry behavior.
3. Record review identity, evidence URLs, check date, versioned rights ledger, source kill switch and exact allowlisted route. Negative/different-date and updates-after-correction contract tests.
4. Then implement a **read-only**, bounded preview behind an explicit DEV flag. A second source is not enabled until an owner approves after rights review.
5. Do not enable SQL writer or persistence until Supabase RESTORE-GATE #4 is proven.

This is a rights-first research record, **not** a second operationally approved source. Existing GOV.UK RSH watcher remains the only verified-read acquisition in this branch.

Public research sources:
- https://www.senapred.cl/noticias/
- https://web.senapred.cl/eventos/
- https://senapred.cl/contacto/
