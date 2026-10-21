#!/usr/bin/env python3
"""Fail-closed comparison of an authentic pg_restore Auth ledger against offline target.

Input from an ALREADY isolated, authorized runner only. Never log migration IDs,
dump contents, version hashes or SQL. This tool does not open a DB or decrypt.
It only supplies a precondition; it does not authorize a write or a restore.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re

TABLE = re.compile(r'^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+auth\s+([A-Za-z_][A-Za-z_0-9]*)\s+', re.I)
COPY = re.compile(r'^COPY\s+auth\.schema_migrations\s+\(version\)\s+FROM stdin;$', re.I)
VERSION = re.compile(r'^[0-9]{2,14}$')
EXPECTED_TABLES = 27
EXPECTED_VERSIONS = 82

class GateFailure(ValueError): pass

def migration_only_toc(text: str) -> str:
    if len(text) > 2_000_000: raise GateFailure('AUTH_TOC_SIZE_INVALID')
    tables = []
    selected = []
    for line in text.splitlines(keepends=True):
        match = TABLE.match(line)
        if match is None:
            selected.append(line if line.lstrip().startswith(';') else ';' + line)
            continue
        name = match.group(1)
        tables.append(name)
        selected.append(line if name == 'schema_migrations' else ';' + line)
    if len(tables) != EXPECTED_TABLES or len(set(tables)) != EXPECTED_TABLES or tables.count('schema_migrations') != 1:
        raise GateFailure('AUTH_ARCHIVE_TABLE_INVENTORY_INVALID')
    return ''.join(selected)

def load_versions(text: str, *, archive: bool) -> frozenset[str]:
    if len(text) > 500_000: raise GateFailure('AUTH_VERSION_INPUT_TOO_LARGE')
    if not archive:
        lines = text.splitlines()
        if len(lines) != EXPECTED_VERSIONS or any(not VERSION.fullmatch(x) for x in lines):
            raise GateFailure('AUTH_TARGET_VERSION_FORMAT_INVALID')
        if len(set(lines)) != EXPECTED_VERSIONS: raise GateFailure('AUTH_TARGET_DUPLICATE_VERSION')
        return frozenset(lines)
    inside = False
    finished = False
    versions = []
    for line in text.splitlines():
        if COPY.match(line):
            if inside or finished: raise GateFailure('AUTH_ARCHIVE_MULTIPLE_COPY_STANZAS')
            inside = True
            continue
        if line.startswith('COPY ') and not inside:
            raise GateFailure('AUTH_ARCHIVE_UNEXPECTED_COPY_STANZA')
        if inside:
            if line == r'\.':
                inside = False
                finished = True
                continue
            if not VERSION.fullmatch(line):
                raise GateFailure('AUTH_ARCHIVE_VERSION_FORMAT_INVALID')
            versions.append(line)
    if inside or not finished or len(versions) != EXPECTED_VERSIONS:
        raise GateFailure('AUTH_ARCHIVE_VERSION_COUNT_INVALID')
    if len(set(versions)) != EXPECTED_VERSIONS: raise GateFailure('AUTH_ARCHIVE_DUPLICATE_VERSION')
    return frozenset(versions)

def compare(archived_sql: str, target_lines: str) -> None:
    archived = load_versions(archived_sql, archive=True)
    target = load_versions(target_lines, archive=False)
    if archived != target:
        raise GateFailure('AUTH_ARCHIVE_TARGET_VERSION_SET_MISMATCH')

def exclusive_write(path: Path, text: str) -> None:
    if path.exists(): raise GateFailure('PRIVATE_OUTPUT_ALREADY_EXISTS')
    fd = path.open('x', encoding='utf-8')
    try: fd.write(text)
    finally: fd.close()
    path.chmod(0o600)

def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--toc-in', required=True, type=Path)
    p.add_argument('--toc-out', required=True, type=Path)
    p = sub.add_parser('compare')
    p.add_argument('--archive-sql', required=True, type=Path)
    p.add_argument('--target-versions', required=True, type=Path)
    args = ap.parse_args()
    try:
        if args.command == 'prepare':
            exclusive_write(args.toc_out, migration_only_toc(args.toc_in.read_text()))
            print('ARCHIVED_AUTH_MIGRATION_TOC_PREPARED=PASS')
            print('ARCHIVED_AUTH_MIGRATION_VALUES_CHECKED=FALSE')
        else:
            compare(args.archive_sql.read_text(), args.target_versions.read_text())
            print('AUTH_ARCHIVE_TARGET_82_VERSION_SETS_EQUAL=PASS')
            print('RESTORE_AUTHORIZATION=FALSE')
    except (GateFailure, OSError, UnicodeError) as exc:
        message = str(exc) if isinstance(exc, GateFailure) else 'AUTH_PROTECTED_GATE_IO_FAILURE'
        print(message)
        return 1
    return 0

if __name__ == '__main__': raise SystemExit(main())
