#!/usr/bin/env python3
"""ATTACK 4: two-stage headline-metadata candidate retrieval / bounded-event verification.

Offline research baseline. No LLM, external HTTP, provider-authorized full text,
Article/Event writes, claims or contradiction inference. NO authoritative identity.
"""
from __future__ import annotations
import argparse
from datetime import date
from itertools import combinations
from pathlib import Path
import hashlib
import json
import re
import unicodedata
from urllib.parse import urlsplit

VERSION = "attack4-generic-anchors-retrieval-verifier-v1"
MAX_ARTICLES = 48
# Domain/general-language policy, never learned from scored news examples.
NOISE = frozenset(("de del la las el los un una unas unos que por para en con y o a ante tras "
 "desde sobre durante se su sus al lo le les como mas muy hoy ayer manana este esta "
 "esto estos estas hay fue son ser han esta asi video fotos foto vivo minuto "
 "nacional regional regiones region chileno chile noticia noticias reportan "
 "reporta informa informan alerta ultimo ultimas".split()))
ENTITY_NOISE = frozenset(("VIDEO FOTOS FOTOGRAFIAS EN VIVO AHORA ULTIMA HORA "
 "REPORTE NOTICIAS NACIONAL REGIONAL URGENTE".split()))
PREP = re.compile(r"\b(?:en|de|del|desde|hacia|por|sobre)\s+(?:el\s+|la\s+|los\s+|las\s+)?"
                  r"([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÜÑáéíóúüñ-]+"
                  r"(?:\s+(?:de|del|la|las|los|el|San|Santa|[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÜÑáéíóúüñ-]+)){0,3})", re.UNICODE)
PROPER = re.compile(r"\b(?:[A-ZÁÉÍÓÚÑ][a-záéíóúüñ][\wáéíóúüñ-]*|[A-ZÁÉÍÓÚÑ]{2,})"
                    r"(?:\s+(?:de|del|la|el|los|las|y|[A-ZÁÉÍÓÚÑ][\wáéíóúüñ-]+)){1,4}", re.UNICODE)
KINDS = {
 "tornado":r"\b(tornado|tornados|tromba|trombas)\b",
 "fire":r"\b(incendio|incendios|incendia|incendiado|queman|quemado|quemados|fuego|llamas)\b",
 "outage":r"\b(apagon|apagones|corte de luz|sin luz|sin energia|interrupcion electrica)\b",
 "mudslide":r"\b(aluvion|aluviones|deslizamiento|deslizamientos|alud)\b",
 "flood":r"\b(inundacion|inundaciones|desborde|desbordes)\b",
 "earthquake":r"\b(sismo|terremoto|temblor)\b",
 "crash":r"\b(choque|colision|accidente de transito|volcamiento)\b",
 "protest":r"\b(protesta|protestas|manifestacion|manifestaciones|disturbios)\b",
}
OBJECTS = {
 "public_transport":r"\b(bus|buses|micro|micros|microbuses|taxibuses|terminal|garita|flota)\b",
 "theater":r"\b(teatro|escenario|sala teatral)\b",
 "apartment":r"\b(departamento|departamentos|edificio|piso \d{1,2})\b",
 "house":r"\b(casa|casas|vivienda|viviendas|domicilio)\b",
 "school":r"\b(colegio|escuela|liceo|universidad)\b",
 "hospital":r"\b(hospital|clinica|consultorio)\b",
 "electric_grid":r"\b(transmision|subestacion|red electrica|suministro electrico)\b",
}
SPEECH = re.compile(r"\b(alcalde|alcaldesa|ministro|ministra|presidente|presidenta|"
 "anuncia|anuncio|asegura|aseguro|afirma|afirmo|declara|declaro|"
 "proyecta|proyecto|instruye|instruyo|explica|explico|advierte|"
 "advirtio|senala|informo que|dijo que|segun)\b")
RETROSPECTIVE = re.compile(r"\b(imagenes|fotografias|fotos|videos|registro visual|"
 "muestran|lo que dejo|danos que|tras el paso|despues del)\b")
MULTI = re.compile(r"\b(otro (?:bus|hecho|ataque)|varios incidentes|"
 "hechos de violencia|multiples incidentes|intento de saqueo|"
 "al menos tres emergencias)\b")
URLID = re.compile(r"^[a-z][0-9]{2,3}$")

def norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower())
                   if unicodedata.category(c) != "Mn")

def tokens(s: str) -> set[str]:
    return {x for x in re.findall(r"[a-z0-9]{3,}", norm(s))
            if x not in NOISE and not x.isdecimal()}

