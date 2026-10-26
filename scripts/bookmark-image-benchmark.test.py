import importlib.util, io, pathlib, sqlite3, unittest
from PIL import Image
spec=importlib.util.spec_from_file_location('bench',pathlib.Path(__file__).with_name('bookmark-image-benchmark.py'))
bench=importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)
class BenchmarkTest(unittest.TestCase):
 def test_preprocessing_and_conflicts(self):
  image=Image.new('RGB',(300,200),(255,0,0)); b=io.BytesIO(); image.save(b,format='JPEG'); tensor=bench.prepare_mobile(b.getvalue())
  self.assertEqual(tensor.shape,(1,3,224,224)); self.assertGreater(float(tensor[0,0,0,0]),0.99); self.assertLess(float(tensor[0,1,0,0]),0.02)
  self.assertTrue(bench.policy_conflict({'rating':'general','reasons':['nudity']})); self.assertTrue(bench.policy_conflict({'rating':'r','reasons':['graphic_violence']})); self.assertFalse(bench.policy_conflict({'rating':'r','reasons':['sexual_suggestiveness']}))
 def test_preserves_distinct_runs_and_tools(self):
  c=sqlite3.connect(':memory:'); c.execute('PRAGMA foreign_keys=ON'); bench.create_schema(c)
  for rid in (1,2):
   c.execute('INSERT INTO runs(id,name,account,config) VALUES(?,?,?,?)',(rid,'trial','user','{}')); c.execute('INSERT INTO items(id,run_id,post_id,media_index,source_url) VALUES(?,?,?,?,?)',(rid,rid,7,0,'url'))
   for tool in ('qwen','mobilenet','future_tool'): c.execute('INSERT INTO predictions(run_id,item_id,tool,model,model_digest,result_json,elapsed_ms) VALUES(?,?,?,?,?,?,?)',(rid,rid,tool,'model','digest','{}',1))
  self.assertEqual(c.execute('SELECT count(*) FROM predictions').fetchone()[0],6)
  with self.assertRaises(sqlite3.IntegrityError): c.execute('INSERT INTO predictions(run_id,item_id,tool,model,model_digest,result_json,elapsed_ms) VALUES(1,1,?,?,?,?,?)',('qwen','model','digest','{}',1))
if __name__=='__main__': unittest.main()
