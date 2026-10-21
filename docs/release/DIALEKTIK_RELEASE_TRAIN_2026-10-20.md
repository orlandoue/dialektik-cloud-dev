# DIALEKTIK — Release train: del piloto Android real a beta pública (20-10-2026)

## Fuente de verdad y alcance

La APK Flutter Android real se compila mediante GitHub Actions en una rama del piloto; Core NestJS corre en Render DEV y usa Supabase DEV. La rama por defecto de este repositorio contiene **solo Core/database**, no el código completo de Flutter. El usuario ha instalado/probado la APK. No reconstruir ese piloto.

Hechos demostrados **antes** de este release train:
- GOV.UK RSH: hasta siete metadatos oficiales verificados mediante API de fuente, **previsualización no persistente**, y monitor de lista cerrada en PR #9. No adquisición continua de URLs nuevas ni segunda fuente con permiso demostrado.
- Chile: cinco enlaces editoriales de un solo acontecimiento de Estación Central con cuatro redacciones y un comunicado oficial. **Agrupación humana**, no inferencia del motor. PR #8 agrega análisis lexical shadow DEV no desplegado.
- Recuperación: backup ciphertext REAL, íntegro, incluye 27 tablas Auth y ledger, pero el replay protegido llegó a **roles + privilegios + esquema PASS / carga Auth FAIL**; aún **RESTORE-GATE #4 NO_GO**. La versión de Auth en DEV coincide en 82 migraciones internas con Supabase local, pero falta verificar equivalencia **del backup**.
- Artículos y Events remotos: 0 al último inventario, migraciones aplicadas hasta 042. 043/044 sin aplicar; writer NOLOGIN. No reproducir noticias almacenadas falsas.
- Modelos experimentales ATTACK 1–7 y evaluación formal R14 NO-GO para atribuir automáticamente acontecimientos/contradicciones.

## Release stages — impedir sobreventa

| Stage | Estado | Características permitidas | No anunciar |
|---|---|---|---|
| DEV Android privado existente | **FUNCIONANDO con límites** | Login autorizado, previews reales etiquetados, pruebas de usabilidad con usuarios expresamente habilitados | Ingestión multipublisher autónoma, Events persistidos, contradicciones automáticas |
| Beta por invitación ampliada | **CANDIDATO** | Cohorte limitada, consentimiento/privacidad, soporte de incidentes, telemetría mínima opcional y apagado remoto, después de smoke + observabilidad + revisión jurídica | Algoritmo validado que detecta información falsa |
| Beta automatizada Chile | **BLOQUEADA** por #4 y #6 | Solo al aprobar backup+restore, fuente(s) autorizadas, recibos persistidos, deduplicación, grouping auditado y rollback | Cobertura de 50 medios, contradicciones sin evidencia |
| Lanzamiento público amplio | **NO_GO** | APK/release Android firmado, onboarding/soporte, privacidad y derechos, desempeño, cobertura y evaluación independiente | Disponibilidad general, fact-checking garantizado, clasificación objetiva de la verdad |

## Camino crítico (orden de ejecución, sin reconstruir el producto)

**R0 — Respaldo e integridad (bloqueante para DB writer).**
Conservar backup ciphertext fuera de GitHub (artefacto 12295491516 expira 27-10-2026); reconfirmar su copia y custodia separada de la clave. Contabilizar 82 migraciones Auth **directamente en el backup** y compararlas contra la base local; solo si coinciden, preservar la tabla Auth local inicializada y restaurar otras 26 mediante TOC derivado (todas las claves/roles/constraints vigentes). Después completar 50 migraciones de aplicación, RLS/ACL, prueba Core Auth, snapshot consistente/recuperación y simulación de rollback. PR #10, issue #4. No habilitar writer ni aplicar 043/044 antes del PASS independiente.

**R1 — Fuentes autorizadas y schedule real.**
Revisar reglas robots/ToS/licencia y retención para al menos dos publishers independientes de cobertura relevante a Chile. Mantener GOV.UK como referencia oficial acotada; SENAPRED es CANDIDATO NO HABILITADO. Implementar descubrimiento de nuevas URLs autorizado, no solamente vigilancia de un allowlist congelado; receipts con timestamp, HTTP status categorizado, source policy version, hash dedupe, backoff, límites, kill switch y pruebas de no-rescrape. No copiar cuerpos de artículos sin derechos.

