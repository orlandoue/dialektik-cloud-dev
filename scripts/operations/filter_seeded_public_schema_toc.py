#!/usr/bin/env python3
"""Suppress ONLY one redundant built-in public SCHEMA from pg_restore TOC.

Generated scope-specific TOC is private. Do not print TOC lines or SQL.
The target's public schema existence and privileges are separately checked.
"""
import argparse
from pathlib import Path
import re
import sys

SCHEMA_ROW = re.compile(
    r"^\s*(\d+); \s*(?:\d+)\s+(?:\d+)\s+SCHEMA\s+-\s+public\s+[A-Za-z_][A-Za-z0-9_]*\s*$",
    re.ASCII
)
ANY_SCHEMA = re.compile(r"^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+", re.ASCII)

class UnsafeToc(Exception):
    pass

def filter_toc(text: str) -> str:
    lines = text.splitlines(keepends=True)
    output=[]
    found=0
    for line in lines:
        if line.lstrip().startswith(";"):
            output.append(line)
            continue
        if ANY_SCHEMA.match(line):
            if not SCHEMA_ROW.fullmatch(line.rstrip("\r\n")):
                raise UnsafeToc("UNEXPECTED_SCHEMA_TOC")
            found+=1
            if found!=1:
                raise UnsafeToc("REPEATED_PUBLIC_SCHEMA_TOC")
            output.append("; "+line)
        else:
            output.append(line)
    if found!=1:
        raise UnsafeToc("PUBLIC_SCHEMA_ENTRY_MISSING")
    result="".join(output)
    if len(lines)!=len(result.splitlines(keepends=True)):
        raise UnsafeToc("TOC_LENGTH_MISMATCH")
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    if args.output.exists():raise UnsafeToc("OUTPUT_EXISTS")
    source=args.input.read_text(encoding="utf8")
    result=filter_toc(source)
    args.output.write_text(result,encoding="utf8")
    args.output.chmod(0o600)
    print("ONLY_PREEXISTING_PUBLIC_SCHEMA_TOC_EXCLUDED=PASS")

if __name__=="__main__":
    try:main()
    except Exception:
        print("STRICT_PUBLIC_SCHEMA_TOC_FILTER=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
