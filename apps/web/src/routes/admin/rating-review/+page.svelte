<script>
  import {onMount} from 'svelte';
  import PostBody from '#lib/PostBody.svelte';
  import SourcePost from '#lib/SourcePost.svelte';
  let token='', ready=false, busy=false, error='', message='', items=[], counts={}, distribution=null, status='pending', ratingFilter='', after=0, hasMore=false, choices={}, notes={};
  const ratings=[{key:'general',label:'General'},{key:'r',label:'R'},{key:'x',label:'X'},{key:'unrated',label:'Needs review'}];
  const showRating=(group,rating)=>{status=group;ratingFilter=rating;after=0;load();};
  const barWidth=(group,key)=>{const values=distribution?.[group]||{};const max=Math.max(1,...ratings.map(r=>values[r.key]||0));return `${100*(values[key]||0)/max}%`;};
  function policyConflict(item) {
    const reasons=Array.isArray(item.details?.reasons)?item.details.reasons:[];
    const rating=item.proposed_rating || item.details?.rating;
    return item.details?.policy_conflict || (rating==='general' && reasons.some(reason=>['sexual_suggestiveness','strong_language','nudity','sexual_activity','graphic_violence'].includes(reason))) || (rating==='r' && reasons.some(reason=>['nudity','sexual_activity','graphic_violence'].includes(reason)));
  }
  async function request(path, method='GET', body) {
    const response=await fetch('/api/admin/rating-reviews'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error || 'Could not load rating reviews.');
    return result;
  }
  async function load() {
    error='';busy=true;
    try { const result=await request('?status='+status+'&after='+after+(ratingFilter?'&rating='+encodeURIComponent(ratingFilter):''));items=result.items;counts=result.counts;distribution=result.distribution;hasMore=items.length===20;for(const item of items)choices[item.id]=item.final_rating||'';choices={...choices}; }
    catch(e){error=e.message;}finally{busy=false;}
  }
  onMount(async()=>{token=localStorage.getItem('swartzit_session')||'';ready=true;if(token)await load();});
  async function save(item,dismiss=false) {
    error='';message='';busy=true;
    try {
      await request('/'+item.id+'/decision','POST',{rating:choices[item.id]||null,dismiss,notes:notes[item.id]||''});
      message=dismiss?'Item dismissed; no training label saved.':'Human rating saved to the post and training data.';
      await load();
    }catch(e){error=e.message;}finally{busy=false;}
  }
  async function download() {
    busy=true;error='';
    try {
      let after=0, lines=[];
      for (;;) {
        const result=await request('/training?after='+after);
        lines.push(...result.items.map(item=>JSON.stringify(item)));
        if(!result.has_more)break;
        if(result.next_after<=after)throw new Error('Training export did not advance.');
        after=result.next_after;
      }
      const url=URL.createObjectURL(new Blob([lines.join('\n')+(lines.length?'\n':'')],{type:'application/x-ndjson'}));
      const link=document.createElement('a');link.href=url;link.download='swartzit-human-rating-labels.jsonl';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      message=`Exported ${lines.length} human-reviewed examples.`;
    }catch(e){error=e.message;}finally{busy=false;}
  }
  const sourceFor=item=>({provider:item.snapshot.provider||'runner',source_author:item.snapshot.source_author||'Submitted post',source_url:item.snapshot.source_url||'/post/'+item.snapshot.public_id,media:item.snapshot.media||[],observed_at:item.created_at});
