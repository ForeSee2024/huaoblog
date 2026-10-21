import { env } from 'cloudflare:workers';
import { createD1Database } from './storage/d1.js';
import { createR2BlobStore } from './storage/r2.js';
import { createContentStore } from './storage/content-store.js';
import { runtimeConfig } from './runtime-config.js';

export async function getRuntime() {
  if (!env.DB || !env.MEDIA) throw new Error('Content storage bindings are missing.');
  const database = createD1Database(env.DB);
  return { store: createContentStore(database), database, blobs: createR2BlobStore(env.MEDIA), config: runtimeConfig(env, 'cloudflare') };
}
