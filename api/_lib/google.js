// Checks a "Sign in with Google" ID token: signed by Google, meant for Cura (GOOGLE_CLIENT_ID), not expired.
// Only the public Client ID is needed; there's no client secret in this flow.
import crypto from 'node:crypto';

let certs = { at: 0, keys: [] };
async function googleKeys(force = false) {
  if (!force && certs.keys.length && Date.now() - certs.at < 3600000) return certs.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error(`Google keys: ${res.status}`);
  certs = { at: Date.now(), keys: (await res.json()).keys || [] };
  return certs.keys;
}

const part = s => Buffer.from(s, 'base64url');

export async function verifyGoogleToken(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('not a token');
  const header = JSON.parse(part(parts[0]).toString()), payload = JSON.parse(part(parts[1]).toString());
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  // Google rotates its keys; if the one named isn't cached yet, fetch them again once.
  const jwk = (await googleKeys()).find(k => k.kid === header.kid) || (await googleKeys(true)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, part(parts[2]))) throw new Error('bad signature');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('wrong issuer');
  if (payload.aud !== clientId) throw new Error('wrong audience');
  if (Number(payload.exp) * 1000 < Date.now() - 60000) throw new Error('expired');
  if (!payload.sub || payload.email_verified === false) throw new Error('unverified account');
  return { sub: String(payload.sub), email: String(payload.email || ''), name: String(payload.given_name || payload.name || '').slice(0, 60) };
}
