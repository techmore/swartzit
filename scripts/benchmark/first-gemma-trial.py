#!/usr/bin/env python3
"""Run one bounded local Gemma/Qwen video trial once setup and memory permit."""
import argparse, json, os, pathlib, subprocess, tempfile, time, uuid

ROOT=pathlib.Path.home()/'.local/share/swartzit-mobilenet-trial'

def memory_ready(model_size, text=None):
    if text is None: text=pathlib.Path('/proc/meminfo').read_text()
    fields={line.split(':',1)[0]:int(line.split()[1])*1024 for line in text.splitlines() if line.split(':',1)[0] in ('MemAvailable','SwapTotal','SwapFree')}
    total=fields.get('SwapTotal',0); free=fields.get('SwapFree',0)
    return fields.get('MemAvailable',0)>=model_size+4*1024**3 and (not total or free>=min(1024**3,total//4))

def select_video(manifest, output):
    with manifest.open(encoding='utf8') as source, output.open('x',encoding='utf8') as target:
        for line in source:
            post=json.loads(line)
            videos=[a for a in post['assets'] if a.get('role')=='src' and a.get('kind')=='video' and a.get('status')=='ready']
            if videos and 0<(videos[0].get('size') or 0)<=20*1024*1024:
                target.write(line); return
    raise ValueError('no cached video under 20 MiB is available')

def main():
    p=argparse.ArgumentParser(); p.add_argument('--max-wait',type=int,default=3600); p.add_argument('--poll',type=int,default=30); args=p.parse_args()
    if not 1<=args.max_wait<=7200 or not 1<=args.poll<=60: raise ValueError('invalid wait limits')
    os.umask(0o077); root=ROOT; model=root/'gemma-4-12B-it.litertlm'; gemma_python=root/'gemma-venv/bin/python'; python=root/'venv/bin/python'
    deadline=time.monotonic()+args.max_wait
    while time.monotonic()<deadline:
        setup_active=subprocess.run(['systemctl','--user','is-active','--quiet','swartzit-gemma-setup.service'],timeout=10).returncode==0
        if not setup_active and model.is_file() and gemma_python.is_file() and memory_ready(model.stat().st_size):
            break
        print('Waiting for the verified model, runtime, and available memory.',flush=True)
        time.sleep(min(args.poll,max(0,deadline-time.monotonic())))
    else: raise TimeoutError('Gemma model or memory reserve did not become available')
    subprocess.run(['incus','exec','swartzit','--','runuser','-u','swartzit','--','python3','/var/lib/swartzit/state/export-bookmark-media-manifest.py','--handle','techmore'],check=True,timeout=120)
    with tempfile.NamedTemporaryFile(dir=root,prefix='.first-gemma-source-',delete=False) as f:
        manifest=pathlib.Path(f.name)
        subprocess.run(['incus','exec','swartzit','--','runuser','-u','swartzit','--','cat','/var/lib/swartzit/state/bookmark-media-archive/manifest.jsonl'],stdout=f,check=True,timeout=120)
    token=uuid.uuid4().hex; sample=root/('gemma-first-sample-'+token+'.jsonl'); config=root/('gemma-first-config-'+token+'.json')
    try: select_video(manifest,sample)
    finally: manifest.unlink(missing_ok=True)
    subprocess.run([str(gemma_python),str(root/'configure-gemma.py'),'--output',str(config),'--input','multimodal_video','--frames','3','--iterations','1','--backend','cpu'],check=True,timeout=180)
    result=subprocess.run([str(python),str(root/'battery.py'),'--db',str(root/'batteries.sqlite'),'create','--manifest',str(sample),'--config',str(config),'--name','gemma-qwen-first-video','--media-kind','video','--ready-only','--limit','1'],capture_output=True,text=True,check=True,timeout=120)
    run=json.loads(result.stdout)['battery_id']; print(json.dumps({'battery_id':run}),flush=True)
    subprocess.run([str(python),str(root/'battery.py'),'--db',str(root/'batteries.sqlite'),'run','--id',str(run),'--cache',str(root/'battery-originals'),'--archive-site','https://swartzit.stoverparc.org'],check=True,timeout=2000)
    result=subprocess.run([str(python),str(root/'battery.py'),'--db',str(root/'batteries.sqlite'),'summary','--id',str(run)],capture_output=True,text=True,check=True,timeout=60)
    with (root/'gemma-first-trial-summary.json').open('w',encoding='utf8') as out: out.write(result.stdout)
    print(json.dumps({'battery_id':run,'summary':str(root/'gemma-first-trial-summary.json')}),flush=True)
    if any(tool['counts'].get('error',0) for tool in json.loads(result.stdout)['tools']):
        raise RuntimeError('one or more benchmark tools failed; see the saved summary')
if __name__=='__main__': main()
