#!/usr/bin/env python3
"""Isolate the *exact* PostgreSQL parameter GRANT for a privileged local replay.

Never grants to an invented role or changes source grants. The source SQL
remains unchanged and verified. All derived files stay inside ephemeral runner.
Only the single known parameter, literal GRANT SET grammar, and tightly bounded
role identifier list are accepted. No private names or SQL appear in logs.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re

_SQL_IDENTIFIER = r'(?:"(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*)'
_GRANTEES = rf'{_SQL_IDENTIFIER}(?:\s*,\s*{_SQL_IDENTIFIER})*'
_EXACT_GRANT = re.compile(
    rf'^\s*GRANT\s+SET\s+ON\s+PARAMETER\s+"log_min_messages"'
    rf'\s+TO\s+{_GRANTEES}(?:\s+WITH\s+GRANT\s+OPTION)?\s*;\s*$',
    flags=re.IGNORECASE,
)
_GUC_NAME = re.compile(r'\blog_min_messages\b',re.IGNORECASE)
_COMMENT = '-- ISOLATED_TARGET_PRIVILEGED_REPLAY: original parameter GRANT deferred'

def split_grant(content: str) -> tuple[str,str]:
    if not content or len(content)>12_000_000:
        raise ValueError("ROLE_SQL_BOUNDS_NOT_MET")
    lines=content.splitlines(keepends=True)
    found=[]
    for i,line in enumerate(lines):
        if _GUC_NAME.search(line):
            if not _EXACT_GRANT.fullmatch(line.strip()):
                raise ValueError("UNEXPECTED_LOG_PARAMETER_SQL_SHAPE")
            found.append(i)
    if len(found)!=1:
        raise ValueError("EXACTLY_ONE_PARAMETER_GRANT_REQUIRED")
    idx=found[0]
    source_line=lines[idx]
    eol='\r\n' if source_line.endswith('\r\n') else '\n' if source_line.endswith('\n') else ''
    new_lines=list(lines)
    new_lines[idx]=_COMMENT+eol
    ordinary=''.join(new_lines)
    privileged=source_line if source_line.endswith('\n') else source_line+'\n'
    if ordinary.replace(_COMMENT+eol, source_line, 1)!=content:
        raise ValueError("SOURCE_SQL_RECONSTRUCTION_FAILED")
    if not _EXACT_GRANT.fullmatch(privileged.strip()):
        raise ValueError("PRIVILEGED_SQL_SCOPE_FAILED")
    return ordinary, privileged

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--ordinary-out",type=Path,required=True)
    p.add_argument("--privileged-out",type=Path,required=True)
    args=p.parse_args()
    ordinary,grant=split_grant(args.source.read_text(encoding="utf-8"))
    for target,value in ((args.ordinary_out,ordinary),
                         (args.privileged_out,grant)):
        if target.exists():
            raise ValueError("PRIVATE_DERIVED_OUTPUT_ALREADY_EXISTS")
        with target.open("x",encoding="utf-8",newline="") as out:
            out.write(value)
        target.chmod(0o600)
    print("ISOLATED_PARAMETER_GRANT_SPLIT=PASS")
    print("EXACT_PRIVILEGED_GRANTS=1")
    print("SOURCE_SQL_ORIGINAL_MODIFIED=FALSE")
    print("ROLE_NAMES_SQL_VALUES_LOGGED=FALSE")

if __name__=="__main__":
    main()
