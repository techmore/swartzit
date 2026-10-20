// The public address of this instance, for canonical links and social
// previews. Operators set SWARTZIT_ORIGIN (the same variable the API server
// reads); otherwise the origin of the incoming request is used, so a
// self-hosted instance never advertises somebody else's domain.
export function publicOrigin(requestUrl, env = process.env) {
  const configured = env.SWARTZIT_ORIGIN?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
    } catch { /* fall through to the request origin */ }
  }
  try { return new URL(requestUrl).origin; } catch { return ''; }
}

export function canonicalPostUrl(origin, publicId) {
  return `${origin}/post/${encodeURIComponent(publicId)}`;
}
