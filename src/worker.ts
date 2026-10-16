import { handle } from '@astrojs/cloudflare/handler';
import { getRuntime } from './server/runtime-cloudflare.js';
import { runScheduledBackup } from './server/scheduled-backup.js';
import { serveMedia } from './server/api.js';

export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    // Astro's static manifest still knows legacy source filenames after asset cleanup.
    // Reserve managed media before its static matcher so database deletion is authoritative.
    if (path.startsWith('/images/posts/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
      let name;
      try { name = decodeURIComponent(path.slice('/images/posts/'.length)); } catch { return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
      return serveMedia(request, await getRuntime(), name);
    }
    return handle(request, env, context);
  },
  async scheduled(_event, env, context) {
    context.waitUntil(getRuntime().then(runtime => runScheduledBackup(runtime, env.MEDIA)).catch(error => {
      console.error(JSON.stringify({ event: 'scheduled_backup_failed', code: error.code || 'backup_failed' }));
      throw error;
    }));
  },
} satisfies ExportedHandler<Env>;
