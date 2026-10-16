import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const astroPackage = JSON.parse(readFileSync(new URL('../node_modules/astro/package.json', import.meta.url), 'utf8'));
const astroBinary = typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro;
const astroCli = fileURLToPath(new URL(`../node_modules/astro/${astroBinary}`, import.meta.url));
const children = [spawn(process.execPath, [astroCli, 'dev', '--host', '127.0.0.1', '--port', '4321', '--ignore-lock'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', DEPLOY_TARGET: 'node', APP_DEV_AUTH: process.env.APP_DEV_AUTH ?? '1' }, stdio: 'inherit' })];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; process.exitCode = code; children.forEach(child => child.kill('SIGTERM')); }
for (const child of children) { child.on('error', error => { console.error(error.message); stop(1); }); child.on('exit', code => { if (!stopping) stop(code || 0); }); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
