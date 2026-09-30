/* ============================================
   Crea un usuario admin.
   Escribe en el backend configurado (GitHub o SQLite) a través del
   mismo store que usa la API, para que funcione igual en local y en
   Vercel. Con STORE=github hace falta GITHUB_REPO y GITHUB_TOKEN.
   Uso: npm run create-user
   ============================================ */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { store, IS_READ_ONLY, STORE_NAME } from '../api/_lib/store.js';
import { upsertUser, hashPassword, validateNewUser, newUserId } from '../api/_lib/users.js';

const MIN = 12;

const rl = readline.createInterface({ input: stdin, output: stdout });

async function secret(question) {
  // readline no oculta la entrada de forma fiable, así que se silencia
  // el eco a mano y se restaura al terminar.
  const output = rl.output;
  const real = output.write.bind(output);
  let muted = true;
  rl._writeToOutput = (s) => {
    if (!muted) real(s);
  };
  const v = await rl.question(question);
  muted = false;
  rl._writeToOutput = real;
  return v;
}

async function main() {
  console.log(`\n  Multimedios — crear usuario`);
  console.log(`  Backend: ${STORE_NAME}${IS_READ_ONLY ? ' (SOLO LECTURA: no se puede escribir)' : ''}\n`);

  if (IS_READ_ONLY) {
    console.error('  Este despliegue es de solo lectura. Define GITHUB_REPO o DATABASE_PATH,');
    console.error('  o usa el arranque en frío desde el panel: entra en /admin.html y crea');
    console.error('  el primer admin con el botón de registro.\n');
    process.exit(1);
  }

  const nombre = (await rl.question('  Nombre: ')).trim();
  const email = (await rl.question('  Email: ')).trim().toLowerCase();
  const password = await secret('  Contraseña (mínimo 12): ');
  const repetir = await secret('  Repite la contraseña: ');
  console.log('');

  const v = validateNewUser({ nombre, email, password, rol: 'admin' });
  if (!v.ok) {
    console.error('  ' + v.errors.join('\n  ') + '\n');
    process.exit(1);
  }
  if (password !== repetir) {
    console.error('  Las contraseñas no coinciden.\n');
    process.exit(1);
  }

  const data = await store.getUsers();
  if (data.usuarios.some((u) => u.email.toLowerCase() === email)) {
    console.error(`  Ya existe un usuario con ${email}.\n`);
    process.exit(1);
  }

  const guardado = await store.saveUsers(
    upsertUser(data.usuarios, {
      id: newUserId(),
      nombre,
      email,
      hash: await hashPassword(password),
      rol: 'admin',
    })
  );

  console.log(`  Creado ${email} como admin.`);
  console.log(`  Guardado en ${STORE_NAME}: ${guardado.path || 'data/users.json'}\n`);
  console.log('  El registro de usuarios no se sube a Git (contiene hashes bcrypt).\n');
}

main()
  .catch((e) => {
    console.error(`\n  Error: ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());


  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2) + '\n');

  console.log(`  Creado ${email} como admin.`);
  console.log(`  Guardado en data/users.json\n`);
  console.log('  Recuerda: ese archivo se sube al repo. Solo contiene hashes bcrypt,');
  console.log('  pero es material sensible: si es un repositorio público, plantéate');
  console.log('  usar GITHUB_REPO en un repo privado o_STORE=sqlite en Docker.\n');
}

main()
  .then(() => rl.close())
  .catch((e) => {
    console.error(`\n  Error: ${e.message}\n`);
    rl.close();
    process.exit(1);
  });
