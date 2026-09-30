/* ============================================
   Arranque en frío: con el registro de usuarios vacío,
   /admin.html ofrece crear el primer admin sin sesión.
   Necesita su propia base de datos, porque la suite
   principal arranca con un usuario ya creado.
   Uso: node tools/test-bootstrap.mjs
   ============================================ */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3198;
const FRONT = 4001;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = '/tmp/opencode/mm-test-bootstrap.sqlite';
const USERS_FILE = join(SITE, 'data', 'users.json');
const PASSWORD = 'primera-contrasena-larga';
const ADMIN = { nombre: 'Ada Admin', email: 'ada@multimedios.example' };

process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_PATH = DB;
process.env.STORE = 'sqlite';
process.env.NODE_ENV = 'development';

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
    results.push(`FAIL  ${name}\n${String(e.message).split('\n').slice(0, 6).map((l) => '        ' + l).join('\n')}`);
  }
}

/* Registro vacío: el estado de un despliegue recién llegado. */
const originalUsers = await readFile(USERS_FILE, 'utf8').catch(() => '{"usuarios":[]}');
writeFileSync(USERS_FILE, JSON.stringify({ usuarios: [] }, null, 2) + '\n');

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
await new Promise((r) => files.listen(FRONT, r));

const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], {
  cwd: SITE,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = [];
server.stdout.on('data', (d) => log.push(d.toString()));
server.stderr.on('data', (d) => log.push(d.toString()));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('el servidor no arrancó:\n' + log.join(''))), 15000);
  server.stdout.on('data', (d) => d.toString().includes('Multimedios en') && (clearTimeout(t), resolve()));
});

const get = async (path) => (await fetch(BASE + path)).json();

const post = async (path, body, cookie) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, body: json };
};

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));
await page.route('**/api/**', (route) => {
  const url = new URL(route.request().url());
  route.continue({ url: `${BASE}${url.pathname}${url.search}` });
});
const abrirPanel = async () => {
  await page.goto(`http://127.0.0.1:${FRONT}/admin.html`, { waitUntil: 'networkidle' });
};

/* --- 1. Estado vacío, por API --- */

await check('GET /api/auth dice arranque:true con el registro vacío', async () => {
  const r = await get('/api/auth');
  assert.equal(r.autenticado, false);
  assert.equal(r.arranque, true);
});

await check('GET /api/auth no filtra el contenido del registro vacío', async () => {
  const t = JSON.stringify(await get('/api/auth'));
  assert.ok(!/usuarios/.test(t), 'se exponen los usuarios');
});

/* --- 2. Estado vacío, en el panel --- */

await check('el panel ofrece crear el primer admin en vez de pedir login', async () => {
  await abrirPanel();
  assert.equal(await page.locator('#bootstrap').isVisible(), true, 'no aparece el arranque en frío');
  assert.equal(await page.locator('#loginSubmit').isVisible(), false, 'no debería pedir login todavía');
  assert.equal(await page.locator('#panelView').isHidden(), true, 'el panel no debe abrirse sin sesión');
});

await check('el arranque en frío se completa desde el navegador', async () => {
  await page.fill('#b_nombre', ADMIN.nombre);
  await page.fill('#b_email', ADMIN.email);
  await page.fill('#b_password', PASSWORD);
  await page.click('#bootstrapSubmit');
  await page.waitForFunction(
    () => document.getElementById('bootstrapNote')?.textContent.includes('Admin creado'),
    null,
    { timeout: 15000 }
  );
  const nota = await page.textContent('#bootstrapNote');
  assert.ok(!/error/i.test(nota), 'la nota reporta un error: ' + nota);
});

/* --- 3. Con el admin ya creado --- */

await check('el usuario creado en frío puede entrar', async () => {
  const r = await post('/api/auth', { accion: 'login', email: ADMIN.email, password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.rol, 'admin', 'el primero debe ser admin, si no no puede crear más');
});

await check('GET /api/auth ya no ofrece arranque', async () => {
  const r = await get('/api/auth');
  assert.equal(r.arranque, false, 'la vía de arranque debe cerrarse sola tras el primer usuario');
});

await check('un segundo registro sin sesión se rechaza', async () => {
  const r = await post('/api/auth', {
    accion: 'register', nombre: 'Intruso', email: 'i@x.co', password: PASSWORD,
  });
  assert.equal(r.status, 403);
});

await check('el panel vuelve a pedir login, sin ofrecen el arranque', async () => {
  await abrirPanel();
  assert.equal(await page.locator('#bootstrap').isVisible(), false, 'el arranque debe desaparecer');
  assert.equal(await page.locator('#loginSubmit').isVisible(), true, 'debe pedir login');
});

await check('ese admin entra al panel y ve la gestión de usuarios', async () => {
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', PASSWORD);
  await page.click('#loginSubmit');
  await page.waitForSelector('#panelView:not([hidden])');
  assert.ok((await page.textContent('#whoami')).includes('Ada'));
  assert.equal(await page.locator('#userBox').isVisible(), true, 'un admin debe ver la gestión de usuarios');
});

await check('sin errores de JS en el arranque en frío', async () => {
  assert.deepEqual(jsErrors, [], jsErrors.join(' | '));
});

/* --- limpieza --- */

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
  console.log('\n--- log del servidor ---\n' + log.join(''));
  process.exit(1);
}
