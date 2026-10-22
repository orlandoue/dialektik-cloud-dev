#!/usr/bin/env python3
"""Fail-closed check of one preseeded Supabase Storage migration ledger.

Protected offline runner only. Never print SQL, COPY values, timestamps,
individual migration IDs, or hashes. The source archive is immutable.
"""
from __future__ import annotations
import argparse
from collections import Counter
from pathlib import Path
import re
import sys

TABLE = re.compile(r"^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+storage\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+", re.ASCII)
COPY = re.compile(r"^COPY storage\.migrations \(id, name, hash, executed_at\) FROM stdin;$", re.ASCII)
EXPECTED_COLUMNS = 4
EXPECTED_ROWS = 74

class StorageGateError(ValueError):
    pass

def source_toc(toc: str, *, exclude: bool) -> str:
    if len(toc)>2_000_000:
        raise StorageGateError("STORAGE_TOC_TOO_LARGE")
    output=[]
    seen=[]
    for line in toc.splitlines(keepends=True):
        m=TABLE.match(line)
        if m is None:
            output.append(line if exclude or line.lstrip().startswith(";") else ";"+line)
            continue
        seen.append(m.group(1))
        selected=(m.group(1) == "migrations")
        output.append((";" if (selected==exclude) else "")+line)
    if Counter(seen)["migrations"] != 1 or len(set(seen)) != len(seen):
        raise StorageGateError("STORAGE_MIGRATION_TOC_NOT_UNIQUE")
    if len(seen)<1 or len(seen)>30:
        raise StorageGateError("STORAGE_TABLE_INVENTORY_INVALID")
    return "".join(output)

def extract_source_rows(sql: str) -> tuple[str, ...]:
    if len(sql)>1_000_000:
        raise StorageGateError("STORAGE_SOURCE_SQL_TOO_LONG")
    inside=False
    ended=False
    rows=[]
    for line in sql.splitlines():
        if COPY.fullmatch(line):
            if inside or ended:
                raise StorageGateError("STORAGE_COPY_DUPLICATE")
            inside=True
            continue
        if line.startswith("COPY "):
            raise StorageGateError("STORAGE_COPY_UNKNOWN")
        if inside:
            if line==r"\.":
                inside=False
                ended=True
                continue
            if len(line)>8192 or len(line.split("\t")) != EXPECTED_COLUMNS:
                raise StorageGateError("STORAGE_COPY_INVALID_ROW")
            rows.append(line)
    if inside or not ended or len(rows)!=EXPECTED_ROWS:
        raise StorageGateError("STORAGE_COPY_SIZE_OR_TERMINATOR_INVALID")
    if len(set(row.split("\t")[0] for row in rows)) != EXPECTED_ROWS:
        raise StorageGateError("STORAGE_COPY_DUPLICATE_ID")
    return tuple(sorted(rows))

# All category values are static/allowlisted and carry no source IDs,
# names, hashes, data values, timestamps or counts.
SAFE_DIFFERENCES = frozenset({
    "STORAGE_TARGET_ROW_COUNT_OR_COLUMNS_MISMATCH",
    "STORAGE_TARGET_DUPLICATE_ID",
    "STORAGE_MIGRATION_ID_SET_MISMATCH",
    "STORAGE_MIGRATION_NAME_OR_HASH_MISMATCH",
    "STORAGE_MIGRATION_TIMESTAMP_ONLY_MISMATCH",
    "STORAGE_MIGRATIONS_NOT_BYTE_EQUIVALENT",
    "STORAGE_COPY_SIZE_OR_TERMINATOR_INVALID",
})

def exact_compare(source_sql: str, target_copy: str) -> None:
    a=extract_source_rows(source_sql)
    b=target_copy.splitlines()
    if len(b)!=EXPECTED_ROWS or any(len(row.split("\t"))!=EXPECTED_COLUMNS for row in b):
        raise StorageGateError("STORAGE_TARGET_ROW_COUNT_OR_COLUMNS_MISMATCH")
    if len(set(row.split("\t")[0] for row in b))!=EXPECTED_ROWS:
        raise StorageGateError("STORAGE_TARGET_DUPLICATE_ID")
    if a == tuple(sorted(b)):
        return
    archive={row.split("\t")[0]: row.split("\t") for row in a}
    target={row.split("\t")[0]: row.split("\t") for row in b}
    if set(archive)!=set(target):
        raise StorageGateError("STORAGE_MIGRATION_ID_SET_MISMATCH")
    if any(archive[k][1:3] != target[k][1:3] for k in archive):
        raise StorageGateError("STORAGE_MIGRATION_NAME_OR_HASH_MISMATCH")
    if any(archive[k][3] != target[k][3] for k in archive):
        raise StorageGateError("STORAGE_MIGRATION_TIMESTAMP_ONLY_MISMATCH")
    raise StorageGateError("STORAGE_MIGRATIONS_NOT_BYTE_EQUIVALENT")

def exclusive_write(path: Path, text: str) -> None:
    if path.exists():
        raise StorageGateError("STORAGE_OUTPUT_EXISTS")
    path.write_text(text, encoding="utf8")
    path.chmod(0o600)

def main() -> None:
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest="command",required=True)
    p=sub.add_parser("only-migrations")
    p.add_argument("--toc",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    q=sub.add_parser("compare")
    q.add_argument("--source-sql",type=Path,required=True)
    q.add_argument("--target-copy",type=Path,required=True)
    x=sub.add_parser("exclude-if-identical")
    x.add_argument("--toc",type=Path,required=True)
    x.add_argument("--out",type=Path,required=True)
    x.add_argument("--equality-proved",action="store_true")
    args=parser.parse_args()
    if args.command=="only-migrations":
        exclusive_write(args.out,source_toc(args.toc.read_text(encoding="utf8"),exclude=False))
        print("STORAGE_MIGRATION_ONLY_TOC=PASS")
    elif args.command=="compare":
        exact_compare(args.source_sql.read_text(encoding="utf8"),args.target_copy.read_text(encoding="utf8"))
        print("STORAGE_MIGRATION_FULL_ROW_EXACT_EQUALITY=PASS")
    else:
        if not args.equality_proved:
            raise StorageGateError("STORAGE_EXCLUSION_NOT_AUTHORIZED")
        exclusive_write(args.out,source_toc(args.toc.read_text(encoding="utf8"),exclude=True))
        print("STORAGE_ONLY_PROVEN_IDENTICAL_LEDGER_EXCLUDED=PASS")

if __name__=="__main__":
    try: main()
    except StorageGateError as exc:
        category = str(exc)
        if category in SAFE_DIFFERENCES:
            print("STORAGE_MIGRATION_SAFE_MISMATCH_CLASS="+category,file=sys.stderr)
        print("STORAGE_SEEDED_LEDGER_CHECK=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STORAGE_SEEDED_LEDGER_CHECK=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
