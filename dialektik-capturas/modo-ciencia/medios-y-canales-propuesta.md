# Medios y canales de ciencia: propuesta para elegir

Esta es una propuesta para que elijas. Todavía no hay código para esta sección.

**Regla de producto.** Dialektik no dice quién tiene razón, así que la lista no se presenta como «canales serios». Se presenta como «fuentes que cumplen estos criterios públicos», y cada ficha muestra qué criterio cumple. Los criterios son verificables y no juzgan el contenido.

| Criterio | Qué se mira | Cómo se verifica |
|---|---|---|
| A. Autoría identificable | Quién escribe o presenta, y su formación | Bio pública, institución o currículum |
| B. Cita sus fuentes | Lista de fuentes o enlaces a estudios | Descripción del video o notas del artículo |
| C. Corrige errores | Correcciones visibles (función Corrections de YouTube, comentario fijado, fe de erratas) | Al menos un caso documentado |
| D. Financiamiento declarado | Quién financia, si aplica | Página «about», Patreon, patrocinios declarados |

Cómo se mostraría: solo titulares o videos con enlace al original, nunca texto completo. Van en una sección propia, separada de los estudios.

---

## 1. Medios de ciencia (titular + enlace por RSS, como los medios de noticias)

| Medio | Idioma | Por qué | Notas | ¿Incluir? |
|---|---|---|---|---|
| Nature (News) | en | Revista científica de referencia; sección de noticias con periodistas identificados | Muchas notas son de pago: solo titular y enlace | ☐ |
| Science (News) | en | Ídem (AAAS) | Ídem | ☐ |
| Quanta Magazine | en | Periodismo de ciencia financiado por la Fundación Simons, sin paywall | Financiamiento declarado | ☐ |
| New Scientist | en | Revista de divulgación con redacción identificada | Paywall parcial | ☐ |
| Scientific American | en | Ídem | Paywall parcial | ☐ |
| Agencia SINC | es | Agencia pública española de noticias de ciencia (FECYT) | Licencia abierta en gran parte del contenido | ☐ |
| SciDev.Net (español) | es | Ciencia y desarrollo, con foco en América Latina | | ☐ |

Con cada uno se verifica en CI que su RSS existe y responde, igual que con los medios actuales, antes de activarlo.

---

## 2. Canales de YouTube (lector de YouTube que ya existe en la app)

| Canal | Idioma | A. Autoría | B. Fuentes | C. Correcciones | D. Financiamiento | ¿Incluir? |
|---|---|---|---|---|---|---|
| QuantumFracture | es | José Luis Crespo, físico (UAM), ex divulgador del IFT-Madrid [1] | Por verificar en cada video | Por verificar | Patrocinios en video | ☐ |
| Date un Voltio | es | Javier Santaolalla, doctor en física de partículas, trabajó en el CERN [2] | Por verificar | Por verificar | Patrocinios en video | ☐ |
| Derivando | es | Eduardo Sáenz de Cabezón, doctor en matemáticas, profesor de la U. de La Rioja; producido por una productora [3] | Por verificar | Por verificar | Productora declarada | ☐ |
| CdeCiencia | es | Martí Montferrer, geólogo; resumen semanal de noticias científicas [4] | Por verificar | Por verificar | Por verificar | ☐ |
| La Hiperactina | es | Sandra Ortonobes, biomédica (UB), máster en comunicación científica (UPF) [5] | Por verificar | Por verificar | Patreon declarado [5] | ☐ |
| Kurzgesagt | en | Estudio con verificadores internos [6] | **Sí**: lista de fuentes en cada video [6] | **Sí**: rehízo un video tras críticas [6] | Fundación Gates (declarado; generó debate) [6] | ☐ |
| PBS Space Time | en | Matt O'Dowd, astrofísico, CUNY Lehman College [7] | Por verificar | Por verificar | PBS (público) | ☐ |
| Veritasium | en | Derek Muller, doctorado en investigación educativa en física | Por verificar | Un video fue cuestionado públicamente por un profesor de UCLA [8]; no encontré nota de corrección | Patrocinios en video | ☐ |

**Chile.** Hay divulgadoras de astronomía con formación de la U. de Chile, como Teresa Paneque y Francisca Contreras («Fran Astrónoma»), y series institucionales, como «Universo en 300s» del Instituto de Astrofísica UC y el Planetario USACH [9]. Pueden entrar como fuentes chilenas si las apruebas.

«Por verificar» quiere decir que no encontré evidencia pública en esta búsqueda. Antes de activar un canal, reviso 5 videos recientes y anoto B y C con enlaces.

## Lo que necesito de ti
1. Marca qué medios y canales entran.
2. ¿Exigimos los 4 criterios o basta con A y B?
3. ¿Agrego las fuentes chilenas de la lista?

## Fuentes
1. [CAB INTA-CSIC](https://cab.inta-csic.es/en/?p=33568), [CCCB](https://www.cccb.org/en/participants/file/jose-luis-crespo-quantumfracture/231511)
2. [Wikipedia: Javier Santaolalla](https://en.wikipedia.org/wiki/Javier_Santaolalla), [BBVA](https://www.bbva.es/finanzas-vistazo/aprendemos-juntos/javier-santaolalla.html)
3. [Wikipedia: Eduardo Sáenz de Cabezón](https://en.wikipedia.com/wiki/Eduardo_S%C3%A1enz_de_Cabez%C3%B3n), [Universidad de Alicante](https://web.ua.es/es/divulgar-ciencia-xxi/curriculums-breves/eduardo-saenz-de-cabezon.html)
4. [CCCB](https://cccb.org/en/participants/file/marti-montferrer-cdeciencia/231513), [Público](https://www.publico.es/ciencias/ciencia-defiende-youtube.html)
5. [CCCB](https://cccb.org/en/participants/file/sandra-ortonobes-la-hiperactina/231652), [Patreon](https://www.patreon.com/lahiperactina/about)
6. [Clearer Thinking](https://www.clearerthinking.org/post/2019/04/03/how-fun-animations-can-teach-you-important-ideas-about-the-world), [r/kurzgesagt: declaración sobre conflicto de interés](https://lr.eu.psf.lt/r/kurzgesagt/comments/10jlyyk/kurzgesagt_statement_to_the_conflict_of_interest), [resumen tipo wiki](https://wiki.riteme.site/wiki/Kurzgesagt)
7. [Wikipedia: Matt O'Dowd](https://en.wikipedia.org/wiki/Matt_O%27Dowd_(astrophysicist)), [Schmidt Sciences](https://www.schmidtsciences.org/grantee/matt-odowd/)
8. [Interesting Engineering](https://interestingengineering.com/video/ucla-physics-professor-bet-a-youtuber-10k-that-his-video-was-wrong)
9. [U. de Chile](https://uchile.cl/noticias/220136/francisca-contreras-educadora-astronomica-infantil), [UC: Universo en 300s](https://www.uc.cl/noticias/academicos-del-instituto-de-astrofisica-lanzaron-nueva-serie-online-que-busca-ensenar-astronomia-a-las-personas/), [El Tiempo: Teresa Paneque](https://www.eltiempo.com/vida/ciencia/la-astronoma-que-trabaja-en-divulgacion-cientifica-en-tiktok-784367)
