import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const versionPath = path.resolve(webRoot, '../../VERSION');
const appVersion = process.env.SWARTZIT_WEB_VERSION?.trim() || fs.readFileSync(versionPath, 'utf8').trim() || 'development';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
  define: { __SWARTZIT_VERSION__: JSON.stringify(appVersion) }
});
