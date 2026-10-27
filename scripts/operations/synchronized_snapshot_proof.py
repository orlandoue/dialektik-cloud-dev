#!/usr/bin/env python3
"""Prove pg_export_snapshot/pg_dump --snapshot consistency on an isolated PG17.

Synthetic fixtures only. Does not connect to remote databases, expose row data,
or claim that earlier independent Supabase CLI exports were consistent.
"""
import re
import subprocess
import sys

CONTAINER = "dialektik-snapshot-atomicity"
SNAPSHOT_ID = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$", re.ASCII)
SCHEMAS = ("public", "auth", "supabase_migrations")

def invoke(*argv: str) -> str:
    proc = subprocess.run(
        ["docker", "exec", CONTAINER, *argv],
        text=True, capture_output=True, timeout=60,
    )
    if proc.returncode:
        raise RuntimeError("SYNTHETIC_SNAPSHOT_COMMAND_FAILED")
    return proc.stdout.strip()

def query(sql: str, database: str = "postgres") -> str:
    return invoke("psql", "-XAt", "-v", "ON_ERROR_STOP=1",
                  "-U", "postgres", "-d", database, "-c", sql)

def assert_counts(database: str, expected: tuple[int,int,int]) -> None:
    # Return only count tuple; no identifiers from source printed.
    cols = (
        "(SELECT count(*) FROM public.example_articles)",
        "(SELECT count(*) FROM auth.example_users)",
        "(SELECT count(*) FROM supabase_migrations.example_versions)",
    )
    raw = query("SELECT " + ",".join(cols), database)
    try:
        got = tuple(int(x) for x in raw.split("|"))
    except ValueError as exc:
        raise RuntimeError("SYNTHETIC_SNAPSHOT_COUNT_MALFORMED") from exc
    if got != expected:
        raise RuntimeError("SYNTHETIC_SNAPSHOT_NOT_CONSISTENT")

def main() -> None:
    # The CI container has --network none. Fail closed on unexpected networks.
    mode = subprocess.run(
        ["docker","inspect",CONTAINER,"--format","{{.HostConfig.NetworkMode}}"],
        text=True,capture_output=True,check=True
    ).stdout.strip()
    if mode != "none":
        raise RuntimeError("SYNTHETIC_CONTAINER_NETWORK_UNSAFE")
    exporter = subprocess.Popen(
        ["docker","exec","-i",CONTAINER,"psql","-qAt","-U","postgres",
         "-d","postgres","-v","ON_ERROR_STOP=1"],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
        text=True,bufsize=1
    )
    try:
        if not exporter.stdin or not exporter.stdout:
            raise RuntimeError("SYNTHETIC_EXPORTER_UNAVAILABLE")
        exporter.stdin.write("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n")
        exporter.stdin.flush()
        snapshot_id=exporter.stdout.readline().strip()
        if not SNAPSHOT_ID.fullmatch(snapshot_id):
            raise RuntimeError("SYNTHETIC_SNAPSHOT_EXPORT_FAILED")
        # Mutate the source AFTER snapshot export. Every synchronized archive
        # must still see the earlier version, even though source counts grow.
        query("""INSERT INTO public.example_articles VALUES ('after-snapshot');
                  INSERT INTO auth.example_users VALUES ('after-snapshot');
                  INSERT INTO supabase_migrations.example_versions VALUES ('after-snapshot');""")
        assert_counts("postgres",(2,2,2))
        for schema in SCHEMAS:
            invoke("pg_dump","-U","postgres","-d","postgres",
                   "--format=custom","--data-only","--schema="+schema,
                   "--snapshot="+snapshot_id,
                   "--file=/tmp/"+schema+".snapshot.dump")
        exporter.stdin.write("COMMIT;\n")
        exporter.stdin.flush()
        exporter.stdin.close()
        if exporter.wait(timeout=15):
            raise RuntimeError("SYNTHETIC_SNAPSHOT_EXPORTER_TRANSACTION_FAILED")
        for schema in SCHEMAS:
            invoke("pg_restore","-U","postgres","-d","snapshot_target",
                   "--data-only","--single-transaction","--exit-on-error",
                   "/tmp/"+schema+".snapshot.dump")
        assert_counts("snapshot_target",(1,1,1))
        print("SYNCHRONIZED_APPLICATION_AUTH_LEDGER_SNAPSHOT=PASS")
        print("SOURCE_CONCURRENT_CHANGES_EXCLUDED_FROM_EACH_ARCHIVE=PASS")
        print("SYNTHETIC_SNAPSHOT_IDENTIFIERS_OR_ROWS_EXPOSED=FALSE")
        print("AUTHENTIC_BACKUP_OPENED=FALSE")
    finally:
        if exporter.poll() is None:
            exporter.kill()
            exporter.wait(timeout=5)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("SYNCHRONIZED_SNAPSHOT_SYNTHETIC=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
