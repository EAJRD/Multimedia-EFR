import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const p = normalize(decodeURI(req.url.split('?')[0]));
  const file = join(ROOT, p === '/' ? 'index.html' : p);
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('nope');
  }
});

await new Promise(r => server.listen(4321, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });

const results = [];
const check = (name, pass, extra = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);

// --- 1. Imágenes referenciadas existen ---
const imgs = await page.$$eval('.project__media img', els => els.map(e => e.getAttribute('src')));
for (const src of imgs) {
  const r = await page.request.get('http://localhost:4321/' + src);
  check(`imagen ${src}`, r.status() === 200, 'HTTP ' + r.status());
}

// --- 2. Filtros ---
const total = await page.locator('.project:not(.is-hidden)').count();
check('filtro "Todos" muestra 7', total === 7, 'visibles=' + total);

await page.click('[data-filter="cortometraje"]');
const corto = await page.locator('.project:not(.is-hidden)').count();
check('filtro Cortometraje → 3', corto === 3, 'visibles=' + corto);

await page.click('[data-filter="publicidad"]');
const pub = await page.locator('.project:not(.is-hidden)').count();
const pubTitles = await page.locator('.project:not(.is-hidden) h3').allTextContents();
check('filtro Publicidad → 1 pendiente', pub === 1, 'visibles=' + pub + ' [' + pubTitles.join(',') + ']');

await page.click('[data-filter="todos"]');
check('volver a Todos → 7', (await page.locator('.project:not(.is-hidden)').count()) === 7);

// --- 3. aria-selected ---
await page.click('[data-filter="eventos"]');
const sel = await page.getAttribute('[data-filter="eventos"]', 'aria-selected');
check('aria-selected se actualiza', sel === 'true', 'valor=' + sel);
await page.click('[data-filter="todos"]');

// --- 4. Modal ---
await page.click('.project:has-text("Encajonado") .project__open');
await page.waitForSelector('#modal:not([hidden])');
const mt = await page.textContent('#modalTitle');
const mm = await page.textContent('#modalMeta');
check('modal abre con el título correcto', mt.trim() === 'Encajonado', 'titulo=' + mt.trim());
check('modal muestra el meta', mm.includes('12:40'), 'meta=' + mm.trim());
const focused = await page.evaluate(() => document.activeElement.className);
check('foco entra en el modal', focused.includes('modal__close'), 'foco=' + focused);

await page.keyboard.press('Escape');
await page.waitForFunction(() => document.getElementById('modal').hidden);
const refocused = await page.evaluate(() => document.activeElement.className);
check('Escape cierra y devuelve el foco', refocused.includes('project__open'), 'foco=' + refocused);

// --- 5. Formulario: errores ---
await page.click('#contactForm button[type=submit]');
const errCount = await page.locator('.field.has-error').count();
const required = await page.locator('#contactForm [required]').count();
check(`submit vacío marca los ${required} campos obligatorios`, errCount === required, `errores=${errCount}/${required}`);

// --- 6. Formulario: email inválido ---
await page.fill('#email', 'esto-no-es-un-email');
await page.locator('#name').click();
const emailErr = await page.textContent('[data-error-for="email"]');
check('email inválido detectado', emailErr.includes('válido'), 'msg=' + emailErr.trim());

// --- 7. Formulario: válido ---
await page.fill('#org', 'Fundación Test');
await page.selectOption('#tipo_org', { label: 'Organización sin fines de lucro' });
await page.fill('#name', 'Ana Pérez');
await page.fill('#email', 'ana@fundacion.org');
await page.selectOption('#tipo', { label: 'Documental' });
await page.fill('#mensaje', 'Queremos documentar nuestro programa de jóvenes durante un año.');
await page.check('#rgpd');
await page.click('#contactForm button[type=submit]');
await page.waitForSelector('#toast:not([hidden])');
const toast = await page.textContent('#toast');
check('formulario válido muestra toast', toast.includes('Solicitud registrada'));
const orgVal = await page.inputValue('#org');
check('formulario se resetea tras enviar', orgVal === '', 'org=' + JSON.stringify(orgVal));

// --- 8. Móvil: menú ---
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#navToggle');
const menuOpen = await page.getAttribute('#navToggle', 'aria-expanded');
const menuVisible = await page.locator('#navLinks').isVisible();
check('menú móvil abre', menuOpen === 'true' && menuVisible, 'aria=' + menuOpen + ' visible=' + menuVisible);

// --- 9. Sin scroll horizontal en móvil ---
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('sin overflow horizontal a 390px', overflow <= 0, 'overflow=' + overflow + 'px');

await page.click('#navLinks a[href="#servicios"]');
check('menú móvil cierra al navegar', (await page.getAttribute('#navToggle', 'aria-expanded')) === 'false');

// --- 10. Reveal aplicado ---
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(400);
const revealed = await page.locator('.card.reveal.is-visible').count();
check('reveal on scroll se activa', revealed > 0, 'visibles=' + revealed);

// --- 10b. Sin API, el sitio usa el contenido del HTML ---
const titulosFallback = await page.locator('#projectGrid h3').allTextContents();
check('sin /api/projects cae al contenido del HTML', titulosFallback.includes('Encajonado'),
  'proyectos=' + titulosFallback.length);

// --- 11. Errores de consola ---
// Aquí no hay API, así que el 404 de /api/projects es lo esperado
// y es justamente lo que dispara el respaldo.
const reales = errors.filter((e) => !/Failed to load resource/.test(e));
check('sin errores de JS', reales.length === 0, reales.join(' | '));

console.log('\n' + results.join('\n'));
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} OK`);

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
