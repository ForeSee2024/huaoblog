import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { createFileBlobStore } from '../src/server/storage/filesystem.js';
import { createContentStore } from '../src/server/storage/content-store.js';

export function options(args = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!/^--[a-z][a-z-]*$/.test(key) || !args[index + 1] || args[index + 1].startsWith('--') || Object.hasOwn(result, key.slice(2))) throw new Error(`Invalid or duplicate option: ${key}`);
    result[key.slice(2)] = args[index + 1];
  }
  return result;
}
export async function openContentRuntime(dataDir) {
  const directory = resolve(dataDir); await mkdir(directory, { recursive: true });
  const database = createNodeDatabase(resolve(directory, 'content.sqlite'));
  try {
    await database.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    const names = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    const highest = Math.max(...names.map(name => Number(name.split('_')[0])));
    const [latest] = await database.all('SELECT MAX(version) AS version FROM schema_migrations');
    if (latest.version > highest) throw new Error('Database schema is newer than this application.');
    for (const name of names) {
      const version = Number(name.split('_')[0]);
      if ((await database.all('SELECT version FROM schema_migrations WHERE version = ?', [version])).length) continue;
      await database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      await database.batch([{ sql: 'INSERT INTO schema_migrations VALUES (?, ?)', params: [version, new Date().toISOString()] }]);
    }
    return { database, store: createContentStore(database), blobs: createFileBlobStore(resolve(directory, 'objects')) };
  } catch (error) { database.close(); throw error; }
}
