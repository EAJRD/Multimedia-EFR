/* ============================================
   Pruebas de la API y del panel de admin contra el
   servidor real. Levanta su propio Express en un puerto
   libre, así que no depende de que haya uno corriendo.
   Uso: npm test
   ============================================ */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = '/tmp/opencode/mm-test-suite.sqlite';

const SECRET = crypto.randomBytes(32).toString('hex');
const PASSWORD = 'contrasena-de-prueba-2026';

process.env.SESSION_SECRET = SECRET;
process.env.DATABASE_PATH = DB;
process.env.STORE = 'sqlite';
process.env.NODE_ENV = 'development';
// El límite se agota en el test de fuerza bruta, que va el último.
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 100);

for (const p of [DB, DB + '-wal', DB + '-shm']) {
  try { rmSync(p); } catch { /* no existía */ }
}

const results = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    failed++;
    const detalle = String(e.message).split('\n').slice(0, 6).map((l) => '        ' + l).join('\n');
    results.push(`FAIL  ${name}\n${detalle}`);
  }
}

/* ---------- Servidor estático para el front ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const files = createServer(async (req, res) => {
  const p = normalize(decodeURI(req.url.split('?')[0]));
  try {
    const buf = await readFile(join(SITE, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => files.listen(4000, r));

/* ---------- API ---------- */

/* --- El registro se escribe ANTES de arrancar el servidor, porque el
   backend SQLite siembra desde data/users.json en el primer arranque. --- */

const { upsertUser, hashPassword } = await import('../api/_lib/users.js');
const { writeFileSync } = await import('node:fs');
const USERS_FILE = join(SITE, 'data', 'users.json');
const originalUsers = await readFile(USERS_FILE, 'utf8').catch(() => '{"usuarios":[]}');

writeFileSync(
  USERS_FILE,
  JSON.stringify(upsertUser([], {
    id: 'u_demo', nombre: 'Ana Pérez', email: 'ana@multimedios.example',
    hash: await hashPassword(PASSWORD), rol: 'admin',
  }), null, 2) + '\n'
);

const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], {
  cwd: SITE,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(d.toString()));
server.stderr.on('data', (d) => serverLog.push(d.toString()));

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('el servidor no arrancó:\n' + serverLog.join(''))), 15000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('Multimedios en')) { clearTimeout(t); resolve(); }
  });
});

/* ---------- Cliente HTTP con cookies ---------- */

function makeClient() {
  let cookie = '';
  return async (path, options = {}) => {
    const res = await fetch(BASE + path, {
      method: options.method || 'GET',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) cookie = c.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, body: json, setCookie: set, cookie: () => cookie };
  };
}

/* ============================================================ */

const anon = makeClient();
const sesion = { cookie: '' };

