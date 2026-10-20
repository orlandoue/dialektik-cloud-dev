#!/usr/bin/env python3
"""Attack 4 synthetic-only, no sampled real-news labels and no network."""
import unittest
from attack4 import run, named_anchors, retrieve, verify, conservative_groups

def article(i,title,publisher=None,day="2026-07-12"):
    return {"id":"s"+str(i).zfill(2),"publisher":publisher or "Example Publisher",
      "headline":title,"published_on":day,
      "canonical_url":"https://source.example/article-"+str(i)}

def input_of(rows):
    return {"schema":"public-real-metadata-only-v1","source_text_acquired":False,
      "articles":rows}

class Attack4SyntheticTests(unittest.TestCase):
    def labels(self, rows):
        return run(input_of(rows))

    def test_generic_new_city_without_dictionary(self):
        out=self.labels([
          article(1,"Incendio destruye terminal de buses en Puerto Brisa"),
          article(2,"Microbuses dañados tras incendio en Puerto Brisa","Another Publisher")])
        self.assertIn("puerto brisa",out["pair_decisions"][0]["evidence"]["shared_named_anchors"])
        self.assertTrue(out["pair_decisions"][0]["retrieved"])
        self.assertEqual(out["pair_decisions"][0]["decision"],"SAME_OCCURRENCE")

    def test_named_place_punctuation_and_accents(self):
        out=self.labels([
          article(1,"Tornado causa daños en Villa Señora"),
          article(2,"Tornado azota Villa Señora y deja destrozos","Other")])
        self.assertEqual(out["pair_decisions"][0]["decision"],"SAME_OCCURRENCE")
        self.assertEqual(out["articles"][0]["event_at"],None)

    def test_statement_related_is_not_same_incident(self):
        out=self.labels([
          article(1,"Incendio destruye terminal de buses en Puerto Brisa"),
          article(2,"Alcalde de Puerto Brisa anuncia medidas tras incendio en terminal","Other")])
        self.assertEqual(out["pair_decisions"][0]["decision"],
                         "SAME_THREAD_DIFFERENT_OCCURRENCE")

    def test_different_object_not_merged(self):
        out=self.labels([
          article(1,"Incendio destruye teatro municipal en Puerto Brisa"),
          article(2,"Incendio de casa en Puerto Brisa deja heridos","Other")])
        self.assertNotEqual(out["pair_decisions"][0]["decision"],"SAME_OCCURRENCE")

    def test_generic_city_without_incident_specificity(self):
        out=self.labels([
          article(1,"Incendio de edificio en Villa Serena"),
          article(2,"Incendio de edificio en Villa Serena","Other")])
        # Small same-city same-type news reports are not provenance-backed
        # occurrence equivalents; algorithm is research-only (known risk).
        self.assertEqual(out["pair_decisions"][0]["decision"],"UNKNOWN")

    def test_narrative_does_not_create_transitive_equivalence(self):
        decisions={("s01","s02"):"SAME_OCCURRENCE",
                   ("s02","s03"):"SAME_OCCURRENCE",
                   ("s01","s03"):"UNKNOWN"}
        self.assertEqual(conservative_groups(["s01","s02","s03"],decisions),[["s01","s02"]])

    def test_retrieval_distinct_from_identity(self):
        out=self.labels([
          article(1,"Incendio afecta a Puerto Brisa"),
          article(2,"Incendio en Puerto Brisa deja daños","Other")])
        self.assertTrue(out["pair_decisions"][0]["retrieved"])
        self.assertEqual(out["pair_decisions"][0]["decision"],"UNKNOWN")

    def test_multi_incident_abstention(self):
        out=self.labels([
          article(1,"Incendio de bus y otro ataque en Puerto Brisa"),
          article(2,"Incendio afecta bus en Puerto Brisa","Other")])
        self.assertEqual(out["pair_decisions"][0]["decision"],"UNKNOWN")

    def test_publication_distance_not_event_time(self):
        out=self.labels([
          article(1,"Tornado causa daños en Villa Serena","A",day="2026-05-01"),
          article(2,"Tornado causa graves daños en Villa Serena","B",day="2026-05-20")])
        self.assertEqual(out["pair_decisions"][0]["decision"],"UNKNOWN")
        self.assertTrue(all(a["event_at"] is None for a in out["articles"]))

    def test_no_same_source_exclusion(self):
        out=self.labels([
          article(1,"Incendio destruye terminal de buses en Puerto Brisa","One"),
          article(2,"Incendio afecta a 20 microbuses en Puerto Brisa","One")])
        self.assertEqual(out["pair_decisions"][0]["decision"],"SAME_OCCURRENCE")

    def test_permutation_and_no_persistent_semantics(self):
        rows=[article(1,"Tornado en Villa Serena"),article(2,"Tornado azota Villa Serena","B"),
              article(3,"Alcalde de Villa Serena anuncia medidas por tornado","C")]
        a,b=self.labels(rows),self.labels(list(reversed(rows)))
        self.assertEqual(a,b)
        self.assertFalse(a["production_permission"])
        self.assertEqual(a["database_writes"],0)
        self.assertEqual(a["contradictions_detected"],0)
        self.assertFalse(a["semantic_model_executed"])

    def test_reject_leaked_reference(self):
        rows=[article(1,"Tornado en Villa Serena"),article(2,"Tornado azota Villa Serena")]
        rows[0]["gold_occurrence_id"]="leak"
        with self.assertRaises(ValueError):
            self.labels(rows)

if __name__=="__main__":
    unittest.main()
