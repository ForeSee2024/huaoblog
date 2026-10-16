import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminConfiguration } from '../src/config/admin.ts';
test('内容服务为默认模式，Git 回退模式明确列出缺失配置', () => {
  assert.equal(createAdminConfiguration({},true).ready,true);
  const config = createAdminConfiguration({},false);
  assert.equal(config.backend,'api');
  assert.equal(config.direct,true);
  assert.equal(config.apiUrl,'/api/v1');
  assert.equal(config.repo,'ForeSee2024/huaoblog');
  assert.equal(config.authUrl,'https://huaoblog-oauth.huaoqaq.workers.dev');
  assert.equal(config.siteUrl,'https://huaoblog.cn');
  assert.equal(config.ready,true);
  assert.deepEqual(createAdminConfiguration({CMS_BACKEND:'github'},false).issues,['CMS_REPO','CMS_AUTH_URL','SITE_URL']);
});
test('运行时只注入允许公开的地址和部署类型，不序列化密钥', () => {
  const config=createAdminConfiguration({},false,{siteUrl:'https://runtime.example.com',authUrl:'https://login.example.com',deployment:'cloudflare',devAuth:false,sessionSecret:'never-serialize'});
  assert.equal(config.siteUrl,'https://runtime.example.com');
  assert.equal(config.authUrl,'https://login.example.com');
  assert.equal(config.deployment,'cloudflare');
  assert.equal(JSON.stringify(config).includes('never-serialize'),false);
});
test('生产配置只包含公开地址，拒绝不安全的授权地址', () => {
  const config=createAdminConfiguration({CMS_REPO:'huao/blog',CMS_AUTH_URL:'https://auth.example.com',SITE_URL:'https://blog.example.com',GITHUB_CLIENT_SECRET:'never-serialize'},false);
  assert.equal(config.ready,true);assert.equal(config.local,false);assert.equal(config.branch,'main');
  assert.equal(JSON.stringify(config).includes('never-serialize'),false);
  assert.equal(createAdminConfiguration({CMS_REPO:'huao/blog',CMS_AUTH_URL:'https://user:password@auth.example.com',SITE_URL:'https://blog.example.com'},false).ready,false);
});
