// Read an existing Hermes archive or Daddario manifest. Never invokes Signal.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const archive=option('--archive'), manifest=option('--manifest');
const author=option('--author')?.replace(/^@/,'').toLowerCase();
if(author && (!archive || !/^[a-z0-9_]{1,15}$/.test(author)))throw new Error('--author requires --archive and a valid X handle');
const limit=Number(option('--limit')??20);
if ((!archive && !manifest) || (archive && manifest) || !Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Use --archive DIR or --manifest FILE, with --limit 1..100');
const community=option('--community')??(archive?'x_imports':'alexandra_daddario');
const items=[];
const plain=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim();
const metric=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const bounded=(s,max)=>{let result='';for(const c of s){if(Buffer.byteLength(result+c)>max)break;result+=c;}return result;};
if(archive) {
  const files=(await readdir(archive)).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>{const x=BigInt(a.slice(0,-5)),y=BigInt(b.slice(0,-5));return x===y?0:x>y?-1:1;});
  for(const file of files) {
    if(items.length>=limit) break;
    const p=JSON.parse(await readFile(join(archive,file),'utf8'));
    if(!p.url || !p.text || p.error) continue;
    if(author && String(p.handle??'').replace(/^@/,'').toLowerCase()!==author)continue;
    items.push({community,provider:'x',source_url:p.url,source_author:bounded(p.handle||p.display||'Unknown source author',200),title:bounded((p.display||p.handle||'From X')+': '+p.text.slice(0,180),300),body:p.text,
      published_at:p.time||null, observed_at:p.scrapedAt?new Date(p.scrapedAt*1000).toISOString():null,
      source_views:metric(p.views),source_likes:metric(p.likes),source_reposts:metric(p.reposts),source_replies:metric(p.replies),
      media:(p.media??[]).filter(u=>typeof u==='string'&&u.startsWith('https://pbs.twimg.com/')).slice(0,8),
      attribution:p.isVideo?'Source includes a video; open the original to watch it.':''});
  }
} else {
  const entries=Object.values(JSON.parse(await readFile(manifest,'utf8')));
  const seen=new Set();
  for(const entry of entries) {
    if(items.length>=limit) break;
    let u; try{u=new URL(entry.source);}catch{continue;}
    if(u.hostname!=='upload.wikimedia.org') continue;
    const parts=u.pathname.split('/'), index=parts.indexOf('commons');
    if(index<0)continue;
    const file=decodeURIComponent(parts[index+(parts[index+1]==='thumb'?4:3)]??'');
    if(!file || seen.has(file))continue;
    seen.add(file);
    const query=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'extmetadata',titles:'File:'+file});
    const r=await fetch('https://commons.wikimedia.org/w/api.php?'+query,{headers:{'user-agent':'Swartzit/0.1 (public Commons metadata import)'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('Commons metadata unavailable: '+r.status);
    const json=await r.json(), metadata=Object.values(json.query?.pages??{})[0]?.imageinfo?.[0]?.extmetadata;
    const license=plain(metadata?.LicenseShortName?.value);
    if(!/^(CC BY(?:-SA)? |CC0|Public domain)/i.test(license)) {console.error('Skipped file without a supported reusable license: '+file);continue;}
    const artist=plain(metadata?.Artist?.value);
    if(!artist)continue;
    items.push({community,provider:'commons',source_url:'https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file),source_author:bounded(artist,200),title:bounded('Alexandra Daddario — '+file.replace(/\.[^.]+$/,''),300),
      body:'A publicly sourced photograph of Alexandra Daddario. See the original file page for full credits and license terms.',
      published_at:null,observed_at:new Date().toISOString(),media:[entry.source],
      attribution:artist+' · '+license+' · '+plain(metadata?.LicenseUrl?.value)});
  }
}
// Missing capture dates must be supplied by the operator, not invented as now.
if(items.some(p=>!p.observed_at)) throw new Error('Some source records have no capture timestamp. Supply observed_at before importing.');
console.log(JSON.stringify(items,null,2));
