// Cache only public X profile images already referenced by imported posts.
// The server serves these files from /profile-images/:post_id.
import { mkdir, readdir, rename, writeFile, link, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
const api=process.env.API_URL??'http://127.0.0.1:8080';
const root=process.env.PROFILE_IMAGE_CACHE_DIR??'.local/profile-cache';
const limit=Math.max(1,Math.min(Number(process.env.PROFILE_IMAGE_LIMIT??500),5000));
const trusted=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='pbs.twimg.com'&&!u.username&&!u.password&&!u.port&&u.pathname.includes('/profile_images/');}catch{return false;}};
const response=await fetch(`${api}/api/posts?page=1`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error(`Could not read posts: HTTP ${response.status}`);
const first=await response.json(); const posts=[...(first.posts??[])];
for(let page=2; first.has_more && posts.length<limit; page++) { const r=await fetch(`${api}/api/posts?page=${page}`,{signal:AbortSignal.timeout(15000)}); if(!r.ok)break; const data=await r.json(); posts.push(...(data.posts??[])); if(!data.has_more)break; }
await mkdir(root,{recursive:true}); let cached=0, reused=0, skipped=0;
const files=await readdir(root);
const byUrl=new Map();
const avatarKey=url=>createHash('sha256').update(url).digest('hex').slice(0,24);
const existingFor=id=>files.find(name=>name.startsWith(`${id}.`)&&!name.startsWith('.'));
async function attach(source,id) {
  const ext=source.slice(source.lastIndexOf('.')).toLowerCase().split('?')[0];
  const canonical=byUrl.get(source);
  if (!canonical) return false;
  const target=join(root,`${id}${ext}`);
  if (existingFor(id)) return true;
  try { await link(canonical,target); } catch { await copyFile(canonical,target); }
  files.push(`${id}${ext}`); reused++; return true;
}
for(const post of posts.slice(0,limit)) {
  const url=post.source?.profile_image_url; const id=post.source?.post_id;
  if(!post.source || post.source.provider!=='x' || !url || !id || !trusted(url)){skipped++;continue;}
  const existing=existingFor(id); if(existing){byUrl.set(url,join(root,existing));continue;}
  if(await attach(url,id))continue;
  const key=avatarKey(url);
  const r=await fetch(url,{headers:{accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'user-agent':'Swartzit profile image cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok) { console.error(`Skipped ${id}: HTTP ${r.status}`); continue; }
  const type=(r.headers.get('content-type')??'').split(';',1)[0].toLowerCase(); const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif' }[type];
  const bytes=Buffer.from(await r.arrayBuffer()); if(!ext || bytes.length>1024*1024){console.error(`Skipped ${id}: unsupported type or size`);continue;}
  const canonical=join(root,`.avatar-${key}.${ext}`); const tmp=canonical+'.tmp';
  await writeFile(tmp,bytes,{flag:'wx'}).catch(()=>null); await rename(tmp,canonical).catch(()=>{});
  byUrl.set(url,canonical);
  await attach(url,id); cached++;
}
console.log(JSON.stringify({posts:posts.length,cached,reused,skipped,cache:root}));
