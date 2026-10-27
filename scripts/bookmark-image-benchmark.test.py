import importlib.util, io, json, pathlib, sqlite3, unittest
from PIL import Image
spec=importlib.util.spec_from_file_location('bench',pathlib.Path(__file__).with_name('bookmark-image-benchmark.py'))
bench=importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)
class BenchmarkTest(unittest.TestCase):
 def test_preprocessing_and_conflicts(self):
  image=Image.new('RGB',(300,200),(255,0,0)); b=io.BytesIO(); image.save(b,format='JPEG'); tensor=bench.prepare_mobile(b.getvalue())
  self.assertEqual(tensor.shape,(1,3,224,224)); self.assertGreater(float(tensor[0,0,0,0]),0.99); self.assertLess(float(tensor[0,1,0,0]),0.02)
  self.assertTrue(bench.policy_conflict({'rating':'general','reasons':['nudity']})); self.assertTrue(bench.policy_conflict({'rating':'r','reasons':['graphic_violence']})); self.assertFalse(bench.policy_conflict({'rating':'r','reasons':['sexual_suggestiveness']}))
 def test_prefetch_preserves_order_and_isolates_errors(self):
  rows=[(1,'ok',None,None),(2,'bad',None,None),(3,'cached','hash','path')]
  def fetch(url):
   if url=='bad': raise ValueError('bad')
   return b'image'
  results=list(bench.prefetch(rows,fetch)); self.assertEqual([r[0][0] for r in results],[1,2,3]); self.assertEqual(results[0][1],b'image'); self.assertIsInstance(results[1][1],ValueError); self.assertIsNone(results[2][1])
 def test_preserves_distinct_runs_and_tools(self):
  c=sqlite3.connect(':memory:'); c.execute('PRAGMA foreign_keys=ON'); bench.create_schema(c)
  for rid in (1,2):
   c.execute('INSERT INTO runs(id,name,account,config) VALUES(?,?,?,?)',(rid,'trial','user','{}')); c.execute('INSERT INTO items(id,run_id,post_id,media_index,source_url) VALUES(?,?,?,?,?)',(rid,rid,7,0,'url'))
   for tool in ('qwen','mobilenet','future_tool'): c.execute('INSERT INTO predictions(run_id,item_id,tool,model,model_digest,result_json,elapsed_ms) VALUES(?,?,?,?,?,?,?)',(rid,rid,tool,'model','digest','{}',1))
  self.assertEqual(c.execute('SELECT count(*) FROM predictions').fetchone()[0],6)
  with self.assertRaises(sqlite3.IntegrityError): c.execute('INSERT INTO predictions(run_id,item_id,tool,model,model_digest,result_json,elapsed_ms) VALUES(1,1,?,?,?,?,?)',('qwen','model','digest','{}',1))
 def test_retry_creates_new_run_preserving_original_and_completed_predictions(self):
  c=sqlite3.connect(':memory:'); c.execute('PRAGMA foreign_keys=ON'); bench.create_schema(c)
  config={'qwen_digest':'q','mobile_digest':'m','qwen_prompt':'p','qwen_schema':{},'qwen_options':{},'mobile_input':'m','qwen_input':'q','onnxruntime':'1'}
  c.execute('INSERT INTO runs(id,name,account,finished_at,config) VALUES(1,?,?,?,?)',('original','owner','finished',json.dumps(config)))
  c.execute("INSERT INTO items(id,run_id,post_id,media_index,source_url,input_sha256,image_path,status,error) VALUES(1,1,10,0,'url','hash','images/hash.jpg','error','JSONDecodeError')")
  c.execute("INSERT INTO predictions(run_id,item_id,tool,model,model_digest,result_json,elapsed_ms) VALUES(1,1,'mobilenet','m','m','{}',1)"); c.commit()
  retry=bench.create_failed_retry(c,1,'owner',config,'retry')
  self.assertEqual(c.execute('SELECT status,error FROM items WHERE id=1').fetchone(),('error','JSONDecodeError'))
  item=c.execute('SELECT id,status,input_sha256,image_path FROM items WHERE run_id=?',(retry,)).fetchone()
  self.assertEqual(item[1:],('pending','hash','images/hash.jpg'))
  self.assertEqual(c.execute('SELECT tool FROM predictions WHERE run_id=? AND item_id=?',(retry,item[0])).fetchall(),[('mobilenet',)])
  self.assertEqual(json.loads(c.execute('SELECT config FROM runs WHERE id=?',(retry,)).fetchone()[0])['retry_of'],1)
  with self.assertRaises(ValueError): bench.create_failed_retry(c,1,'other',config,'retry')
  with self.assertRaises(ValueError): bench.create_failed_retry(c,1,'owner',{**config,'qwen_digest':'changed'},'retry')
if __name__=='__main__': unittest.main()
