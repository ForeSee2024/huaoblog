import type { SiteSettings } from './config/site';

declare global {
  namespace App {
    interface Locals {
      services: Awaited<ReturnType<typeof import('#content-runtime').getRuntime>>;
      siteSettings: SiteSettings;
    }
  }
}

export {};
