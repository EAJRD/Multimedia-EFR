/* ============================================
   El registro de usuarios no debe salir en claro al repo, que es
   público. Se comprueba interceptando la llamada a la API de GitHub:
   lo que se manda por PUT tiene que ir cifrado, y tiene que volver a
   abrirse con la misma SESSION_SECRET.
   Uso: node tools/test-secret-box.mjs
   ============================================ */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const results = [];
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    failed++;
    results.push(`FAIL  ${name}\n        ${String(e.message).split('\n').slice(0, 5).join('\n        ')}`);
  }
}

const SECRET = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = SECRET;
process.env.GITHUB_TOKEN = 'token-falso-para-la-prueba';
process.env.GITHUB_REPO = 'EAJRD/Multimedia-EFR';
process.env.GITHUB_BRANCH = 'main';

const { sellar, abrir, estaSellado } = await import('../api/_lib/secret-box.js');
const { githubStore } = await import('../api/_lib/store-github.js');

const HASH = '$2b$12$' + 'x'.repeat(53);
const REGISTRO = { usuarios: [{ id: 'u1', nombre: 'Ada', email: 'ada@x.co', hash: HASH, rol: 'admin' }] };

/* --- La caja fuerte, suelta --- */

await check('sellar y abrir devuelve lo mismo', () => {
  assert.deepEqual(abrir(sellar(REGISTRO)), REGISTRO);
});

await check('el texto sellado no contiene ni el email ni el hash', () => {
  const texto = JSON.stringify(sellar(REGISTRO));
  assert.ok(!texto.includes('ada@x.co'), 'el email se lee en claro');
  assert.ok(!texto.includes(HASH), 'el hash se lee en claro');
  assert.ok(!texto.includes('Ada'), 'el nombre se lee en claro');
});

await check('sellar dos veces da ciphertext distinto (IV aleatorio)', () => {
  assert.notEqual(JSON.stringify(sellar(REGISTRO)), JSON.stringify(sellar(REGISTRO)));
});

await check('un registro en claro se acepta sin error', () => {
  assert.deepEqual(abrir(REGISTRO), REGISTRO);
  assert.equal(estaSellado(REGISTRO), false);
});

await check('un archivo sellado se detecta', () => {
  assert.equal(estaSellado(sellar(REGISTRO)), true);
});

await check('truncar el ciphertext da error, no datos corruptos', () => {
  const roto = sellar(REGISTRO);
  roto.datos = roto.datos.slice(0, 20);
  assert.throws(() => abrir(roto), /SESSION_SECRET/);
});

await check('con otra SESSION_SECRET no se puede abrir', () => {
  const sellado = sellar(REGISTRO);
  const antes = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  try {
    assert.throws(() => abrir(sellado), /SESSION_SECRET/);
  } finally {
    process.env.SESSION_SECRET = antes;
  }
});

/* --- Lo que realmente sube al repo --- */

let subido = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/contents/data/users.json') && (opts.method || 'GET') === 'PUT') {
    subido = JSON.parse(Buffer.from(opts.body).toString('utf8'));
    return new Response('{}', { status: 200 });
  }
  if (u.includes('/contents/data/users.json')) {
    if (!subido) return new Response('Not Found', { status: 404 });
    return new Response(JSON.stringify(subido), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(url, opts);
};

await check('saveUsers manda el registro cifrado, no en claro', async () => {
  await githubStore.saveUsers(REGISTRO);
  assert.ok(subido, 'nunca se hizo el PUT');
  const cuerpoDelPut = JSON.stringify(subido);
  assert.ok(!cuerpoDelPut.includes('ada@x.co'), 'el email llegó en claro al repo');
  assert.ok(!cuerpoDelPut.includes(HASH), 'el hash llegó en claro al repo');
  // Lo que realmente se guarda es el base64 de content.
  const archivo = JSON.parse(Buffer.from(subido.content, 'base64').toString('utf8'));
  assert.equal(estaSellado(archivo), true, 'el archivo del repo no va marcado como cifrado');
});

await check('getUsers recupera el registro después del viaje', async () => {
  const archivoEnRepo = JSON.parse(Buffer.from(subido.content, 'base64').toString('utf8'));
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('data/users.json') && (opts.method || 'GET') === 'GET') {
      return new Response(JSON.stringify(archivoEnRepo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(url, opts);
  };
  assert.deepEqual(await githubStore.getUsers(), REGISTRO);
});

await check('sin SESSION_SECRET no se escribe nada en claro', async () => {
  const antes = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    await assert.rejects(() => githubStore.saveUsers(REGISTRO), /SESSION_SECRET/);
  } finally {
    process.env.SESSION_SECRET = antes;
  }
});

globalThis.fetch = realFetch;

console.log('\n' + results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} OK`);
if (failed) process.exit(1);
