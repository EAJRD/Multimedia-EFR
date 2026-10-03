/* ============================================
   Admin — sesión, carga, edición y publicación.
   El texto de los proyectos se inyecta siempre con
   textContent, nunca con innerHTML.
   ============================================ */

const $ = (id) => document.getElementById(id);

const state = {
  usuario: null,
  categorias: [],
  proyectos: [],
  originales: null, // copia para detectar cambios sin publicar
  editando: null,
  soloLectura: false,
  backend: 'file',
  arranque: false, // ¿el registro de usuarios está vacío?
};

/* ---------- Red ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }

  if (res.status === 401 && state.usuario) {
    mostrarLogin();
    throw new Error('La sesión caducó. Vuelve a entrar.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/* ---------- Avisos ---------- */

let toastTimer;
function toast(titulo, texto) {
  $('toastTitle').textContent = titulo;
  $('toastText').textContent = texto;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 6000);
}

function errorDeCampo(id, mensaje) {
  const campo = $(id);
  const wrap = campo.closest('.field');
  const slot = wrap?.querySelector('[data-error-for]');
  if (mensaje) {
    wrap?.classList.add('has-error');
    if (slot) slot.textContent = mensaje;
  } else {
    wrap?.classList.remove('has-error');
    if (slot) slot.textContent = '';
  }
}

function limpiarErrores() {
  document.querySelectorAll('[data-error-for]').forEach((s) => (s.textContent = ''));
  document.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
}

/* ---------- Vistas ---------- */

function mostrarLogin() {
  state.usuario = null;
  $('panelView').hidden = true;
  $('loginView').hidden = false;
  $('password').value = '';
  // Con la vía de arranque abierta, el foco va al primer campo de esa, no al
  // login, y el login se queda escondido: hay dos formas de entrar y solo
  // una tiene sentido según si el registro está vacío o no.
  if (state.arranque) $('b_nombre').focus();
  else $('email').focus();
}

function mostrarPanel() {
  $('loginView').hidden = true;
  $('panelView').hidden = false;
  $('whoami').textContent = '';
  const fuerte = document.createElement('strong');
  fuerte.textContent = state.usuario.nombre;
  $('whoami').append(fuerte, ` · ${state.usuario.rol}`);

  // Solo un admin crea usuarios.
  $('userBox').hidden = state.usuario.rol !== 'admin';

  const alerta = $('storeAlert');
  if (state.soloLectura) {
    alerta.innerHTML =
      '<b>Solo lectura.</b> Este despliegue no tiene <code>GITHUB_REPO</code> ni <code>DATABASE_PATH</code>, ' +
      'así que puedes ver y editar en pantalla, pero no publicar. ' +
      'Copia <code>.env.example</code> a <code>.env</code> y define las variables.';
    alerta.hidden = false;
  } else {
    alerta.hidden = true;
  }
}

/* ---------- Pintar ---------- */

function pintarLista() {
  const ul = $('plist');
  ul.replaceChildren();

  for (const p of state.proyectos) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = p.id;
    if (state.editando === p.id) btn.classList.add('is-active');

    const dot = document.createElement('span');
    dot.className = 'dot' + (p.pendiente ? ' is-pending' : '');

    const nombre = document.createElement('span');
    nombre.className = 'name';
    nombre.textContent = p.titulo;

    const cat = document.createElement('span');
    cat.className = 'cat';
    cat.textContent = p.categoria;

    btn.append(dot, nombre, cat);
    btn.addEventListener('click', () => abrirEditor(p.id));
    li.append(btn);
    ul.append(li);
  }

  if (!state.proyectos.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Todavía no hay proyectos.';
    ul.append(li);
  }
}

function pintarCategorias() {
  const ul = $('clist');
  ul.replaceChildren();

  for (const c of state.categorias) {
    const uso = state.proyectos.filter((p) => p.categoria === c.id).length;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';

    const nombre = document.createElement('span');
    nombre.className = 'name';
    nombre.textContent = c.nombre;

    const n = document.createElement('span');
    n.className = 'cat';
    n.textContent = `${uso}`;

    btn.append(nombre, n);
    btn.addEventListener('click', () => toast('Categorías', `«${c.nombre}» tiene ${uso} proyecto(s). Renombrar o quitar categorías se hace en data/projects.json.`));
    li.append(btn);
    ul.append(li);
  }
}

