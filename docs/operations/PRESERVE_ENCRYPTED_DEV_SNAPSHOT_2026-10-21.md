# Preservación del respaldo cifrado original de Dialektik DEV

Protocolo de copia **sin descifrado**, iniciado desde la rama independiente `codex/backup-ciphertext-retention-20261021`.

- Respaldo original, artefacto de GitHub `12295491516` del run `39488529000`, expiración 2026-10-27T20:20:08Z.
- La copia descarga solo el artefacto ID explícito, exige un único archivo con nombre conocido y tamaño limitado; coteja SHA-256 entre bytes descargados y bytes reentregados, sin usar clave GPG, sin secretos, ni conexión a Supabase.
- Nueva retención solicitada: 60 días (si el límite del repositorio permite). GitHub limita por políticas de repo/organización.
- **Importante:** segunda copia en GitHub es redundancia temporal **dentro del mismo proveedor**, no resguardo independiente ni prueba de que la restauración funciona. El propietario debe guardar el cifrado en almacenamiento privado fuera de GitHub con la clave custodiada separadamente.
- Restauración Auth, 82 migraciones internas, 50 del proyecto y login Core siguen NO_GO. No desbloquea 043/044, writer ni producción. Sin persistencia automática.

Verificar run SUCCESS + existencia y expiración efectiva del artefacto nuevo mediante GitHub API; no declarar preservación hasta comprobar ambos.
