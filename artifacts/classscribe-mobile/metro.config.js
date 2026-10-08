// Expo's native bundle only inlines EXPO_PUBLIC_* variables. Replit provides
// the managed Clerk key as CLERK_PUBLISHABLE_KEY during App Store builds.
if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_PUBLISHABLE_KEY) {
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
}

// Published Clerk instances use a same-origin proxy. A native bundle must
// receive the complete public URL; an unprefixed CLERK_PROXY_URL is only a path.
if (!process.env.EXPO_PUBLIC_CLERK_PROXY_URL && process.env.CLERK_PROXY_URL) {
  const origin = process.env.REPLIT_INTERNAL_APP_DOMAIN
    || process.env.EXPO_PUBLIC_SERVER_URL
    || process.env.EXPO_PUBLIC_DOMAIN;
  if (!origin) {
    throw new Error('Clerk proxy is configured, but no public server domain was provided for the native bundle.');
  }
  const url = new URL(/^https?:\/\//.test(origin) ? origin : `https://${origin}`);
  process.env.EXPO_PUBLIC_CLERK_PROXY_URL = `${url.origin}${process.env.CLERK_PROXY_URL}`;
}

const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
