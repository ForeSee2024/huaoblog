import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminConfiguration } from '../src/config/admin.ts';
test('本地模式独立可用，生产模式明确列出缺失配置', () => {
  assert.equal(createAdminConfiguration({},true).ready,true);
  assert.deepEqual(createAdminConfiguration({},false).issues,['CMS_REPO','CMS_AUTH_URL','SITE_URL']);
});
test('生产配置只包含公开地址，拒绝不安全的授权地址', () => {
  const config=createAdminConfiguration({CMS_REPO:'huao/blog',CMS_AUTH_URL:'https://auth.example.com',SITE_URL:'https://blog.example.com',GITHUB_CLIENT_SECRET:'never-serialize'},false);
  assert.equal(config.ready,true);assert.equal(config.local,false);assert.equal(config.branch,'main');
  assert.equal(JSON.stringify(config).includes('never-serialize'),false);
  assert.equal(createAdminConfiguration({CMS_REPO:'huao/blog',CMS_AUTH_URL:'https://user:password@auth.example.com',SITE_URL:'https://blog.example.com'},false).ready,false);
});
