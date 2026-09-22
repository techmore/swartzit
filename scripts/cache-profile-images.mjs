// Cache only public X profile images already referenced by imported posts.
// The server serves these files from /profile-images/:post_id.
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const api=process.env.API_URL??'http://127.0.0.1:8080';
const root=process.env.PROFILE_IMAGE_CACHE_DIR??'.local/profile-cache';
const limit=Math.max(1,Math.min(Number(process.env.PROFILE_IMAGE_LIMIT??500),5000));
const trusted=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='pbs.twimg.com'&&!u.username&&!u.password&&!u.port&&u.pathname.includes('/profile_images/');}catch{return false;}};
const response=await fetch(`${api}/api/posts?page=1`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error(`Could not read posts: HTTP ${response.status}`);
const first=await response.json(); const posts=[...(first.posts??[])];
for(let page=2; first.has_more && posts.length<limit; page++) { const r=await fetch(`${api}/api/posts?page=${page}`,{signal:AbortSignal.timeout(15000)}); if(!r.ok)break; const data=await r.json(); posts.push(...(data.posts??[])); if(!data.has_more)break; }
await mkdir(root,{recursive:true}); let cached=0, skipped=0;
for(const post of posts.slice(0,limit)) {
  const url=post.source?.profile_image_url; const id=post.source?.post_id;
  if(!post.source || post.source.provider!=='x' || !url || !id || !trusted(url)){skipped++;continue;}
  const existing=(await readdir(root)).find(name=>name.startsWith(`${id}.`)); if(existing)continue;
  const r=await fetch(url,{headers:{accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'user-agent':'Swartzit profile image cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok) { console.error(`Skipped ${id}: HTTP ${r.status}`); continue; }
  const type=(r.headers.get('content-type')??'').split(';',1)[0].toLowerCase(); const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif' }[type];
  const bytes=Buffer.from(await r.arrayBuffer()); if(!ext || bytes.length>1024*1024){console.error(`Skipped ${id}: unsupported type or size`);continue;}
  const tmp=join(root,`.${id}.tmp`); await writeFile(tmp,bytes,{flag:'wx'}).catch(()=>null); await rename(tmp,join(root,`${id}.${ext}`)).catch(()=>{}); cached++;
}
console.log(JSON.stringify({posts:posts.length,cached,skipped,cache:root}));
