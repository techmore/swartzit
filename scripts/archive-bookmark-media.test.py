import collections, importlib.util, io, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('archive',pathlib.Path(__file__).with_name('archive-bookmark-media.py'))
a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
class Response(io.BytesIO):
 def __init__(self,data,mime):
  super().__init__(data); self.headers=type('Headers',(),{'get_content_type':lambda self:mime,'get':lambda self,k,d=None: str(len(data)) if k=='Content-Length' else d})()
class ArchiveTest(unittest.TestCase):
 def test_hosts(self):
  self.assertTrue(a.trusted('https://pbs.twimg.com/media/a.jpg')); self.assertFalse(a.trusted('https://pbs.twimg.com@evil.example/a')); self.assertFalse(a.trusted('http://pbs.twimg.com/a'))
 def test_saved_original_and_index(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp); (root/'objects').mkdir(); (root/'index').mkdir(); data=b'original bytes'
   opener=type('Opener',(),{'open':lambda self,*args,**kw:Response(data,'image/jpeg')})()
   usage=collections.namedtuple('usage','total used free')(10**12,0,10**12)
   with patch.object(a,'ROOT',root),patch.object(a.shutil,'disk_usage',return_value=usage),patch.object(a.urllib.request,'build_opener',return_value=opener): result=a.download(('https://pbs.twimg.com/a','image'))
   self.assertEqual(result['status'],'ready'); self.assertEqual((root/'objects'/result['sha256']).read_bytes(),data); self.assertEqual(len(list((root/'index').glob('*.json'))),1)
 def test_reject_mismatched_media_type(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp); (root/'objects').mkdir(); (root/'index').mkdir(); opener=type('Opener',(),{'open':lambda self,*args,**kw:Response(b'html','text/html')})(); usage=collections.namedtuple('usage','total used free')(10**12,0,10**12)
   with patch.object(a,'ROOT',root),patch.object(a.shutil,'disk_usage',return_value=usage),patch.object(a.urllib.request,'build_opener',return_value=opener): result=a.download(('https://pbs.twimg.com/a','image'))
   self.assertEqual(result['status'],'error'); self.assertFalse(list((root/'objects').iterdir()))
if __name__=='__main__':unittest.main()
