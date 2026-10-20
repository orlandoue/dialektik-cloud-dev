#!/usr/bin/env python3
"""Synthetic adversarial engineering checks ONLY (not independent real Gold)."""
from copy import deepcopy
import unittest
from attack7 import make_graph, mentions
from attack5 import load_geography

def row(i,text,day="2025-08-03"):
    return {"id":f"u{i:02d}","headline":text,"published_on":day,
            "publisher":f"Publisher {i}",
            "canonical_url":f"https://example.org/research-{i}"}
def bundle(*xs):
    return {"schema":"public-real-metadata-only-v1","source_text_acquired":False,
            "articles":list(xs)}

class EvidenceGraphTests(unittest.TestCase):
    def test_span_offsets_and_unicode(self):
        a=row(1,"La Fiscalía confirma 123 fallecidos tras incendio en Viña del Mar")
        out=mentions(a,load_geography())
        ev=out["numeric_observations"]
        self.assertTrue(ev)
        self.assertEqual(ev[0]["kind"],"DEATHS_REPORTED")
        self.assertEqual(ev[0]["value"],123)
        for item in out["actions"]+out["physical_mentions"]+ev:
            self.assertEqual(a["headline"][item["start"]:item["end"]],item["verbatim"])

    def test_mine_is_facility_candidate_not_commune(self):
        a=row(1,"Rescate en El Teniente: avanzan 16 metros")
        x=mentions(a,load_geography())
        self.assertTrue(any(f["normalized_alias"]=="el teniente" for f in x["facility_candidates"]))
        self.assertFalse(any(g["kind"]=="GEO_COMMUNE" for g in x["geography"]))
        self.assertIsNone(x["event_time"])

    def test_mine_rescue_is_documentary_operation(self):
        a=row(1,"Rescate en El Teniente avanza hacia mineros")
        x=mentions(a,load_geography())
        self.assertEqual(x["primary_documentary_action"],"RESCUE_OPERATION")
        self.assertTrue(any(p["family"]=="RESCUE" for p in x["physical_mentions"]))

    def test_fire_and_number_two_as_of_unknown(self):
        a=row(1,"Balance: 99 fallecidos por incendio en Valparaíso",day="2024-02-04")
        b=row(2,"Balance: 123 fallecidos por incendio en Valparaíso",day="2024-02-05")
        g=make_graph(bundle(a,b))
        obs=[x for x in g["nodes"] if x["kind"]=="NumericObservationProposal"]
        self.assertEqual({x["reported_value"] for x in obs},{99,123})
        self.assertTrue(all(x["observation_as_of"] is None for x in obs))
        self.assertTrue(all(x["claim_truth_status"]=="NOT_VERIFIED" for x in obs))
        self.assertEqual(g["asserted_contradictions"],0)

    def test_single_article_multiple_phenomena(self):
        g=make_graph(bundle(
            row(1,"Incendios e inundaciones afectan diferentes sectores de Valparaíso"),
            row(2,"Se reportó un incendio en Valparaíso")))
        mids=[x for x in g["nodes"] if x["kind"]=="PhysicalPhenomenonMention"
              and x["id"].startswith("mention:u01:")]
        self.assertGreaterEqual(len({x["family"] for x in mids}),2)
        self.assertEqual(g["asserted_same_occurrence_edges"],0)

    def test_separate_institutional_action_and_event(self):
        g=make_graph(bundle(
            row(1,"Gobierno confirma derrumbe en mina El Teniente"),
            row(2,"Derrumbe en El Teniente deja trabajadores desaparecidos")))
        self.assertTrue(any(x["kind"]=="DocumentaryAction" and
                            x["action_type"]=="CONFIRMATION" for x in g["nodes"]))
        self.assertEqual(g["asserted_same_occurrence_edges"],0)
        self.assertEqual(g["asserted_contradictions"],0)

    def test_two_alarms_not_contradiction(self):
        g=make_graph(bundle(
            row(1,"Senapred decreta evacuación por incendio en Viña del Mar"),
            row(2,"Senapred cancela alerta por incendio en Viña del Mar")))
        self.assertEqual(g["asserted_contradictions"],0)

    def test_mine_alias_retrieval_no_world_merger(self):
        g=make_graph(bundle(
            row(1,"Rescate en El Teniente: hallan trabajadores",day="2025-08-02"),
            row(2,"Derrumbe en mina El Teniente: Fiscalía investiga",day="2025-08-03"),
            row(3,"Tornado causa daños en Puerto Varas",day="2025-08-03")))
        self.assertTrue(any(set(e["ids"])=={"u01","u02"} and
                            e["relation"]=="REVIEW_CANDIDATE_ONLY"
                            for e in g["retrieval_candidates"]))
        self.assertEqual(g["asserted_same_occurrence_edges"],0)

    def test_same_commune_fire_is_only_candidate(self):
        g=make_graph(bundle(
            row(1,"Incendio afecta vivienda de Viña del Mar"),
            row(2,"Incendio afecta local comercial de Viña del Mar")))
        self.assertTrue(g["retrieval_candidates"])
        self.assertTrue(all(e["same_bounded_occurrence"] is None for e in g["retrieval_candidates"]))
        self.assertEqual(g["asserted_same_occurrence_edges"],0)

    def test_date_is_not_event_time(self):
        g=make_graph(bundle(
            row(1,"Incendio en Viña del Mar ayer",day="2024-02-04"),
            row(2,"Incendio en Viña del Mar hoy",day="2024-02-05")))
        self.assertTrue(all(f["event_time"] is None for f in g["article_facets"]))
        self.assertTrue(any(f["time_mentions"] for f in g["article_facets"]))

    def test_permutation_invariance(self):
        rows=[row(1,"Incendio en Viña del Mar"),
              row(2,"Gobierno confirma incendio en Viña del Mar"),
              row(3,"Balance de 99 fallecidos en incendio de Viña del Mar")]
        a=make_graph(bundle(*rows))
        b=make_graph(bundle(*list(reversed(rows))))
        self.assertEqual(a,b)

    def test_no_review_gold_in_inputs(self):
        x=row(1,"Incendio en Viña del Mar")
        x["occurrence_gold"]="LEAK"
        with self.assertRaises(ValueError):
            make_graph(bundle(x,row(2,"Incendio en Viña del Mar")))

    def test_url_policy_fail_closed(self):
        x=row(1,"Incendio en Viña del Mar")
        x["canonical_url"]="http://example.org/"
        with self.assertRaises(ValueError):
            make_graph(bundle(x,row(2,"Incendio en Viña del Mar")))

    def test_no_authority(self):
        g=make_graph(bundle(row(1,"Incendio en Viña del Mar"),
                            row(2,"Incendio en Viña del Mar")))
        self.assertFalse(g["production_permission"])
        self.assertFalse(g["source_bodies_acquired"])
        self.assertEqual(g["database_writes"],0)
        self.assertEqual(g["asserted_contradictions"],0)

    def test_unverified_actor_not_automatically_attributed_claim(self):
        g=make_graph(bundle(
          row(1,"SML informa 99 fallecidos en incendio de Valparaíso"),
          row(2,"Gobierno informa 123 fallecidos en incendio de Valparaíso",
              day="2024-02-05")))
        actors=[x for x in g["nodes"] if x["kind"]=="ActorMention"]
        self.assertTrue(any(x["alias"]=="SML" for x in actors))
        self.assertTrue(any(x["alias"]=="GOVERNMENT" for x in actors))
        self.assertEqual(g["asserted_contradictions"],0)
        self.assertFalse(any(e["type"]=="VERIFIED_ASSERTION_BY" for e in g["edges"]))

    def test_reporting_disjoint_strata(self):
        g=make_graph(bundle(
          row(1,"Incendios afectan Viña del Mar",day="2024-02-03"),
          row(2,"Derrumbe en mina El Teniente",day="2025-08-02"),
          row(3,"Desborde del río afecta Constitución",day="2023-08-21")))
        self.assertEqual(g["candidate_count"],0)

if __name__=="__main__":
    unittest.main()
