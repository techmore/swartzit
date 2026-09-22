import {readFile} from 'node:fs/promises';
import {enrichX} from './x-media.mjs';
const base=process.env.API_URL??'http://127.0.0.1:18080';
const env=await readFile('.local/import-scheduler.env','utf8');
const values=Object.fromEntries(env.split('\n').map(l=>l.match(/^\s*(SCHEDULER_HANDLE|SCHEDULER_PASSWORD)\s*=\s*(.+?)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^['"]|['"]$/g,'')]));
let token;const summary={updated:[],failed:[]};
async function api(path,body,method=body?'POST':'GET') {const r=await fetch(base+'/api'+path,{method,signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('API '+r.status);return r.status===204?null:r.json();}
try {
  token=(await api('/sessions',{handle:values.SCHEDULER_HANDLE,password:values.SCHEDULER_PASSWORD})).token;
  for(let page=1;page<=100;page++) {
    const feed=await api('/posts?page='+page);
    for(const p of feed.posts.filter(p=>p.source?.provider==='x')) {
      try{const item=await enrichX({...p.source,community:p.community,title:p.title,body:p.body});if(JSON.stringify(item.media)===JSON.stringify(p.source.media)&&item.profile_image_url===p.source.profile_image_url&&item.profile_url===p.source.profile_url&&item.profile_display_name===p.source.profile_display_name&&item.profile_verified===p.source.profile_verified)continue;await api('/admin/imports',item);summary.updated.push(p.id);}
      catch(e){summary.failed.push({id:p.id,error:e.message});}
    }
    if(!feed.has_more)break;
  }
}finally{if(token)await api('/sessions',undefined,'DELETE');console.log(JSON.stringify(summary));if(summary.failed.length)process.exitCode=1;}
