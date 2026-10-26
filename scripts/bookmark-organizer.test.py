import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('organizer',pathlib.Path(__file__).with_name('bookmark-organizer.py'))
organizer=importlib.util.module_from_spec(spec); spec.loader.exec_module(organizer)

class OrganizerTest(unittest.TestCase):
    def test_validates_model_output(self):
        self.assertEqual(organizer.normalize({'folder':'Entertainment','tags':['#Movies','movies','a'*41], 'confidence':0.9})['tags'], ['movies'])
        with self.assertRaises(ValueError): organizer.normalize({'folder':'Untrusted','tags':[], 'confidence':1})
        with self.assertRaises(ValueError): organizer.normalize({'folder':'Entertainment','tags':[], 'confidence':2})

    def test_atomic_private_update_and_concurrent_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'test.db'; c=sqlite3.connect(path)
            c.executescript('''CREATE TABLE authors(id INTEGER PRIMARY KEY,handle TEXT); CREATE TABLE posts(id INTEGER PRIMARY KEY,title TEXT,body TEXT,moderation_status TEXT); CREATE TABLE external_posts(post_id INTEGER,media TEXT); CREATE TABLE bookmark_folders(id INTEGER PRIMARY KEY,author_id INTEGER,name TEXT,parent_id INTEGER); CREATE TABLE bookmarks(author_id INTEGER,post_id INTEGER,folder_id INTEGER,created_at TEXT,sort_at TEXT); CREATE TABLE bookmark_tags(author_id INTEGER,post_id INTEGER,tag TEXT, UNIQUE(author_id,post_id,tag)); INSERT INTO authors VALUES(1,'techmore'),(2,'other'); INSERT INTO posts VALUES(10,'title','body','approved'); INSERT INTO external_posts VALUES(10,'[]'); INSERT INTO bookmarks VALUES(1,10,NULL,'today',NULL),(2,10,NULL,'today',NULL); INSERT INTO bookmark_tags VALUES(1,10,'existing'),(2,10,'private');'''); c.commit()
            code=organizer.GUEST.replace('/var/lib/swartzit/state/swartzit.sqlite',str(path))
            def call(payload):
                return json.loads(subprocess.run([sys.executable,'-c',code],input=json.dumps({'handle':'techmore',**payload}),text=True,capture_output=True,check=True).stdout)
            snapshot=call({'op':'read','id':10})
            c.execute("UPDATE posts SET body='updated' WHERE id=10"); c.commit()
            self.assertFalse(call({'op':'apply','snapshot':snapshot,'folder':'Entertainment','tags':['new']})['applied'])
            snapshot=call({'op':'read','id':10})
            self.assertTrue(call({'op':'apply','snapshot':snapshot,'folder':'Entertainment','tags':['existing','new']})['applied'])
            self.assertEqual(c.execute('SELECT tag FROM bookmark_tags WHERE author_id=1 ORDER BY tag').fetchall(), [('existing',),('new',)])
            self.assertEqual(c.execute('SELECT folder_id FROM bookmarks WHERE author_id=2').fetchone(),(None,))
            self.assertEqual(c.execute('SELECT tag FROM bookmark_tags WHERE author_id=2').fetchall(), [('private',)])
            self.assertFalse(call({'op':'apply','snapshot':snapshot,'folder':'Art & Design','tags':['new']})['applied'])
            c.close()

if __name__=='__main__': unittest.main()
