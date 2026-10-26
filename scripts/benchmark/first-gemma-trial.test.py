import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('trial',pathlib.Path(__file__).with_name('first-gemma-trial.py')); trial=importlib.util.module_from_spec(spec); spec.loader.exec_module(trial)
class TrialTest(unittest.TestCase):
 def test_requires_both_ram_and_swap_headroom(self):
  self.assertFalse(trial.memory_ready(1024,'MemAvailable: 12000000 kB\nSwapTotal: 8000000 kB\nSwapFree: 1000 kB\n'))
  self.assertTrue(trial.memory_ready(1024,'MemAvailable: 12000000 kB\nSwapTotal: 8000000 kB\nSwapFree: 2000000 kB\n'))
 def test_selects_only_first_ready_small_video(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d); source=p/'manifest'; output=p/'sample'; bad={'post_id':1,'assets':[{'role':'src','kind':'video','status':'ready','size':30*1024*1024},{'role':'src','kind':'video','status':'ready','size':10}]}; good={'post_id':2,'assets':[{'role':'src','kind':'video','status':'ready','size':100}]}; source.write_text(json.dumps(bad)+'\n'+json.dumps(good)+'\n'); trial.select_video(source,output); self.assertEqual(json.loads(output.read_text())['post_id'],2)
 def test_no_ready_video_fails(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d); source=p/'manifest'; source.write_text(json.dumps({'post_id':1,'assets':[]})+'\n')
   with self.assertRaises(ValueError): trial.select_video(source,p/'sample')
if __name__=='__main__':unittest.main()
