import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('host worker queues suggestions only and exports verified pixels with human labels', () => {
  const code = String.raw`
import importlib.util,sys,tempfile,pathlib,json,hashlib,os
spec=importlib.util.spec_from_file_location('worker',sys.argv[1]);w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
for bad in [{'rating':'safe','uncertain':False,'reasons':[]},{'rating':'general','uncertain':'false','reasons':[]}]:
 try:w.validate_decision(bad);raise AssertionError('accepted invalid decision')
 except ValueError:pass
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);cache=root/'cache';cache.mkdir()
 item={'post_id':1,'content_hash':'a'*64,'policy_version':w.POLICY_VERSION,'snapshot':{'body':'Ordinary material','media':[]}}
 calls=[]
 def request(url,data=None,token=None,method=None,**kwargs):
  calls.append((url,data,method))
  if url.endswith('/api/sessions'):return {'token':'test'} if method!='DELETE' else None
  if url.endswith('/api/tags'):return {'models':[{'name':'qwen3.5:4b','digest':'a'*64}]}
  if url.endswith('/candidates'):return {'items':[item]}
  if url.endswith('/api/chat'):return {'message':{'content':json.dumps({'rating':'general','uncertain':False,'reasons':['ordinary_content']})}}
  if url.endswith('/rating-reviews'):return {'id':1}
  raise AssertionError('Unexpected write or read: '+url)
 w.read_json=request;os.environ.update(SCHEDULER_HANDLE='test',SCHEDULER_PASSWORD='test');sys.argv=['worker','--state-dir',str(root/'state')]
 w.main()
 assert not any('/decision' in url or 'content-rating' in url for url,_,_ in calls)
 proposal=next(data for url,data,_ in calls if url.endswith('/rating-reviews'))
 assert proposal['proposed_rating']=='general' and proposal['model']=='qwen3.5:4b' and 'label_source' not in proposal
 video={'snapshot':{'body':'','media':[{'kind':'video','src':'https://video.twimg.com/a.mp4'}]}}
 rating,details,artifacts=w.review(video,'https://example.test','http://127.0.0.1:11434','qwen',cache)
 assert rating is None and details['coverage_partial']
 for rating,reasons in [('general',['nudity']),('general',['sexual_suggestiveness']),('general',['strong_language']),('r',['graphic_violence'])]:
  w.read_json=lambda *args,**kwargs:{'message':{'content':json.dumps({'rating':rating,'uncertain':False,'reasons':reasons})}}
  decision,details,_=w.review(item,'https://example.test','http://127.0.0.1:11434','qwen',cache)
  assert decision is None and details['policy_conflict'] and details['uncertain']
 image=b'captured training pixels';digest=hashlib.sha256(image).hexdigest();(cache/(digest+'.jpg')).write_bytes(image)
 row={'label_source':'human','label':'r','artifacts':[{'sha256':digest,'cache_key':digest+'.jpg'}]}
 w.read_json=lambda *args,**kwargs:{'items':[row],'has_more':False}
 destination=root/'export';assert w.export_training('https://example.test','test',cache,destination)==1
 saved=json.loads((destination/'labels.jsonl').read_text());assert saved['label']=='r'
 assert (destination/saved['image_files'][0]).read_bytes()==image
`;
  const result=spawnSync('python3',['-',new URL('./rating-review-worker.py',import.meta.url).pathname],{input:code,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
