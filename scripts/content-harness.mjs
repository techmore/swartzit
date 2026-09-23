#!/usr/bin/env node
// Normalize browser captures, fingerprint media, and choose safe reruns.
// This file is deliberately independent from the browser driver: FluidUse (or
// the current signed-in browser bookmarklet) supplies JSON, and this harness
// makes the result deterministic and idempotent.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enrichX} from './x-media.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export function canonicalSourceUrl(provider, raw) {
  const u=new URL(raw);
  u.hash='';
  u.search='';
  if (provider==='x') {
    const m=u.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/);
    if (!m || !['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)) throw new Error(`Invalid X source URL: ${raw}`);
    return `https://x.com/i/status/${m[2]}`;
  }
  return u.toString().replace(/\/$/,'');
}

export function hashBytes(bytes, algorithm='sha256') {
  return createHash(algorithm).update(bytes).digest('hex');
}

export function normalizeMedia(media=[]) {
  return media.map(item=>typeof item==='string'?{kind:'image',src:item}:item)
    .filter(item=>item && typeof item.src==='string')
    .map(item=>({kind:item.kind??'image',src:item.src, ...(item.poster?{poster:item.poster}:{}), ...(item.alt?{alt:item.alt}:{}), ...(item.md5?{md5:item.md5}:{}), ...(item.sha256?{sha256:item.sha256}:{})}));
}

export function normalizeRecord(record) {
  const provider=String(record.provider??'x').toLowerCase();
  const source_url=canonicalSourceUrl(provider,record.source_url);
  const media=normalizeMedia(record.media);
  const media_hashes=[...(record.media_hashes??[]),...media.flatMap(m=>[m.md5,m.sha256]).filter(Boolean)];
  return {...record,provider,source_url,media,media_hashes:[...new Set(media_hashes)].sort(),observed_at:new Date(record.observed_at??Date.now()).toISOString()};
}

export function selectRerunCandidates(records,{usedSources=[],usedMediaHashes=[],limit=10,seed='default'}={}) {
  const sourceSet=new Set(usedSources.map(String));
  const mediaSet=new Set(usedMediaHashes.map(String));
  const candidates=records.map(normalizeRecord).filter(item=>!sourceSet.has(item.source_url)&&!item.media_hashes.some(h=>mediaSet.has(h)));
  // Seeded Fisher-Yates means a scheduled rerun can be reproduced and tested.
  let state=hashBytes(seed,'sha256').slice(0,8); const rand=()=>{state=hashBytes(state,'sha256').slice(0,8);return parseInt(state,16)/0x100000000;};
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  return candidates.slice(0,limit);
}

export async function fingerprintMedia(record,{fetchMedia=false,timeoutMs=12000}={}) {
  const normalized=normalizeRecord(record);
  const media=await Promise.all(normalized.media.map(async item=>{
    if(!fetchMedia || item.md5 || item.sha256) return item;
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetch(item.src,{signal:controller.signal});
      if(!response.ok) return item;
      const bytes=Buffer.from(await response.arrayBuffer());
      return {...item,md5:hashBytes(bytes,'md5'),sha256:hashBytes(bytes,'sha256')};
    } catch { return item; } finally { clearTimeout(timer); }
  }));
  const media_hashes=[...new Set(media.flatMap(m=>[m.md5,m.sha256]).filter(Boolean))].sort();
  return {...normalized,media,media_hashes};
}

export async function readState(path) {
  try { const state=JSON.parse(await readFile(path,'utf8')); return {usedSources:[],usedMediaHashes:[],...state}; }
  catch(e) { if(e.code==='ENOENT') return {usedSources:[],usedMediaHashes:[]}; throw e; }
}

export async function writeState(path,state) {
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify({usedSources:[...new Set(state.usedSources??[])].sort(),usedMediaHashes:[...new Set(state.usedMediaHashes??[])].sort(),updated_at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
}

function option(args,name) { const i=args.indexOf(name); return i<0?undefined:args[i+1]; }
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), input=option(args,'--input'), output=option(args,'--output'), statePath=resolve(root,option(args,'--state')??'.local/content-harness-state.json');
  if(!input || !output) throw new Error('Usage: node scripts/content-harness.mjs --input FILE --output FILE [--state FILE] [--limit N] [--seed VALUE] [--fingerprint]');
  const state=await readState(statePath), raw=JSON.parse(await readFile(resolve(root,input),'utf8'));
  if(!Array.isArray(raw)) throw new Error('Input must be a JSON array');
  const prepare=async items=>{const records=[],errors=[];for(const item of items){try{const enriched=args.includes('--enrich-x')&&item.provider==='x'?await enrichX(item):item;records.push(await fingerprintMedia(enriched,{fetchMedia:args.includes('--fingerprint')}));}catch(error){errors.push({source_url:item.source_url,error:String(error.message??error)});}}return {records,errors};};
  const contains=option(args,'--contains'),postContains=option(args,'--post-contains');
  const sourceRecords=raw.filter(item=>{
    const text=`${item.title??''}\n${item.body??''}`;
    const postText=String(item.body??'').split('\n').slice(4).join('\n');
    return (!contains||new RegExp(contains,'i').test(text))&&(!postContains||new RegExp(postContains,'i').test(postText));
  });
  const prepared=await prepare(sourceRecords),records=prepared.records;
  let bootstrap=[]; const bootstrapPath=option(args,'--bootstrap');
  let bootstrapErrors=[];
  if(bootstrapPath){const value=JSON.parse(await readFile(resolve(root,bootstrapPath),'utf8'));if(!Array.isArray(value))throw new Error('Bootstrap must be a JSON array');const preparedBootstrap=await prepare(value);bootstrap=preparedBootstrap.records;bootstrapErrors=preparedBootstrap.errors;}
  const usedSources=[...state.usedSources,...bootstrap.map(x=>x.source_url)],usedMediaHashes=[...state.usedMediaHashes,...bootstrap.flatMap(x=>x.media_hashes)];
  const selected=selectRerunCandidates(records,{usedSources,usedMediaHashes,limit:Number(option(args,'--limit')??records.length),seed:option(args,'--seed')??new Date().toISOString().slice(0,10)});
  if(args.includes('--mark-selected')) await writeState(statePath,{usedSources:[...usedSources,...selected.map(x=>x.source_url)],usedMediaHashes:[...usedMediaHashes,...selected.flatMap(x=>x.media_hashes)]});
  await mkdir(dirname(resolve(root,output)),{recursive:true}); await writeFile(resolve(root,output),JSON.stringify(selected,null,2)+'\n');
  console.log(JSON.stringify({input:raw.length,matched:sourceRecords.length,bootstrap:bootstrap.length,eligible:records.length,selected:selected.length,duplicate_or_used:records.length-selected.length,errors:[...prepared.errors,...bootstrapErrors],output}));
}
