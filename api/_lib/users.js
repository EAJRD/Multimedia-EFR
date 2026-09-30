/* ============================================
   Usuarios: registro en data/users.json.
   Los hashes son bcrypt. Las contraseñas en claro
   nunca se guardan ni se registran en el log.
   ============================================ */

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export const ROLES = ['admin', 'editor'];
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD = 12;

/* En Vercel el bundle es de solo lectura salvo /tmp, así que los datos
   de lectura vienen por variable de entorno o por fetch a la raw URL.
   En Docker/SQLite se leen del disco. El store decide. */

let cache = null;

export function setUserCache(users) {
  cache = users;
}

export function parseUserFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('data/users.json no es JSON válido');
  }
  const list = Array.isArray(parsed) ? parsed : parsed.usuarios;
  if (!Array.isArray(list)) throw new Error('data/users.json no contiene un array de usuarios');
  return list;
}

export function validateNewUser({ nombre, email, password, rol }) {
  const errors = [];

  if (!nombre || String(nombre).trim().length < 2) {
    errors.push('El nombre debe tener al menos 2 caracteres.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim())) {
    errors.push('El email no es válido.');
  }
  if (!password || String(password).length < MIN_PASSWORD) {
    errors.push(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
  if (rol && !ROLES.includes(rol)) {
    errors.push('El rol debe ser "admin" o "editor".');
  }

  return { ok: errors.length === 0, errors };
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPasswordShape(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD;
}

export async function authenticate(users, email, password) {
  const user = users.find(
    (u) => typeof u.email === 'string' && u.email.toLowerCase() === String(email || '').trim().toLowerCase()
  );

  // Se verifica siempre contra un hash, exista el usuario o no, para que el
  // tiempo de respuesta no revele qué emails están registrados.
  const hash = user?.hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(String(password ?? ''), hash);

  if (!user || !ok) return null;
  if (user.activo === false) return null;

  return { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol || 'editor' };
}

export function newUserId() {
  return 'u_' + crypto.randomBytes(6).toString('hex');
}

/** Devuelve el archivo users.json con el usuario añadido o actualizado. */
export function upsertUser(users, user) {
  const now = new Date().toISOString();
  const list = users.slice();
  const i = list.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());

  const record = {
    id: user.id ?? newUserId(),
    nombre: user.nombre,
    email: user.email.toLowerCase(),
    hash: user.hash,
    rol: user.rol || 'editor',
    activo: true,
    creado: i >= 0 ? list[i].creado ?? now : now,
    actualizado: now,
  };

  if (i >= 0) list[i] = record;
  else list.push(record);

  return { usuarios: list };
}

/** Quita `hash` para no devolverlo nunca al cliente. */
export function publicUser(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol || 'editor',
    activo: u.activo !== false,
  };
}
