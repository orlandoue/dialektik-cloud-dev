# Chile original-news sources — rights and robots preflight, 2026-10-21

## INE: commercial re-use rights appear promising, but acquisition remains OFF

Official Instituto Nacional de Estadísticas (INE) [Términos de Uso y Licencia de Datos Abiertos](https://ineportaldpr.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos) expressly references **CC BY-SA 4.0**, including commercial reuse when attribution, same-license derivative sharing and notices of modifications are respected. Relevant official news listings: https://www.ine.gob.cl/sala-de-prensa/noticias and https://www.ine.gob.cl/sala-de-prensa/prensa/general.

**Licensing is distinct from a site's robots and technical accessibility.** The new GitHub test accesses ONLY `https://www.ine.gob.cl/robots.txt`, tests two exact listing paths, stores NO page/article body, uses no DB credentials, and never activates acquisition. If robots cannot be fetched, parsed unambiguously or disallow the paths, the source stays **DISABLED / TECHNICAL_REVIEW_REQUIRED**. Before any production ingest, establish per-item original authorship and third-party exclusions, canonical URL, publication date, identity, bounded read and user-facing BY-SA/attribution/derivation notices.

## BCN: commercial content usage NOT authorized by cited news license

BCN [licensing statement](https://www.bcn.cl/portal/api-servicios/servicio/ObtenerNoticiaPorIdNoticiaHTML?id=contenidos-web-de-la-bcn-con-derechos-de-uso-liberados) permits distribution/derivative works **only for noncommercial use** with citation. This is not sufficient to license a potentially monetized Dialektik commercial news service. Accordingly **BCN_LICENSE_REQUIRED: do not ingest protected BCN news content for commercial exploitation by default**. Linking/citation and raw publicly known facts have different legal questions and are not a blanket blanket copyright license. Individual licensing review remains necessary.

## Operational status

This branch is a technical preflight, not a live feeder. No Supabase DB writes, no source grant, no article persistence, no event inference and no app deployment. Restore Gate #4 is still NO_GO; independently gated release remains required.
