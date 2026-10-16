import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createNodeDatabase } from './storage/sqlite.js';
import { createFileBlobStore } from './storage/filesystem.js';
import { createContentStore } from './storage/content-store.js';
import { runtimeConfig } from './runtime-config.js';
import contentSchema from '../../migrations/001_content.sql?raw';
import sessionSchema from '../../migrations/002_sessions.sql?raw';
import operationsSchema from '../../migrations/003_operations.sql?raw';

let initialized;
export async function getRuntime() {
  if (!initialized) initialized = initialize().catch(error => { initialized = undefined; throw error; });
  return initialized;
}
async function initialize() {
  const dataDir = resolve(process.env.APP_DATA_DIR || '.local/runtime');
  await mkdir(dataDir, { recursive: true });
  const database = createNodeDatabase(resolve(dataDir, 'content.sqlite'));
  await database.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const current = await database.all('SELECT MAX(version) AS version FROM schema_migrations');
  if ((current[0]?.version || 0) > 3) throw new Error('Database schema is newer than this application.');
  for (const [index, sql] of [contentSchema, sessionSchema, operationsSchema].entries()) {
    const version = index + 1;
    if (!(await database.all('SELECT version FROM schema_migrations WHERE version = ?', [version])).length) {
      await database.exec(sql);
      await database.batch([{ sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', params: [version, new Date().toISOString()] }]);
    }
  }
  return { store: createContentStore(database), database, blobs: createFileBlobStore(resolve(dataDir, 'objects')), config: runtimeConfig(process.env, 'node') };
}
