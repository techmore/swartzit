#!/usr/bin/env python3
"""Private, resumable benchmark batteries over immutable archived post inputs.

Tool adapters are trusted local executables. Each gets one JSON request on stdin
and must emit one JSON object on stdout; no shell is involved. Model outputs
are measurements only and never update Swartzit ratings or bookmarks.
"""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import platform
import shutil
import sqlite3
import statistics
import subprocess
import tempfile
import time
import urllib.parse
import urllib.error
import urllib.request

SCHEMA = '''
CREATE TABLE IF NOT EXISTS batteries(id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,manifest_sha256 TEXT NOT NULL,config TEXT NOT NULL,host TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inputs(id INTEGER PRIMARY KEY,battery_id INTEGER NOT NULL REFERENCES batteries(id),post_id INTEGER NOT NULL,input_sha256 TEXT NOT NULL,payload TEXT NOT NULL,split TEXT NOT NULL,UNIQUE(battery_id,post_id));
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,battery_id INTEGER NOT NULL REFERENCES batteries(id),input_id INTEGER NOT NULL REFERENCES inputs(id),tool_id TEXT NOT NULL,iteration INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',UNIQUE(battery_id,input_id,tool_id,iteration));
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL REFERENCES jobs(id),status TEXT NOT NULL,result TEXT,error TEXT,preparation_ms REAL,wall_ms REAL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
'''

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def host_info():
    host={'system':platform.system(), 'machine':platform.machine(), 'release':platform.release(), 'python':platform.python_version()}
    try:
        cpu=pathlib.Path('/proc/cpuinfo').read_text()
        host['cpu']=next(line.split(':',1)[1].strip() for line in cpu.splitlines() if line.startswith('model name'))
        mem=pathlib.Path('/proc/meminfo').read_text()
        host['memory_total_kib']=int(next(line.split()[1] for line in mem.splitlines() if line.startswith('MemTotal:')))
    except (OSError,StopIteration,ValueError):
        pass
    return host

def connect(path):
    os.umask(0o077)
    path = pathlib.Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript(SCHEMA)
    return db

def validate_config(config):
    if not isinstance(config, dict) or type(config.get('iterations')) is not int or not 1 <= config['iterations'] <= 100:
        raise ValueError('iterations must be between 1 and 100')
    tools = config.get('tools')
    if not isinstance(tools, list) or not tools or len(tools) > 32:
        raise ValueError('supply 1–32 tools')
    names = set()
    for tool in tools:
        if not isinstance(tool, dict) or not isinstance(tool.get('id'), str) or not tool['id'] or tool['id'] in names:
            raise ValueError('tool IDs must be unique nonempty strings')
        names.add(tool['id'])
        if tool.get('task') not in ('rating', 'object', 'other') or tool.get('input') not in ('image', 'text', 'multimodal'):
            raise ValueError('invalid tool task or input')
        if not isinstance(tool.get('model'), str) or not tool['model'] or not isinstance(tool.get('model_digest'), str) or not tool['model_digest']:
            raise ValueError('model and model_digest are required')
        argv = tool.get('argv')
        if not isinstance(argv, list) or not argv or not all(isinstance(v, str) and v for v in argv):
            raise ValueError('argv must be a nonempty list of strings')
    timeout = config.get('timeout_seconds', 180)
    if type(timeout) is not int or not 1 <= timeout <= 3600:
        raise ValueError('invalid timeout')
    return config

def snapshot_post(record):
    if type(record.get('post_id')) is not int or not isinstance(record.get('assets'), list):
        raise ValueError('invalid manifest record')
    if not isinstance(record.get('human_labels',[]),list):
        raise ValueError('invalid human label list')
    # Preserve unavailable and partial assets; never turn a model suggestion into a label.
    assets = []
    for asset in record['assets']:
        if not isinstance(asset, dict):
            raise ValueError('invalid asset')
        assets.append({k: asset.get(k) for k in ('index', 'role', 'kind', 'source_url', 'status', 'sha256', 'size', 'mime', 'error')})
    return {'post_id':record['post_id'], 'public_id':record.get('public_id'), 'title':record.get('title',''), 'text':record.get('text',''), 'source_url':record.get('source_url'), 'assets':assets, 'human_labels':record.get('human_labels',[])}