</script>
<svelte:head><title>Rating review — Swartzit</title><meta name="robots" content="noindex" /></svelte:head>
<main id="main-content">
  <a href="/admin">← Admin</a><h1>Rating review</h1>
  <p>Suggestive photos are <strong>R</strong>. Nudity and explicit material are <strong>X</strong>. Review the full post, then save your rating.</p>
  <p class="muted">Qwen supplies suggestions. Only your saved decisions become training labels.</p>
  {#if ready && !token}<p><a href="/login?next=%2Fadmin%2Frating-review">Sign in as an administrator</a> to review ratings.</p>{:else}
    {#if distribution}
      <section class="dashboard" aria-labelledby="rating-overview"><h2 id="rating-overview">Rating overview</h2><p class="muted">Counts cover the entire review queue. Model suggestions and saved human decisions are shown separately; select a bar to see the matching posts.</p>
        <div class="charts">{#each [{key:'pending',title:'Awaiting human review',subtitle:'Model suggestions'}, {key:'reviewed',title:'Human decisions',subtitle:'Latest saved rating per review'}] as group}
          <section class="chart" aria-label={group.title}><h3>{group.title} <span>{counts[group.key]??0}</span></h3><p class="muted">{group.subtitle}</p>
            {#each ratings as rating}<button class="bar-row" disabled={busy} onclick={()=>showRating(group.key,rating.key)} aria-label={`${group.title}: ${rating.label}, ${distribution[group.key]?.[rating.key]??0} posts`}><span>{rating.label}</span><span class="bar-track" aria-hidden="true"><span class={'bar '+rating.key} style:width={barWidth(group.key,rating.key)}></span></span><strong>{distribution[group.key]?.[rating.key]??0}</strong></button>{/each}
          </section>{/each}</div>
      </section>
    {/if}
    <div class="toolbar"><label>Queue<select bind:value={status} onchange={()=>{ratingFilter='';after=0;load();}} disabled={busy}><option value="pending">Pending ({counts.pending??0})</option><option value="reviewed">Reviewed ({counts.reviewed??0})</option><option value="dismissed">Dismissed ({counts.dismissed??0})</option></select></label><label>Rating<select bind:value={ratingFilter} onchange={()=>{after=0;load();}} disabled={busy}><option value="">All ratings</option>{#each ratings as rating}<option value={rating.key}>{rating.label}</option>{/each}</select></label><button onclick={load} disabled={busy}>Refresh</button><button onclick={download} disabled={busy}>Export human training labels</button></div>
    {#if message}<p role="status">{message}</p>{/if}{#if error}<p role="alert" class="form-error">{error}</p>{/if}
    {#if !items.length && !error}<p role="status">{busy?'Loading reviews…':'No items in this queue. New suggestions will appear here.'}</p>{/if}
    {#each items as item (item.id)}
      <article>
        <div class="review-heading"><strong>Model: {item.proposed_rating?.toUpperCase()||'Needs manual review'}</strong><span>Current: {item.current_rating.toUpperCase()} · {item.current_rating_source}</span></div>
        {#if item.details.coverage_partial || item.details.error}<p class="attention">{item.details.error?'The model could not complete this review.': 'Partial media review — check every attachment before choosing a label.'}</p>{/if}
        {#if item.details.uncertain}<p class="attention">Qwen marked this suggestion uncertain.</p>{/if}
        {#if policyConflict(item)}<p class="attention">The model's rating conflicts with its reasons. Choose a rating after reviewing the post.</p>{/if}
        {#if item.snapshot.media?.length}<SourcePost source={sourceFor(item)} text={item.snapshot.body} embedded />{:else}<h2>{item.snapshot.title}</h2><PostBody body={item.snapshot.body} />{/if}
        <p><a href={'/post/'+item.snapshot.public_id} target="_blank" rel="noopener noreferrer">Open full post ↗</a></p>
        <div class="decision"><label>Your rating<select bind:value={choices[item.id]} disabled={busy}><option value="" disabled>Choose a rating</option><option value="general">General</option><option value="r">R — suggestive / mature</option><option value="x">X — nudity / explicit</option></select></label><label>Correction notes (optional)<input bind:value={notes[item.id]} maxlength="1000" disabled={busy} /></label><button onclick={()=>save(item)} disabled={busy||!choices[item.id]}>Save human rating</button><button class="secondary" onclick={()=>save(item,true)} disabled={busy}>Dismiss</button></div>
        {#if item.history?.length}<div class="history"><h3>Human review log</h3><ol>{#each item.history as entry}<li><strong>{entry.rating.toUpperCase()}</strong> · {entry.reviewer||'Unknown reviewer'} · <time datetime={entry.reviewed_at}>{entry.reviewed_at}</time>{#if entry.notes}<p>{entry.notes}</p>{/if}</li>{/each}</ol></div>{:else if item.status==='dismissed'}<p class="muted">Dismissed by {item.reviewer||'Unknown reviewer'}{item.reviewed_at?' · '+item.reviewed_at:''}. No human rating was saved.</p>{/if}
        <details><summary>Review details</summary><p>{item.model} · {item.policy_version}</p><p>Reasons: {(item.details.reasons||[]).join(', ')||'None supplied'}</p><small>Model version: {item.model_digest}</small></details>
      </article>
    {/each}
    <nav aria-label="Review pages">{#if after>0}<button disabled={busy} onclick={()=>{after=0;load();}}>First page</button>{/if}{#if hasMore}<button disabled={busy} onclick={()=>{after=items[items.length-1].id;load();}}>More reviews</button>{/if}</nav>
  {/if}
</main>
<style>
  main{max-width:960px}.muted,small{color:var(--muted)}.toolbar,.review-heading{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.toolbar{margin:24px 0}label{display:grid;gap:6px}article{padding:24px 0;border-top:1px solid var(--border)}.review-heading{justify-content:space-between;margin-bottom:14px}.review-heading span{font-size:.82rem;color:var(--muted)}.decision{display:grid;grid-template-columns:minmax(150px,1fr) minmax(200px,2fr) auto auto;gap:12px;align-items:end;margin:20px 0}select,input{width:100%;min-width:0}.attention{padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--subtle)}details{font-size:.82rem}small{overflow-wrap:anywhere}.dashboard{margin-top:28px}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.chart{border:1px solid var(--border);border-radius:12px;padding:18px}.chart h3{display:flex;justify-content:space-between;margin:0}.chart p{font-size:.85rem;margin:6px 0 14px}.bar-row{display:grid;grid-template-columns:110px 1fr 40px;align-items:center;gap:10px;width:100%;padding:8px 4px;text-align:left;background:transparent;border:0;color:inherit}.bar-row:hover,.bar-row:focus-visible{background:var(--subtle)}.bar-track{height:10px;border-radius:999px;background:var(--subtle);overflow:hidden}.bar{display:block;height:100%;border-radius:999px;background:#547ad3}.bar.r{background:#ca8a04}.bar.x{background:#cc5662}.bar.unrated{background:#8b8798}.bar-row strong{text-align:right}.history{padding:12px 16px;border:1px solid var(--border);border-radius:8px;margin:16px 0}.history h3{margin:0 0 8px}.history ol{margin:0;padding-left:20px}.history li{padding:4px 0}.history p{margin:4px 0;white-space:pre-wrap}@media(max-width:700px){.charts{grid-template-columns:1fr}.decision{grid-template-columns:1fr 1fr}.decision label{grid-column:1/-1}}
</style>
