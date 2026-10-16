import { defineMiddleware } from 'astro:middleware';
import { getRuntime } from '#content-runtime';
import { settings as bootstrapSettings } from './config/site';

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/images/') || pathname.startsWith('/_astro/') || pathname === '/favicon.svg') return next();

  const services = await getRuntime();
  context.locals.services = services;
  const publishedSettings = await services.store.getPublishedSettings();
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (!publishedSettings && !admin) {
    return new Response('站点尚未初始化，请先在管理后台导入博客内容。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  context.locals.siteSettings = publishedSettings || bootstrapSettings;
  const response = await next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
