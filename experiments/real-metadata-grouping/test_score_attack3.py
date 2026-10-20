"""Only synthetic scorer contract tests; NEVER an evaluated real-news corpus."""
from hashlib import sha256
from itertools import combinations
import json
import unittest
from score_attack3 import score

LABELS = ['SAME_OCCURRENCE','UNRELATED']
def fixture():
    articles = [{'id':name} for name in ('x01','x02','x03')]
    corpus = {'schema':'public-real-metadata-only-v1','articles':articles}
    digest = sha256(json.dumps(corpus).encode()).hexdigest()
    pairs = [
      {'ids':['x01','x02'],'decision':'SAME_OCCURRENCE'},
      {'ids':['x01','x03'],'decision':'UNKNOWN'},
      {'ids':['x02','x03'],'decision':'UNKNOWN'},
    ]
    predictions = {'version':'typed-occurrence-metadata-v3-preprospective',
      'input_count':3,'metadata_only':True,'production_permission':False,
      'database_writes':0,'semantic_model_executed':False,
      'pair_decisions':pairs,'occurrence_groups':[{'members':['x01','x02']}]}
    reference = {'schema':'attack3-independent-pair-reference-v1',
      'corpus_sha256':digest,
      'adjudication':{'independent_annotators':2,'conflicts_resolved':True},
      'pairs':[
        {'ids':['x01','x02'],'expected':'SAME_OCCURRENCE'},
        {'ids':['x01','x03'],'expected':'UNRELATED'},
        {'ids':['x02','x03'],'expected':'UNRELATED'},
      ]}
    return corpus,predictions,reference,digest

class ScoreTests(unittest.TestCase):
    def test_coverage_and_cluster_metrics(self):
        a,b,c,d=fixture()
        result=score(a,b,c,d)
        self.assertEqual(result['scientific_gate'],'NO_GO_PENDING_EXTERNAL_REVIEW')
        self.assertEqual(result['pairs'],3)
        self.assertEqual(result['per_class']['SAME_OCCURRENCE']['tp'],1)
        self.assertEqual(result['selective_coverage'],1/3)
        self.assertEqual(result['impure_predicted_clusters'],0)
        self.assertFalse(result['production_permission'])

    def test_incomplete_reference_rejected(self):
        a,b,c,d=fixture()
        c['pairs'].pop()
        with self.assertRaises(ValueError):
            score(a,b,c,d)

    def test_reference_hash_mismatch_rejected(self):
        a,b,c,d=fixture()
        c['corpus_sha256']='0'*64
        with self.assertRaises(ValueError):
            score(a,b,c,d)

    def test_independent_adjudication_missing_rejected(self):
        a,b,c,d=fixture()
        c['adjudication']={'independent_annotators':1,'conflicts_resolved':False}
        with self.assertRaises(ValueError):
            score(a,b,c,d)

    def test_golden_reference_not_used_by_predictor(self):
        a,b,c,d=fixture()
        b['production_permission']=True
        with self.assertRaises(ValueError):
            score(a,b,c,d)

if __name__=='__main__':
    unittest.main()
