/* ============================================
   Caja fuerte para el registro de usuarios.

   En Vercel no hay disco, así que el registro tiene que vivir fuera.
   Acabamos usando el repo, pero el repo es público: si se guardan los
   hashes tal cual, cualquiera que abra el repo ve el email del admin y
   se lleva un hash bcrypt para atacar en local.

   Así que el archivo que sube al repo va cifrado con AES-256-GCM, con
   clave derivada de SESSION_SECRET. SESSION_SECRET solo vive en las
   variables de entorno de Vercel, así que el archivo del repo no sirve
   de nada sin él. Sigue sin ser ideal, pero es la diferencia entre
   "un hash bcrypt expuesto" y "nada legible".

   Solo se aplica al backend de GitHub. En Docker los usuarios viven en
   el volumen SQLite, en el disco del dueño: no hay nada que esconder y
   cifrar ahí solo añade formas de fallar.
   ============================================ */

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const MARCA = 'aes-256-gcm/v1';

function clave() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'Falta SESSION_SECRET: sin ella el registro de usuarios no se puede cifrar. ' +
        'No se escribe nada en claro en el repo a propósito.'
    );
  }
  // scrypt no hace falta aquí: SESSION_SECRET ya es aleatoria y de 64 hex.
  // Un SHA-256 basta para convertirla en una clave de 32 bytes.
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function sellar(datos) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, clave(), iv);
  const cifrado = Buffer.concat([
    cipher.update(JSON.stringify(datos), 'utf8'),
    cipher.final(),
  ]);
  return {
    __cifrado: MARCA,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    datos: cifrado.toString('base64'),
  };
}

export function estaSellado(algo) {
  return Boolean(algo && typeof algo === 'object' && algo.__cifrado === MARCA);
}

/* Un registro en claro se acepta, para no dejar fuera a quien ya tenga
   uno escrito antes de existir esto. Un archivo sellado que no se puede
   abrir sí es un error: casi siempre significa SESSION_SECRET distinta. */
export function abrir(algo) {
  if (!estaSellado(algo)) return algo;
  try {
    const decipher = crypto.createDecipheriv(ALGO, clave(), Buffer.from(algo.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(algo.tag, 'base64'));
    const texto = Buffer.concat([
      decipher.update(Buffer.from(algo.datos, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(texto);
  } catch {
    throw new Error(
      'No se pudo descifrar data/users.json. SESSION_SECRET no es la misma que ' +
        'la de cuando se guardó. Sin ella no hay forma de recuperar los usuarios.'
    );
  }
}