**R2 — Persistencia mínima / API real.**
Tras R0 PASS y autorización diferenciada, aplicar 043/044 con checksum guard y test de rollback; usar rol dedicado min-privilege. Ingerir solo título/canonical URL/editor/source timestamps/attribution en primera fase; demostrar idempotencia de dos fuentes, nuevas versiones de correcciones y que el feed/Flutter leen lo mismo. Ninguna feature flag de preview puede engañar al usuario respecto a persistencia.

**R3 — Acontecimientos y contradicciones.**
Integrar candidato semántico **shadow**, versionado y separado de Gold. Exigir pruebas independientes de pares positivos y negativos por ocurrencia, fecha, lugar, actor y acción; no aceptar falsos merges por titular genérico. Solo habilitar Event generado cuando su umbral de false-merge cumple una política cuantitativa aprobada. Contradicciones: comparables en entidad/tiempo/unidad/fuente, atribuciones accesibles y separación explícita entre discrepancia, actualización posterior y falta de información. Si no hay contradicción real validada, mostrar «No se encontraron contradicciones verificables».

**R4 — Móvil/operación.**
Revisar GitHub Actions APK, dependencia en la rama Flutter, dispositivos Android reales, release firmado con claves fuera del repo, control de versiones, deep-links originales, accesibilidad, aviso de tratamiento de datos, reportes de error, límites y protección contra abuso. Confirmar branding, dominio público, disponibilidad de APK y política de distribución, onboarding, cuentas de prueba separadas y métricas respetuosas de la privacidad. Privacidad legal y fuentes antes de abrir captación masiva.

**R5 — Crecimiento medido.**
Primero cohorte cerrada: 20–50 invitados que entiendan que hay previews editoriales, no una promesa de IA infalible. Medir (agregado) activación, noticias abiertas, clicks a fuentes, comprensión de etiquetas, errores por sesión, crash-free, retención a 7 días y reportes de agrupaciones erróneas. Segundo, lista de espera pública solo con consentimiento claro y política de borrado. Tercero, outreach a periodistas, editores, universidades y comunidades noticiosas bajo una demostración fiel. Publicidad pagada significativa solo tras asegurar derechos, operación y funcionalidades anunciadas.

## Gate automático añadido en PR de lanzamiento

`scripts/operations/pilot-release-readiness.mjs` y `.github/workflows/pilot-launch-readiness.yml`:
- Compilar Core y DB, pruebas de GOV.UK+preview editorial.
- **GET sin tokens**, nunca cuerpo de respuestas privadas: `/health/live`, `/health/ready`, `/v1/feed`, `/v1/contradictions`, `/live/preview/govuk`, `/live/preview/events/chile-tornado`.
- Exigir 200 a health y 401 a cuatro endpoints beta protegidos. Si uno responde 200 sin Auth, **NO_GO**.
- Emitir `NO_GO_PUBLIC_LAUNCH` de forma irreversible hasta contar con nueva evidencia externa y una nueva revisión de release. Un runtime PASS prueba **salud y guardas**, NO un motor semántico automatizado.

## Mensajería externa autorizable (solo tras comprobar claims)

**Anuncio para testers privados**:
> Dialektik es un proyecto en desarrollo para explorar cómo distintos medios cubren los acontecimientos. Estamos probando una aplicación Android con noticias enlazadas a sus fuentes originales y casos piloto revisados editorialmente. Buscamos un grupo pequeño de personas que quiera evaluar la experiencia y ayudarnos a mejorarla. Las agrupaciones automáticas y las comparaciones de afirmaciones siguen en desarrollo.

**No usar hoy**: «Dialektik detecta contradicciones en tiempo real», «todos los medios de Chile», «noticias verificadas por IA», «acontecimientos agrupados automáticamente», «la verdad objetiva de cada noticia». Esas frases no cuentan con pruebas productivas.

## Responsable de decisión

Cualquier GO público requiere: evidencias de seguridad y restauración; aprobación de privacidad/derechos; comportamiento real en Android y Core; verificación de fuentes; control de falsos merges y afirmaciones; y aprobación explícita del propietario sobre exactamente qué anuncio y audiencia se habilitan. No tratar un CI green de código como sustituto.
