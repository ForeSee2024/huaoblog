import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2] || 'node';
if (!['node', 'cloudflare'].includes(target)) throw new Error('Build target must be node or cloudflare');
const pkg = JSON.parse(await readFile(new URL('../node_modules/astro/package.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL(`../node_modules/astro/${typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.astro}`, import.meta.url));
const child = spawn(process.execPath, [cli, 'build'], { cwd: root, env: { ...process.env, DEPLOY_TARGET: target }, stdio: 'inherit' });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
if (code !== 0) process.exit(code || 1);
// Managed images belong to the content service, never a static asset handler.
await rm(new URL('../dist/client/images/posts', import.meta.url), { recursive: true, force: true });
// Astro adapters append configured redirects to the copied legacy file.
// Cloudflare rejects duplicate source paths, including identical generated rules.
const redirectFile = new URL('../dist/client/_redirects', import.meta.url);
try {
  const seen = new Map();
  const lines = (await readFile(redirectFile, 'utf8')).split('\n').filter(line => {
    const parts = line.trim().split(/\s+/); if (!parts[0] || parts[0].startsWith('#')) return true;
    const [source, ...rule] = parts, target = rule.join(' ');
    if (seen.has(source)) { if (seen.get(source) !== target) throw new Error(`Conflicting redirect: ${source}`); return false; }
    seen.set(source, target); return true;
  });
  await writeFile(redirectFile, lines.join('\n'));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await access(new URL('../dist/client/images/posts', import.meta.url)); throw new Error('Managed media must not be present in build assets'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
