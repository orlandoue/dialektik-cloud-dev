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
- MIGRATION_DATABASE_URL: private migration-only PostgreSQL URL

Use a startup command that temporarily maps MIGRATION_DATABASE_URL to DATABASE_URL
for the migration process, then starts Core with the application-role DATABASE_URL:
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run db:migrate && npm run start

Do not configure news polling, provider credentials, Cloudflare, semantic fixtures,
or LIVE activation in this deployment.
