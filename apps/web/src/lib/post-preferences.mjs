export async function loadCopyLinkPreference(fetcher, token) {
  if (!token) return true;
  try {
    const response = await fetcher('/api/me/post-preferences', {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) return true;
    const result = await response.json();
    return result.copy_link_after_post !== false;
  } catch {
    return true;
  }
}

export async function copyTextToClipboard(value, navigatorObject, documentObject) {
  try {
    if (typeof navigatorObject?.clipboard?.writeText === 'function') {
      await navigatorObject.clipboard.writeText(value);
      return true;
    }
  } catch { /* Try the legacy clipboard path below. */ }

  try {
    const input = documentObject.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    documentObject.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, input.value.length);
    const copied = documentObject.execCommand('copy');
    input.remove();
    return copied;
  } catch {
    return false;
  }
}

export async function copyPostLink(publicId, navigatorObject, documentObject, origin) {
  const url = new URL(`/post/${encodeURIComponent(publicId)}`, origin).href;
  return copyTextToClipboard(url, navigatorObject, documentObject);
}
