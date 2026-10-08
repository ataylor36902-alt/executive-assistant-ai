'use strict';

function normalizeBasePath(value) {
  const basePath = String(value || '/').trim();
  if (!basePath || basePath === '/') return '';
  return `/${basePath.replace(/^\/+|\/+$/g, '')}`;
}

function stripBasePath(requestUrl, value) {
  const originalUrl = String(requestUrl || '/');
  const queryIndex = originalUrl.indexOf('?');
  const pathname =
    queryIndex === -1 ? originalUrl : originalUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : originalUrl.slice(queryIndex);
  const basePath = normalizeBasePath(value);

  if (!basePath) return originalUrl;
  if (pathname === basePath) return `/${query}`;
  if (pathname.startsWith(`${basePath}/`)) {
    return `${pathname.slice(basePath.length) || '/'}${query}`;
  }
  return originalUrl;
}

function stripRequestPrefixes(requestUrl, prefixes) {
  return [...new Set(prefixes.map(normalizeBasePath).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .reduce((url, prefix) => stripBasePath(url, prefix), requestUrl || '/');
}

module.exports = { normalizeBasePath, stripBasePath, stripRequestPrefixes };