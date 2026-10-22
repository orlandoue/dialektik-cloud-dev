#!/usr/bin/env python3
"""Offline Realtime migration version-set gate.

Only the 91 migration versions may be treated as preseeded when completely
identical; inserted_at is intentionally NOT copied into the local target.
Never emit raw versions, timestamps, SQL, Auth rows, or hashes.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re
import sys

EXPECTED_ROWS=91
LEDGER_RE=re.compile(r"^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+realtime\s+schema_migrations\s+\S+",re.ASCII)
TABLE_ANY_RE=re.compile(r"^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+",re.ASCII)
COPY_LINE="COPY realtime.schema_migrations (version, inserted_at) FROM stdin;"
VERSION_RE=re.compile(r"^[0-9]{1,20}$",re.ASCII)

class RealtimeGateError(ValueError):
    pass

def filter_toc(text:str, *, exclude:bool)->str:
    if len(text)>2_000_000:raise RealtimeGateError("REALTIME_TOC_TOO_LARGE")
    lines=text.splitlines(keepends=True)
    ledger=0
    out=[]
    for line in lines:
        is_data=TABLE_ANY_RE.match(line) is not None
        is_ledger=LEDGER_RE.match(line) is not None
        if is_data and "TABLE DATA realtime " not in line:
            raise RealtimeGateError("REALTIME_TOC_UNEXPECTED_SCHEMA")
        if is_ledger:ledger+=1
        if is_data and ((not is_ledger and not exclude) or (is_ledger and exclude)):
            out.append(";"+line)
        else:
            out.append(line)
    if ledger != 1:raise RealtimeGateError("REALTIME_LEDGER_TOC_NOT_UNIQUE")
    return "".join(out)

def source_versions(copy_sql:str)->tuple[tuple[str,str],...]:
    if len(copy_sql)>1_000_000:raise RealtimeGateError("REALTIME_ARCHIVE_SQL_TOO_LARGE")
    in_copy=False
    ended=False
    rows=[]
    for line in copy_sql.splitlines():
        if line==COPY_LINE:
            if in_copy or ended:raise RealtimeGateError("REALTIME_LEDGER_COPY_DUPLICATE")
            in_copy=True
            continue
        if line.startswith("COPY "):raise RealtimeGateError("REALTIME_LEDGER_COPY_UNKNOWN")
        if in_copy:
            if line==r"\.":
                ended=True
                in_copy=False
                continue
            if len(line)>256:raise RealtimeGateError("REALTIME_LEDGER_COPY_MALFORMED")
            cells=line.split("\t")
            if len(cells)!=2 or not VERSION_RE.fullmatch(cells[0]) or not cells[1]:
                raise RealtimeGateError("REALTIME_LEDGER_COPY_MALFORMED")
            rows.append((cells[0],cells[1]))
    if in_copy or not ended or len(rows)!=EXPECTED_ROWS:
        raise RealtimeGateError("REALTIME_LEDGER_COUNT_MISMATCH")
    if len({v for v,_ in rows})!=EXPECTED_ROWS:
        raise RealtimeGateError("REALTIME_LEDGER_DUPLICATE_VERSION")
    return tuple(rows)

def compare(source_sql:str,target_copy:str)->None:
    a=source_versions(source_sql)
    b=[]
    for line in target_copy.splitlines():
        cells=line.split("\t")
        if len(cells)!=2 or not VERSION_RE.fullmatch(cells[0]) or not cells[1]:
            raise RealtimeGateError("REALTIME_TARGET_COPY_MALFORMED")
        b.append((cells[0],cells[1]))
    if len(b)!=EXPECTED_ROWS or len({v for v,_ in b})!=EXPECTED_ROWS:
        raise RealtimeGateError("REALTIME_TARGET_VERSION_COUNT_MISMATCH")
    source_versions_set={v for v,_ in a}
    target_versions_set={v for v,_ in b}
    if source_versions_set != target_versions_set:
        # Counts only, bounded by 91; no migration version or timestamp emitted.
        print("REALTIME_VERSION_DIFF_CATEGORY=DIFFERENT_VERSION_SET",file=sys.stderr)
        print(f"REALTIME_SOURCE_ONLY_VERSION_COUNT={len(source_versions_set-target_versions_set)}",file=sys.stderr)
        print(f"REALTIME_TARGET_ONLY_VERSION_COUNT={len(target_versions_set-source_versions_set)}",file=sys.stderr)
        raise RealtimeGateError("REALTIME_MIGRATION_VERSION_SET_MISMATCH")

def write_exclusive(dest:Path, text:str)->None:
    if dest.exists():raise RealtimeGateError("REALTIME_TARGET_TOC_ALREADY_EXISTS")
    dest.write_text(text,encoding="utf8")
    dest.chmod(0o600)

def main()->None:
    arg=argparse.ArgumentParser()
    sub=arg.add_subparsers(dest="task",required=True)
    for name in ("select-ledger","exclude-if-compatible"):
        p=sub.add_parser(name)
        p.add_argument("--toc",required=True,type=Path)
        p.add_argument("--out",required=True,type=Path)
        if name=="exclude-if-compatible":
            p.add_argument("--versions-proved",action="store_true")
    p=sub.add_parser("compare")
    p.add_argument("--source-sql",required=True,type=Path)
    p.add_argument("--target-copy",required=True,type=Path)
    args=arg.parse_args()
    if args.task=="select-ledger":
        write_exclusive(args.out,filter_toc(args.toc.read_text("utf8"),exclude=False))
        print("REALTIME_LEDGER_ONLY_TOC=PASS")
    elif args.task=="exclude-if-compatible":
        if not args.versions_proved:
            raise RealtimeGateError("REALTIME_EXCLUSION_NOT_AUTHORIZED")
        write_exclusive(args.out,filter_toc(args.toc.read_text("utf8"),exclude=True))
        print("REALTIME_ONLY_IDENTICAL_VERSION_LEDGER_EXCLUDED=PASS")
        print("REALTIME_SOURCE_INSERTED_AT_PRESERVED=FALSE")
    else:
        compare(args.source_sql.read_text("utf8"),args.target_copy.read_text("utf8"))
        print("REALTIME_COMPLETE_91_VERSION_SET_EQUAL=PASS")

if __name__=="__main__":
    try:main()
    except Exception:
        print("REALTIME_SEEDED_LEDGER_GATE=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