def create(db, name, manifest, config, limit=0):
    if limit < 0: raise ValueError('limit cannot be negative')
    config = json.loads(canonical(validate_config(config)))
    for tool in config['tools']:
        files=[]
        for index,arg in enumerate(tool['argv']):
            candidate=shutil.which(arg) if index==0 else arg
            if candidate and pathlib.Path(candidate).is_file():
                files.append({'argument_index':index,'path':str(pathlib.Path(candidate).resolve()),'sha256':digest(pathlib.Path(candidate).read_bytes())})
        if not files:
            raise ValueError('tool executable must exist when the battery is created')
        tool['file_digests']=files
    raw = pathlib.Path(manifest).read_bytes()
    posts = [snapshot_post(json.loads(line)) for line in raw.splitlines() if line.strip()]
    if limit:
        posts = posts[:limit]
    if not posts:
        raise ValueError('manifest contains no posts')
    host = host_info()
    with db:
        run = db.execute('INSERT INTO batteries(name,manifest_sha256,config,host) VALUES(?,?,?,?) RETURNING id', (name,digest(raw),canonical(config),canonical(host))).fetchone()[0]
        for post in posts:
            payload = canonical(post)
            input_hash = digest(canonical({k:v for k,v in post.items() if k != 'human_labels'}).encode())
            # Stable grouping by post prevents different images from leaking across splits.
            split = 'held_out' if int(digest(str(post['post_id']).encode())[:8],16) % 5 == 0 else 'development'
            item = db.execute('INSERT INTO inputs(battery_id,post_id,input_sha256,payload,split) VALUES(?,?,?,?,?) RETURNING id', (run,post['post_id'],input_hash,payload,split)).fetchone()[0]
            for tool in config['tools']:
                for iteration in range(1,config['iterations']+1):
                    db.execute('INSERT INTO jobs(battery_id,input_id,tool_id,iteration) VALUES(?,?,?,?)',(run,item,tool['id'],iteration))
    return run

def cached_image(asset, cache, site):
    sha = asset.get('sha256')
    if not isinstance(sha,str) or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):
        raise ValueError('image has no valid content hash')
    cache = pathlib.Path(cache)
    cache.mkdir(mode=0o700,parents=True,exist_ok=True)
    target = cache/sha
    if target.exists():
        if digest(target.read_bytes()) != sha:
            raise ValueError('cached image hash mismatch')
        return str(target)
    origin = urllib.parse.urlparse(site)
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path not in ('','/'):
        raise ValueError('archive origin must be an HTTPS origin')
    url = site.rstrip('/')+'/archived-media?'+urllib.parse.urlencode({'src':asset['source_url']})
    request = urllib.request.Request(url,headers={'User-Agent':'Swartzit-battery/1'})
    name = None
    try:
        # Redirects are deliberately disabled: a miss must not download from X.
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:
            if not response.headers.get('Content-Type','').startswith('image/'):
                raise ValueError('archive returned a non-image')
            h = hashlib.sha256(); size = 0
            with tempfile.NamedTemporaryFile(dir=cache,prefix='.partial-',delete=False) as output:
                name = output.name
                while chunk := response.read(262144):
                    size += len(chunk)
                    if size > 50*1024*1024:
                        raise ValueError('image exceeds benchmark limit')
                    h.update(chunk); output.write(chunk)
                output.flush(); os.fsync(output.fileno())
        if h.hexdigest() != sha or (asset.get('size') is not None and size != asset['size']):
            raise ValueError('archive image checksum or size mismatch')
        os.replace(name,target); name = None
        return str(target)
    finally:
        if name:
            pathlib.Path(name).unlink(missing_ok=True)