function pintarSelectCategorias(seleccion) {
  const sel = $('f_categoria');
  sel.replaceChildren();
  for (const c of state.categorias) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.nombre;
    if (c.id === seleccion) o.selected = true;
    sel.append(o);
  }
}

function marcarSucio() {
  const distintos = JSON.stringify({ c: state.categorias, p: state.proyectos }) !== state.originales;
  $('savebar').hidden = !distintos;
  if (distintos) {
    $('savebarMsg').textContent = 'Tienes cambios sin publicar.';
  }
}

/* ---------- Editor ---------- */

function abrirEditor(id) {
  limpiarErrores();
  const p = id ? state.proyectos.find((x) => x.id === id) : null;
  state.editando = p ? p.id : null;

  $('editor').hidden = false;
  $('editorTitle').textContent = p ? p.titulo : 'Nuevo proyecto';
  $('deleteBtn').hidden = !p;

  $('f_id').value = p?.id ?? '';
  $('f_titulo').value = p?.titulo ?? '';
  $('f_cliente').value = p?.cliente ?? '';
  $('f_anio').value = p?.anio ?? '';
  $('f_duracion').value = p?.duracion ?? '';
  $('f_imagen').value = p?.imagen ?? '';
  $('f_alt').value = p?.alt ?? '';
  $('f_resumen').value = p?.resumen ?? '';
  $('f_detalle').value = p?.detalle ?? '';
  $('f_meta').value = p?.meta ?? '';
  $('f_destacado').checked = p?.destacado ?? false;
  $('f_pendiente').checked = p?.pendiente ?? false;
  // El selector de archivo no guarda nada: si no, al abrir otro proyecto
  // seguiría apuntando al archivo anterior y se subiría por error.
  $('f_archivo').value = '';
  $('subir_estado').textContent = '';

  pintarSelectCategorias(p?.categoria);
  previsualizar();
  pintarLista();
  $('f_titulo').focus();
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function previsualizar() {
  const img = $('f_preview');
  const ruta = $('f_imagen').value.trim();
  if (!ruta) {
    img.hidden = true;
    return;
  }
  img.src = ruta;
  img.alt = $('f_alt').value.trim() || $('f_titulo').value.trim() || 'Vista previa';
  img.hidden = false;
}

/* ---------- Subida de imágenes ---------- */

const MAX_SUBIDA = 4 * 1024 * 1024;

function aBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.readAsDataURL(file);
  });
}

async function subirImagen() {
  const entrada = $('f_archivo');
  const estado = $('subir_estado');
  const boton = $('btn_subir');
  const archivo = entrada.files?.[0];

  if (!archivo) {
    estado.textContent = 'Elige primero un archivo.';
    return;
  }
  if (archivo.size > MAX_SUBIDA) {
    estado.textContent =
      `Esa imagen pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el tope son 4 MB.`;
    return;
  }

  boton.disabled = true;
  estado.textContent = 'Subiendo…';
  try {
    const base64 = await aBase64(archivo);
    // El nombre del archivo no se envía: el servidor rehace la ruta
    // desde cero. Aquí solo se manda como pista para el nombre.
    const nombre = $('f_titulo').value.trim() || archivo.name.replace(/\.[^.]+$/, '');
    const r = await api('/api/upload', { method: 'POST', body: { nombre, base64 } });
    $('f_imagen').value = r.ruta;
    estado.textContent = 'Subida. Falta guardar el proyecto para publicarlo.';
    previsualizar();
  } catch (e) {
    estado.textContent = e.message;
  } finally {
    boton.disabled = false;
  }
}

