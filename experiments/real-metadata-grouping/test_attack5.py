#!/usr/bin/env python3
"""Synthetic-only adversarial gates for ATTACK 5, no real holdout or Gold."""
import copy
import unittest
from attack5 import load_geography, geo_mentions, feature, run, cliques

def a(i,title,publisher="Test publisher",on="2026-10-01"):
    return {"id":f"s{i:02d}","headline":title,"publisher":publisher,
      "canonical_url":f"https://example.test/independent-{i}","published_on":on}
def corpus(rows):
    return {"schema":"public-real-metadata-only-v1","source_text_acquired":False,
            "articles":rows}
def pair(x,y):
    return run(corpus([a(1,x),a(2,y,publisher="Another publisher")]))["pair_decisions"][0]

class Attack5GeoAndIdentity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geo=load_geography()

    def test_source_coverage_and_keys(self):
        self.assertEqual(self.geo["count"],346)
        self.assertEqual(len(set(x["region_code"] for x in self.geo["entries"])),16)
        self.assertEqual(len(set(x["code"] for x in self.geo["entries"])),346)
        self.assertTrue(self.geo["source"]["file"].startswith("https://github.com/"))

    def test_geonames_without_headline_dictionary(self):
        for place in ("Puerto Varas","Villa Alemana","San Miguel","Copiapó",
                      "Los Ángeles","Maipú","Estación Central","Punta Arenas"):
            with self.subTest(place=place):
                places=geo_mentions(f"Incendio registrado en {place}",self.geo)
                self.assertTrue(any(x["kind"]=="GEO_COMMUNE" for x in places),places)

    def test_person_is_not_geographical_anchor(self):
        actual=geo_mentions("Carolina Tohá fue entrevistada",self.geo)
        self.assertFalse(actual)

    def test_person_candidate_is_not_geo_identity(self):
        p=feature(a(1,"Carolina Tohá analiza sismo en Copiapó"),self.geo)
        self.assertTrue(any(x["kind"]=="PERSON_CANDIDATE" and
                            x["text"]=="Carolina Tohá" for x in p["person_candidates"]))
        self.assertTrue(any(h["kind"]=="GEO_COMMUNE" and
                            h["text"]=="copiapo" for h in p["geography"]))
        self.assertFalse(any("carolina" in h["text"] for h in p["geography"]))

    def test_organization_candidate_never_authorizes_identity(self):
        p=feature(a(1,"Dirección Meteorológica anuncia alerta por tornado en Penco"),self.geo)
        self.assertTrue(any(x["kind"]=="ORGANIZATION_CANDIDATE" for x in p["organization_candidates"]))
        self.assertTrue(all(x["kind"]!="GEO_COMMUNE" for x in p["organization_candidates"]))

    def test_region_vs_same_named_commune(self):
        city=geo_mentions("Emergencia en Los Lagos",self.geo)
        reg=geo_mentions("Alerta en Región de Los Lagos",self.geo)
        self.assertTrue(any(x["kind"]=="GEO_COMMUNE" and x["text"]=="los lagos" for x in city),city)
        self.assertTrue(any(x["kind"]=="GEO_REGION" and x["text"]=="los lagos" for x in reg),reg)
        self.assertFalse(any(x["kind"]=="GEO_COMMUNE" and x["text"]=="los lagos" for x in reg),reg)

    def test_commune_alias_accent_invariance(self):
        one=geo_mentions("Tornado en Los Angeles",self.geo)
        two=geo_mentions("Tornado en Los Ángeles",self.geo)
        self.assertEqual(one,two)

    def test_disjoint_communes_do_not_merge_fires(self):
        p=pair("Incendio en terminal de buses de San Miguel",
               "Incendio en terminal de buses de Maipú")
        self.assertNotEqual(p["decision"],"SAME_OCCURRENCE")

    def test_same_commune_fire_not_identity(self):
        p=pair("Incendio destruye casa en San Miguel",
               "Incendio afecta viviendas en San Miguel")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"UNKNOWN")
        self.assertEqual(p["reason"],"FIRE_WITHOUT_VERIFIED_FACILITY_OR_EVENT_ID")

    def test_tornado_same_commune_is_unverified_pair_hypothesis(self):
        p=pair("Tornado deja daños en Puerto Varas",
               "Tornado causa destrozos en Puerto Varas")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"SAME_OCCURRENCE")
        self.assertEqual(p["authority"],"CANDIDATE_ONLY")

    def test_tornado_different_commune_not_identity(self):
        p=pair("Tornado causa daños en Puerto Varas",
               "Tornado provoca daños en Los Ángeles")
        self.assertNotEqual(p["decision"],"SAME_OCCURRENCE")

    def test_earthquake_magnitude_with_commune_hypothesis(self):
        p=pair("Sismo 6,4 sacude Copiapó",
               "Temblor de magnitud 6.4 afecta Copiapó")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"SAME_OCCURRENCE")

    def test_earthquake_conflicting_magnitude_not_identity(self):
        p=pair("Sismo 6,4 sacude Copiapó",
               "Sismo 5,2 sacude Copiapó")
        self.assertNotEqual(p["decision"],"SAME_OCCURRENCE")

    def test_region_only_not_equivalence(self):
        p=pair("Sismo 6,4 afecta Región de Atacama",
               "Sismo 6,4 se registra en Región de Atacama")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"UNKNOWN")

    def test_same_topic_institutional_action_distinct_from_event(self):
        p=pair("Tornado provoca destrozos en Puerto Varas",
               "Alcalde de Puerto Varas asegura que tornado causó graves daños")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"SAME_THREAD_DIFFERENT_OCCURRENCE")

    def test_two_official_actions_are_not_same_occurrence(self):
        p=pair("Senapred declara alerta por tsunami en Valparaíso",
               "Senapred levanta alerta por tsunami en Valparaíso")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"UNKNOWN")

    def test_broad_geography_does_not_prove_same_incident(self):
        p=pair("Tornado afecta a Región de Los Lagos",
               "Tornado causa daños en Puerto Varas")
        self.assertTrue(p["retrieved"])
        self.assertEqual(p["decision"],"UNKNOWN")

    def test_multi_geographical_places_abstain(self):
        p=pair("Tornado afecta a Puerto Varas y Los Ángeles",
               "Tornado causa daños en Puerto Varas")
        self.assertNotEqual(p["decision"],"SAME_OCCURRENCE")

    def test_multiple_mentions_not_transitive(self):
        groups=cliques(["a","b","c"],{
            ("a","b"):"SAME_OCCURRENCE",
            ("b","c"):"SAME_OCCURRENCE",
            ("a","c"):"UNKNOWN"})
        self.assertEqual(groups,[["a","b"]])

    def test_publication_date_not_event_time(self):
        result=run(corpus([a(1,"Tornado en Puerto Varas"),
                           a(2,"Tornado en Puerto Varas",on="2026-10-14")]))
        self.assertEqual(result["pair_decisions"][0]["decision"],"UNKNOWN")
        self.assertTrue(all(x["event_at"] is None for x in result["articles"]))

    def test_permutation_invariance(self):
        arr=[a(1,"Tornado destruye casas en Puerto Varas"),
             a(2,"Tornado deja daños en Puerto Varas",publisher="Other"),
             a(3,"Alcalde de Puerto Varas comenta tornado",publisher="Third")]
        c=corpus(arr)
        d=copy.deepcopy(c);d["articles"]=list(reversed(arr))
        self.assertEqual(run(c),run(d))

    def test_no_gold_in_input(self):
        x=a(1,"Tornado en Puerto Varas")
        x["occurrence_gold"]="not allowed"
        with self.assertRaises(ValueError):
            run(corpus([x,a(2,"Tornado en Puerto Varas")]))

    def test_no_authoritative_writes(self):
        r=run(corpus([a(1,"Tornado en Puerto Varas"),
                     a(2,"Tornado en Puerto Varas")]))
        self.assertFalse(r["production_permission"])
        self.assertFalse(r["semantically_authoritative"])
        self.assertEqual(r["database_writes"],0)
        self.assertEqual(r["contradictions_detected"],0)
        self.assertFalse(r["full_source_text_used"])

    def test_duplicate_url_rejected(self):
        x=a(1,"Tornado en Puerto Varas")
        y=a(2,"Tornado en Puerto Varas")
        y["canonical_url"]=x["canonical_url"]
        with self.assertRaises(ValueError):run(corpus([x,y]))

if __name__=="__main__":
    unittest.main()