def prepare(post, tool, cache, site):
    selected = [a for a in post['assets'] if a.get('role') == 'src' and a.get('kind') == 'image' and a.get('status') == 'ready']
    all_media = [a for a in post['assets'] if a.get('role') == 'src']
    paths = []
    if tool['input'] in ('image','multimodal'):
        if not selected:
            raise ValueError('no verified archived image')
        # Single-image adapters must not claim coverage of a multi-attachment post.
        paths = [cached_image(selected[0],cache,site)]
    complete = len(all_media) == len(selected) == len(paths) if tool['input'] in ('image','multimodal') else not all_media
    if tool['input'] == 'image' and (post.get('text') or post.get('title')):
        complete = False
    if tool['input'] in ('multimodal','text') and len(post.get('text','')) > 8000:
        complete = False
    # Ground truth must never be included in an adapter's input.
    input_post={key:value for key,value in post.items() if key!='human_labels'}
    return {'post':input_post, 'images':paths, 'coverage':{'complete':complete,'image_count':len(paths),'attachment_count':len(all_media)}, 'tool':tool}

def execute(db, run, cache, site, max_jobs=0, retry_errors=False):
    if max_jobs < 0: raise ValueError('max_jobs cannot be negative')
    row = db.execute('SELECT config FROM batteries WHERE id=?',(run,)).fetchone()
    if not row:
        raise ValueError('battery not found')
    config = validate_config(json.loads(row[0])); tools = {x['id']:x for x in config['tools']}
    states = ('pending','error') if retry_errors else ('pending',)
    marks = ','.join('?' for _ in states)
    rows = db.execute(f'SELECT j.id,j.tool_id,j.iteration,i.payload,i.input_sha256 FROM jobs j JOIN inputs i ON i.id=j.input_id WHERE j.battery_id=? AND j.status IN ({marks}) ORDER BY j.id',(run,*states)).fetchall()
    if max_jobs:
        rows = rows[:max_jobs]
    for job, tool_id, iteration, raw, input_sha in rows:
        start = time.perf_counter(); preparation_ms = None; wall_ms = None
        try:
            for file in tools[tool_id]['file_digests']:
                index=file.get('argument_index')
                if index is None:
                    argv=tools[tool_id]['argv']; index=next((i for i,arg in enumerate(argv) if (candidate:=shutil.which(arg) if i==0 else arg) and str(pathlib.Path(candidate).resolve())==file['path']),None)
                if index is None: raise ValueError('adapter path changed')
                arg=tools[tool_id]['argv'][index]; candidate=shutil.which(arg) if index==0 else arg
                if not candidate or str(pathlib.Path(candidate).resolve())!=file['path'] or digest(pathlib.Path(file['path']).read_bytes()) != file['sha256']:
                    raise ValueError('adapter executable or input file changed')
            request = prepare(json.loads(raw),tools[tool_id],cache,site)
            request.update({'input_sha256':input_sha,'iteration':iteration})
            preparation_ms = (time.perf_counter()-start)*1000
            start = time.perf_counter()
            result = subprocess.run(tools[tool_id]['argv'],input=canonical(request),text=True,capture_output=True,timeout=config.get('timeout_seconds',180),check=True)
            wall_ms = (time.perf_counter()-start)*1000
            if len(result.stdout.encode()) > 100000:
                raise ValueError('adapter output too large')
            value = json.loads(result.stdout)
            if not isinstance(value,dict):
                raise ValueError('adapter must return a JSON object')
            status='done'; error=None; result_json=canonical({'output':value,'coverage':request['coverage']})
        except Exception as exc:
            status='error'; result_json=None
            if isinstance(exc,ValueError): error='ValueError: '+str(exc)[:200]
            elif isinstance(exc,urllib.error.HTTPError): error='Archive HTTP '+str(exc.code)
            elif isinstance(exc,subprocess.CalledProcessError): error='Adapter exit '+str(exc.returncode)
            else: error=type(exc).__name__
        with db:
            db.execute('INSERT INTO attempts(job_id,status,result,error,preparation_ms,wall_ms) VALUES(?,?,?,?,?,?)',(job,status,result_json,error,preparation_ms,wall_ms))
            db.execute('UPDATE jobs SET status=? WHERE id=?',(status,job))
    return len(rows)

