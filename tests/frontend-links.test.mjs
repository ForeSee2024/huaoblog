import assert from 'node:assert/strict';
import test from 'node:test';

const config = await import('../src/config/site.ts');

test('navigation accepts site routes and HTTPS addresses while rejecting executable and ambiguous destinations', () => {
  assert.equal(typeof config.safeNavigationHref, 'function');
  for (const href of ['/', '/posts', '/posts/article', '/archive?year=2026', '/friends/', '/about#bio', 'https://example.com/blog']) {
    assert.equal(config.safeNavigationHref(href), href);
  }
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//example.com', '/\\example.com', 'http://example.com', '/admin/', 'https://user:secret@example.com', 'https://example.com\n']) {
    assert.equal(config.safeNavigationHref(href), undefined, href);
  }
});

test('external profile and friend links permit HTTP or HTTPS without credentials or script protocols', () => {
  assert.equal(typeof config.safeExternalHref, 'function');
  assert.equal(config.safeExternalHref('http://example.com/blog'), 'http://example.com/blog');
  assert.equal(config.safeExternalHref('https://example.com/blog'), 'https://example.com/blog');
  for (const href of ['javascript:alert(1)', 'mailto:user@example.com', '//example.com', 'https://user:secret@example.com', 'https://example.com\\bad']) {
    assert.equal(config.safeExternalHref(href), undefined, href);
  }
});

test('avatar sources accept site uploads or web images and reject ambiguous or executable URLs', () => {
  assert.equal(typeof config.safeImageSrc, 'function');
  assert.equal(config.safeImageSrc('/images/avatar.png'), '/images/avatar.png');
  assert.equal(config.safeImageSrc('https://example.com/avatar.png'), 'https://example.com/avatar.png');
  for (const href of ['data:image/svg+xml,<svg/>', '//example.com/avatar.png', '/\\example.com/avatar.png', 'javascript:alert(1)']) {
    assert.equal(config.safeImageSrc(href), undefined, href);
  }
});