function slugify(s, fallback) {
  const base = String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

function guardarProyecto(ev) {
  ev.preventDefault();
  limpiarErrores();

  const proyecto = {
    id: $('f_id').value.trim() || slugify($('f_titulo').value, 'proyecto'),
    titulo: $('f_titulo').value.trim(),
    categoria: $('f_categoria').value,
    cliente: $('f_cliente').value.trim(),
    anio: $('f_anio').value.trim(),
    duracion: $('f_duracion').value.trim(),
    resumen: $('f_resumen').value.trim(),
    detalle: $('f_detalle').value.trim(),
    meta: $('f_meta').value.trim(),
    imagen: $('f_imagen').value.trim(),
    alt: $('f_alt').value.trim(),
    destacado: $('f_destacado').checked,
    pendiente: $('f_pendiente').checked,
  };

  const problemas = [];
  if (proyecto.titulo.length < 2) problemas.push(['f_titulo', 'El título es obligatorio.']);
  if (!proyecto.alt) problemas.push(['f_alt', 'El texto alternativo es obligatorio.']);
  if (proyecto.resumen.length < 2) problemas.push(['f_resumen', 'El resumen es obligatorio.']);
  for (const [campo, msg] of problemas) errorDeCampo(campo, msg);
  if (problemas.length) return $('f_titulo').focus();

  const i = state.proyectos.findIndex((p) => p.id === proyecto.id);
  if (i >= 0) state.proyectos[i] = proyecto;
  else state.proyectos.push(proyecto);

  if (!state.categorias.some((c) => c.id === proyecto.categoria)) {
    toast('Categoría nueva', `«${proyecto.categoria}» aún no está en la lista. Publícalo y se añadirá sola.`);
    state.categorias.push({ id: proyecto.categoria, nombre: proyecto.categoria });
    pintarCategorias();
  }

  marcarSucio();
  abrirEditor(proyecto.id);
  toast('Guardado en pantalla', 'Falta pulsar «Publicar cambios» para que lo vea el sitio.');
}

function borrarProyecto() {
  const id = $('f_id').value.trim();
  const p = state.proyectos.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`¿Borrar «${p.titulo}»? Esto se quita del sitio al publicar.`)) return;

  state.proyectos = state.proyectos.filter((x) => x.id !== id);
  $('editor').hidden = true;
  state.editando = null;
  marcarSucio();
  pintarLista();
  pintarCategorias();
}