def summary(db, run):
    row=db.execute('SELECT name,manifest_sha256,config,host FROM batteries WHERE id=?',(run,)).fetchone()
    if not row: raise ValueError('battery not found')
    config=json.loads(row[2]); result={'run':run,'name':row[0],'manifest_sha256':row[1],'host':json.loads(row[3]),'splits':dict(db.execute('SELECT split,count(*) FROM inputs WHERE battery_id=? GROUP BY split',(run,)).fetchall()),'tools':[],'comparisons':[]}
    matched={}
    for tool in config['tools']:
        counts=dict(db.execute('SELECT status,count(*) FROM jobs WHERE battery_id=? AND tool_id=? GROUP BY status',(run,tool['id'])).fetchall())
        rows=db.execute("SELECT j.input_id,j.iteration,a.wall_ms,a.preparation_ms,a.result,i.payload,i.split FROM jobs j JOIN inputs i ON i.id=j.input_id JOIN attempts a ON a.id=(SELECT max(a2.id) FROM attempts a2 WHERE a2.job_id=j.id) WHERE j.battery_id=? AND j.tool_id=? AND j.status='done'",(run,tool['id'])).fetchall()
        matched[tool['id']]={(r[0],r[1]) for r in rows}
        times=[r[2] for r in rows if r[2] is not None]; prep=[r[3] for r in rows if r[3] is not None]
        partial=sum(not json.loads(r[4])['coverage']['complete'] for r in rows)
        metric_values={}
        for record in rows:
            metrics=json.loads(record[4])['output'].get('metrics',{})
            if not isinstance(metrics,dict): continue
            for key,value in metrics.items():
                if type(value) in (int,float) and value>=0: metric_values.setdefault(key,[]).append(value)
        errors=db.execute("SELECT coalesce(a.error,'unknown'),count(*) FROM jobs j JOIN attempts a ON a.id=(SELECT max(a2.id) FROM attempts a2 WHERE a2.job_id=j.id) WHERE j.battery_id=? AND j.tool_id=? AND j.status='error' GROUP BY a.error",(run,tool['id'])).fetchall()
        duration=sum((r[2] or 0)+(r[3] or 0) for r in rows)
        entry={'id':tool['id'],'task':tool['task'],'model':tool['model'],'counts':counts,'errors':dict(errors),'partial_coverage':partial,'median_adapter_wall_ms':round(statistics.median(times),2) if times else None,'median_cache_preparation_ms':round(statistics.median(prep),2) if prep else None,'measured_adapter_and_preparation_jobs_per_second':round(len(rows)*1000/duration,3) if duration else None,'median_model_metrics':{key:round(statistics.median(values),2) for key,values in metric_values.items()}}
        if tool['task']=='rating':
            classes=('general','r','x'); matrix={actual:{predicted:0 for predicted in classes} for actual in classes}; uncertain=0
            for _,iteration,_,_,raw_output,raw_input,split in rows:
                if split!='held_out' or iteration!=1: continue
                value=json.loads(raw_output); post=json.loads(raw_input); labels=post.get('human_labels',[]); output=value['output']
                if not labels or not labels[0].get('snapshot_verified') or not value['coverage']['complete'] or not tool.get('policy_version') or tool['policy_version']!=labels[0].get('policy_version'): continue
                expected=labels[0].get('artifact_sha256',[]); actual=labels[0].get('label'); predicted=output.get('rating'); prepared=output.get('prepared_image_sha256')
                image_match=len(expected)==1 and prepared and expected[0]==prepared
                text_match=tool['input']=='text' and not expected and not prepared and value['coverage']['attachment_count']==0
                if not (image_match or text_match) or actual not in classes or predicted not in classes: continue
                matrix[actual][predicted]+=1; uncertain+=output.get('uncertain') is True
            total=sum(sum(row.values()) for row in matrix.values())
            per_class={}
            for label in classes:
                tp=matrix[label][label]; predicted=sum(matrix[a][label] for a in classes); actual=sum(matrix[label].values())
                per_class[label]={'precision':tp/predicted if predicted else None,'recall':tp/actual if actual else None,'support':actual}
            entry['held_out_human_accuracy']={'samples':total,'confusion_matrix':matrix,'per_class':per_class,'uncertain':uncertain,'iteration':1} if total else {'samples':0,'status':'No matching held-out human-reviewed content and image inputs.'}
        result['tools'].append(entry)
    for index,left in enumerate(config['tools']):
        for right in config['tools'][index+1:]:
            result['comparisons'].append({'tools':[left['id'],right['id']],'matched_post_iterations':len(matched[left['id']] & matched[right['id']]),'same_task':left['task']==right['task']})
    return result

