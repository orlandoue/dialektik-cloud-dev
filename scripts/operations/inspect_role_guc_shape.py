#!/usr/bin/env python3
"""Classify the statement shape around one fixed PostgreSQL logging GUC.

Operates ONLY on an authentic source backup in a protected, disposable runner.
It never emits source SQL, any role name, parameter value, line number or
hash derived from private data. It is diagnostic ONLY, not a SQL sanitizer.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re

GUC = re.compile(r"\blog_min_messages\b", flags=re.IGNORECASE)
_ALLOWED_SHAPES = (
    ("ROLE_ALTER", re.compile(r"^\s*ALTER\s+ROLE\b", re.I)),
    ("DATABASE_ALTER", re.compile(r"^\s*ALTER\s+DATABASE\b", re.I)),
    ("SESSION_SET", re.compile(r"^\s*SET\s+log_min_messages\b", re.I)),
    ("SET_CONFIG_FUNCTION", re.compile(
        r"^\s*(?:SELECT|PERFORM)\s+(?:pg_catalog\.)?set_config\s*\(",re.I)),
    ("DO_BLOCK", re.compile(r"^\s*DO\b", re.I)),
)

def bounded_shapes(contents: str) -> dict[str,int]:
    if len(contents) > 12_000_000:
        raise ValueError("ROLE_SQL_DIAGNOSTIC_INPUT_SIZE_LIMIT")
    # Segmentation is diagnostic only. A semicolon embedded in a SQL string
    # can produce an OTHER category; it NEVER edits the SQL.
    found = {name:0 for name,_ in _ALLOWED_SHAPES}
    found["OTHER_OR_MULTILINE"] = 0
    occurrences = list(GUC.finditer(contents))
    if len(occurrences)>200:
        raise ValueError("UNEXPECTED_NUMBER_OF_LOGGING_GUC_MENTIONS")
    for m in occurrences:
        left = contents.rfind(";", 0, m.start())
        right = contents.find(";",m.end())
        if right<0: right=len(contents)
        segment = contents[left+1:right+1]
        # Remove only obvious SQL comments for diagnostic classification;
        # do not attempt to parse or execute the source statement.
        segment = re.sub(r"(?m)^\s*--[^\n]*$", "", segment)
        category = next((key for key,regex in _ALLOWED_SHAPES
                         if regex.search(segment)), "OTHER_OR_MULTILINE")
        found[category] += 1
    return found

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--roles-sql", type=Path, required=True)
    a=parser.parse_args()
    text=a.roles_sql.read_text(encoding="utf-8",errors="replace")
    result=bounded_shapes(text)
    print("PRIVATE_BACKUP_ROLE_GUC_DIAGNOSTIC=COMPLETE")
    print("REDACTED_LOG_GUC_OCCURRENCES="+str(sum(result.values())))
    for name in sorted(result):
        print("REDACTED_SQL_SHAPE_"+name+"="+str(result[name]))
    print("NO_SQL_OR_ROLE_NAMES_PRINTED=TRUE")
    print("LOGGING_GUC_SOURCE_SQL_MODIFIED=FALSE")
    print("SUPABASE_DEV_ACCESS=NONE")

if __name__=="__main__":main()
