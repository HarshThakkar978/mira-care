// The app's install details, made for the person adding Cura to their Home Screen. On iPhone a Home Screen app
// keeps its own storage, separate from Safari, so without this it would start as a new person and ask for their
// name again. The start address carries their private device code (and theme), so it opens as the same person.
// The "id" stays "/" so phones still see one Cura app.
// Keep in step with manifest.webmanifest (the plain version for browsers that don't run the app's script).
const base = {
  name: 'Cura', short_name: 'Cura',
  description: 'Text Cura how you feel. She keeps track of your cycle and symptoms and helps you prepare for appointments.',
  id: '/', scope: '/', display: 'standalone', background_color: '#F7F4FB', theme_color: '#F7F4FB',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};

const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const THEMES = ['light', 'dark', 'system'];

export function GET(request) {
  const q = new URL(request.url).searchParams;
  const d = q.get('d') || '', t = q.get('t') || '';
  const start = new URLSearchParams({ source: 'homescreen' });
  if (ID_RE.test(d)) { start.set('device', d); start.set('from', 'home'); }
  if (THEMES.includes(t)) start.set('theme', t);
  return new Response(JSON.stringify({ ...base, start_url: `/?${start}#chat` }), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
  });
}
