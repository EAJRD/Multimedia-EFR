/* ============================================
   /api/auth
     GET    → quién está con sesión
     POST   → { accion: 'login' | 'register' | 'logout' }
   ============================================ */

import { store, IS_READ_ONLY, requireWritable } from './_lib/store.js';
import { createSession, readSession, sessionCookie, clearCookie } from './_lib/session.js';
import { authenticate, validateNewUser, hashPassword, upsertUser, publicUser, newUserId, verifyPasswordShape } from './_lib/users.js';
import { send, fail, readBody, rateLimit, guard } from './_lib/http.js';

const IS_PROD = process.env.NODE_ENV === 'production';

/* Intentos de login permitidos por IP. Ajustable porque un campus entero
   puede salir por la misma NAT: 8 sería demasiado para la ECFR. */
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || (IS_PROD ? 25 : 100));
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60_000);

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    // Fallar ruidosamente es mejor que sessions falsificadas.
    throw new Error('Falta SESSION_SECRET. Genera uno con: openssl rand -hex 32');
  }
  if (IS_PROD && s.length < 32) {
    throw new Error('SESSION_SECRET demasiado corto en producción (mínimo 32 caracteres)');
  }
  return s;
}

export const handler = guard(async (req, res) => {
  const method = req.method.toUpperCase();
  const sesion = readSession(req.headers.cookie, process.env.SESSION_SECRET);

  if (method === 'GET') {
    // Listado de usuarios: solo admin, y sin hashes.
    if (req.query?.listado) {
      if (!sesion || sesion.rol !== 'admin') return fail(res, 403, 'Solo un admin puede ver los usuarios.');
      const data = await store.getUsers();
      return send(res, 200, { usuarios: data.usuarios.map(publicUser) });
    }

    if (!sesion) {
      // Un solo booleano: si el registro está vacío se puede crear el primer
      // admin sin sesión. No se expone quién ni cuántos hay.
      let arranque = false;
      try {
        arranque = (await store.getUsers()).usuarios.length === 0;
      } catch {
        arranque = false;
      }
      return send(res, 200, {
        autenticado: false,
        arranque,
        backend: store.name,
        soloLectura: IS_READ_ONLY,
      });
    }
    return send(res, 200, { autenticado: true, usuario: sesion, backend: store.name, soloLectura: IS_READ_ONLY });
  }

  if (method !== 'POST') return fail(res, 405, 'Método no permitido.');

  const body = await readBody(req);
  const accion = String(body.accion || 'login');

  /* --- logout --- */
  if (accion === 'logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(IS_PROD) });
  }

  /* --- crear usuario ---
     Dos caminos:
       · con sesión de admin, siempre;
       · sin sesión, solo si el registro está vacío. Es el arranque en frío:
         sin él no habría forma de crear el primer admin en un despliegue
         nuevo, porque el registro no se puede versionar (son hashes). */
  if (accion === 'register') {
    const data = await store.getUsers();
    const vacio = data.usuarios.length === 0;
    const esAdmin = sesion?.rol === 'admin';

    if (!esAdmin && !(vacio && !sesion)) {
      return fail(res, 403, 'Solo un admin puede crear usuarios.');
    }
    requireWritable();

    const { nombre, email, password, rol } = body;
    const v = validateNewUser({ nombre, email, password, rol });
    if (!v.ok) return fail(res, 400, v.errors.join(' '), { errores: v.errors });

    if (data.usuarios.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
      return fail(res, 409, 'Ya existe un usuario con ese email.');
    }

    // El primero que se crea sin sesión es admin; si no, el que llegue
    // después sin sesión podría degradarse a editor por whim suyo.
    const primerAdmin = vacio && !esAdmin;

    const guardado = await store.saveUsers(
      upsertUser(data.usuarios, {
        id: newUserId(),
        nombre: String(nombre).trim(),
        email: String(email).trim().toLowerCase(),
        hash: await hashPassword(password),
        rol: primerAdmin ? 'admin' : rol || 'editor',
      })
    );

    return send(res, 201, { ok: true, arranque: primerAdmin, guardado });
  }

  /* --- login --- */
  const permitido = await new Promise((ok) => {
    rateLimit({ max: MAX_ATTEMPTS, windowMs: WINDOW_MS })(req, res, () => ok(true));
  });
  // Si no se llamó a next(), el limitador ya respondió 429.
  if (!permitido) return;

  const { email, password } = body;
  if (!email || !verifyPasswordShape(password)) {
    return fail(res, 401, 'Email o contraseña incorrectos.');
  }

  const data = await store.getUsers();
  const user = await authenticate(data.usuarios, email, password);
  if (!user) return fail(res, 401, 'Email o contraseña incorrectos.');

  return send(res, 200, { ok: true, usuario: publicUser(user) }, {
    'Set-Cookie': sessionCookie(createSession(user, secret()), IS_PROD),
  });
});

export default handler;
