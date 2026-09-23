<script>
  import { onMount } from 'svelte';

  export let postId;
  export let summary = { responses: 0 };

  const scores = [1, 2, 3, 4, 5];
  const dimensions = [
    { key: 'prompt_match', label: 'Prompt match', hint: 'Did the image follow the idea?' },
    { key: 'natural_color', label: 'Natural color', hint: 'Do the colors feel believable?' },
    { key: 'realism', label: 'Realism', hint: 'How convincing is the rendering?' },
    { key: 'likeness', label: 'Likeness', hint: 'Useful for people or recognizable subjects.' },
    { key: 'composition', label: 'Composition', hint: 'Does the framing and balance work?' },
    { key: 'detail', label: 'Detail', hint: 'Are texture and small features strong?' }
  ];
  const labels = { 1: 'Not for me', 2: 'Needs work', 3: 'Okay', 4: 'Good', 5: 'More like this' };
  let token = '';
  let loading = true;
  let saving = false;
  let message = '';
  let error = '';
  let values = { overall: null, prompt_match: null, natural_color: null, realism: null, likeness: null, composition: null, detail: null };

  function setValue(key, value) {
    values = { ...values, [key]: value };
    message = '';
    error = '';
  }

  function average(key) {
    const value = Number(summary?.[key]);
    return Number.isFinite(value) ? value.toFixed(1) : null;
  }

  async function loadMine() {
    if (!token) return;
    try {
      const response = await fetch(`/api/posts/${postId}/draw-feedback`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const result = await response.json();
      if (result.summary) summary = result.summary;
      if (result.mine) values = { ...values, ...result.mine };
    } catch {
      // Feedback is optional; do not make a post fail because this request did.
    }
  }

  async function save() {
    if (!token) { error = 'Sign in to leave structured feedback.'; return; }
    if (values.overall == null) { error = 'Choose an overall score first.'; return; }
    saving = true;
    message = '';
    error = '';
    const payload = { overall: values.overall };
    for (const item of dimensions) if (values[item.key] != null) payload[item.key] = values[item.key];
    try {
      const response = await fetch(`/api/posts/${postId}/draw-feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save feedback.');
      summary = result.summary || summary;
      message = result.message || 'Feedback saved.';
    } catch (e) {
      error = e.message || 'Could not save feedback.';
    } finally {
      saving = false;
    }
  }

  onMount(async () => {
    token = localStorage.getItem('swartzit_session') || '';
    await loadMine();
    loading = false;
  });
</script>

<section class="draw-feedback" aria-labelledby="draw-feedback-title">
  <div class="feedback-heading">
    <div>
      <p class="eyebrow">DRAW THINGS FEEDBACK</p>
      <h2 id="draw-feedback-title">Guide the next image</h2>
      <p>Structured feedback helps tune future prompts and settings. It is separate from the normal post vote.</p>
    </div>
    {#if Number(summary?.responses) > 0}<span class="feedback-count">{summary.responses} {Number(summary.responses) === 1 ? 'rating' : 'ratings'}</span>{/if}
  </div>

  {#if !loading && !token}
    <p class="feedback-login"><a href="/login">Sign in</a> to rate this generation.</p>
  {:else}
    <div class="overall-question">
      <div><strong>Would you like more images like this?</strong><small>Overall impression · required</small></div>
      <div class="overall-scores" role="radiogroup" aria-label="Overall image rating">
        {#each scores as score}
          <button type="button" class:active={values.overall === score} aria-pressed={values.overall === score} aria-label={`${score} out of 5: ${labels[score]}`} title={labels[score]} disabled={loading || saving} on:click={() => setValue('overall', score)}>{score}</button>
        {/each}
      </div>
      {#if values.overall != null}<span class="score-label">{labels[values.overall]}</span>{/if}
    </div>

    <div class="dimension-list">
      {#each dimensions as item}
        <div class="dimension-row">
          <div class="dimension-label"><strong>{item.label}</strong><small>{item.hint}</small></div>
          <div class="dimension-scores" role="radiogroup" aria-label={`${item.label} rating`}>
            {#each scores as score}
              <button type="button" class:active={values[item.key] === score} aria-pressed={values[item.key] === score} aria-label={`${item.label}: ${score} out of 5`} disabled={loading || saving} on:click={() => setValue(item.key, score)}>{score}</button>
            {/each}
            <button type="button" class:selected={values[item.key] == null} class="skip-score" aria-pressed={values[item.key] == null} disabled={loading || saving} on:click={() => setValue(item.key, null)}>Skip</button>
          </div>
        </div>
      {/each}
    </div>

    <div class="feedback-footer">
      <button type="button" class="save-feedback" disabled={loading || saving || values.overall == null} on:click={save}>{saving ? 'Saving…' : 'Save feedback'}</button>
      {#if message}<span class="feedback-message" role="status">{message}</span>{/if}
      {#if error}<span class="feedback-error" role="alert">{error}</span>{/if}
    </div>
  {/if}

  {#if Number(summary?.responses) > 0}
    <div class="feedback-signal" aria-label="Community feedback signal">
      <strong>Community signal</strong>
      {#each [{key:'overall',label:'Overall'}, ...dimensions] as item}
        {#if average(item.key)}<span>{item.label} <b>{average(item.key)}</b></span>{/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .draw-feedback{margin:22px 0 4px;padding:18px 0;border-top:1px solid var(--border,#dedfd7);border-bottom:1px solid var(--border,#dedfd7)}
  .feedback-heading{display:flex;justify-content:space-between;align-items:start;gap:18px}.eyebrow{margin:0 0 5px;color:var(--accent,#9b5e38);font-size:.67rem;letter-spacing:.14em;font-weight:800}.feedback-heading h2{margin:0;color:var(--heading,#173d34);font:500 1.45rem/1.15 Georgia,serif}.feedback-heading p:not(.eyebrow){max-width:560px;margin:6px 0 0;color:var(--muted,#66766c);font-size:.78rem;line-height:1.4}.feedback-count{flex:none;padding:6px 9px;border-radius:999px;background:var(--subtle,#f0f3ec);color:var(--muted,#66766c);font-size:.7rem;font-weight:750}.feedback-login{margin:16px 0 2px;color:var(--muted,#66766c);font-size:.82rem}.feedback-login a{color:var(--link,#215e47);font-weight:700}.overall-question{display:flex;align-items:center;gap:18px;margin:17px 0 14px;padding:12px;border:1px solid var(--border,#c7d0c6);border-radius:10px;background:var(--subtle,#f5f7f3)}.overall-question>div:first-child{min-width:190px}.overall-question strong,.dimension-label strong{display:block;color:var(--heading,#173d34);font-size:.82rem}.overall-question small,.dimension-label small{display:block;margin-top:3px;color:var(--muted,#66766c);font-size:.7rem}.overall-scores,.dimension-scores{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.overall-scores{margin-left:auto}.overall-scores button,.dimension-scores button{width:28px;height:28px;padding:0;border:1px solid var(--border,#c7d0c6);border-radius:50%;background:var(--surface,#fff);color:var(--muted,#66766c);font-size:.73rem;cursor:pointer}.overall-scores button:hover,.dimension-scores button:hover,.overall-scores button.active,.dimension-scores button.active{border-color:var(--link,#215e47);background:var(--link,#215e47);color:#fff}.score-label{min-width:74px;color:var(--muted,#66766c);font-size:.7rem}.dimension-list{display:grid;gap:8px}.dimension-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:7px 0}.dimension-label{min-width:190px}.dimension-scores{justify-content:flex-end}.dimension-scores .skip-score{width:auto;padding:0 8px;border-radius:999px;font-size:.67rem}.dimension-scores .skip-score.selected{border-color:var(--accent,#9b5e38);color:var(--accent,#9b5e38);background:color-mix(in srgb,var(--accent,#9b5e38) 10%,var(--surface,#fff))}.feedback-footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}.save-feedback{padding:8px 13px;border:1px solid var(--link,#215e47);border-radius:7px;background:var(--link,#215e47);color:#fff;font-size:.76rem;font-weight:750;cursor:pointer}.save-feedback:disabled{opacity:.55;cursor:default}.feedback-message{color:var(--link,#215e47);font-size:.75rem}.feedback-error{color:var(--error,#973c35);font-size:.75rem}.feedback-signal{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:15px;color:var(--muted,#66766c);font-size:.7rem}.feedback-signal strong{color:var(--heading,#173d34);font-size:.72rem;margin-right:3px}.feedback-signal span{padding:5px 7px;border:1px solid var(--border,#dedfd7);border-radius:999px;background:var(--surface,#fff)}.feedback-signal b{color:var(--heading,#173d34)}
  @media(max-width:650px){.overall-question,.dimension-row{align-items:flex-start;flex-direction:column}.overall-question>div:first-child,.dimension-label{min-width:0}.overall-scores,.dimension-scores{margin-left:0;justify-content:flex-start}.score-label{min-width:0}.feedback-heading{flex-direction:column;gap:8px}}
</style>
