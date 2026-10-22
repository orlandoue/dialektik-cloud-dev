# GOV.UK two-publisher discovery proof — 2026-10-21

This branch extends the bounded, source-verified GOV.UK metadata-only search to two issuing bodies:
- Regulator of Social Housing (RSH), via the prior search+content adapter.
- Ministry of Housing, Communities and Local Government (MHCLG), with independently scoped Search API query and Content API verified organisation.

Every run consults robots.txt before Search and Content API access; accepts only official https://www.gov.uk origin, press releases under /government/news, canonical dates, exact publisher and content ID. It fetches at most five articles per source and 40 search results per query; no full text output, no database secret, no writes. Cross-source identical canonical URLs are not treated as independent reports and are discarded from the second set (or the run fails if none remains). Date/rights review expires after 30 days, robot disallow fails closed.

Source terms: https://www.gov.uk/help/terms-conditions (OGL v3, exceptions and attribution). Public Search API: https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html . The API remains unsupported for stability; schema drift can stop discovery. Both are original government sources, not two journalistic outlets and do NOT establish independent corroboration of the same event. No semantic Events/contradictions may be inferred. Source relevance is UK housing; independent Chilean publisher rights remain a separate task.

The live read-only GitHub Actions proof compiles the Core/DB and runs Node + Vitest tests; artifact retention 3 days. Cron OFF by default and only runs automatically if workflow is merged into default with operator flag. The active DEV database, Render and APK are unchanged. RESTORE-GATE #4 remains NO_GO.
