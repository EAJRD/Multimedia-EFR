import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'capturas');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const shots = [
  { name: 'escritorio-completo', w: 1440, h: 1000, full: true },
  { name: 'escritorio-hero',     w: 1440, h: 1000, full: false },
  { name: 'movil-completo',      w: 390,  h: 844,  full: true },
];

for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto('http://127.0.0.1:8000/', { waitUntil: 'networkidle' });
  // Dispara el reveal on scroll recorriendo la página entera.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + s.name + '.png', fullPage: s.full });
  console.log('capturas/' + s.name + '.png', s.w + 'x' + s.h);
  await page.close();
}

// Estado filtrado + modal abierto, para revisar los estados interactivos.
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:8000/', { waitUntil: 'networkidle' });
await page.click('[data-filter="cortometraje"]');
await page.locator('#proyectos').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 'filtro-cortometraje.png' });
console.log('capturas/filtro-cortometraje.png');

await page.click('.project:has-text("La Última Tanda") .project__open');
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 'modal-proyecto.png' });
console.log('capturas/modal-proyecto.png');

await page.close();
await browser.close();
