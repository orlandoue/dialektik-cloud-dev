#!/usr/bin/env bash
# Networkless restored PostgreSQL or networkless synthetic CI only.
# No remote URL, SQL source text, personal records or credentials permitted.
set -euo pipefail
umask 077
db="$1"
work="$2"
test -n "$db" && test -d "$work" || exit 1
network_json="$(docker inspect "$db" --format '{{json .NetworkSettings.Networks}}')"
network_mode="$(docker inspect "$db" --format '{{.HostConfig.NetworkMode}}')"
network_names="$(docker inspect "$db" --format '{{range $n,$v := .NetworkSettings.Networks}}{{println $n}}{{end}}' | tr -d '\\r')"
# Production replay has exactly {} after physically disconnecting every network.
# A synthetic container launched with --network none has the sole 'none' network.
if [ "$network_json" != '{}' ] &&
   ! { [ "$network_mode" = 'none' ] && [ "$network_names" = 'none' ]; }; then
  echo 'RESTORED_SECURITY_TARGET_MUST_BE_NETWORKLESS'
  exit 1
fi
mkdir -p "$work/derived"
# Never leak local psql logs: these can include database errors.
docker cp scripts/operations/restore_role_acl_contract.sql "$db:/tmp/dialektik-restore-acl-contract.sql"
if ! docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f /tmp/dialektik-restore-acl-contract.sql > "$work/derived/role-acl-private.log" 2>&1; then
  echo 'RESTORED_CORE_WRITER_RLS_ACL=FAIL_REDACTED'
  exit 1
fi
if [ "$(cat "$work/derived/role-acl-private.log")" != 'PASS' ]; then
  echo 'RESTORED_CORE_WRITER_RLS_ACL=FAIL_REDACTED'
  exit 1
fi
echo 'RESTORED_CORE_WRITER_RLS_ACL=PASS'

# Snapshot only aggregate row counts. Never emit the counts to CI or artifacts.
state_sql="SELECT
  (SELECT count(*) FROM auth.users),
  (SELECT count(*) FROM public.private_beta_testers),
  (SELECT count(*) FROM public.categories),
  (SELECT count(*) FROM public.sources),
  (SELECT count(*) FROM public.articles),
  (SELECT count(*) FROM public.events);"
if ! docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "$state_sql" > "$work/derived/pre-rollback-state.log" 2>&1; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=PRECONDITION_FAILED'
  exit 1
fi

probe='public.dialektik_restore_atomic_probe_20261021'
exists="$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('$probe') IS NULL;" 2>/dev/null)" || {
  echo 'RESTORED_TX_ROLLBACK_PROBE=PRECONDITION_FAILED'; exit 1;
}
if [ "$exists" != 't' ]; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=PRECONDITION_FAILED'
  exit 1
fi

# This intentionally FAILS within --single-transaction. PostgreSQL must roll back
# both a synthetic table definition and its inserted row. No restored row touched.
cat > "$work/derived/intentional-rollback.sql" <<'SQL'
CREATE TABLE public.dialektik_restore_atomic_probe_20261021 (id integer PRIMARY KEY);
INSERT INTO public.dialektik_restore_atomic_probe_20261021 (id) VALUES (1001);
DO $recovery_rollback$ BEGIN
  RAISE EXCEPTION 'DIALEKTIK_EXPECTED_TRANSACTION_ROLLBACK';
END $recovery_rollback$;
SQL
docker cp "$work/derived/intentional-rollback.sql" "$db:/tmp/dialektik-intentional-rollback.sql"
if docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    --single-transaction -f /tmp/dialektik-intentional-rollback.sql \
    > "$work/derived/intentional-rollback-private.log" 2>&1; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=UNEXPECTED_COMMIT'
  exit 1
fi
if ! grep -Fq 'DIALEKTIK_EXPECTED_TRANSACTION_ROLLBACK' \
  "$work/derived/intentional-rollback-private.log"; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=WRONG_FAILURE'
  exit 1
fi
absence="$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('$probe') IS NULL;" 2>/dev/null)" || {
  echo 'RESTORED_TX_ROLLBACK_PROBE=POSTCONDITION_FAILED'; exit 1;
}
if [ "$absence" != 't' ]; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=PARTIAL_COMMIT'
  exit 1
fi
if ! docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "$state_sql" > "$work/derived/post-rollback-state.log" 2>&1; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=POSTCONDITION_FAILED'
  exit 1
fi
if ! cmp -s "$work/derived/pre-rollback-state.log" "$work/derived/post-rollback-state.log"; then
  echo 'RESTORED_TX_ROLLBACK_PROBE=RESTORED_STATE_CHANGED'
  exit 1
fi
echo 'RESTORED_TX_ROLLBACK_PROBE=PASS'
echo 'RESTORED_ROWS_OR_AUTH_IDENTIFIERS_EXPOSED=FALSE'
