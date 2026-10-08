// adapter-node reads the operator-owned API address when the server runs.
// Keep this outside SvelteKit's build-time environment exports.
export function apiUrl(fallback = 'http://127.0.0.1:8080') {
  return process.env.API_URL?.trim() || fallback;
}
