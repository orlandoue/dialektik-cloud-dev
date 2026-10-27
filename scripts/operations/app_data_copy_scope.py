#!/usr/bin/env python3
"""Redacted structural diagnosis of FIRST application COPY failure.

For a protected, isolated PostgreSQL restore only. No SQL is executed. Never
emit table names, row values, identifiers, SQL, path, line numbers or hashes.
Original authenticated backup bytes remain unchanged.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

# Match only the exact private SQL path used by the protected local runner.
_PSQL_ERROR = re.compile(
    r"^psql:/tmp/dialektik_restore_real/data\.sql:([1-9][0-9]{0,9}):\s+ERROR:\s+(.+)$",
    re.IGNORECASE,
)
_ANY_SQL_ERROR = re.compile(r"(?:^|[ \t])(?:ERROR|FATAL):", re.IGNORECASE)
_IDENTIFIER = r'(?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*)'
_COPY = re.compile(
    r"^COPY\s+(?P<schema>"+_IDENTIFIER+r")\.(?P<table>"+_IDENTIFIER+
    r")\s*(?:\([^;\r\n]*\))?\s+FROM stdin;\s*$",
    re.IGNORECASE,
)
_END = r"\."
# These four table names are names of Supabase's ordinary system ledgers,
# NOT an instruction to omit them or to bypass unique constraints.
_SYSTEM_LEDGER = frozenset((
    ("auth", "schema_migrations"),
    ("storage", "migrations"),
    ("realtime", "schema_migrations"),
    ("supabase_migrations", "schema_migrations"),
))


def _unquote(name: str) -> str:
    return (name[1:-1] if name.startswith('"') and name.endswith('"') else name).lower()


def _copy_scope(schema: str, table: str) -> str:
    if (schema, table) in _SYSTEM_LEDGER:
        return "MANAGED_MIGRATION_LEDGER_CANDIDATE"
    if schema == "public":
        return "APPLICATION_PUBLIC_COPY"
    if schema == "auth":
        return "OTHER_AUTH_COPY"
    if schema == "realtime":
        return "OTHER_REALTIME_COPY"
    if schema == "storage":
        return "OTHER_STORAGE_COPY"
    if schema == "supabase_migrations":
        return "OTHER_SUPABASE_MIGRATIONS_COPY"
    return "OTHER_OR_UNSUPPORTED_SCHEMA_COPY"


def first_duplicate_copy_scope(error_log: str, data_sql: str) -> str:
    """Return a fixed code, fail closed if statement attribution is ambiguous."""
    first_error = None
    for line in error_log.splitlines():
        if not _ANY_SQL_ERROR.search(line):
            continue
        first_error = _PSQL_ERROR.fullmatch(line)
        break
    if first_error is None:
        return "FIRST_ERROR_LOCATION_UNAVAILABLE"
    line_number = int(first_error.group(1))
    # Only scope the exactly established duplicate-key category.
    if not first_error.group(2).lower().startswith("duplicate key value violates unique constraint"):
        return "FIRST_ERROR_NOT_DUPLICATE_KEY"
    active = None
    for n, line in enumerate(data_sql.splitlines(), start=1):
        if active is None:
            if n > line_number:
                return "FIRST_ERROR_OUTSIDE_COPY"
            match = _COPY.fullmatch(line)
            if match:
                active = (n, _unquote(match.group("schema")), _unquote(match.group("table")))
        else:
            if line == _END:
                begin, schema, table = active
                if begin <= line_number <= n:
                    return _copy_scope(schema, table)
                active = None
            elif n > line_number:
                # A COPY failure can be reported at the terminator, not the row.
                # No target can be released until a structurally complete COPY.
                continue
    return "FIRST_ERROR_COPY_UNRESOLVED" if active is not None else "FIRST_ERROR_OUTSIDE_COPY"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--private-log", type=Path, required=True)
    p.add_argument("--data-sql", type=Path, required=True)
    a = p.parse_args()
    try:
        if a.private_log.stat().st_size > 1_000_000 or a.data_sql.stat().st_size > 250_000_000:
            raise ValueError("size")
        log = a.private_log.read_text(encoding="utf-8", errors="replace")
        data = a.data_sql.read_text(encoding="utf-8", errors="replace")
        scope = first_duplicate_copy_scope(log, data)
    except (ValueError, OSError, UnicodeError):
        scope = "PRIVATE_INPUT_PRECONDITION_FAILED"
    print("REDACTED_FIRST_APPLICATION_COPY_SCOPE="+scope)
    print("APPLICATION_SOURCE_ROWS_OR_TABLE_IDENTIFIERS_EXPOSED=FALSE")


if __name__ == "__main__":
    main()
