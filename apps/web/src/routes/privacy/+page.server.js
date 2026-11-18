import { contactEmail } from '#lib/server/contact.mjs';

export function load() {
  return { contact: contactEmail() };
}
