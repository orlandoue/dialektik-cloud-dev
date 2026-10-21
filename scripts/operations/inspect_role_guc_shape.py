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

_FIRST_KEYWORD_ALLOWLIST = {
    "ALTER","SET","SELECT","DO","COPY","COMMENT","RESET",
    "GRANT","REVOKE","CREATE","BEGIN","END"
}

def physical_guc_shapes(contents: str) -> dict[str,int]:
    summary = {
        "LINE_STARTS_ALTER_ROLE":0,
        "LINE_STARTS_ALTER_USER":0,
        "LINE_STARTS_SET":0,
        "LINE_STARTS_SELECT":0,
        "LINE_STARTS_COMMENT":0,
        "LINE_STARTS_OTHER":0,
        "LINE_HAS_ALTER_ROLE_ANYWHERE":0,
        "LINE_HAS_SET_ANYWHERE":0,
        "GUC_IDENTIFIER_DOUBLE_QUOTED":0,
        "GUC_IDENTIFIER_SINGLE_QUOTED":0,
        "GUC_LINE_ENDS_SEMICOLON":0,
        "GUC_LINE_MULTIPLE_COMMAND_DELIMITERS":0,
    }
    for line in contents.splitlines():
        if not GUC.search(line):
            continue
        stripped=line.lstrip()
        if stripped.startswith("--"):
            summary["LINE_STARTS_COMMENT"] += 1
        elif re.match(r"^ALTER\s+ROLE\b",stripped,re.I):
            summary["LINE_STARTS_ALTER_ROLE"] += 1
        elif re.match(r"^ALTER\s+USER\b",stripped,re.I):
            summary["LINE_STARTS_ALTER_USER"] += 1
        elif re.match(r"^SET\b",stripped,re.I):
            summary["LINE_STARTS_SET"] += 1
        elif re.match(r"^SELECT\b",stripped,re.I):
            summary["LINE_STARTS_SELECT"] += 1
        else:
            summary["LINE_STARTS_OTHER"] += 1
        summary["LINE_HAS_ALTER_ROLE_ANYWHERE"] += int(
            bool(re.search(r"\bALTER\s+ROLE\b",line,re.I)))
        summary["LINE_HAS_SET_ANYWHERE"] += int(
            bool(re.search(r"\bSET\b",line,re.I)))
        summary["GUC_IDENTIFIER_DOUBLE_QUOTED"] += int(
            bool(re.search(r'"log_min_messages"',line,re.I)))
        summary["GUC_IDENTIFIER_SINGLE_QUOTED"] += int(
            bool(re.search(r"'log_min_messages'",line,re.I)))
        summary["GUC_LINE_ENDS_SEMICOLON"] += int(stripped.rstrip().endswith(";"))
        summary["GUC_LINE_MULTIPLE_COMMAND_DELIMITERS"] += int(line.count(";")>1)
    return summary

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
    physical=physical_guc_shapes(text)
    for name in sorted(physical):
        print("REDACTED_PHYSICAL_"+name+"="+str(physical[name]))
    print("NO_SQL_OR_ROLE_NAMES_PRINTED=TRUE")
    print("LOGGING_GUC_SOURCE_SQL_MODIFIED=FALSE")
    print("SUPABASE_DEV_ACCESS=NONE")

if __name__=="__main__":main()
