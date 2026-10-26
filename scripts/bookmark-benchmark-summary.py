#!/usr/bin/env python3
"""Summarize local benchmark runs without exposing bookmark content."""
import json, os, pathlib, sqlite3, statistics
path=pathlib.Path(os.path.expanduser('~/.local/share/swartzit-mobilenet-trial/results.sqlite'))
c=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
runs=[]
for rid,name,start,end,config in c.execute('SELECT id,name,created_at,finished_at,config FROM runs ORDER BY id').fetchall():
 counts=dict(c.execute('SELECT status,count(*) FROM items WHERE run_id=? GROUP BY status',(rid,)).fetchall())
 tools={}
 for tool, in c.execute('SELECT DISTINCT tool FROM predictions WHERE run_id=?',(rid,)).fetchall():
  rows=c.execute('SELECT elapsed_ms,result_json FROM predictions WHERE run_id=? AND tool=?',(rid,tool)).fetchall()
  entry={'count':len(rows),'median_elapsed_ms':round(statistics.median(row[0] for row in rows),2)}
  if tool=='qwen':
   results=[json.loads(row[1]) for row in rows]
   def conflict(result):
    reasons=set(result.get('reasons',[])); return (result.get('rating')=='general' and bool(reasons & {'sexual_suggestiveness','nudity','sexual_activity','graphic_violence'})) or (result.get('rating')=='r' and bool(reasons & {'nudity','sexual_activity','graphic_violence'}))
   entry['policy_conflicts']=sum(conflict(result) for result in results)
   entry['ratings']={rating:sum(result.get('rating')==rating for result in results) for rating in ('general','r','x')}
  tools[tool]=entry
 runs.append({'run':rid,'name':name,'started_utc':start,'finished_utc':end,'counts':counts,'tools':tools,'config':json.loads(config)})
print(json.dumps({'runs':runs},indent=2))
