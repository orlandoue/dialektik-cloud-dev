#!/usr/bin/env python3
"""ATTACK 5 — Chilean typed geographic resolver and evidence-gated occurrence hypotheses.

Research baseline. External administrative source is snapshotted with provenance.
No network requests, embeddings, production SQL, licensed article bodies,
authoritative event attribution, or contradictions. UNKNOWN remains valid.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from datetime import date
import argparse
import hashlib
from itertools import combinations
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

VERSION="attack5-typed-chile-geo-v1"
MAX_DOCS=48
GEO_PATH=Path(__file__).with_name("attack5")/"chile_geography.json"
KINDS={
 "tornado":r"\b(tornado|tornados|tromba marina)\b",
 "earthquake":r"\b(sismo|sismos|temblor|temblores|terremoto|terremotos)\b",
 "fire":r"\b(incendio|incendios|incendiado|incendiada|llamas|fuego)\b",
 "outage":r"\b(apagon|apagones|corte de luz|sin luz|suministro electrico)\b",
 "tsunami":r"\b(tsunami|maremoto)\b",
 "flood":r"\b(inundacion|inundaciones|aluvion|aluviones|desborde)\b",
 "protest":r"\b(protesta|protestas|manifestacion|manifestaciones|disturbios)\b",
}
SPEECH=re.compile(r"\b(alcalde|alcaldesa|presidente|presidenta|ministro|ministra|"
                  r"asegura|aseguro|afirma|afirmo|explica|explico|advierte|"
                  r"advirtio|dijo|sostuvo|califica|califico|declara|declaro|"
                  r"segun el|segun la|anuncia|anuncio|pide|exige|vocero)\b")
OFFICIAL_ACTION=re.compile(r"\b(decretan|decreta|declaran|declara|levanta|"
                           r"levantan|cancelan|cancela|activa|activan|"
                           r"alerta|estado de excepcion|evacuacion|"
                           r"suspende|suspenden|medidas preventivas)\b")
RETRO=re.compile(r"\b(imagenes|fotografias|fotos|video|videos|"
                 r"balance|tras el paso|despues del|da[nñ]os|"
                 r"cifra asciende|reconstruccion)\b")
MULTI=re.compile(r"\b(varios incidentes|multiples incidentes|dos hechos distintos|"
                 r"otro (?:ataque|bus|incendio)|y otro|distintos puntos|"
                 r"al menos tres hechos)\b")
EVENT_VENUE=re.compile(r"\b(?:teatro municipal|centro cultural|terminal(?: de buses)?|"
                       r"garita|centro comercial|estadio|aeropuerto|mall|"
                       r"hospital|colegio|escuela)\s+"
                       r"(?:de |del |la |las |los |el )?"
                       r"([a-z0-9]+(?:\s+[a-z0-9]+){0,2})\b")
STOP=frozenset(("la las el los del de y en a al un una unos unas por para tras ante"
                " mas que fue son sobre sin con desde hasta caso afecta afecto"
                " noticias video fotos hoy ayer este este dia reportan informa"
                " chile noticia del los".split()))
FEATURE=frozenset(("terremoto tornado tsunami incendio sismo temblor"
                   " emergencia bomberos senapred shoa alcalde ministra ministro".split()))
DATE_MAG=re.compile(r"(?<!\d)([3-9])\s*[,\.]\s*([0-9])\s*(?:richter|mw|grados|magnitud)?(?!\d)")
ID_RE=re.compile(r"^[a-z][0-9]{2,3}$")

def norm(s):
    return " ".join(re.findall(r"[a-z0-9]+", "".join(
        c for c in unicodedata.normalize("NFD",s.casefold())
        if unicodedata.category(c)!="Mn")))

def words(s):
    return {x for x in norm(s).split() if len(x)>=3 and x not in STOP}

def load_geography(path=GEO_PATH):
    doc=json.loads(Path(path).read_text(encoding="utf-8"))
    if doc.get("schema")!="attack5-chile-geography-data-v1" or doc.get("count")!=346:
        raise ValueError("GEO_SNAPSHOT_CONTRACT")
    entries=doc["entries"]
    if len(entries)!=346 or len({x["code"] for x in entries})!=346:
        raise ValueError("GEO_SNAPSHOT_INTEGRITY")
    return doc

def geo_index(geo):
    communes={}
    regions={}
    provinces=defaultdict(set)
    for row in geo["entries"]:
        alias=norm(row["name"])
        if not alias: raise ValueError("EMPTY_ADMIN_NAME")
        communes.setdefault(alias,[]).append(row)
        reg_name=norm(row["region"]).removeprefix("region de ").removeprefix("region del ")
        reg_name=reg_name.removeprefix("region metropolitana de ").removeprefix("region ")
        regions.setdefault(reg_name,set()).add(row["region_code"])
        provinces[norm(row["province"])].add(row["region_code"])
    # Conservative explicit short forms; not silently learned and not treated
    # as commune alias when an alias is ambiguous.
    region_aliases={
      "rm":"13","region metropolitana":"13",
      "metropolitana de santiago":"13",
      "atacama":"03","biobio":"08","bio bio":"08",
      "los lagos":"10","arica y parinacota":"15",
      "valparaiso":"05","nuble":"16",
    }
    region_to_codes={}
    for name,codes in regions.items():
        if len(codes)==1: region_to_codes[name]=next(iter(codes))
    region_to_codes.update(region_aliases)
    return communes,region_to_codes,provinces

def _phrase_hits(text,phrase):
    return [(m.start(),m.end()) for m in re.finditer(
        r"(?<![a-z0-9])"+re.escape(phrase)+r"(?![a-z0-9])",text)]

def geo_mentions(headline,geo):
    text=norm(headline)
    communes,region_aliases,provinces=geo_index(geo)
    out=[]
    # Longest spans win: e.g. "Puente Alto" must not reduce to "Alto".
    for phrase,rows in communes.items():
        if len(phrase)<4:continue
        for a,b in _phrase_hits(text,phrase):
            # A qualified "region de Los Lagos" is not the commune Los Lagos.
            if re.search(r"\bregion\s+(?:de |del )?$",text[max(0,a-20):a]):
                continue
            out.append({"start":a,"end":b,"text":phrase,
                "kind":"GEO_COMMUNE" if len(rows)==1 else "GEO_AMBIGUOUS",
                "ids":sorted({row["code"] for row in rows}),
                "regions":sorted({row["region_code"] for row in rows}),
                "source":"chile-hub-DPA-snapshot"})
    for phrase,region in region_aliases.items():
        if len(phrase)<=2:
            hits=_phrase_hits(text,phrase) if (phrase=="rm" and
                re.search(r"\b(?:en|la|region|comunas de)\s+rm\b",text)) else []
        else:
            hits=_phrase_hits(text,phrase)
        # Bare "Santiago" is a commune, not an unqualified region.
        for a,b in hits:
            if phrase in communes and not re.search(
                r"\b(?:region|regional)\s+(?:de |del )?"+re.escape(phrase), text[max(0,a-20):b]):
                continue
            out.append({"start":a,"end":b,"text":phrase,
                "kind":"GEO_REGION","ids":["CL-"+region],
                "regions":[region],"source":"chile-hub-DPA-snapshot"})
    # Each mention has span, type and provenance; never call an untyped
    # person name or an arbitrary proper-noun phrase a verified place.
    # Deduplicate overlapping evidence; prefer commune if qualified region absent.
    ordered=sorted(out,key=lambda h:(-(h["end"]-h["start"]),h["start"],h["kind"]))
    kept=[]
    for hit in ordered:
        if any(hit["start"]<x["end"] and x["start"]<hit["end"] for x in kept):continue
        kept.append(hit)
    return sorted(({k:v for k,v in h.items() if k not in ("start","end")}
                   for h in kept),key=lambda h:(h["text"],h["kind"],h["ids"]))

def entities(headline,geo):
    geographical=geo_mentions(headline,geo)
    t=norm(headline)
    speech=bool(SPEECH.search(t))
    speaker=[]
    for tag,pat in (
      ("OFFICIAL_ROLE_MAYOR",r"\b(?:alcalde|alcaldesa)\b"),
      ("OFFICIAL_ROLE_PRESIDENT",r"\b(?:presidente|presidenta)\b"),
      ("OFFICIAL_ROLE_MINISTER",r"\b(?:ministro|ministra)\b"),
    ):
        if re.search(pat,t):speaker.append(tag)
    facilities=[]
    # Facility type, not verified facility identity. No place ID inferred from
    # this string alone, including generic "teatro municipal".
    for m in EVENT_VENUE.finditer(t):
        facilities.append({"kind":"FACILITY_MENTION_UNVERIFIED",
                           "label":m.group(0),"authority":"LEXICAL_ONLY"})
    return geographical, speaker, facilities, speech

def event_kind(t):
    found=[k for k,p in KINDS.items() if re.search(p,t)]
    # Notice tsunami warning is an institutional response to earthquake,
    # not automatically the same physical occurrence.
    if "tsunami" in found:return "tsunami",found
    return (found[0] if len(found)==1 else None),found

def feature(row,geo):
    u=urlsplit(row["canonical_url"])
    if u.scheme!="https" or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ValueError("CANONICAL_URL_INVALID")
    t=norm(row["headline"])
    geographical,speakers,facilities,speech=entities(row["headline"],geo)
    kind,kinds=event_kind(t)
    multi=bool(MULTI.search(t) or len(set(h["regions"][0] for h in geographical
       if h["regions"]))>1 and re.search(r"\b(?:entre|desde|hasta|y)\b",t))
    if multi:role="MULTI_OR_AMBIGUOUS"
    elif OFFICIAL_ACTION.search(t):role="INSTITUTIONAL_ACTION"
    elif speech:role="ATTRIBUTED_STATEMENT"
    elif RETRO.search(t):role="RETROSPECTIVE_REPORT"
    elif kind:role="PHYSICAL_REPORT"
    else:role="UNKNOWN"
    magnitude=DATE_MAG.search(t) if kind=="earthquake" else None
    return {"id":row["id"],"publisher":row["publisher"],
      "canonical_url":row["canonical_url"],"headline":row["headline"],
      "published_on":row["published_on"],"geography":geographical,
      "speaker_roles":speakers,"facility_mentions":facilities,
      "kind":kind,"kind_mentions":kinds,"role":role,
      "magnitude":(f"{magnitude.group(1)}.{magnitude.group(2)}" if magnitude else None),
      "lexical_tokens":sorted(words(row["headline"])),
      "event_at":None,"event_time_status":"UNRESOLVED_FROM_METADATA",
      "source_text_used":False,"claim_extraction":"NOT_PERFORMED"}

def geo_relation(a,b):
    aa=a["geography"];bb=b["geography"]
    comA={x for h in aa if h["kind"]=="GEO_COMMUNE" for x in h["ids"]}
    comB={x for h in bb if h["kind"]=="GEO_COMMUNE" for x in h["ids"]}
    regA={x for h in aa for x in h["regions"]}
    regB={x for h in bb for x in h["regions"]}
    if comA & comB:return "SAME_COMMUNE",sorted(comA&comB)
    if comA and comB and not comA&comB:return "DISTINCT_COMMUNES",[]
    if regA & regB:return "SAME_REGION_ONLY",sorted(regA&regB)
    if regA and regB and not regA&regB:return "DISTINCT_REGIONS",[]
    return "UNKNOWN_GEO",[]

def retrieve(a,b):
    ta,tb=set(a["lexical_tokens"]),set(b["lexical_tokens"])
    j=len(ta&tb)/len(ta|tb) if (ta|tb) else 0
    days=abs((date.fromisoformat(a["published_on"])-date.fromisoformat(b["published_on"])).days)
    gr,evidence=geo_relation(a,b)
    same_kind=bool(a["kind"] and a["kind"]==b["kind"])
    candidate=(days<=30 and (same_kind and (
         gr in ("SAME_COMMUNE","SAME_REGION_ONLY") or
         j>=0.23 or len(ta&tb)>=3) or
         (gr=="SAME_COMMUNE" and j>=0.25)))
    return candidate,{"geo_relation":gr,"geo_evidence":evidence,
       "same_kind":same_kind,"published_gap_days":days,
       "title_jaccard":round(j,4),"shared_tokens":sorted(ta&tb)}

def verify(a,b,retrieved,e):
    if a["role"]=="MULTI_OR_AMBIGUOUS" or b["role"]=="MULTI_OR_AMBIGUOUS":
        return "UNKNOWN","MULTI_MENTION_NOT_RESOLVED"
    if not retrieved:return "UNKNOWN","NOT_RETRIEVED_NO_NEGATIVE_EVIDENCE"
    if not e["same_kind"]:return "UNKNOWN","DIFFERENT_OR_MISSING_EVENT_KIND"
    if e["geo_relation"] in ("DISTINCT_COMMUNES","DISTINCT_REGIONS","UNKNOWN_GEO"):
        return "UNKNOWN","GEO_NOT_COMPATIBLE_OR_UNRESOLVED"
    if e["published_gap_days"]>7:
        return "UNKNOWN","PUBLICATION_GAP_NOT_EVENT_TIME"
    roles={a["role"],b["role"]}
    nonphysical={"ATTRIBUTED_STATEMENT","INSTITUTIONAL_ACTION"}
    physical={"PHYSICAL_REPORT","RETROSPECTIVE_REPORT"}
    if roles & nonphysical and roles & physical:
        return "SAME_THREAD_DIFFERENT_OCCURRENCE","COMMUNICATION_VS_PHYSICAL_OCCURRENCE"
    if roles & nonphysical:return "UNKNOWN","INSTITUTIONAL_ACTION_IDENTITY_UNRESOLVED"
    if not roles<=physical:return "UNKNOWN","ACTION_IDENTITY_UNRESOLVED"
    if e["geo_relation"]!="SAME_COMMUNE" or e["published_gap_days"]>2:
        return "UNKNOWN","NO_PRECISE_SHARED_LOCATION_OR_WINDOW"
    # Two same-kind fires in one commune can coexist: require verified
    # distinctive venue/external identifier; a free-text facility mention
    # is NOT enough to give authoritative identity.
    if a["kind"]=="earthquake" and a["magnitude"] is not None and (
       a["magnitude"]==b["magnitude"]):
        return "SAME_OCCURRENCE","EARTHQUAKE_MAGNITUDE_AND_COMMUNE_CANDIDATE"
    if a["kind"]=="tornado" and e["published_gap_days"]<=1:
        return "SAME_OCCURRENCE","RARE_TORNADO_SAME_COMMUNE_DATE_CANDIDATE"
    if a["kind"]=="fire":
        return "UNKNOWN","FIRE_WITHOUT_VERIFIED_FACILITY_OR_EVENT_ID"
    return "UNKNOWN","BOUNDED_OCCURRENCE_IDENTITY_NOT_ESTABLISHED"

def cliques(ids,labels):
    groups=[]
    for item in sorted(ids):
        fitting=[i for i,g in enumerate(groups)
                 if all(labels.get(tuple(sorted((item,o))))=="SAME_OCCURRENCE" for o in g)]
        if len(fitting)==1:groups[fitting[0]].append(item)
        else:groups.append([item])
    return [g for g in groups if len(g)>=2]

def run(corpus,geo=None):
    if corpus.get("schema")!="public-real-metadata-only-v1" or corpus.get("source_text_acquired") is not False:
        raise ValueError("INVALID_METADATA_ONLY_CORPUS")
    data=geo if geo is not None else load_geography()
    if data.get("schema")!="attack5-chile-geography-data-v1" or data.get("count")!=346:
        raise ValueError("BAD_GEO_SCHEMA")
    articles=corpus.get("articles")
    if not isinstance(articles,list) or not 2<=len(articles)<=MAX_DOCS:
        raise ValueError("INPUT_SIZE_UNSUPPORTED")
    docs={};urls=set()
    for row in articles:
        if not isinstance(row,dict) or set(row)!={"id","headline","canonical_url","published_on","publisher"}:
            raise ValueError("CANDIDATE_INPUT_MUST_EXCLUDE_GOLD_AND_BODIES")
        if any(not isinstance(x,str) or not x for x in row.values()) or not ID_RE.fullmatch(row["id"]):
            raise ValueError("BAD_ROW")
        date.fromisoformat(row["published_on"])
        if row["id"] in docs or row["canonical_url"] in urls:raise ValueError("DUPLICATE_INPUT")
        urls.add(row["canonical_url"])
        docs[row["id"]]=feature(row,data)
    pairs=[];positive={}
    keys=sorted(docs)
    for a,b in combinations(keys,2):
        found,ev=retrieve(docs[a],docs[b])
        status,why=verify(docs[a],docs[b],found,ev)
        pairs.append({"ids":[a,b],"retrieved":found,"decision":status,
                      "reason":why,"evidence":ev,"authority":"CANDIDATE_ONLY"})
        positive[(a,b)]=status
    groups=cliques(keys,positive)
    return {"version":VERSION,"input_count":len(keys),"metadata_only":True,
      "semantically_authoritative":False,"semantic_model_executed":False,
      "full_source_text_used":False,"database_writes":0,"contradictions_detected":0,
      "production_permission":False,
      "geography_source":data["source"],"geography_entries":len(data["entries"]),
      "retrieved_pairs":sum(p["retrieved"] for p in pairs),
      "articles":[docs[k] for k in keys],"pair_decisions":pairs,
      "occurrence_groups":[{"members":g,"authority":"UNVERIFIED"} for g in groups],
      "limits":["Commune gazetteer is third-party normalized; no live geopoint/geocoder.",
        "No full publisher body or event timestamp; same-day is not occurrence time.",
        "Entity types are inferred only from headline/gazetteer/lexical patterns.",
        "No authoritative Core writes, claims, or contradiction detection."]}

def main():
    cli=argparse.ArgumentParser()
    cli.add_argument("--input",required=True)
    cli.add_argument("--output",required=True)
    a=cli.parse_args()
    raw=Path(a.input).read_bytes()
    pred=run(json.loads(raw))
    Path(a.output).write_text(json.dumps(pred,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    c=Counter(p["decision"] for p in pred["pair_decisions"])
    print("MODEL="+VERSION)
    print("INPUT_SHA256="+hashlib.sha256(raw).hexdigest())
    print("OUTPUT_SHA256="+hashlib.sha256(Path(a.output).read_bytes()).hexdigest())
    print("GEO_ENTRIES="+str(pred["geography_entries"]))
    print("RETRIEVED_PAIRS="+str(pred["retrieved_pairs"]))
    print("DECISIONS="+json.dumps(c,sort_keys=True))
    print("GROUPS="+str(len(pred["occurrence_groups"])))
    print("WRITES=0")
    print("SCIENTIFIC_GATE=UNSCORED")

if __name__=="__main__":main()