await check('GET /api/health responde ok', async () => {
  const r = await anon('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

await check('GET /api/projects es público y trae el contenido', async () => {
  const r = await anon('/api/projects');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.proyectos));
  assert.ok(r.body.proyectos.length >= 5, 'esperaba al menos 5 proyectos');
  assert.ok(r.body.categorias.length >= 3);
});

await check('GET /api/projects nunca filtra un hash', async () => {
  const r = await anon('/api/projects');
  const texto = JSON.stringify(r.body);
  assert.ok(!/\$2[aby]\$/.test(texto), 'apareció un hash bcrypt en la respuesta');
});

await check('POST /api/projects sin sesión → 401', async () => {
  const r = await anon('/api/projects', { method: 'POST', body: { categorias: [], proyectos: [] } });
  assert.equal(r.status, 401);
});

await check('PUT /api/projects sin sesión → 401', async () => {
  const r = await anon('/api/projects', { method: 'PUT', body: { proyecto: {} } });
  assert.equal(r.status, 401);
});

await check('DELETE /api/projects sin sesión → 401', async () => {
  const r = await anon('/api/projects', { method: 'DELETE', body: { id: 'x' } });
  assert.equal(r.status, 401);
});

await check('login con contraseña corta → 401', async () => {
  const r = await anon('/api/auth', { method: 'POST', body: { accion: 'login', email: 'a@b.co', password: 'corta' } });
  assert.equal(r.status, 401);
});

await check('login con email inexistente → 401', async () => {
  const r = await anon('/api/auth', { method: 'POST', body: { accion: 'login', email: 'nadie@x.co', password: PASSWORD } });
  assert.equal(r.status, 401);
});

await check('GET /api/auth sin sesión → autenticado:false', async () => {
  const r = await anon('/api/auth');
  assert.equal(r.body.autenticado, false);
});

/* --- caché: el admin nunca debe leer de la CDN --- */

await check('GET /api/projects anónimo se puede cachear 1 minuto', async () => {
  const r = await fetch(BASE + '/api/projects');
  assert.match(r.headers.get('cache-control') || '', /max-age=60/);
  assert.equal(r.headers.get('vary'), 'Cookie');
});

await check('GET /api/projects con cookie va con no-store', async () => {
  // Se comprueba antes de iniciar sesión, con una cookie cualquiera: lo que
  // cuenta es que el backend no fíe en la caché si viene una.
  const r = await fetch(BASE + '/api/projects', { headers: { cookie: 'mm_sesion=cualquiera' } });
  assert.equal(r.headers.get('cache-control'), 'no-store', 'el panel podría leer contenido viejo');
});

/* --- el diagnóstico de solo lectura tiene que ser accionable --- */

await check('el diagnóstico nombra las variables que faltan', async () => {
  const antes = { ...process.env };
  delete process.env.GITHUB_REPO;
  delete process.env.GITHUB_TOKEN;
  delete process.env.DATABASE_PATH;
  delete process.env.VERCEL;
  try {
    const { diagnosticoAlmacenamiento } = await import('../api/_lib/store.js?' + Date.now());
    const enLocal = diagnosticoAlmacenamiento();
    assert.ok(/DATABASE_PATH/.test(enLocal), 'no sugiere la variable local');
    assert.ok(/npm start/.test(enLocal), 'no dice cómo se carga el .env');

    process.env.VERCEL = '1';
    const enVercel = diagnosticoAlmacenamiento();
    assert.ok(/GITHUB_REPO/.test(enVercel) && /GITHUB_TOKEN/.test(enVercel), 'no nombra las de Vercel');
    assert.ok(/Redeploy/i.test(enVercel), 'no avisa de que cambiar una variable no redeploya');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
    Object.assign(process.env, antes);
  }
});

await check('un despliegue en Vercel sin variables da 503 con el diagnóstico', async () => {
  // Esta es la ruta exacta que se-topa alguien con Vercel sin configurar:
  // el registro sale vacío, el panel ofrece arrancar, y al crear el primer
  // admin no hay dónde guardarlo. Con variables de solo lectura.
  const PORT_RO = 3197;
  // En Vercel el despliegue no trae data/users.json: no está en el repo. En
  // local sí está, así que hay que quitarlo para reproducir el estado real.
  const saved = await readFile(USERS_FILE, 'utf8');
  writeFileSync(USERS_FILE, JSON.stringify({ usuarios: [] }, null, 2) + '\n');
  const ro = spawn(process.execPath, ['server/index.js'], {
    cwd: SITE,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      VERCEL: '1',
      SESSION_SECRET: 'x'.repeat(64),
      PORT: String(PORT_RO),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logRo = [];
  ro.stdout.on('data', (d) => logRo.push(d.toString()));
  ro.stderr.on('data', (d) => logRo.push(d.toString()));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no arrancó: ' + logRo.join(''))), 15000);
      ro.stdout.on('data', (d) => d.toString().includes('Multimedios en') && (clearTimeout(t), resolve()));
    });

    // Sin variables, el sitio sigue siendo legible: solo lectura.
    const listado = await fetch(`http://127.0.0.1:${PORT_RO}/api/projects`);
    assert.equal(listado.status, 200, 'el contenido público debe seguir leyéndose');
    assert.equal((await listado.json()).proyectos.length, 7);

    const anon2 = await (await fetch(`http://127.0.0.1:${PORT_RO}/api/auth`)).json();
    assert.equal(anon2.arranque, true, 'sin registro, debe ofrecer arrancar');

    const res = await fetch(`http://127.0.0.1:${PORT_RO}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accion: 'register', nombre: 'Ada', email: 'ada@x.co', password: PASSWORD,
      }),
    });
    assert.equal(res.status, 503);
    const cuerpo = await res.json();
    assert.ok(/GITHUB_REPO/.test(cuerpo.error), 'no dice qué configurar: ' + cuerpo.error);
    assert.ok(/Redeploy/i.test(cuerpo.error), 'no avisa de que cambiar una variable no redeploya');
  } finally {
    ro.kill();
    writeFileSync(USERS_FILE, saved);
  }
});

/* --- registro: el primero se crea a mano en users.json --- */

await check('register sin sesión → 403 cuando ya hay usuarios', async () => {
  const r = await anon('/api/auth', {
    method: 'POST',
    body: { accion: 'register', nombre: 'Intruso', email: 'i@x.co', password: PASSWORD },
  });
  assert.equal(r.status, 403, 'el arranque en frío debería estar cerrado: hay usuarios');
});

await check('GET /api/auth sin sesión dice arranque:false con usuarios', async () => {
  const r = await anon('/api/auth');
  assert.equal(r.body.autenticado, false);
  assert.equal(r.body.arranque, false, 'no debe ofrecer arranque con usuarios ya registrados');
});

await check('GET /api/auth no filtra nada del registro', async () => {
  const r = await anon('/api/auth');
  const t = JSON.stringify(r.body);
  assert.ok(!t.includes(PASSWORD), 'se filtró una contraseña');
  assert.ok(!/\$2[aby]\$/.test(t), 'se filtró un hash');
  assert.ok(!/usuarios|ana@/.test(t), 'se filtró el registro de usuarios');
});

await check('login con contraseña incorrecta → 401', async () => {
  const r = await anon('/api/auth', {
    method: 'POST', body: { accion: 'login', email: 'ana@multimedios.example', password: 'incorrecta-123456' },
  });
  assert.equal(r.status, 401);
});

await check('login correcto → 200 con cookie httpOnly', async () => {
  const r = await anon('/api/auth', {
    method: 'POST', body: { accion: 'login', email: 'ana@multimedios.example', password: PASSWORD },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.email, 'ana@multimedios.example');
  assert.equal(r.body.usuario.rol, 'admin');
  assert.ok(!('hash' in r.body.usuario), 'el usuario devuelto trae hash');

  const cookie = r.setCookie.find((c) => c.startsWith('mm_session='));
  assert.ok(cookie, 'no llegó la cookie de sesión');
  assert.ok(/HttpOnly/i.test(cookie), 'la cookie no es HttpOnly');
  assert.ok(/SameSite=Lax/i.test(cookie), 'la cookie no es SameSite=Lax');
  sesion.cookie = cookie.split(';')[0];
});

await check('cookie falsificada se rechaza', async () => {
  const r = await fetch(BASE + '/api/auth', { headers: { cookie: 'mm_session=eyJzdWIiOiJhZG1pbiJ9.firma-falsa' } });
  const j = await r.json();
  assert.equal(j.autenticado, false);
});

await check('cookie con firma recortada se rechaza', async () => {
  const partes = sesion.cookie.split('=')[1].split('.');
  const r = await fetch(BASE + '/api/auth', {
    headers: { cookie: `mm_session=${partes[0]}.${partes[1].slice(0, -3)}` },
  });
  const j = await r.json();
  assert.equal(j.autenticado, false);
});

const auth = makeClient();
auth.cookieOverride = sesion.cookie;
const asUser = (p, o) => {
  const c = makeClient();
  return c(p, o);
};

/* Cliente autenticado: reutiliza el mismo flujo con la cookie buena. */
const conSesion = async (path, options = {}) => {
  const r = await fetch(BASE + path, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      cookie: sesion.cookie,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, body: json };
};

await check('GET /api/auth con sesión → autenticado:true', async () => {
  const r = await conSesion('/api/auth');
  assert.equal(r.body.autenticado, true);
  assert.equal(r.body.usuario.email, 'ana@multimedios.example');
});

await check('GET /api/auth?listado=1 como admin → sin hashes', async () => {
  const r = await conSesion('/api/auth?listado=1');
  assert.equal(r.status, 200);
  assert.ok(r.body.usuarios.length >= 1);
  assert.ok(!JSON.stringify(r.body).match(/\$2[aby]\$/), 'se filtró un hash bcrypt');
});

await check('POST /api/projects con sesión guarda y persiste', async () => {
  const antes = (await anon('/api/projects')).body;
  const nuevos = {
    categorias: antes.categorias,
    proyectos: [...antes.proyectos, {
      id: 'prueba-suite', titulo: 'Proyecto de prueba', categoria: antes.categorias[0].id,
      cliente: 'QA', anio: '2026', duracion: '01:00', resumen: 'Creado por la suite de pruebas.',
      detalle: 'No debe quedarse en la base.', meta: 'Prueba', imagen: 'img/encajonado.svg',
      alt: 'Prueba', destacado: false, pendiente: true,
    }],
  };
  const r = await conSesion('/api/projects', { method: 'POST', body: nuevos });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, nuevos.proyectos.length);

  const despues = (await anon('/api/projects')).body;
  assert.ok(despues.proyectos.some((p) => p.id === 'prueba-suite'), 'no se persistió');
});

await check('el contenido nuevo aparece en el sitio público', async () => {
  const r = await anon('/api/projects');
  const p = r.body.proyectos.find((x) => x.id === 'prueba-suite');
  assert.ok(p, 'el proyecto no está en la API pública');
  assert.equal(p.titulo, 'Proyecto de prueba');
});

await check('PUT upsert no duplica', async () => {
  const d = (await anon('/api/projects')).body;
  const p = d.proyectos.find((x) => x.id === 'prueba-suite');
  p.titulo = 'Proyecto renombrado';
  const r = await conSesion('/api/projects', { method: 'PUT', body: { proyecto: p } });
  assert.equal(r.status, 200);
  const d2 = (await anon('/api/projects')).body;
  assert.equal(d2.proyectos.filter((x) => x.id === 'prueba-suite').length, 1);
  assert.equal(d2.proyectos.find((x) => x.id === 'prueba-suite').titulo, 'Proyecto renombrado');
});

await check('categoría inexistente → 400', async () => {
  const d = (await anon('/api/projects')).body;
  const r = await conSesion('/api/projects', {
    method: 'POST',
    body: { categorias: d.categorias, proyectos: [{ titulo: 'X', categoria: 'no-existe', resumen: 'x' }] },
  });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.includes('no-existe'));
});

await check('ruta de imagen fuera de img/ → 400', async () => {
  const d = (await anon('/api/projects')).body;
  const r = await conSesion('/api/projects', {
    method: 'POST',
    body: {
      categorias: d.categorias,
      proyectos: [{ titulo: 'X', categoria: d.categorias[0].id, resumen: 'x', imagen: '../../etc/passwd' }],
    },
  });
  assert.equal(r.status, 400);
});

await check('id duplicado → 400', async () => {
  const d = (await anon('/api/projects')).body;
  const p = { titulo: 'A', categoria: d.categorias[0].id, resumen: 'x' };
  const r = await conSesion('/api/projects', { method: 'POST', body: { categorias: d.categorias, proyectos: [p, p] } });
  assert.equal(r.status, 400);
});

await check('DELETE borra el proyecto', async () => {
  const r = await conSesion('/api/projects', { method: 'DELETE', body: { id: 'prueba-suite' } });
  assert.equal(r.status, 200);
  const d = (await anon('/api/projects')).body;
  assert.ok(!d.proyectos.some((p) => p.id === 'prueba-suite'));
});

await check('DELETE de id inexistente → 404', async () => {
  const r = await conSesion('/api/projects', { method: 'DELETE', body: { id: 'no-existe' } });
  assert.equal(r.status, 404);
});

await check('método no permitido → 405', async () => {
  const r = await conSesion('/api/projects', { method: 'PATCH' });
  assert.equal(r.status, 405);
});

await check('JSON roto → 400, no 500', async () => {
  const r = await fetch(BASE + '/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: sesion.cookie },
    body: '{esto no es json',
  });
  assert.equal(r.status, 400);
});

await check('register con email repetido → 409', async () => {
  const r = await conSesion('/api/auth', {
    method: 'POST',
    body: { accion: 'register', nombre: 'Otra', email: 'ana@multimedios.example', password: PASSWORD },
  });
  assert.equal(r.status, 409);
});

await check('register con contraseña corta → 400', async () => {
  const r = await conSesion('/api/auth', {
    method: 'POST', body: { accion: 'register', nombre: 'Corto', email: 'c@x.co', password: 'corta' },
  });
  assert.equal(r.status, 400);
});

await check('register crea un editor y puede entrar con él', async () => {
  const nuevo = 'editor-de-prueba';
  const r = await conSesion('/api/auth', {
    method: 'POST', body: { accion: 'register', nombre: 'Luis Edita', email: `${nuevo}@x.co`, password: PASSWORD, rol: 'editor' },
  });
  assert.equal(r.status, 201);

  const c = makeClient();
  const login = await c('/api/auth', { method: 'POST', body: { accion: 'login', email: `${nuevo}@x.co`, password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.body.usuario.rol, 'editor');
});

await check('un editor NO puede crear usuarios', async () => {
  const c = makeClient();
  await c('/api/auth', { method: 'POST', body: { accion: 'login', email: 'editor-de-prueba@x.co', password: PASSWORD } });
  const r = await c('/api/auth', {
    method: 'POST', body: { accion: 'register', nombre: 'Escalada', email: 'e@x.co', password: PASSWORD },
  });
  assert.equal(r.status, 403);
});

await check('un editor NO puede ver el listado de usuarios', async () => {
  const c = makeClient();
  await c('/api/auth', { method: 'POST', body: { accion: 'login', email: 'editor-de-prueba@x.co', password: PASSWORD } });
  const r = await c('/api/auth?listado=1');
  assert.equal(r.status, 403);
});

await check('logout invalida la cookie', async () => {
  const c = makeClient();
  await c('/api/auth', { method: 'POST', body: { accion: 'login', email: 'ana@multimedios.example', password: PASSWORD } });
  const out = await c('/api/auth', { method: 'POST', body: { accion: 'logout' } });
  assert.equal(out.status, 200);
  const after = await c('/api/auth');
  assert.equal(after.body.autenticado, false);
});

/* ============================================================
   Front: sitio público y panel de admin
   ============================================================ */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

// El panel habla con el Express del puerto 3199; el front se sirve en el 4000.
await page.route('**/api/**', (route) => {
  const url = new URL(route.request().url());
  route.continue({ url: `${BASE}${url.pathname}${url.search}` });
});

await check('admin.html sin sesión muestra el login', async () => {
  await page.goto('http://127.0.0.1:4000/admin.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#loginView:not([hidden])');
  assert.equal(await page.locator('#panelView').isHidden(), true);
});

await check('el sitio público no filtra el panel de admin', async () => {
  await page.goto('http://127.0.0.1:4000/index.html', { waitUntil: 'networkidle' });
  const html = await page.content();
  assert.ok(!html.includes('SESSION_SECRET'));
  assert.ok(!html.includes('GITHUB_TOKEN'));
});

await check('login fallido muestra error y no abre el panel', async () => {
  await page.goto('http://127.0.0.1:4000/admin.html', { waitUntil: 'networkidle' });
  await page.fill('#email', 'ana@multimedios.example');
  await page.fill('#password', 'contrasena-equivocada');
  await page.click('#loginSubmit');
  await page.waitForSelector('#loginError:not([hidden])');
  assert.equal(await page.locator('#panelView').isHidden(), true);
});

await check('login correcto abre el panel con la lista cargada', async () => {
  await page.fill('#email', 'ana@multimedios.example');
  await page.fill('#password', PASSWORD);
  await page.click('#loginSubmit');
  await page.waitForSelector('#panelView:not([hidden])');
  const n = await page.locator('#plist button').count();
  assert.ok(n >= 5, `esperaba 5+ proyectos en la lista, hay ${n}`);
  assert.ok((await page.textContent('#whoami')).includes('Ana'));
});

await check('el admin no muestra hashes en el DOM', async () => {
  const html = await page.content();
  assert.ok(!/\$2[aby]\$/.test(html), 'hay un hash bcrypt en el panel');
});

await check('el panel de admin ofrece crear usuarios a un admin', async () => {
  assert.equal(await page.locator('#userBox').isVisible(), true);
  const n = await page.locator('#ulist li').count();
  assert.ok(n >= 1, 'el listado de usuarios está vacío');
});

await check('crear un proyecto lo añade a la lista sin publicar', async () => {
  await page.click('#newBtn');
  await page.fill('#f_titulo', 'Proyecto desde el panel');
  await page.fill('#f_resumen', 'Escrito en la prueba end-to-end.');
  await page.fill('#f_imagen', 'img/encajonado.svg');
  await page.fill('#f_alt', 'Imagen de prueba');
  await page.click('#projectForm button[type=submit]');
  await page.waitForSelector('#savebar:not([hidden])');
  const textos = await page.locator('#plist button .name').allTextContents();
  assert.ok(textos.includes('Proyecto desde el panel'), 'no apareció en la lista');
});

await check('publicar persiste y el sitio público lo muestra', async () => {
  await page.click('#saveAllBtn');
  await page.waitForSelector('#toast:not([hidden])');
  const r = await anon('/api/projects');
  assert.ok(r.body.proyectos.some((p) => p.titulo === 'Proyecto desde el panel'), 'no llegó al backend');
});

await check('el sitio público pinta los proyectos del backend', async () => {
  await page.goto('http://127.0.0.1:4000/index.html', { waitUntil: 'networkidle' });
  const t = await page.locator('#projectGrid').textContent();
  assert.ok(t.includes('Proyecto desde el panel'), 'el sitio no lo pintó');
});

await check('el sitio público filtra por categoría', async () => {
  await page.click('[data-filter="cortometraje"]');
  const vis = await page.locator('.project:not(.is-hidden)').count();
  assert.ok(vis >= 2, 'el filtro no dejó nada visible');
});

await check('el modal de proyecto funciona con datos del backend', async () => {
  await page.click('[data-filter="todos"]');
  await page.locator('.project__open').first().click();
  await page.waitForSelector('#modal:not([hidden])');
  assert.ok((await page.textContent('#modalTitle')).trim().length > 0);
});

await check('borrar un proyecto lo quita al publicar', async () => {
  await page.keyboard.press('Escape');
  await page.goto('http://127.0.0.1:4000/admin.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panelView:not([hidden])');
  page.on('dialog', (d) => d.accept());
  const btn = page.locator('#plist button', { hasText: 'Proyecto desde el panel' });
  await btn.click();
  await page.click('#deleteBtn');
  await page.click('#saveAllBtn');
  await page.waitForSelector('#toast:not([hidden])');
  const r = await anon('/api/projects');
  assert.ok(!r.body.proyectos.some((p) => p.titulo === 'Proyecto desde el panel'));
});

await check('un texto con HTML se muestra literal, no se ejecuta', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const d = (await anon('/api/projects')).body;
  await conSesion('/api/projects', {
    method: 'POST',
    body: {
      categorias: d.categorias,
      proyectos: [{
        id: 'xss-check', titulo: payload, categoria: d.categorias[0].id,
        resumen: 'Comprobación de escape', imagen: 'img/encajonado.svg', alt: 'x',
      }],
    },
  });

  await page.goto('http://127.0.0.1:4000/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.project:has-text("onerror")');

  // 1. No se creó ningún elemento a partir del payload.
  const inyectados = await page.locator('#projectGrid img[onerror], #projectGrid script').count();
  assert.equal(inyectados, 0, 'se inyectó un elemento desde el título');

  // 2. Se muestra tal cual, como texto.
  const titulo = await page.locator('#projectGrid h3', { hasText: 'onerror' }).first().textContent();
  assert.equal(titulo.trim(), payload, 'el payload no se muestra literal');

  // 3. Ni siquiera al abrir el modal se interpreta.
  await page.locator('.project__open').first().click();
  await page.waitForSelector('#modal:not([hidden])');
  const modalInyectado = await page.locator('#modal img[onerror], #modal script').count();
  assert.equal(modalInyectado, 0, 'se inyectó un elemento en el modal');
});

await check('sin errores de JS en todo el recorrido', async () => {
  // Los 401 de los intentos de login fallidos que acabamos de hacer son
  // respuestas esperadas del navegador, no errores de la página.
  const reales = errores.filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(reales, [], reales.join(' | '));
});

/* Este test agota el límite de la IP, así que tiene que ir el último:
   después ya no se puede hacer ni un login más desde aquí. */
await check('el rate limit corta los intentos de fuerza bruta', async () => {
  const c = makeClient();
  let limited = false;
  for (let i = 0; i < MAX_ATTEMPTS + 10; i++) {
    const r = await c('/api/auth', { method: 'POST', body: { accion: 'login', email: 'fuerza@bruta.co', password: 'aaa' } });
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'el limitador nunca respondió 429');
});

await check('tras el límite, un login legítimo también se frena', async () => {
  const c = makeClient();
  const r = await c('/api/auth', { method: 'POST', body: { accion: 'login', email: 'ana@multimedios.example', password: PASSWORD } });
  assert.equal(r.status, 429);
});

/* ---------- Limpieza ---------- */

writeFileSync(USERS_FILE, originalUsers);
await browser.close();
server.kill();
files.close();
for (const p of [DB, DB + '-wal', DB + '-shm']) {
  try { rmSync(p); } catch { /* ya no está */ }
}

console.log('\n' + results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} OK`);

if (failed) {
  console.log('\n--- log del servidor ---\n' + serverLog.join(''));
  process.exit(1);
}