def compare(db, left, right):
    configurations=[]
    for run in (left,right):
        row=db.execute('SELECT config FROM batteries WHERE id=?',(run,)).fetchone()
        if not row: raise ValueError('battery not found')
        configurations.append(validate_config(json.loads(row[0])))
    comparisons=[]
    for left_tool in configurations[0]['tools']:
        for right_tool in configurations[1]['tools']:
            if left_tool['task']!=right_tool['task']: continue
            def measurements(run,tool):
                rows=db.execute("SELECT i.input_sha256,j.iteration,a.wall_ms FROM jobs j JOIN inputs i ON i.id=j.input_id JOIN attempts a ON a.id=(SELECT max(a2.id) FROM attempts a2 WHERE a2.job_id=j.id) WHERE j.battery_id=? AND j.tool_id=? AND j.status='done'",(run,tool)).fetchall()
                return {(h,iteration):wall for h,iteration,wall in rows if wall is not None}
            before=measurements(left,left_tool['id']); after=measurements(right,right_tool['id']); keys=before.keys() & after.keys()
            comparisons.append({'left_tool':left_tool['id'],'right_tool':right_tool['id'],'task':left_tool['task'],'left_input':left_tool['input'],'right_input':right_tool['input'],'same_configuration':canonical(left_tool)==canonical(right_tool),'matched_post_iterations':len(keys),'left_median_adapter_wall_ms':round(statistics.median(before[k] for k in keys),2) if keys else None,'right_median_adapter_wall_ms':round(statistics.median(after[k] for k in keys),2) if keys else None})
    return {'left_run':left,'right_run':right,'comparisons':comparisons}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--db',required=True); subs=p.add_subparsers(dest='command',required=True)
    new=subs.add_parser('create'); new.add_argument('--manifest',required=True); new.add_argument('--config',required=True); new.add_argument('--name',required=True); new.add_argument('--limit',type=int,default=0)
    run=subs.add_parser('run'); run.add_argument('--id',type=int,required=True); run.add_argument('--cache',required=True); run.add_argument('--archive-site',required=True); run.add_argument('--max-jobs',type=int,default=0); run.add_argument('--retry-errors',action='store_true')
    report=subs.add_parser('summary'); report.add_argument('--id',type=int,required=True)
    diff=subs.add_parser('compare'); diff.add_argument('--left',type=int,required=True); diff.add_argument('--right',type=int,required=True)
    args=p.parse_args(); db=connect(args.db)
    if args.command=='create': print(json.dumps({'battery_id':create(db,args.name,args.manifest,json.loads(pathlib.Path(args.config).read_text()),args.limit)}))
    elif args.command=='run':
        lock_path=pathlib.Path(args.db).with_name(pathlib.Path(args.db).name+'.lock')
        with lock_path.open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            print(json.dumps({'processed':execute(db,args.id,args.cache,args.archive_site,args.max_jobs,args.retry_errors)}))
    elif args.command=='summary': print(json.dumps(summary(db,args.id),indent=2))
    else: print(json.dumps(compare(db,args.left,args.right),indent=2))
if __name__=='__main__': main()
