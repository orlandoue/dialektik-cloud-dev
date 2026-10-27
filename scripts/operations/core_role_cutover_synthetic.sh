#!/usr/bin/env bash
# Synthetic credential rotation experiment only. Never pass production passwords.
set -euo pipefail
umask 077
db="${1:?container required}"
w="${2:?scratch directory required}"
test -d "$w"
# The database MUST have no external Docker networks.
mode="$(docker inspect "$db" --format '{{.HostConfig.NetworkMode}}')"
network_names="$(docker inspect "$db" --format '{{range $n,$v := .NetworkSettings.Networks}}{{println $n}}{{end}}')"
if [ "$mode" != none ] || [ "$network_names" != none ]; then
  echo 'CORE_ROTATION_SYNTHETIC_NETWORK_ISOLATION=FAIL'
  exit 1
fi
root='dummy-root-scram-20261021'
old='dummy-old-core-scram-20261021'
next='dummy-next-core-scram-20261021'
cat > "$w/fixture.sql" <<'SQL'
CREATE ROLE dialektik_core_app LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'dummy-old-core-scram-20261021';
CREATE ROLE dialektik_core_app_next LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'dummy-next-core-scram-20261021';
CREATE TABLE public.sources(id text PRIMARY KEY);
CREATE TABLE public.articles(id text PRIMARY KEY);
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO dialektik_core_app,dialektik_core_app_next;
GRANT SELECT ON public.sources,public.articles TO dialektik_core_app,dialektik_core_app_next;
SQL
docker cp "$w/fixture.sql" "$db:/tmp/synthetic-cutover-fixture.sql"
if ! docker exec -e PGPASSWORD="$root" "$db" psql -X -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/synthetic-cutover-fixture.sql > "$w/fixture-private.log" 2>&1; then
  echo 'SYNTHETIC_CUTOVER_FIXTURE=FAIL'
  exit 1
fi
probe='SELECT CASE WHEN
  has_table_privilege(current_user,\x27public.articles\x27,\x27SELECT\x27) AND
  has_table_privilege(current_user,\x27public.sources\x27,\x27SELECT\x27) AND
  NOT has_table_privilege(current_user,\x27public.articles\x27,\x27INSERT\x27) AND
  NOT has_table_privilege(current_user,\x27public.articles\x27,\x27DELETE\x27) AND
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls)
  THEN \x27PASS\x27 ELSE \x27FAIL\x27 END;'
# Literal SQL quote protection without shell eval.
probe="${probe//\\x27/\'}"
login_probe() {
  local user="$1" password="$2" file="$3"
  docker exec -e PGPASSWORD="$password" "$db" psql -XAt -h 127.0.0.1 \
    -U "$user" -d postgres -v ON_ERROR_STOP=1 -c "$probe" > "$file" 2>&1 &&
    [ "$(cat "$file")" = 'PASS' ]
}
login_probe dialektik_core_app "$old" "$w/old-before-private.log" || {
  echo 'SYNTHETIC_OLD_CORE_READ=FAIL'; exit 1;
}
login_probe dialektik_core_app_next "$next" "$w/next-before-private.log" || {
  echo 'SYNTHETIC_NEXT_CORE_READ=FAIL'; exit 1;
}
if login_probe dialektik_core_app_next "$old" "$w/invalid-private.log"; then
  echo 'SYNTHETIC_NEXT_WRONG_PASSWORD_UNEXPECTED_SUCCESS'; exit 1
fi
echo 'SYNTHETIC_DUAL_CREDENTIAL_READ=PASS'

# Simulate cutover: old credential rejected for NEW sessions; new read remains.
docker exec -e PGPASSWORD="$root" "$db" psql -XAt -h 127.0.0.1 -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c 'ALTER ROLE dialektik_core_app NOLOGIN;' > "$w/revoke-private.log" 2>&1
if login_probe dialektik_core_app "$old" "$w/old-rejected-private.log"; then
  echo 'SYNTHETIC_OLD_ROLE_NOT_REVOKED'; exit 1
fi
login_probe dialektik_core_app_next "$next" "$w/next-after-private.log" || {
  echo 'SYNTHETIC_NEXT_CORE_AFTER_REVOKE=FAIL'; exit 1;
}
echo 'SYNTHETIC_NEW_CORE_CONTINUITY=PASS'

# Simulate owner rollback of cutover, never touch a managed production role.
docker exec -e PGPASSWORD="$root" "$db" psql -XAt -h 127.0.0.1 -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c 'ALTER ROLE dialektik_core_app LOGIN;' > "$w/rollback-private.log" 2>&1
login_probe dialektik_core_app "$old" "$w/old-restored-private.log" || {
  echo 'SYNTHETIC_CUTOVER_ROLLBACK=FAIL'; exit 1;
}
login_probe dialektik_core_app_next "$next" "$w/next-retained-private.log" || {
  echo 'SYNTHETIC_CUTOVER_ROLLBACK=FAIL'; exit 1;
}
echo 'SYNTHETIC_CUTOVER_ROLLBACK=PASS'
echo 'PRODUCTION_ROLE_OR_RENDER_CHANGED=FALSE'
