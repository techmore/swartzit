<script>
  let input='', items=[], error='', results=[], busy=false;
  function preview() {
    error=''; results=[];
    try {
      if(input.length>1000000)throw new Error('Use a batch smaller than 1 MB.');
      const parsed=JSON.parse(input);
      if(!Array.isArray(parsed)||!parsed.length||parsed.length>100)throw new Error('Provide a JSON array of 1–100 prepared posts.');
      if(parsed.some(p=>!p.source_url||!p.title||!p.community))throw new Error('Each post needs source_url, title, and community.');
      items=parsed;
    }catch(e){items=[];error=e.message;}
  }
  async function file(event) {
    const f=event.target.files?.[0]; if(!f)return;
    if(f.size>1000000){error='File exceeds 1 MB.';return;}
    input=await f.text();preview();
  }
  async function publish() {
    busy=true;results=[];error='';
    for(const item of items) {
      try {
        const r=await fetch('/api/admin/imports',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+localStorage.getItem('swartzit_session')},body:JSON.stringify(item)});
        const data=await r.json();
        if(!r.ok)throw new Error(data.error??'Import failed');
        results=[...results,{title:item.title,id:data.id,state:data.created?'Published':data.updated?'Updated':'Skipped older snapshot'}];
      }catch(e){error=e.message+' Earlier successful imports are listed below; retrying will not duplicate them.';break;}
    }
    busy=false;
  }
</script>
<section class="panel">
  <h3>Import public source posts</h3>
  <p>Prepare a JSON batch with scripts/prepare-import.mjs, then review it here. Source metrics stay separate from local votes, views, and comments. Reimporting the same source updates its existing post.</p>
  <label>Prepared JSON file <input type="file" accept=".json,application/json" onchange={file} disabled={busy} /></label>
  <label>Or paste prepared JSON<textarea aria-label="Import JSON" bind:value={input} oninput={() => {items=[];results=[];}} rows="8" disabled={busy}></textarea></label>
  <button onclick={preview} disabled={busy}>Review batch</button>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if items.length}<h3>{items.length} posts ready for review</h3><ul>{#each items as item}<li>{item.title} → c/{item.community}<br /><small>{item.source_url}</small></li>{/each}</ul>
  <p>Publish only public material intended for this instance. Source images load from their original host when a reader chooses to load them.</p>
  <button onclick={publish} disabled={busy}>{busy?'Importing…':'Publish / update reviewed posts'}</button>{/if}
  <ul aria-live="polite">{#each results as result}<li>{result.state}: <a href={'/post/'+result.id}>{result.title}</a></li>{/each}</ul>
</section>
