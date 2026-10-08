// Builds the imported web source into the artifact's web-public/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dir, '..', 'web-public');
const appVersion = JSON.parse(fs.readFileSync(path.join(dir, '../package.json'), 'utf8')).version;
const staticDir = path.join(dir, 'static');
const appearanceTokens = JSON.parse(fs.readFileSync(path.join(dir, '../../classscribe-mobile/lib/appearance-tokens.json'), 'utf8'));
const appearanceVars = (palette) => [
  `--phone-bg:${palette.phoneBg}`, `--bg:${palette.webBg}`, `--surface:${palette.card}`, `--surface-2:${palette.raised}`,
  `--ink:${palette.text}`, `--muted:${palette.secondaryText}`, `--faint:${palette.faint}`, `--line:${palette.separator}`,
  `--accent:${palette.accent}`, `--accent-ink:${palette.accentText}`, `--accent-soft:${palette.accentSoft}`,
  `--rec-ink:${palette.accentText}`,
  `--hero:${palette.hero}`, `--hero-ink:${palette.heroText}`, `--logo:${palette.logo}`,
  `--hi:${palette.exam}`, `--hi-soft:${palette.examSoft}`, `--hi-ink:${palette.examText}`,
  `--rec:${palette.record}`, `--rec-soft:${palette.recordSoft}`, `--good:${palette.good}`,
  `--warn:${palette.warn}`, `--warn-soft:${palette.warnSoft}`, `--c1:${palette.accent}`,
  `--c2:${palette.blue}`, `--c3:${palette.orange}`, `--c4:${palette.purple}`,
  `--c5:${palette.teal}`, `--c6:${palette.gold}`,
].join(';');
const appearanceBootstrap = `(()=>{
  const valid=v=>['auto','light','dark'].includes(v)?v:'auto';
  const read=()=>{try{const uid=localStorage.getItem('cs_device_uid');const base=JSON.parse(localStorage.getItem(uid?'cs_profile_v2_'+uid:'cs_profile')||'{}');const pending=uid?JSON.parse(localStorage.getItem('cs_pending_profile_v2_'+uid)||'{}'):{};return valid({...base,...pending}.appearance)}catch{return'auto'}};
  let preference=read();
  const root=document.documentElement,media=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)'),phone=window.matchMedia&&window.matchMedia('(max-width: 600px)');
  const apply=()=>{const dark=preference==='dark'||preference==='auto'&&!!(media&&media.matches);const mode=dark?'dark':'light';root.dataset.theme=mode;root.style.colorScheme=mode;const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?(phone&&phone.matches?'${appearanceTokens.dark.phoneBg}':'${appearanceTokens.dark.webBg}'):(phone&&phone.matches?'${appearanceTokens.light.phoneBg}':'${appearanceTokens.light.webBg}')};
  const api={get:()=>preference,set:value=>{preference=valid(value);apply()},sync:profile=>{preference=valid(profile&&profile.appearance);apply()},apply};
  window.CS_APPEARANCE=api;
  if(media){if(media.addEventListener)media.addEventListener('change',()=>{if(preference==='auto')apply()});else if(media.addListener)media.addListener(()=>{if(preference==='auto')apply()})}
  if(phone){if(phone.addEventListener)phone.addEventListener('change',apply);else if(phone.addListener)phone.addListener(apply)}
  apply()
})();`;
await build({
  stdin: {
    contents: "import { Clerk } from '@clerk/clerk-js';\nimport { ClerkUI } from '@clerk/ui/entry';\nwindow.ClassScribeClerk = { Clerk, ClerkUI };\n",
    resolveDir: dir,
    sourcefile: 'clerk.browser-entry.js',
    loader: 'js',
  },
  outfile: path.join(publicDir, 'clerk.browser.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
});
const parts = ['2_data.js', '3_core.js', '4_views.js', '5_capture_lecture.js', '7_notes.js', '8_account.js', '9_schedule.js', '6_study_social.js', '10_grades.js'];
const headSource = fs.readFileSync(path.join(dir, '1_head.html'), 'utf8')
  .replace('/* APPEARANCE_PALETTE */', `color-scheme:light;${appearanceVars(appearanceTokens.light)}`)
  .replace('/* APPEARANCE_DARK_PALETTE */', appearanceVars(appearanceTokens.dark));
const app = headSource + '\n<script>\n' + parts.map((f) => fs.readFileSync(path.join(dir, f), 'utf8') + '\n').join('') + '</script>\n';

const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="ClassScribe">
<meta name="theme-color" content="${appearanceTokens.light.webBg}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon-192.png">
<script src="/platform.js"></script>
<script src="/support.js" defer></script>
<script>${appearanceBootstrap}</script>
<script>window.CS_CLERK_CONFIG=${JSON.stringify({
  publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "",
  proxyUrl: process.env.VITE_CLERK_PROXY_URL || process.env.CLERK_PROXY_URL || "",
})};</script>
<script>window.CS_APP_VERSION=${JSON.stringify(appVersion)};</script>
`;
let html = head + app.replace('<div class="app">', '</head>\n<body>\n<div class="app">') + '</body>\n</html>\n';

// Wording for the self-hosted server (the same source also runs on claude.ai).
const replace = [
  ['AI answers need you signed in to claude.ai, and no lecture passages matched your words.', 'AI isn’t set up on this server yet, and no lecture passages matched your words.'],
  ['AI answers need you signed in to claude.ai. Here are the closest passages from your lectures:', 'AI isn’t set up on this server yet. Here are the closest passages from your lectures:'],
  ['AI features need you signed in to claude.ai.', 'AI isn’t set up yet. Add ANTHROPIC_API_KEY in Replit Secrets.'],
  ['Explanations use Claude and need you signed in to claude.ai.', 'Explanations need AI. Add ANTHROPIC_API_KEY in Replit Secrets.'],
  ['Saved in this browser only. Sign in to claude.ai to sync.', 'Saved in this browser only.'],
  ['Sharing with classmates works when you’re signed in to claude.ai.', 'Sharing with classmates needs the ClassScribe server.'],
  ['Sharing works when you’re signed in to claude.ai.', 'Sharing needs the ClassScribe server.'],
  ['Synced to your claude.ai account. Your library', 'Saved on the ClassScribe server. Your library'],
  ['Synced to your claude.ai account', 'Saved on the ClassScribe server'],
  ['Your account is saved in this browser. Sign in to claude.ai to sync it across devices and join class groups.', 'Your account is saved in this browser.'],
  ['Your account is tied to your claude.ai sign-in. Only your name', 'Your account is tied to this browser. Only your name'],
  ['The ClassScribe page on claude.ai can’t use your microphone; record in the ClassScribe phone app or the Replit web app, or add a transcript below.', 'The microphone was off or blocked during this recording. Next time allow microphone access (or use the phone app), or add a transcript below.'],
  ['AI access wasn’t allowed for this page. Reload the page to be asked again.', 'The AI key was rejected. Check ANTHROPIC_API_KEY in Replit Secrets.'],
];
for (const [a, b] of replace) html = html.split(a).join(b);
html = html.replace(/Class groups sync through your claude\.ai account\.[^<]*/, 'Class groups need the ClassScribe server. You’re seeing an example group.');
if (html.includes('claude.ai')) console.warn('Note: some text still mentions claude.ai');

fs.writeFileSync(path.join(dir, '..', 'web-public', 'index.html'), html);
for (const file of ['privacy.html', 'terms.html', 'ai-consent.js']) {
  fs.copyFileSync(path.join(staticDir, file), path.join(publicDir, file));
}
console.log('Built web-public/index.html (' + Math.round(html.length / 1024) + ' KB)');
