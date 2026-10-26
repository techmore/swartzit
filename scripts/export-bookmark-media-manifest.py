#!/usr/bin/env python3
"""Create a private, refreshable manifest for future local classifier trials."""
import argparse, json, os, pathlib, sqlite3, tempfile
ROOT=pathlib.Path('/var/lib/swartzit/state/bookmark-media-archive')
APPDB='/var/lib/swartzit/state/swartzit.sqlite'
def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--handle',required=True); parser.add_argument('--output',default=str(ROOT/'manifest.jsonl')); args=parser.parse_args()
 os.umask(0o077); root=ROOT.resolve(); out=pathlib.Path(args.output).resolve()
 if out.parent!=root: raise ValueError('manifest must be inside private archive directory')
 app=sqlite3.connect(f'file:{APPDB}?mode=ro',uri=True); cache=sqlite3.connect(f'file:{ROOT}/archive.sqlite?mode=ro',uri=True)
 rows=app.execute("SELECT p.id,p.public_id,p.title,p.body,p.content_rating,p.content_rating_source,e.source_url,e.media,e.profile_image_url,e.provider,e.source_author FROM bookmarks b JOIN authors a ON a.id=b.author_id JOIN posts p ON p.id=b.post_id JOIN external_posts e ON e.post_id=p.id WHERE a.handle=?",(args.handle,)).fetchall()
 n=0; ready=0; name=None
 try:
  with tempfile.NamedTemporaryFile(mode='w',dir=root,prefix='.manifest-',delete=False,encoding='utf8') as dst:
   name=dst.name
   for pid,public,title,body,rating,rating_source,source,media,avatar,provider,source_author in rows:
    uploads=app.execute("SELECT m.media_type,m.id,m.content_hash FROM post_media pm JOIN media_assets m ON m.id=pm.media_id WHERE pm.post_id=? AND m.media_type IN ('image','video') AND m.status='ready' ORDER BY pm.position,m.id",(pid,)).fetchall()
    current={'post_id':pid,'public_id':public,'title':title,'body':body,'provider':provider,'source_url':source,'source_author':source_author,'media':json.loads(media)+[{'kind':kind,'src':f'/media/{mid}/original','content_hash':h} for kind,mid,h in uploads]}
    labels=app.execute('SELECT t.content_hash,t.label,t.created_at,r.snapshot,r.content_hash,r.artifacts,r.policy_version FROM rating_training_labels t JOIN rating_reviews r ON r.id=t.review_id WHERE t.post_id=? ORDER BY t.id DESC',(pid,)).fetchall()
    assets=[]
    for index,m in enumerate(json.loads(media)):
     if isinstance(m,str): m={'kind':'image','src':m}
     if not isinstance(m,dict): continue
     for role in ('src','poster'):
      url=m.get(role)
      if not isinstance(url,str): continue
      row=cache.execute('SELECT status,sha256,size,mime,error FROM targets WHERE url=?',(url,)).fetchone()
      if row:
       status,sha,size,mime,error=row; ready+=status=='ready'
       assets.append({'index':index,'role':role,'kind':m.get('kind') if role=='src' else 'image','source_url':url,'status':status,'sha256':sha,'size':size,'mime':mime,'error':error,'object_path':str(root/'objects'/sha) if sha else None})
      else:
       assets.append({'index':index,'role':role,'kind':m.get('kind') if role=='src' else 'image','source_url':url,'status':'untracked','sha256':None,'size':None,'mime':None,'error':None,'object_path':None})
    for index,(kind,mid,hash_value) in enumerate(uploads,start=len(json.loads(media))):
     assets.append({'index':index,'role':'src','kind':kind,'source_url':f'/media/{mid}/original','status':'untracked','sha256':hash_value,'size':None,'mime':None,'error':None,'object_path':None})
    human=[{'content_hash':h,'label':v,'reviewed_at':t,'policy_version':policy,'snapshot_verified':h==review_hash and json.loads(snapshot)==current,'artifact_sha256':[a.get('sha256') for a in json.loads(artifacts) if isinstance(a,dict) and a.get('sha256')]} for h,v,t,snapshot,review_hash,artifacts,policy in labels]
    record={'post_id':pid,'public_id':public,'title':title,'text':body,'source_url':source,'current_rating':rating,'current_rating_source':rating_source,'human_labels':human,'assets':assets}
    dst.write(json.dumps(record,ensure_ascii=False)+'\n'); n+=1
   dst.flush(); os.fsync(dst.fileno())
  os.replace(name,out); name=None
 finally:
  if name: pathlib.Path(name).unlink(missing_ok=True)
 print(json.dumps({'posts':n,'ready_attachments':ready,'manifest':str(out)}))
if __name__=='__main__': main()