def normalize_span(span: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", norm(span))).strip()

def named_anchors(headline: str) -> set[str]:
    """Generic orthographic anchors, not a vetted geocoder or NER system."""
    out = set()
    for pattern in (PROPER, PREP):
        for m in pattern.finditer(headline):
            raw = m.group(1) if pattern is PREP else m.group(0)
            parts = normalize_span(raw).split()
            # Split leading editorial type words but preserve genuine two-word names.
            while parts and (parts[0] in NOISE or parts[0] in
                {"incendio","tornado","video","fotos","ministerio","comunicado"}):
                parts = parts[1:]
            if len(parts) >= 2 and len([p for p in parts if p not in NOISE]) >= 2:
                for n in (2,3,4):
                    for i in range(len(parts)-n+1):
                        phrase = parts[i:i+n]
                        content = [x for x in phrase if x not in NOISE]
                        if len(content) >= 2 and len(set(content)) >= 2:
                            out.add(" ".join(phrase))
    return out

def article_features(row: dict) -> dict:
    headline, link = row["headline"], urlsplit(row["canonical_url"])
    if link.scheme != "https" or not link.hostname or link.username or link.password or link.query or link.fragment:
        raise ValueError("CANONICAL_URL_POLICY")
    name = named_anchors(headline)
    clean = norm(headline)
    found_kinds = [k for k, regex in KINDS.items() if re.search(regex, clean)]
    found_objects = [k for k, regex in OBJECTS.items() if re.search(regex, clean)]
    # Slugs support candidates but never independently certify an occurrence.
    url_tokens = tokens(link.path.replace("-", " ").replace("_"," "))
    return {
      "id":row["id"], "publisher":row["publisher"],
      "published_on":row["published_on"], "canonical_url":row["canonical_url"],
      "headline":headline, "tokens": sorted(tokens(headline)),
      "url_tokens":sorted(url_tokens),
      "named_anchors":sorted(name),
      "kind":found_kinds[0] if len(found_kinds)==1 else None,
      "objects":sorted(found_objects),
      "role":("MULTI_OR_AMBIGUOUS" if MULTI.search(clean) or len(found_kinds)>1 else
              "ATTRIBUTED_COMMUNICATION" if SPEECH.search(clean) else
              "RETROSPECTIVE_REPORT" if RETROSPECTIVE.search(clean) else
              "PHYSICAL_REPORT" if len(found_kinds)==1 else "UNKNOWN"),
      "event_at":None, "event_time_status":"NOT_ESTABLISHED_FROM_HEADLINE",
      "claim_status":"NOT_EXTRACTED", "source_text_used":False,
    }

def shared_anchor(a: dict, b: dict) -> list[str]:
    x = set(a["named_anchors"]) & set(b["named_anchors"])
    # Do not equate two places solely because of trivial generic collocations.
    blocked = {"teatro municipal","centro cultural","corte de luz","bomberos concurre",
               "sistema frontal","estado de excepcion","incendio forestal"}
    return sorted(x - blocked, key=lambda s:(-len(s),s))

def retrieve(a: dict, b: dict) -> tuple[bool, dict]:
    ta,tb = set(a["tokens"]), set(b["tokens"])
    overlap = ta & tb
    joined = ta | tb
    similarity = round(len(overlap)/len(joined), 4) if joined else 0
    url_overlap = set(a["url_tokens"]) & set(b["url_tokens"])
    anchors = shared_anchor(a,b)
    near = abs((date.fromisoformat(a["published_on"])-date.fromisoformat(b["published_on"])).days)
    same_kind = a["kind"] is not None and a["kind"] == b["kind"]
    # Broad retrieval: candidate generation is NOT event identity or topic identity.
    candidate = (near <= 14 and (
      bool(anchors) or
      (same_kind and (similarity >= .23 or len(overlap)>=3 or len(url_overlap)>=3))))
    return candidate, {"shared_named_anchors":anchors,"title_token_jaccard":similarity,
                       "shared_title_tokens":sorted(overlap),
                       "shared_url_tokens":sorted(url_overlap),
                       "publication_gap_days":near,"same_hazard_type":same_kind}

def verify(a: dict, b: dict, retrieved: bool, e: dict) -> tuple[str,str]:
    if a["role"]=="MULTI_OR_AMBIGUOUS" or b["role"]=="MULTI_OR_AMBIGUOUS":
        return "UNKNOWN","MULTI_EVENT_NEEDS_PER_OCCURRENCE_EVIDENCE"
    if not retrieved:
        return "UNKNOWN","NOT_RETRIEVED_NOT_PROOF_OF_UNRELATED"
    if not a["kind"] or not b["kind"] or a["kind"]!=b["kind"]:
        return "UNKNOWN","HAZARD_OR_ACTION_NOT_COMPARABLE"
    if e["publication_gap_days"]>5:
        return "UNKNOWN","PUBLICATION_TIME_NOT_EVENT_TIME"
    if not e["shared_named_anchors"]:
        return "UNKNOWN","NO_SHARED_DISTINCTIVE_NAMED_ANCHOR"
    roles = {a["role"],b["role"]}
    physical = {"PHYSICAL_REPORT","RETROSPECTIVE_REPORT"}
    if "ATTRIBUTED_COMMUNICATION" in roles:
        if roles & physical:
            return "SAME_THREAD_DIFFERENT_OCCURRENCE","SPEECH_ABOUT_EVENT_IS_DISTINCT_ACTION"
        return "UNKNOWN","SPEECH_ACT_IDENTITY_UNRESOLVED"
    if not roles <= physical:
        return "UNKNOWN","ACTION_UNRESOLVED"
    shared_objects = set(a["objects"]) & set(b["objects"])
    # A generic apartment/house in a city does not identify a bounded event.
    # Repeated same-place building fires can happen even on the same day.
    if shared_objects and shared_objects <= {"apartment", "house"}:
        return "UNKNOWN","GENERIC_RESIDENTIAL_OBJECT_NOT_INCIDENT_IDENTITY"
    # Even a transport/venue type is only a non-authoritative hypothesis.
    if shared_objects and e["publication_gap_days"]<=2:
        return "SAME_OCCURRENCE","SHARED_NAMED_ANCHOR_KIND_OBJECT_WITHIN_PUBLICATION_WINDOW"
    if a["kind"] in {"tornado","earthquake"} and e["publication_gap_days"]<=1:
        return "SAME_OCCURRENCE","RARE_EVENT_KIND_AND_SHARED_NAMED_ANCHOR"
    return "UNKNOWN","OBJECT_OR_EVENT_TIME_INSUFFICIENT"

def conservative_groups(ids: list[str], decisions: dict[tuple[str,str],str]) -> list[list[str]]:
    groups=[]
    for member in sorted(ids):
        admissible=[i for i,g in enumerate(groups)
                    if all(decisions.get(tuple(sorted((member,other))))=="SAME_OCCURRENCE" for other in g)]
        if len(admissible)==1:
            groups[admissible[0]].append(member)
        else:
            groups.append([member])
    return [g for g in groups if len(g)>=2]

def run(corpus: dict) -> dict:
    if corpus.get("schema")!="public-real-metadata-only-v1" or corpus.get("source_text_acquired") is not False:
        raise ValueError("UNAUTHORIZED_INPUT_CONTRACT")
    rows=corpus.get("articles")
    if not isinstance(rows,list) or not 2<=len(rows)<=MAX_ARTICLES:
        raise ValueError("INVALID_BOUNDED_CORPUS")
    docs={}
    urls=set()
    for r in rows:
        if not isinstance(r,dict) or set(r)!={"id","publisher","headline","published_on","canonical_url"}:
            raise ValueError("UNEXPECTED_SOURCE_FIELDS")
        if not all(isinstance(v,str) and v for v in r.values()) or not URLID.fullmatch(r["id"]):
            raise ValueError("INVALID_PUBLIC_METADATA")
        date.fromisoformat(r["published_on"])
        if r["id"] in docs or r["canonical_url"] in urls:
            raise ValueError("DUPLICATE_ID_OR_URL")
        urls.add(r["canonical_url"])
        docs[r["id"]]=article_features(r)
    ids=sorted(docs)
    pairs=[]
    decisions={}
    for a,b in combinations(ids,2):
        found,e=retrieve(docs[a],docs[b])
        decision,why=verify(docs[a],docs[b],found,e)
        decisions[(a,b)]=decision
        pairs.append({"ids":[a,b], "retrieved":found,
          "decision":decision,"reason":why,"evidence":e,"authority":"CANDIDATE_ONLY"})
    groups=conservative_groups(ids,decisions)
    return {"version":VERSION,"input_count":len(ids),"metadata_only":True,
      "semantic_model_executed":False,"database_writes":0,"contradictions_detected":0,
      "production_permission":False,"references_or_gold_used":False,
      "retrieved_pairs":sum(p["retrieved"] for p in pairs),
      "articles":[docs[k] for k in ids],"pair_decisions":pairs,
      "occurrence_groups":[{"members":g,"status":"NONAUTHORITATIVE_CLIQUE"} for g in groups],
      "unknown_is_valid":True,
      "limits":["Lexical orthographic anchors do not prove geographical identity.",
        "Publication date is only retrieval context, not verified event time.",
        "Shared venue/type may still describe multiple incidents.",
        "No full-source-text rights, semantic V10.11, claims or contradiction inference."]}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args()
    raw=Path(a.input).read_bytes()
    pred=run(json.loads(raw))
    dest=Path(a.output)
    dest.write_text(json.dumps(pred,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("MODEL="+VERSION)
    print("INPUT_SHA256="+hashlib.sha256(raw).hexdigest())
    print("PREDICTIONS_SHA256="+hashlib.sha256(dest.read_bytes()).hexdigest())
    print("INPUT_ARTICLES="+str(pred["input_count"]))
    print("RETRIEVED_PAIRS="+str(pred["retrieved_pairs"]))
    print("POSITIVE_GROUPS="+str(len(pred["occurrence_groups"])))
    print("DATABASE_WRITES=0")
    print("PRODUCTION_PERMISSION=FALSE")

if __name__=="__main__":
    main()
