/* ============================================
   Multimedios — interacciones
   Vanilla JS, sin dependencias.
   ============================================ */

(function () {
  'use strict';

  /* ---------- Año del footer ---------- */

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Nav: sombra al hacer scroll ---------- */

  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');

  var onScroll = function () {
    if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 10);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Nav: menú móvil ---------- */

  function closeMenu() {
    if (!navLinks || !navToggle) return;
    navLinks.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Abrir menú');
  }

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      navToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
    });

    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 760) closeMenu();
    });
  }

  /* ---------- Filtro de proyectos ---------- */

  var filtersBox = document.getElementById('filters');
  var projectGrid = document.getElementById('projectGrid');
  var emptyState = document.getElementById('emptyState');

  function setupFilters() {
    var filters = document.querySelectorAll('.filter');
    var projects = document.querySelectorAll('.project');

    filters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.filter;

        filters.forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });

        var visible = 0;
        projects.forEach(function (p) {
          var match = target === 'todos' || p.dataset.categoria === target;
          p.classList.toggle('is-hidden', !match);
          if (match) visible++;
        });

        if (emptyState) emptyState.hidden = visible > 0;
      });
    });
  }

  setupFilters();

  /* ---------- Cargar contenido desde la API ----------
     Si /api/projects responde, el contenido manda sobre el HTML de
     respaldo. Si falla (sitio abierto con file://, o sin backend),
     se queda lo que hay escrito en el HTML. */

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function pintarProyecto(p, categoriaNombre) {
    var art = el('article', 'project' + (p.pendiente ? ' is-pending' : ''));
    art.dataset.categoria = p.categoria;
    art.dataset.title = p.titulo || '';
    art.dataset.meta = p.meta || [p.cliente, p.anio, p.duracion].filter(Boolean).join(' · ');
    art.dataset.texto = p.detalle || p.resumen || '';

    var abrir = el('button', 'project__open');
    abrir.type = 'button';
    abrir.setAttribute('aria-label', 'Ver detalle de ' + (p.titulo || 'proyecto'));
    abrir.addEventListener('click', function () { openModal(art); });
    art.appendChild(abrir);

    var media = el('div', 'project__media');
    var img = document.createElement('img');
    img.src = p.imagen || 'img/encajonado.svg';
    img.alt = p.alt || p.titulo || '';
    img.loading = 'lazy';
    img.width = 1200;
    img.height = 800;
    media.appendChild(img);

    var play = el('span', 'project__play', '▶');
    play.setAttribute('aria-hidden', 'true');
    media.appendChild(play);
    media.appendChild(el('span', 'badge', categoriaNombre));
    art.appendChild(media);

    var body = el('div', 'project__body');
    body.appendChild(el('h3', null, p.titulo || ''));
    body.appendChild(el('p', null, p.resumen || ''));

    var meta = el('ul', 'project__meta');
    [p.cliente, p.anio, p.duracion].forEach(function (v) {
      if (v) meta.appendChild(el('li', null, String(v)));
    });
    body.appendChild(meta);
    art.appendChild(body);

    return art;
  }

  function pintarDesdeApi(data) {
    var categorias = data.categorias || [];
    var proyectos = data.proyectos || [];
    if (!proyectos.length) return;

    var nombres = {};
    categorias.forEach(function (c) { nombres[c.id] = c.nombre; });

    // Las pestañas salen de las categorías con al menos un proyecto,
    // para no ofrecer filtros que solo muestran el estado vacío.
    var usadas = categorias.filter(function (c) {
      return proyectos.some(function (p) { return p.categoria === c.id; });
    });

    filtersBox.replaceChildren();
    var botones = [{ id: 'todos', nombre: 'Todos' }].concat(usadas);
    botones.forEach(function (c, i) {
      var b = el('button', 'filter' + (i === 0 ? ' is-active' : ''), c.nombre);
      b.type = 'button';
      b.dataset.filter = c.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === 0));
      filtersBox.appendChild(b);
    });

    projectGrid.replaceChildren();
    proyectos.forEach(function (p) {
      projectGrid.appendChild(pintarProyecto(p, nombres[p.categoria] || p.categoria));
    });

    setupFilters();
  }

  fetch('/api/projects')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) { if (data) pintarDesdeApi(data); })
    .catch(function () {
      /* Sin API: se queda el contenido del HTML. */
    });

  /* ---------- Modal de detalle de proyecto ---------- */

  var modal = document.getElementById('modal');
  var modalTitle = document.getElementById('modalTitle');
  var modalMeta = document.getElementById('modalMeta');
  var modalText = document.getElementById('modalText');
  var modalBadge = document.getElementById('modalBadge');
  var lastFocus = null;

  function openModal(card) {
    if (!modal) return;
    lastFocus = document.activeElement;

    var badge = card.querySelector('.badge');
    if (modalBadge) modalBadge.textContent = badge ? badge.textContent : 'Proyecto';
    if (modalTitle) modalTitle.textContent = card.dataset.title || '';
    if (modalMeta) modalMeta.textContent = card.dataset.meta || '';
    if (modalText) modalText.textContent = card.dataset.texto || '';

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    var close = modal.querySelector('.modal__close');
    if (close) close.focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  if (modal) {
    document.querySelectorAll('.project__open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn.closest('.project'));
      });
    });

    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-modal-close]')) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    // Foco atrapado dentro del panel mientras está abierto.
    modal.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var focusables = modal.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- Formulario: validación ---------- */

  var form = document.getElementById('contactForm');
  var toast = document.getElementById('toast');
  var toastClose = document.getElementById('toastClose');
  var toastTimer = null;

  var messages = {
    vacio:    'Este campo es obligatorio.',
    email:    'Introduce un email válido (ejemplo: nombre@dominio.com).',
    emailCort:'El email parece demasiado corto.',
    selection:'Selecciona una opción de la lista.'
  };

  function fieldWrapper(el) {
    return el.closest('.field');
  }

  function setError(el, msg) {
    var wrap = fieldWrapper(el);
    if (!wrap) return;
    var slot = wrap.querySelector('[data-error-for]');
    wrap.classList.add('has-error');
    if (slot) slot.textContent = msg;
  }

  function clearError(el) {
    var wrap = fieldWrapper(el);
    if (!wrap) return;
    var slot = wrap.querySelector('[data-error-for]');
    wrap.classList.remove('has-error');
    if (slot) slot.textContent = '';
  }

  function validateField(el) {
    var id = el.id;
    var val = (el.value || '').trim();

    if (el.type === 'checkbox') {
      if (!el.checked) { setError(el, 'Necesitamos tu aceptación para continuar.'); return false; }
      clearError(el);
      return true;
    }

    if (el.required && !val) {
      setError(el, el.tagName === 'SELECT' ? messages.selection : messages.vacio);
      return false;
    }

    if (id === 'email' && val) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) {
        setError(el, messages.email);
        return false;
      }
      if (val.length < 6) { setError(el, messages.emailCort); return false; }
    }

    if (id === 'mensaje' && val && val.length < 20) {
      setError(el, 'Cuéntanos un poco más (mínimo 20 caracteres).');
      return false;
    }

    clearError(el);
    return true;
  }

  if (form) {
    var fields = Array.prototype.slice.call(form.querySelectorAll('input, select, textarea'));

    fields.forEach(function (el) {
      el.addEventListener('blur', function () {
        if (el.value || el.type === 'checkbox') validateField(el);
      });
      el.addEventListener('input', function () {
        var wrap = fieldWrapper(el);
        if (wrap && wrap.classList.contains('has-error')) validateField(el);
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var invalid = fields.filter(function (el) { return !validateField(el); });

      if (invalid.length) {
        invalid[0].focus();
        return;
      }

      // DEMO: aquí no se envía nada. Para producción, conecta Formspree
      // (ver PLAN.md, Fase 4) y quita esta línea de preventDefault.
      form.reset();
      fields.forEach(clearError);
      showToast();
    });
  }

  /* ---------- Toast ---------- */

  function showToast() {
    if (!toast) return;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 7000);
  }

  function hideToast() {
    if (!toast) return;
    toast.hidden = true;
    clearTimeout(toastTimer);
  }

  if (toastClose) toastClose.addEventListener('click', hideToast);

  /* ---------- Reveal on scroll ---------- */

  var revealables = document.querySelectorAll(
    '.card, .project, .steps > li, .section__head'
  );
  revealables.forEach(function (el) { el.classList.add('reveal'); });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.style.transitionDelay = (i * 60) + 'ms';
        el.classList.add('is-visible');
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  }

})();
