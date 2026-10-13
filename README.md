# Dialektik Core cloud deployment source

This clean export contains the NestJS Core and its PostgreSQL schema/migration source only.
It excludes the original repository history, Flutter artifacts, local configuration, news records,
research documents, scientific evaluation evidence, and frozen holdout materials.

## Runtime configuration

- NODE_ENV=production
- SEMANTIC_MODE=disabled
- CORE_API_HOST=0.0.0.0
- CORE_API_PORT=10000 (or the platform-provided port)
- DATABASE_URL: restricted application-role PostgreSQL URL using TLS
- Database migrations are applied out-of-band by the owner before deploy. Do not configure
  migration or administrator credentials on the running web service.

Start the service with `npm start` and configure `DATABASE_URL` with the restricted,
read-only application role. The running Core must not receive migration privileges.

Do not configure news polling, provider credentials, Cloudflare, semantic fixtures,
or LIVE activation in this deployment.
