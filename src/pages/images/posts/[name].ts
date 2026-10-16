import type { APIRoute } from 'astro';
import { getRuntime } from '#content-runtime';
import { serveMedia } from '../../../server/api.js';

export const GET: APIRoute = async ({ request, params }) => serveMedia(request, await getRuntime(), params.name);
export const HEAD = GET;
