'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripBasePath, stripRequestPrefixes } = require('../server/path-prefix');
const { normalizeRequestUrl } = require('../server/dev-proxy');

test('strips the configured base path from root and nested routes', () => {
  assert.equal(stripBasePath('/classscribe-mobile/', '/classscribe-mobile/'), '/');
  assert.equal(
    stripBasePath('/classscribe-mobile/manifest?platform=ios', '/classscribe-mobile/'),
    '/manifest?platform=ios',
  );
  assert.equal(
    stripBasePath('/classscribe-mobile/node_modules/expo-router/entry.bundle?platform=ios', '/classscribe-mobile/'),
    '/node_modules/expo-router/entry.bundle?platform=ios',
  );
});

test('does not strip a similar but unrelated path', () => {
  assert.equal(
    stripBasePath('/classscribe-mobile-extra/manifest', '/classscribe-mobile/'),
    '/classscribe-mobile-extra/manifest',
  );
});

test('normalizes preview prefixes and preserves Expo Metro bundle routing', () => {
  assert.equal(normalizeRequestUrl('/?platform=ios'), '/?platform=ios');
  assert.equal(normalizeRequestUrl('/classscribe-mobile/manifest'), '/manifest');
  assert.equal(normalizeRequestUrl('/classscribe-mobile'), '/');
  assert.equal(
    normalizeRequestUrl('/artifacts/classscribe-mobile/node_modules/expo-router/entry.bundle?platform=ios'),
    '/artifacts/classscribe-mobile/node_modules/expo-router/entry.bundle?platform=ios',
  );
});

test('prefix list normalizes trailing slashes and strips only one matching prefix', () => {
  assert.equal(
    stripRequestPrefixes('/classscribe-mobile/manifest', ['/', '/classscribe-mobile/']),
    '/manifest',
  );
});