async function publicar() {
  const btn = $('saveAllBtn');
  btn.disabled = true;
  btn.textContent = 'Publicando…';

  try {
    const r = await api('/api/projects', {
      method: 'POST',
      body: { categorias: state.categorias, proyectos: state.proyectos },
    });
    state.originales = JSON.stringify({ c: state.categorias, p: state.proyectos });
    marcarSucio();
    toast('Publicado', `${r.total} proyecto(s) y ${r.categorias} categoría(s) guardados. El sitio ya los muestra.`);
  } catch (e) {
    toast('No se pudo publicar', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publicar cambios';
  }
}

/* ---------- Usuarios ---------- */

async function cargarUsuarios() {
  if (state.usuario.rol !== 'admin') return;
  try {
    // El endpoint de listado no expone hashes: devuelve solo campos públicos.
    const r = await api('/api/auth?listado=1');
    const ul = $('ulist');
    ul.replaceChildren();
    for (const u of r.usuarios || []) {
      const li = document.createElement('li');
      const nombre = document.createElement('span');
      nombre.textContent = `${u.nombre} · ${u.email}`;
      const rol = document.createElement('span');
      rol.className = 'rol';
      rol.textContent = u.rol;
      li.append(nombre, rol);
      ul.append(li);
    }
  } catch (e) {
    $('userNote').textContent = e.message;
  }
}

/* ---------- Arranque en frío ----------
   Con el registro vacío, cualquiera que abra /admin.html puede crear el
   primer admin. En cuanto hay un usuario, esa vía se cierra sola: la API
   pasa a exigir sesión de admin. El GET público devuelve solo un booleano. */

function mostrarArranque(vacio) {
  state.arranque = vacio;
  $('bootstrap').hidden = !vacio;
  // Se oculta el formulario entero, no solo el botón: si solo se esconde el
  // botón, los campos de email y contraseña se quedan ahí, sin nada que
  // pulsarlos, y pulsar Enter en la contraseña dispara un login imposible.
  $('loginForm').hidden = vacio;
  $('loginError').hidden = true;
  if (vacio) $('b_nombre').focus();
}

function arrancar() {
  const note = $('bootstrapNote');
  note.textContent = '';

  api('/api/auth', {
    method: 'POST',
    body: {
      accion: 'register',
      nombre: $('b_nombre').value.trim(),
      email: $('b_email').value.trim(),
      password: $('b_password').value,
    },
  })
    .then(() => {
      // Ya hay un admin: la vía de arranque se cierra y toca entrar. Si no se
      // recarga la página, el formulario de arranque seguiría ahí, con un
      // segundo intento que la API ya va a rechazar.
      mostrarArranque(false);
      $('loginNote').textContent = 'Admin creado. Entra con esa cuenta.';
      $('email').value = $('b_email').value;
      $('b_nombre').value = '';
      $('b_email').value = '';
      $('b_password').value = '';
      $('email').focus();
    })
    .catch((e) => {
      note.textContent = e.message;
    });
}

function crearUsuario(ev) {
  ev.preventDefault();
  $('userNote').textContent = '';

  api('/api/auth', {
    method: 'POST',
    body: {
      accion: 'register',
      nombre: $('u_nombre').value.trim(),
      email: $('u_email').value.trim(),
      password: $('u_password').value,
      rol: $('u_rol').value,
    },
  })
    .then(() => {
      $('userNote').textContent = 'Usuario creado.';
      $('userForm').reset();
      cargarUsuarios();
    })
    .catch((e) => ($('userNote').textContent = e.message));
}

/* ---------- Arranque ---------- */

async function cargar() {
  const data = await api('/api/projects');
  state.categorias = data.categorias || [];
  state.proyectos = data.proyectos || [];
  state.originales = JSON.stringify({ c: state.categorias, p: state.proyectos });
  pintarLista();
  pintarCategorias();
}

async function iniciar() {
  $('loginView').hidden = false;

  try {
    const sesion = await api('/api/auth');
    state.soloLectura = sesion.soloLectura;
    state.backend = sesion.backend;

    if (sesion.autenticado) {
      state.usuario = sesion.usuario;
      await cargar();
      mostrarPanel();
      cargarUsuarios();
      return;
    }
    mostrarArranque(sesion.arranque === true);
  } catch {
    // El servidor no responde: no prometer la vía de arranque.
    mostrarArranque(false);
  }

  mostrarLogin();
}

function entrar(ev) {
  ev.preventDefault();
  // Cinturón: si el registro está vacío no hay contra qué iniciar sesión.
  // Con el formulario escondido, alguien aún podría mandar el submit
  // con Enter y comerse un "credenciales incorrectas" sin sentido.
  if (state.arranque) return;
  const err = $('loginError');
  err.hidden = true;
  const btn = $('loginSubmit');
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  api('/api/auth', {
    method: 'POST',
    body: { accion: 'login', email: $('email').value.trim(), password: $('password').value },
  })
    .then(async (r) => {
      state.usuario = r.usuario;
      await cargar();
      mostrarPanel();
      cargarUsuarios();
    })
    .catch((e) => {
      err.textContent = e.message;
      err.hidden = false;
      $('password').select();
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
}

function salir() {
  api('/api/auth', { method: 'POST', body: { accion: 'logout' } })
    .catch(() => {})
    .finally(mostrarLogin);
}

function añadirCategoria() {
  const nombre = prompt('Nombre de la categoría nueva:');
  if (!nombre) return;
  const id = slugify(nombre, '');
  if (!id) return toast('No válido', 'Ese nombre no genera un id usable.');
  if (state.categorias.some((c) => c.id === id)) return toast('Repetida', `Ya existe la categoría «${nombre}».`);

  state.categorias.push({ id, nombre: nombre.trim() });
  pintarCategorias();
  marcarSucio();
}

/* ---------- Eventos ---------- */

$('loginForm').addEventListener('submit', entrar);
$('bootstrapSubmit').addEventListener('click', arrancar);
$('logoutBtn').addEventListener('click', salir);
$('newBtn').addEventListener('click', () => abrirEditor(null));
$('cancelBtn').addEventListener('click', () => {
  $('editor').hidden = true;
  state.editando = null;
  pintarLista();
});
$('projectForm').addEventListener('submit', guardarProyecto);
$('deleteBtn').addEventListener('click', borrarProyecto);
$('saveAllBtn').addEventListener('click', publicar);
$('addCatBtn').addEventListener('click', añadirCategoria);
$('userForm').addEventListener('submit', crearUsuario);
$('toastClose').addEventListener('click', () => ($('toast').hidden = true));
$('f_imagen').addEventListener('input', previsualizar);
$('btn_subir').addEventListener('click', subirImagen);
$('f_archivo').addEventListener('change', () => { $('subir_estado').textContent = ''; });
$('f_titulo').addEventListener('input', previsualizar);
$('f_alt').addEventListener('input', previsualizar);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('toast').hidden === false) $('toast').hidden = true;
});

iniciar();
