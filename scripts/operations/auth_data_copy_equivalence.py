#!/usr/bin/env python3
"""Strict exact Auth duplicate-COPY reconciliation, for isolated restores only.

The general SQL dump sometimes contains Auth COPY blocks already covered by the
separately restored original Auth archive. No source data is ever printed.
Eliding a duplicate COPY is allowed ONLY after complete, record-for-record
equality against the independent archived Auth COPY has been established.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import re


_IDENTIFIER = r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*)'
_COPY = re.compile(
    r'^COPY\s+(?P<schema>' + _IDENTIFIER + r')\.(?P<table>' + _IDENTIFIER +
    r')\s+\((?P<cols>' + _IDENTIFIER + r'(?:,\s*' + _IDENTIFIER +
    r')*)\)\s+FROM stdin;\s*$'
)
_COLUMN = re.compile(_IDENTIFIER)
_AUTH_SETVAL = re.compile(r"^SELECT\s+pg_catalog\.setval\('\s*auth\.", re.IGNORECASE)
_ALL_SETVAL = re.compile(r"^SELECT\s+pg_catalog\.setval\(.*\);\s*$", re.IGNORECASE)
_MAX_FILE = 250_000_000


class GateFailure(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class CopyBlock:
    table: str
    columns: tuple[str, ...]
    rows: tuple[str, ...]
    start: int
    end: int


def _identifier(raw: str) -> str:
    return raw[1:-1].replace('""', '"') if raw.startswith('"') else raw.lower()


def _blocks(lines: list[str], auth_only: bool) -> tuple[dict[str, CopyBlock], set[int]]:
    blocks: dict[str, CopyBlock] = {}
    remove: set[int] = set()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\r\n')
        if not line.startswith('COPY '):
            i += 1
            continue
        match = _COPY.fullmatch(line)
        if match is None:
            raise GateFailure('AUTH_COPY_UNRECOGNIZED_STATEMENT')
        schema = _identifier(match.group('schema'))
        table = _identifier(match.group('table'))
        raw_cols = match.group('cols')
        tokens = tuple(_COLUMN.findall(raw_cols))
        # Parse only a canonical comma-separated column token sequence.
        if ', '.join(tokens) != raw_cols and ','.join(tokens) != raw_cols:
            raise GateFailure('AUTH_COPY_COLUMN_FORMAT_INVALID')
        columns = tuple(_identifier(x) for x in tokens)
        if len(columns) != len(set(columns)):
            raise GateFailure('AUTH_COPY_DUPLICATE_COLUMN')
        j = i + 1
        while j < len(lines) and lines[j].rstrip('\r\n') != r'\.':
            j += 1
        if j == len(lines):
            raise GateFailure('AUTH_COPY_TERMINATOR_MISSING')
        if schema == 'auth':
            if table in blocks:
                raise GateFailure('AUTH_COPY_TABLE_REPEATED')
            blocks[table] = CopyBlock(table, columns, tuple(lines[i+1:j]), i, j)
            if not auth_only:
                remove.update(range(i, j+1))
        elif auth_only:
            raise GateFailure('AUTH_ARCHIVE_CONTAINS_NON_AUTH_COPY')
        i = j + 1
    return blocks, remove


def _auth_sequences(lines: list[str]) -> tuple[Counter[str], set[int]]:
    statements: Counter[str] = Counter()
    indexes: set[int] = set()
    for i, line in enumerate(lines):
        text = line.rstrip('\r\n')
        if _AUTH_SETVAL.match(text):
            if _ALL_SETVAL.fullmatch(text) is None:
                raise GateFailure('AUTH_SEQUENCE_STATEMENT_UNRECOGNIZED')
            statements[text] += 1
            indexes.add(i)
    return statements, indexes


def remove_proven_identical_auth_copies(
    general_sql: str, archived_auth_sql: str,
) -> tuple[str, int]:
    general = general_sql.splitlines(keepends=True)
    archive = archived_auth_sql.splitlines(keepends=True)
    source_blocks, removed = _blocks(general, auth_only=False)
    archive_blocks, _ = _blocks(archive, auth_only=True)
    if not source_blocks:
        raise GateFailure('AUTH_GENERAL_DUMP_HAS_NO_AUTH_COPY')
    for table, copy in source_blocks.items():
        original = archive_blocks.get(table)
        if original is None:
            raise GateFailure('AUTH_COPY_NOT_COVERED_BY_ARCHIVE')
        if copy.columns != original.columns:
            raise GateFailure('AUTH_COPY_COLUMNS_NOT_IDENTICAL')
        if Counter(copy.rows) != Counter(original.rows):
            raise GateFailure('AUTH_COPY_ROWS_NOT_IDENTICAL')
    original_sequences, _ = _auth_sequences(archive)
    copied_sequences, source_idxs = _auth_sequences(general)
    if copied_sequences - original_sequences:
        raise GateFailure('AUTH_SEQUENCE_VALUES_NOT_IDENTICAL')
    removed.update(source_idxs)
    retained = ''.join(x for i, x in enumerate(general) if i not in removed)
    if len(retained) >= len(general_sql):
        raise GateFailure('AUTH_COPY_NO_REDUCTION')
    # Structural preservation proof: dropping precisely the verified blocks
    # must leave byte-for-byte identical non-Auth lines, in their original order.
    if any(general[i] != x for i, x in
           zip((i for i in range(len(general)) if i not in removed),
               retained.splitlines(keepends=True))):
        raise GateFailure('AUTH_COPY_NON_AUTH_MUTATION')
    return retained, len(source_blocks)



def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--general-data', type=Path, required=True)
    parser.add_argument('--archive-data', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        # Use identical, strictly validated text decoding for both inputs.
        def load(path: Path) -> str:
            raw = path.read_bytes()
            if not raw or len(raw) > _MAX_FILE:
                raise GateFailure('AUTH_COPY_INPUT_SIZE_INVALID')
            return raw.decode('utf-8', errors='strict')
        content, tables = remove_proven_identical_auth_copies(
            load(args.general_data), load(args.archive_data))
        if args.out.exists():
            raise GateFailure('AUTH_COPY_OUTPUT_ALREADY_EXISTS')
        with args.out.open('x', encoding='utf-8', newline='') as output:
            output.write(content)
        args.out.chmod(0o600)
    except GateFailure as error:
        print('AUTH_DUPLICATE_COPY_EQUIVALENCE='+error.code)
        raise SystemExit(1)
    except Exception:
        # Never allow a Python exception message containing source values into CI.
        print('AUTH_DUPLICATE_COPY_EQUIVALENCE=PRIVATE_INPUT_OR_IO_FAILURE')
        raise SystemExit(1)
    print('AUTH_DUPLICATE_COPY_EQUIVALENCE=PASS')
    print('AUTH_ARCHIVE_COVERS_ALL_REMOVED_COPY_BLOCKS=TRUE')
    print('AUTH_ORIGINAL_AND_REPLAY_ROWS_EXPOSED=FALSE')


if __name__ == '__main__':
    main()
