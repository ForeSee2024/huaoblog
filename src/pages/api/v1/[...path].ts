import type { APIRoute } from 'astro';
import { getRuntime } from '#content-runtime';
import { createContentHandler } from '../../../server/api.js';

export const ALL: APIRoute = async ({ request }) => {
  try { return await createContentHandler(await getRuntime())(request); }
  catch { return Response.json({ error: '内容服务尚未就绪，请稍后重试。', code: 'storage_unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
};
