import contextlib, hashlib, importlib.util, io, json, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('adapters',pathlib.Path(__file__).with_name('adapters.py')); a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
class FakeBackend:
 @staticmethod
 def CPU(): return 'cpu'
 @staticmethod
 def GPU(): return 'gpu'
class FakeConversation:
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def send_message(self,content):
  FakeRuntime.last_message=content
  return {'content':[{'type':'text','text':'{"rating":"r","uncertain":false}'}]}
class FakeEngine:
 def __init__(self,path,**kwargs): FakeRuntime.last_engine=kwargs
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def create_conversation(self,**kwargs): FakeRuntime.last_conversation=kwargs; return FakeConversation()
class FakeRuntime:
 Backend=FakeBackend; Engine=FakeEngine
 @staticmethod
 def SamplerConfig(**kwargs): return kwargs
class AdapterTest(unittest.TestCase):
 def test_gemma_rejects_low_memory_before_loading(self):
  with tempfile.TemporaryDirectory() as d:
   model=pathlib.Path(d)/'model.litertlm'; model.write_bytes(b'model'); request={'tool':{'model_path':str(model),'model_digest':hashlib.sha256(b'model').hexdigest()},'images':[]}
   with patch('sys.platform','linux'),patch.object(pathlib.Path,'read_text',return_value='MemAvailable: 1000 kB\n'):
    with self.assertRaisesRegex(ValueError,'insufficient available memory'): a.gemma_result(request,FakeRuntime,'0.18.1')
 def test_gemma_uses_all_frames_and_checks_model(self):
  try: from PIL import Image
  except ImportError: self.skipTest('Pillow unavailable')
  with tempfile.TemporaryDirectory() as d:
   model=pathlib.Path(d)/'model.litertlm'; model.write_bytes(b'model'); digest=hashlib.sha256(b'model').hexdigest(); images=[str((pathlib.Path(d)/f'{i}.jpg').resolve()) for i in range(3)]
   for path in images: Image.new('RGB',(16,16),'red').save(path)
   request={'tool':{'model_path':str(model),'model_digest':digest,'backend':'cpu','input':'multimodal_video'},'post':{'title':'t','text':'body'},'images':images}
   result=a.gemma_result(request,FakeRuntime,'0.17.1'); self.assertEqual(result['rating'],'r'); self.assertEqual(FakeRuntime.last_engine['vision_backend'],'cpu'); self.assertEqual(FakeRuntime.last_engine['max_num_images'],3); self.assertEqual(len([x['path'] for x in FakeRuntime.last_message['content'] if x['type']=='image']),3); self.assertEqual(len(result['prepared_image_sha256s']),3); self.assertFalse(FakeRuntime.last_conversation['automatic_tool_calling'])
   with self.assertRaises(ValueError): a.gemma_result(request,FakeRuntime,'0.16.0')
   model.write_bytes(b'changed')
   with self.assertRaises(ValueError): a.gemma_result(request,FakeRuntime,'0.17.1')
 def test_qwen_receives_every_sampled_frame(self):
  try: from PIL import Image
  except ImportError: self.skipTest('Pillow unavailable')
  with tempfile.TemporaryDirectory() as d:
   images=[]
   for index in range(3):
    p=pathlib.Path(d)/f'{index}.jpg'; Image.new('RGB',(16,16),(index*30,0,0)).save(p); images.append(str(p))
   request={'tool':{'adapter':'qwen','model':'qwen3.5:2b','model_digest':'digest','input':'multimodal_video'},'post':{'title':'t','text':'body'},'images':images}; calls=[]
   def fake(url,value=None):
    if url.endswith('/api/tags'): return {'models':[{'name':'qwen3.5:2b','digest':'digest'}]}
    if url.endswith('/api/version'): return {'version':'test'}
    calls.append(value); return {'message':{'content':'{"rating":"general","uncertain":false}'}}
   with patch.object(a,'request_json',side_effect=fake),patch('sys.stdin',io.StringIO(json.dumps(request))),contextlib.redirect_stdout(io.StringIO()) as out: a.main()
   self.assertEqual(len(calls[0]['messages'][1]['images']),3); self.assertEqual(len(json.loads(out.getvalue())['prepared_image_sha256s']),3)
if __name__=='__main__': unittest.main()
