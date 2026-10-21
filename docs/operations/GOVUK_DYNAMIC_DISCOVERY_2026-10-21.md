# GOV.UK RSH dynamic discovery — 2026-10-21

Scope: actual GOV.UK Search API discovery of up to five fresh candidate URLs via official API, with robots.txt rechecked each run; every new path independently verified with GOV.UK Content API and the RSH source identity. No full article bodies copied, no database writes, no Event/contradiction generation. Search is an unsupported API, so schema drift fails closed. Readonly receipt retained 3 days in CI.

Source rights: https://www.gov.uk/help/terms-conditions and OGL with exceptions; rights review currently pinned to October 15 (expires after 30 days). Search documentation: https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html . Robots: https://www.gov.uk/robots.txt . No new source is implicitly authorized by a search result. Distinct publishers currently: one.

Critical: this is a prewrite proof, not persistent acquisition. Without an authoritative previous database version, NEW means absent from supplied previous list, not necessarily published since the last poll. Activate scheduler and transactional writer only after restore gate #4 and separate migration/ACL/rollback evaluation, with a validated second publisher and semantic false-merge gate before Events/contradictions may be published. PR deliberately stacked on #14, not deployed to Render.
