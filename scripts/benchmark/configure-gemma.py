#!/usr/bin/env python3
"""Create a pinned Gemma/Qwen battery for cached images or sampled videos."""
import argparse, hashlib, importlib.metadata, json, os, pathlib, urllib.request
p=argparse.ArgumentParser(); p.add_argument('--state',default=os.path.expanduser('~/.local/share/swartzit-mobilenet-trial')); p.add_argument('--output',required=True); p.add_argument('--iterations',type=int,default=2); p.add_argument('--input',choices=['image','multimodal','video','multimodal_video'],default='multimodal_video'); p.add_argument('--frames',type=int,default=3); p.add_argument('--backend',choices=['cpu','gpu'],default='cpu'); args=p.parse_args()
if not 1<=args.iterations<=100 or not 1<=args.frames<=8: raise ValueError('invalid iterations or frames')
root=pathlib.Path(args.state).resolve(); model=root/'gemma-4-12B-it.litertlm'; adapter=root/'adapters-video-gemma-v2.py'; python=root/'gemma-venv/bin/python'; h=hashlib.sha256()
if not adapter.is_file() or not python.is_file(): raise ValueError('install the versioned adapter and Gemma runtime first')
with model.open('rb') as source:
 while chunk:=source.read(1024*1024): h.update(chunk)
digest=h.hexdigest(); expected='58fd31b778ca2c21c80d634fb34fc5a89d11d563a38dfd3cbf1b40dbf252a8b6'
if digest!=expected: raise ValueError('model does not match the pinned Gemma 4 12B release')
version=importlib.metadata.version('litert-lm-api')
with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=10) as response: models=json.load(response)['models']
qwen=next(item['digest'] for item in models if item['name']=='qwen3.5:2b'); policy='suggestive-r-explicit-x-v1'
tools=[{'id':'gemma-4-12b','adapter':'gemma-litert','task':'rating','policy_version':policy,'input':args.input,'video_frames':args.frames,'model':'litert-community/gemma-4-12B-it-litert-lm','model_path':str(model),'model_digest':digest,'runtime_version':version,'backend':args.backend,'argv':[str(python),str(adapter)]},{'id':'qwen','adapter':'qwen','task':'rating','policy_version':policy,'input':args.input,'video_frames':args.frames,'model':'qwen3.5:2b','model_digest':qwen,'argv':[str(root/'venv/bin/python'),str(adapter)]}]
os.umask(0o077)
with open(args.output,'x',encoding='utf8') as out: json.dump({'iterations':args.iterations,'timeout_seconds':900,'tools':tools},out,indent=2); out.write('\n')
print(json.dumps({'output':args.output,'models':[x['id'] for x in tools],'input':args.input,'frames':args.frames,'backend':args.backend}))
