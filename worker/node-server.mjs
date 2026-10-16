import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import gateway from './index.js';

const origin = new URL(process.env.OAUTH_PUBLIC_URL || '');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('OAUTH_PUBLIC_URL must be the HTTPS origin of your login gateway.');
if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET || !process.env.ALLOWED_ORIGINS) throw new Error('GitHub OAuth credentials and ALLOWED_ORIGINS are required.');
if (!crypto.subtle.timingSafeEqual) Object.defineProperty(crypto.subtle, 'timingSafeEqual', { value: timingSafeEqual });
const server = createServer(async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400).end(); return; }
    const request = new Request(new URL(incoming.url, origin), { method: incoming.method, headers: new Headers(incoming.headers) });
    const response = await gateway.fetch(request, { ...process.env, GITHUB_OAUTH_SCOPE: 'read:user' });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing); else outgoing.end();
  } catch { outgoing.writeHead(500, { 'Cache-Control': 'no-store' }); outgoing.end('Login service unavailable.'); }
});
server.listen(Number(process.env.OAUTH_PORT || 8790), process.env.OAUTH_HOST || '127.0.0.1');
