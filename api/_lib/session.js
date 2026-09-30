/* ============================================
   Sesión: cookie firmada con HMAC-SHA256.
   Formato: <base64url(payload)>.<base64url(sig)>
   Sin dependencias, funciona en Vercel y en Node.
   ============================================ */

import crypto from 'node:crypto';

export const COOKIE_NAME = 'mm_session';
const MAX_AGE_S = 60 * 60 * 12; // 12 horas

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function createSession(user, secret) {
  const payload = {
    sub: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    exp: Date.now() + MAX_AGE_S * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function readSession(cookieHeader, secret) {
  if (!cookieHeader || !secret) return null;

  const raw = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;

  const value = raw.slice(COOKIE_NAME.length + 1);
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;

  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  // Comparación en tiempo constante: no filtra por contenido.
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

export function sessionCookie(value, isProd) {
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_S}`,
  ];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearCookie(isProd) {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}
