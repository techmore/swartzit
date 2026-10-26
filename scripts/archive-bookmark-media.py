#!/usr/bin/env python3
"""Archive original X bookmark attachments privately on the Swartzit host."""
import argparse, concurrent.futures, fcntl, hashlib, json, os, pathlib, shutil, sqlite3, tempfile, urllib.error, urllib.parse, urllib.request

ROOT=pathlib.Path('/var/lib/swartzit/state/bookmark-media-archive')
APPDB='/var/lib/swartzit/state/swartzit.sqlite'
HOSTS={'pbs.twimg.com','video.twimg.com'}
FLOOR=30*1024**3
MAX=512*1024**2
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  p=urllib.parse.urlparse(newurl)
  if p.scheme!='https' or p.hostname not in HOSTS or p.username or p.password or p.port: return None
  return super().redirect_request(req,fp,code,msg,headers,newurl)

def trusted(url):
 try:
  p=urllib.parse.urlparse(url)
  return p.scheme=='https' and p.hostname in HOSTS and not p.username and not p.password and not p.port and len(url)<=2048
 except (ValueError,TypeError): return False

def sources(handle):
 c=sqlite3.connect(f'file:{APPDB}?mode=ro',uri=True)
 rows=c.execute("SELECT e.media,e.profile_image_url FROM bookmarks b JOIN authors a ON a.id=b.author_id JOIN external_posts e ON e.post_id=b.post_id WHERE a.handle=?",(handle,)).fetchall(); urls={}
 for raw,avatar in rows:
  if trusted(avatar): urls[avatar]='image'
  for m in json.loads(raw):
   if not isinstance(m,dict): continue
   for role in ('src','poster'):
    url=m.get(role); kind=m.get('kind') if role=='src' else 'image'
    if trusted(url) and kind in ('image','video'): urls[url]=kind
 return urls

def download(item):
 url,kind=item; temp=None
 try:
  if shutil.disk_usage(ROOT).free < FLOOR+MAX*4: raise OSError('space floor reached')
  req=urllib.request.Request(url,headers={'User-Agent':'Swartzit-media-archive/1'})
  with urllib.request.build_opener(Redirect()).open(req,timeout=45) as r:
   mime=r.headers.get_content_type().lower()
   if mime not in ({'image/jpeg','image/png','image/webp','image/gif'} if kind=='image' else {'video/mp4'}): raise ValueError('unsupported MIME type')
   length=int(r.headers.get('Content-Length','0'))
   if length>MAX: raise ValueError('asset exceeds size limit')
   h=hashlib.sha256(); count=0
   with tempfile.NamedTemporaryFile(dir=ROOT/'objects',prefix='.partial-',delete=False) as out:
    temp=pathlib.Path(out.name)
    while True:
     chunk=r.read(262144)
     if not chunk: break
     count+=len(chunk)
     if count>MAX or shutil.disk_usage(ROOT).free<FLOOR: raise OSError('storage limit reached')
     h.update(chunk); out.write(chunk)
    out.flush(); os.fsync(out.fileno())
   if not count or (length and count!=length): raise ValueError('empty or incomplete response')
  digest=h.hexdigest(); target=ROOT/'objects'/digest
  os.replace(temp,target); temp=None
  key=hashlib.sha256(url.encode()).hexdigest(); data={'sha256':digest,'size':count,'mime':mime}
  with tempfile.NamedTemporaryFile(mode='w',dir=ROOT/'index',prefix='.partial-',delete=False) as out:
   json.dump(data,out); out.flush(); os.fsync(out.fileno()); index_temp=out.name
  os.replace(index_temp,ROOT/'index'/(key+'.json'))
  return {'status':'ready','sha256':digest,'size':count,'mime':mime,'error':None}
 except Exception as exc:
  if temp: temp.unlink(missing_ok=True)
  return {'status':'error','sha256':None,'size':0,'mime':None,'error':type(exc).__name__}

def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--handle',required=True); args=parser.parse_args()
 os.umask(0o077); ROOT.mkdir(parents=True,exist_ok=True,mode=0o700); (ROOT/'objects').mkdir(exist_ok=True,mode=0o700); (ROOT/'index').mkdir(exist_ok=True,mode=0o700)
 with (ROOT/'archive.lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  db=sqlite3.connect(ROOT/'archive.sqlite'); db.execute("CREATE TABLE IF NOT EXISTS targets(url TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',sha256 TEXT,size INTEGER,mime TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
  db.executemany('INSERT OR IGNORE INTO targets(url,kind) VALUES(?,?)',sources(args.handle).items()); db.commit()
  print(json.dumps({'targets':db.execute('SELECT count(*) FROM targets').fetchone()[0]}),flush=True)
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   while True:
    if shutil.disk_usage(ROOT).free < FLOOR+MAX*4: print('Free-space floor reached; pausing.',flush=True); break
    rows=db.execute("SELECT url,kind FROM targets WHERE status='pending' OR (status='error' AND attempts<3) ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END LIMIT 24").fetchall()
    if not rows: break
    for (url,kind),result in zip(rows,pool.map(download,rows)):
     db.execute('UPDATE targets SET status=?,sha256=?,size=?,mime=?,error=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE url=?',(result['status'],result['sha256'],result['size'],result['mime'],result['error'],url)); db.commit()
    print(json.dumps({'progress':db.execute('SELECT status,count(*) FROM targets GROUP BY status').fetchall()}),flush=True)
if __name__=='__main__': main()
