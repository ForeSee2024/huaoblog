import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { options } from './content-runtime.mjs';
const args = options();
if (!args.origin || !args.archive) throw new Error('Usage: node scripts/import-remote.mjs --origin https://preview-worker.workers.dev --archive backup.tar');
const url = new URL(args.origin);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Target must be an HTTPS origin.');
const origin = url.origin;
// Use the owner's existing CLI login only for one identity exchange; never print or persist its token/cookie.
const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const response = await fetch(origin + '/api/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), redirect: 'error' });
if (!response.ok) throw new Error(`Identity exchange failed (${response.status}): ${(await response.json()).code || 'authentication'}`);
const cookie = response.headers.get('set-cookie')?.split(';')[0];
if (!cookie?.startsWith('huaovo_session=')) throw new Error('No first-party session returned.');
try {
  const imported = await fetch(origin + '/api/v1/backups/import', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-tar' }, body: Readable.toWeb(createReadStream(args.archive)), duplex: 'half', redirect: 'error' });
  const data = await imported.json(); if (!imported.ok) throw new Error(`Import refused (${imported.status}): ${data.error}`);
  console.log(JSON.stringify({ imported: data.imported, summary: data.summary }, null, 2));
} finally { await fetch(origin + '/api/v1/session', { method: 'DELETE', headers: { Origin: origin, Cookie: cookie }, redirect: 'error' }).then(r => r.body?.cancel()).catch(() => {}); }
