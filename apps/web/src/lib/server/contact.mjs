// The operator's public contact address for the privacy and terms pages,
// read when the server runs (like API_URL), so one build serves any instance.
export function contactEmail(value = process.env.SWARTZIT_CONTACT_EMAIL) {
  const email = (value ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
