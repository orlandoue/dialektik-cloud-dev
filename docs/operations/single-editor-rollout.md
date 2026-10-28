# Revisión con un solo editor

El propietario eligió que Orlando pueda proponer y confirmar las decisiones
editoriales. Las migraciones 045 y 046 y el Core de este cambio preparan esa
modalidad para las revisiones de equivalencia de OD-12. No crean afirmaciones,
evidencias, posturas ni contradicciones y no aprueban contenidos automáticamente.

## Autoridad y trazabilidad

- Solo puede existir una autorización activa para un editor único. Su registro
  conserva la referencia a la decisión y admite revocación, pero no borrado ni
  modificación de su identidad. El Core tiene únicamente lectura de esa tabla.
- Una propuesta conserva el ID de la autorización vigente en el momento de su
  creación. Proponer y confirmar son comandos distintos con sus propios recibos
  y registros de auditoría; ambos identifican al mismo editor. Las propuestas
  anteriores, sin esa autorización, siguen requiriendo moderador y editor
  distintos.
- El Core vuelve a comprobar la sesión, el rol y la autorización al ejecutar
  cada comando. La base exige igualmente el rol y una autorización vigente al
  proponer y decidir. Revocar la autorización impide decisiones nuevas sin
  borrar el historial.
- El control anterior de dos personas se sustituye dentro de la migración por
  una restricción que comprueba ambas modalidades. Los controles de formación,
  integrantes, instantánea actual y procedencia de relaciones siguen vigentes.
- La migración 046 crea un rol sin inicio de sesión que puede escribir solo las
  tablas y columnas necesarias para comandos de moderación. El lector habitual
  no hereda ese rol. El Core usa una conexión editorial separada y responde
  con HTTP 503 en operaciones de escritura mientras esa conexión no exista.
  La cuenta de conexión es una credencial del servidor de confianza y no debe
  entregarse a clientes ni exponerse en el APK.

## Pasos de instalación

1. Revisar y validar la migración y los comandos con PostgreSQL aislado antes
   de aplicarlos a una base compartida.
2. Las estructuras de 044 a 047 se instalaron en Supabase fuera del proceso de
   Core. La 046 no creó ninguna cuenta que pueda iniciar sesión. Se comprobó
   en una transacción revertida que las migraciones 045 a 047 pueden reaplicarse.
   Antes de usar el migrador general hay que reconciliar su historial con el
   esquema real: no se encontró `kysely_migration`, aunque los objetos de las
   migraciones anteriores ya existen.
3. La elección quedó registrada en Supabase con
   [authorize-requested-single-editor.sql](authorize-requested-single-editor.sql).
   El script exige una identidad editorial y una cuenta beta activas, rechaza
   una autorización simultánea para otra persona y puede repetirse.
4. El administrador crea una cuenta de base dedicada al servicio editorial,
   sin capacidades administrativas, y le asigna los roles `dialektik_core_app`
   para las lecturas y `dialektik_moderation_writer` para los comandos. Se
   debe comprobar que el lector habitual sigue sin heredar el rol de escritura.
   La contraseña y URL se configuran de forma segura en Render mediante
   `MODERATION_DATABASE_URL`; no se guardan en el repositorio ni se envían al
   cliente. La conexión usa el mismo certificado CA de PostgreSQL que el Core.
5. Desplegar el Core correspondiente solo después de instalar las migraciones,
   asignar la autorización y configurar la conexión separada. Hasta entonces el
   Core desplegado conserva la regla anterior y no acepta el acceso editorial
   de la cuenta beta. Las credenciales y el rol de escritura solo son adecuados
   para el servidor: sus funciones de auditoría confían en el contexto fijado
   por el servidor al autenticar y autorizar cada solicitud.
6. Desplegar la interfaz editorial móvil del PR de Flutter y revisar cada
   fuente, cita y relación antes de confirmar. La pantalla requiere el Core
   de este PR; sin él, la beta de lectura sigue funcionando y la acción
   editorial permanece oculta. La interfaz y el Core todavía no están
   desplegados en Render ni incluidos en un APK publicado.

La lectura editorial devuelve un fragmento solo cuando tiene entre 140 y 300
caracteres y su artículo tiene título, autor, fecha, fuente y una URL HTTPS
registrados. La pantalla muestra esa atribución junto al fragmento. La
presencia de esos campos no verifica por sí sola la fidelidad de la cita, la
especificidad del enlace ni la autorización de uso; el editor debe revisarlas
en el origen. Los artículos existentes sin autor no muestran el fragmento.

La revocación se hace por el administrador mediante `revoked_at`; no elimina
decisiones anteriores. Una propuesta de editor único que quede pendiente al
revocar su autorización no puede decidirse con esa autorización revocada.
