#!/usr/bin/env python3
"""Create a private starter battery configuration for the existing Ser8 models."""
import argparse, hashlib, json, os, pathlib, sys, urllib.request
p=argparse.ArgumentParser(); p.add_argument('--state',default=os.path.expanduser('~/.local/share/swartzit-mobilenet-trial')); p.add_argument('--output',required=True); p.add_argument('--iterations',type=int,default=2); args=p.parse_args()
if not 1<=args.iterations<=100: raise ValueError('iterations must be between 1 and 100')
root=pathlib.Path(args.state).resolve(); model=root/'mobilenet_v3_small-onnx-float/mobilenet_v3_small.onnx'; labels=model.parent/'labels.txt'; adapter=root/'adapters.py'; python=root/'venv/bin/python'
with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=10) as response: models=json.load(response)['models']
qwen=next(item['digest'] for item in models if item['name']=='qwen3.5:2b'); argv=[str(python),str(adapter)]
config={'iterations':args.iterations,'timeout_seconds':180,'tools':[{'id':'mobilenet','adapter':'mobilenet','task':'object','input':'image','model':'qualcomm/mobilenet-v3-small-onnx-float','model_digest':hashlib.sha256(model.read_bytes()+model.with_suffix('.data').read_bytes()).hexdigest(),'model_path':str(model),'labels_path':str(labels),'labels_sha256':hashlib.sha256(labels.read_bytes()).hexdigest(),'argv':argv},{'id':'qwen','adapter':'qwen','task':'rating','policy_version':'suggestive-r-explicit-x-v1','input':'multimodal','model':'qwen3.5:2b','model_digest':qwen,'argv':argv}]}
os.umask(0o077)
with open(args.output,'x',encoding='utf8') as output: json.dump(config,output,indent=2); output.write('\n')
print(json.dumps({'output':args.output,'iterations':args.iterations,'tools':[tool['id'] for tool in config['tools']]}))
