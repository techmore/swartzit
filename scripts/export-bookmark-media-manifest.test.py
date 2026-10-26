import importlib.util,json,pathlib,sqlite3,sys,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('manifest',pathlib.Path(__file__).with_name('export-bookmark-media-manifest.py')); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class ManifestTest(unittest.TestCase):
 def test_review_snapshot_and_missing_media(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp); app_path=root/'app.sqlite'; app=sqlite3.connect(app_path)
   app.executescript('''CREATE TABLE authors(id INTEGER,handle TEXT); CREATE TABLE bookmarks(author_id INTEGER,post_id INTEGER); CREATE TABLE posts(id INTEGER,public_id TEXT,title TEXT,body TEXT,content_rating TEXT,content_rating_source TEXT); CREATE TABLE external_posts(post_id INTEGER,source_url TEXT,media TEXT,profile_image_url TEXT,provider TEXT,source_author TEXT); CREATE TABLE post_media(post_id INTEGER,media_id INTEGER,position INTEGER); CREATE TABLE media_assets(id INTEGER,media_type TEXT,content_hash TEXT,status TEXT); CREATE TABLE rating_reviews(id INTEGER,snapshot TEXT,content_hash TEXT,artifacts TEXT,policy_version TEXT); CREATE TABLE rating_training_labels(id INTEGER,post_id INTEGER,review_id INTEGER,content_hash TEXT,label TEXT,created_at TEXT); INSERT INTO authors VALUES(1,'user'); INSERT INTO bookmarks VALUES(1,7); INSERT INTO posts VALUES(7,'pub','title','body','r','moderator');''')
   media=[{'kind':'image','src':'https://pbs.twimg.com/a.jpg'}]; snapshot={'post_id':7,'public_id':'pub','title':'title','body':'body','provider':'x','source_url':'https://x.com/i/status/1','source_author':'@a','media':media}
   app.execute('insert into external_posts values(?,?,?,?,?,?)',(7,snapshot['source_url'],json.dumps(media),None,'x','@a')); app.execute('insert into rating_reviews values(?,?,?,?,?)',(1,json.dumps(snapshot),'hash',json.dumps([{'sha256':'abc'}]),'suggestive-r-explicit-x-v1')); app.execute('insert into rating_training_labels values(?,?,?,?,?,?)',(1,7,1,'hash','r','today')); app.commit(); app.close()
   cache=sqlite3.connect(root/'archive.sqlite'); cache.execute('create table targets(url text,status text,sha256 text,size integer,mime text,error text)'); cache.commit(); cache.close()
   with patch.object(m,'ROOT',root),patch.object(m,'APPDB',str(app_path)),patch.object(sys,'argv',['manifest','--handle','user','--output',str(root/'manifest.jsonl')]): m.main()
   data=json.loads((root/'manifest.jsonl').read_text()); self.assertTrue(data['human_labels'][0]['snapshot_verified']); self.assertEqual(data['human_labels'][0]['artifact_sha256'],['abc']); self.assertEqual(data['assets'][0]['status'],'untracked')
   app=sqlite3.connect(app_path); app.execute("update posts set body='edited'"); app.commit(); app.close()
   with patch.object(m,'ROOT',root),patch.object(m,'APPDB',str(app_path)),patch.object(sys,'argv',['manifest','--handle','user','--output',str(root/'manifest.jsonl')]): m.main()
   self.assertFalse(json.loads((root/'manifest.jsonl').read_text())['human_labels'][0]['snapshot_verified'])
if __name__=='__main__':unittest.main()
