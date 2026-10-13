"""Bounded product transport only; frozen Git source is loaded exactly in memory.
Never used by authored tests. No publisher bodies, corpus or result files exist.
"""
import sys
import json
import hashlib
import importlib.abc
import importlib.util
import os
import sysconfig
from datetime import datetime
from dataclasses import asdict
from enum import Enum

COMMIT = "ea47eb75e955b9a51d15dc0135c81145130553ca"
VERSION = "phase3v10.11-applicability-replay-v1"
RUN = "REAL_NEWS_V10_11_EPHEMERAL_SHADOW_V1"
# Explicit owner approval: product transport run only; sealed runtime/model unchanged.
PROSPECTIVE_RUN = "PROSPECTIVE_MULTISOURCE_V10_11_SHADOW_RUN_V1"
MAX_INPUT = 64 * 1024 * 1024


def execute():
    if sys.version_info[:3] != (3, 11, 9):
        raise RuntimeError("FROZEN_RUNTIME_IDENTITY_MISMATCH")
    encoded = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(encoded) > MAX_INPUT:
        raise RuntimeError("FROZEN_INPUT_TOO_LARGE")
    payload = json.loads(encoded)
    run_identity = payload["runIdentity"]
    if payload["commit"] != COMMIT or payload["version"] != VERSION or run_identity not in (RUN, PROSPECTIVE_RUN):
        raise RuntimeError("FROZEN_IDENTITY_MISMATCH")
    article_limit = 150 if run_identity == PROSPECTIVE_RUN else 40
    if payload["model"] != "none" or not 3 <= len(payload["articles"]) <= article_limit:
        raise RuntimeError("FROZEN_BATCH_NOT_AUTHORIZED")
    source_rows = payload["sources"]
    if not 1 <= len(source_rows) <= 128:
        raise RuntimeError("FROZEN_SOURCE_CLOSURE_INVALID")
    sources = {}
    for row in source_rows:
        name, source, digest = row["name"], row["source"], row["sha256"]
        if not (name == "dialektik_intelligence" or name.startswith("dialektik_intelligence.")) or name in sources:
            raise RuntimeError("FROZEN_SOURCE_CLOSURE_INVALID")
        if hashlib.sha256(source.encode("utf-8")).hexdigest() != digest:
            raise RuntimeError("FROZEN_SOURCE_IDENTITY_MISMATCH")
        sources[name] = row

    class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, fullname, path=None, target=None):
            if fullname.startswith("dialektik_intelligence"):
                if fullname not in sources:
                    raise ModuleNotFoundError("FROZEN_MODULE_OUTSIDE_AUTHENTICATED_CLOSURE")
                return importlib.util.spec_from_loader(fullname, self, is_package=sources[fullname]["isPackage"])
            return None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            row = sources[module.__name__]
            module.__file__ = "frozen-git:" + COMMIT + ":" + row["path"]
            exec(compile(row["source"], module.__file__, "exec"), module.__dict__)

    stdlib = os.path.realpath(sysconfig.get_path("stdlib"))
    stdlib_roots = (stdlib, os.path.realpath(os.path.join(sys.base_prefix, "DLLs")))

    def audit(event, arguments):
        if event.startswith(("socket.", "subprocess.", "os.system", "os.exec", "os.spawn")):
            raise RuntimeError("FROZEN_PROCESS_EXTERNAL_ACCESS_FORBIDDEN")
        if event == "open" and arguments:
            value = arguments[0]
            if isinstance(value, (str, bytes, os.PathLike)):
                resolved = os.path.realpath(os.fsdecode(value))
                mode = arguments[1] if len(arguments) > 1 else None
                flags = arguments[2] if len(arguments) > 2 else 0
                if (isinstance(mode, str) and any(character in mode for character in "wxa+")) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                    raise RuntimeError("FROZEN_PROCESS_FILE_WRITE_FORBIDDEN")
                if not any(os.path.commonpath([root, resolved]) == root for root in stdlib_roots) or os.path.commonpath([os.path.join(stdlib, "site-packages"), resolved]) == os.path.join(stdlib, "site-packages"):
                    raise RuntimeError("FROZEN_PROCESS_FILE_ACCESS_FORBIDDEN")
            else:
                raise RuntimeError("FROZEN_PROCESS_FILE_ACCESS_FORBIDDEN")

    sys.addaudithook(audit)
    sys.meta_path.insert(0, Loader())
    from dialektik_intelligence.semantic.label_blind_replay_v10_6 import DecisionArticle
    from dialektik_intelligence.semantic import applicability_replay_v10_11 as replay
    from dialektik_intelligence.semantic import scoped_extractor_v10_10 as extractor
    if replay.VERSION != VERSION or extractor.VERSION != "phase3v10.10-scoped-anchor-v1":
        raise RuntimeError("FROZEN_MODULE_VERSION_MISMATCH")

    def aware(value):
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise RuntimeError("FROZEN_NAIVE_CHRONOLOGY")
        return result

    articles = tuple(DecisionArticle(
        row["article_id"], row["position"], aware(row["available_at"]), aware(row["published_at"]),
        row["source_id"], row["language"], row["title"], row["body"], None
    ) for row in payload["articles"])
    extracted = {}
    anchor_extracted = {}

    def observations(article):
        value = extractor.extract(article)
        extracted[article.article_id] = value
        return value.observations

    def anchors(article):
        # This is the original integrated assembly's second extraction callback.
        value = extractor.extract(article)
        anchor_extracted[article.article_id] = value
        return value.anchor

    result = replay.replay(articles, observations, anchors)

    def locator(span):
        if isinstance(span, dict):
            from types import SimpleNamespace
            span = SimpleNamespace(**span)
        if span.field not in ("title", "body"):
            raise RuntimeError("UNSUPPORTED_FROZEN_EVIDENCE_FIELD")
        return {"articleId": span.article_id, "sourceId": span.source_id, "field": span.field,
                "start": span.start, "end": span.end, "sourceSha256": span.source_sha256,
                "spanSha256": span.span_sha256}

    rows = []
    for row in result.rows:
        evidence = {}
        extraction = extracted[row["article_id"]]
        fields = [field for observation in extraction.observations
                  for field in (*observation.identity, *observation.evolving, *observation.context)]
        if extraction.anchor is not None:
            fields.extend((*extraction.anchor.identity, extraction.anchor.boundary))
        for fact in extraction.facts:
            fields.append(fact.field)
            for support in fact.supports:
                value = locator(support)
                evidence[json.dumps(value, sort_keys=True)] = value
        for field in fields:
            value = locator(field.span)
            evidence[json.dumps(value, sort_keys=True)] = value
        comparisons = []
        applicability = []
        for scope in ("occurrence", "thread"):
            for key, values in row[scope + "_comparisons"].items():
                for index, value in enumerate(values):
                    comparisons.append({"scope": scope.upper(), "targetKey": key, "index": index,
                                        "decision": value["outcome"].upper(),
                                        "references": [locator(reference["span"]) for reference in value["references"]]})
            for key, value in row[scope + "_applicability"].items():
                applicability.append({"scope": scope.upper(), "targetKey": key, "outcome": value["outcome"],
                                      "references": [locator(reference["span"]) for reference in value["references"]]})
        rows.append({
            "articleId": row["article_id"], "position": row["position"], "action": row["action"],
            "reasonCode": row["reason"], "proposedOccurrenceKey": row["occurrence_id"],
            "proposedThreadKey": row["thread_id"], "partialOccurrenceCreation": row["partial_occurrence_creation"],
            "observationIds": row["observation_ids"], "threadAnchorId": row["thread_anchor_id"],
            "evidence": [evidence[key] for key in sorted(evidence)],
            "comparisons": comparisons, "applicability": applicability,
        })
    output = {
        "commit": COMMIT, "version": VERSION, "runtime": {"python": "3.11.9", "model": "none"},
        "runIdentity": run_identity, "articles": rows,
        "occurrences": [{"key": key, "threadKey": state.thread_id,
                         "articleIds": [article.article_id for article in state.members],
                         "generationHash": state.generation} for key, state in sorted(result.occurrences.items())],
        "threads": [{"key": key, "occurrenceKeys": list(state.occurrence_ids),
                     "articleIds": sorted({row["article_id"] for row in result.rows if row["thread_id"] == key}),
                     "generationHash": state.generation} for key, state in sorted(result.threads.items())],
        "streamHashes": result.artifact()["hashes"],
        # Native semantic structures are transferred before rights-aware redaction.
        # No DecisionArticle, state.members or original body is serialized.
        "nativeDiagnostics": {
            "artifact": result.artifact(),
            "extractions": [{"article_id": key, **asdict(value)} for key, value in sorted(extracted.items())],
            "anchor_extractions": [{"article_id": key, **asdict(value)} for key, value in sorted(anchor_extracted.items())],
        },
    }
    def diagnostic_value(value):
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, Enum):
            return value.value
        raise RuntimeError("UNSUPPORTED_NATIVE_DIAGNOSTIC_VALUE")
    # Full input lives through this single provider batch. It never enters output.
    sys.stdout.write(json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=diagnostic_value))


try:
    execute()
except BaseException:
    # Candidate exception strings/tracebacks may contain source. Never forward them.
    sys.stderr.write("FROZEN_PROVIDER_FAILED")
    sys.exit(1)
