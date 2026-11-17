/* GDapp · App shell: home, routing entre módulos y login.
   "Consultar grupo" es pública; el resto exige sesión + permiso.
   Navegación con history.pushState/replaceState (no location.hash directo)
   porque asignar el hash dispara 'popstate' en algunos navegadores,
   confundiendo el botón de volver del dispositivo con una navegación normal. */

import { icon } from '/shared/js/icons.js';
import { avatar } from '/shared/js/avatars.js';
import { capitalize } from '/shared/js/format.js';
import { currentUser, refreshUser, logout } from '/shared/js/session.js';
import { renderAuth } from '/shared/js/auth-view.js';

import * as mapear from '/app/modules/mapear/index.js';
import * as vencimientos from '/app/modules/vencimientos/index.js';
import * as vacios from '/app/modules/vacios/index.js';
import * as consultas from '/app/modules/consultas/index.js';
import * as settings from '/app/modules/settings.js';
import { checkVencidos, markAlertSeen, notifMessageHTML } from '/app/notifications.js';
import { checkDbStale } from '/app/db-stale.js';

const TOOLS = {
  consultas: { ...consultas, icon: 'search' },
  mapear: { ...mapear, icon: 'scan' },
  vencimientos: { ...vencimientos, icon: 'calendarAlert' },
  vacios: { ...vacios, icon: 'remoteSignal' },
};

const PUBLIC_TOOLS = ['consultas'];

const root = document.getElementById('root');
let user = null;

// Doble pulsación de "volver" en el inicio para salir de la app.
let lastRoute = 'home'; // 'home' | 'subpage'
let exitArmed = false;
let exitTimer = null;

// La clave interna de una herramienta (TOOLS / permiso guardado en la base de
// usuarios) no siempre coincide con el nombre que se ve en el link: "vacios" es
// el permiso histórico de Programación remota y se mantiene así para no tocar
// permisos ya otorgados — solo el link usa el nombre real de la herramienta.
const ROUTE_SLUGS = { vacios: 'programacion-remota' };

function slugForKey(key) {
  return ROUTE_SLUGS[key] || key;
}

function keyForSlug(slug) {
  const found = Object.entries(ROUTE_SLUGS).find(([, s]) => s === slug);
  return found ? found[0] : slug;
}

function hashUrl(hash) {
  return location.pathname + location.search + (hash ? `#/${hash}` : '');
}

// pushState no dispara 'popstate', así que renderizamos a mano.
function pushRoute(hash) {
  history.pushState({ gdapp: true }, '', hashUrl(slugForKey(hash)));
  renderRoute();
}

// Asegura una entrada propia para interceptar el primer "volver" en el inicio.
function armGuard() {
  history.pushState({ gdapp: true }, '', location.href);
}

function showExitToast() {
  const old = document.getElementById('exitToast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'exitToast';
  toast.className = 'exit-toast';
  toast.textContent = 'Presiona de nuevo para salir';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// Solo dispara con retroceso/avance real de historial, no con pushRoute.
window.addEventListener('popstate', () => {
  if (lastRoute !== 'home') return; // volver desde una herramienta/login es normal.
  if (exitArmed) return; // segunda pulsación: se deja salir de verdad.
  exitArmed = true;
  showExitToast();
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => { exitArmed = false; }, 2000);
});

window.addEventListener('hashchange', renderRoute);

// Listener a nivel documento (el header se reconstruye en cada render,
// así que no conviene guardar referencias que puedan quedar obsoletas).
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.hidden) {
    const btn = document.getElementById('avatarBtn');
    if (!menu.contains(e.target) && !(btn && btn.contains(e.target))) menu.hidden = true;
  }
  const notif = document.getElementById('notifMenu');
  if (notif && !notif.hidden) {
    const nbtn = document.getElementById('notifBtn');
    if (!notif.contains(e.target) && !(nbtn && nbtn.contains(e.target))) notif.hidden = true;
  }
});

function isEnabled([key]) {
  if (PUBLIC_TOOLS.includes(key)) return true;
  return user ? (user.permissions || []).includes(key) : false;
}

function sortedByTitle(entries) {
  return [...entries].sort((a, b) => a[1].title.localeCompare(b[1].title, 'es'));
}

function enabledTools() {
  return sortedByTitle(Object.entries(TOOLS).filter(isEnabled));
}

function disabledTools() {
  return sortedByTitle(Object.entries(TOOLS).filter((e) => !isEnabled(e)));
}

function currentToolKey() {
  const slug = location.hash.replace('#/', '');
  // Un link viejo (#/vacios) sigue resolviendo a la misma herramienta.
  const key = keyForSlug(slug);
  return enabledTools().some(([k]) => k === key) ? key : null;
}

function setHeader(html) {
  const header = document.getElementById('appHeader');
  if (!html) {
    header.hidden = true;
    header.innerHTML = '';
    return;
  }
  header.hidden = false;
  header.innerHTML = html;
}

function renderShellStructure() {
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header" id="appHeader" hidden></header>
      <main class="app-content" id="outlet"></main>
    </div>
  `;
}

function renderRoute() {
  // Solo renderLogin() reactiva outlet-fullbleed; se resetea en cada render.
  document.getElementById('outlet').classList.remove('outlet-fullbleed');

  const hash = location.hash.replace('#/', '');
  if (hash === 'login') { renderLogin(); return; }
  if (hash === 'settings') { renderSettings(); return; }

  const key = currentToolKey();
  if (key) renderTool(key);
  else renderHome();
}

function toolCardHTML(key, t) {
  return `
    <button class="tool-card" data-key="${key}">
      <div class="tc-top">
        <div class="tc-icon">${icon(t.icon, 18)}</div>
        <span class="tc-chevron">${icon('chevronRight', 18)}</span>
      </div>
      <div class="tc-body">
        <h3>${t.title}</h3>
        <p>${t.description || ''}</p>
      </div>
    </button>
  `;
}

// Pantalla de bienvenida sin sesión (composición propia, no una tool-card agrandada).
function welcomeScreenHTML(key, t) {
  return `
    <div class="hg-screen">
      <div class="hg-topbar">
        <button type="button" class="btn-icon hg-signin" id="loginCta" title="Iniciar sesión" aria-label="Iniciar sesión">${icon('user', 19)}<span>Iniciar sesión</span></button>
      </div>
      <div class="hg-center">
        <div class="hg-glyph-wrap" data-key="${key}">
          <div class="hg-glyph">${icon(t.icon, 32)}</div>
        </div>
        <h1>${t.title}</h1>
        <p>${t.description || ''}</p>
      </div>
      <button type="button" class="hg-cta" data-key="${key}">
        ${icon('scan', 19)}
        <span>Escanear código</span>
      </button>
      <p class="app-footer">GStock 1.0.0</p>
    </div>
  `;
}

// Skeleton estático (no animado: es un estado permanente, no una carga) que oculta la herramienta.
function lockedCardHTML() {
  return `
    <div class="tool-card is-locked is-skeleton">
      <div class="tc-top">
        <div class="tc-icon skeleton-shape"></div>
      </div>
      <div class="tc-body">
        <span class="skeleton-shape skeleton-line skeleton-title"></span>
        <span class="skeleton-shape skeleton-line"></span>
        <span class="skeleton-shape skeleton-line is-short"></span>
      </div>
    </div>
  `;
}

function renderHome() {
  lastRoute = 'home';
  armGuard();

  if (user) {
    setHeader(`
      <div class="hd-left">
        <button class="hd-user" id="avatarBtn">
          <span class="avatar">${avatar(user.username)}</span>
          <h1>Hola, ${capitalize(user.username)}</h1>
        </button>
        <div class="user-menu" id="userMenu" hidden>
          <button class="user-menu-item" id="logoutItem">${icon('logout', 18)} Cerrar sesión</button>
        </div>
      </div>
      <div class="hd-right">
        <button class="btn-icon" id="settingsBtn" title="Configuración">
          ${icon('settings', 20)}
          <span class="notif-badge" id="settingsBadge" hidden>!</span>
        </button>
        <div class="hd-notif">
          <button class="btn-icon" id="notifBtn" title="Notificaciones">
            ${icon('bell', 20)}
            <span class="notif-badge" id="notifBadge" hidden>0</span>
          </button>
          <div class="notif-menu" id="notifMenu" hidden>
            <p class="notif-empty">No tenés notificaciones</p>
          </div>
        </div>
      </div>
    `);

    const menu = document.getElementById('userMenu');
    document.getElementById('avatarBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.getElementById('logoutItem').addEventListener('click', () => {
      logout();
      user = null;
      renderHome();
    });

    const notifMenu = document.getElementById('notifMenu');
    const notifBadge = document.getElementById('notifBadge');
    document.getElementById('notifBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = notifMenu.hidden;
      notifMenu.hidden = !opening;
      if (opening) {
        markAlertSeen();
        notifBadge.hidden = true;
      }
    });
    notifMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.notif-item');
      if (!item) return;
      notifMenu.hidden = true;
      pushRoute('vencimientos');
    });

    // Solo si tiene el permiso; el badge prende una vez por día pero
    // el mensaje sigue disponible al abrir la campana a mano.
    if (user.permissions?.includes('vencimientos')) {
      checkVencidos().then(({ count, shouldAlert }) => {
        notifMenu.innerHTML = notifMessageHTML(count);
        if (shouldAlert) {
          notifBadge.textContent = count > 99 ? '99+' : String(count);
          notifBadge.hidden = false;
        }
      }).catch(() => { /* sin conexión: la campana se queda como estaba */ });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    settingsBtn.addEventListener('click', () => pushRoute('settings'));

    // Solo quien puede actualizar las bases (permiso 'basesdatos', el mismo
    // que exige /api/database/status) ve el aviso de "sin actualizar".
    if (user.permissions?.includes('basesdatos')) {
      checkDbStale().then((stale) => {
        if (!stale || !settingsBtn.isConnected) return;
        document.getElementById('settingsBadge').hidden = false;
        settingsBtn.title = 'Configuración — las bases de datos llevan más de 1 hora sin actualizarse';
      });
    }
  } else {
    setHeader('');
  }

  const enabled = enabledTools();
  const disabled = disabledTools();
  const outlet = document.getElementById('outlet');

  // Sin sesión: usa la primera herramienta pública disponible.
  if (!user) {
    const [key, t] = enabled[0];
    outlet.innerHTML = welcomeScreenHTML(key, t);
    outlet.querySelector('.hg-cta').addEventListener('click', () => pushRoute(key));
    outlet.querySelector('#loginCta').addEventListener('click', () => pushRoute('login'));
    return;
  }

  outlet.innerHTML = `
    <div class="home-layout">
      ${enabled.map(([key, t]) => toolCardHTML(key, t)).join('')}
      ${disabled.map(() => lockedCardHTML()).join('')}
      <p class="app-footer">GStock 1.0.0</p>
    </div>
  `;

  outlet.querySelectorAll('.tool-card[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => pushRoute(btn.dataset.key));
  });
}

// Plantilla compartida por herramientas y login; showBack agrega flecha manual.
function renderSubpage(title, fillContent, { showBack = false } = {}) {
  lastRoute = 'subpage';
  setHeader('');
  const outlet = document.getElementById('outlet');
  outlet.innerHTML = `
    <div class="subpage">
      ${title ? `
        <div class="subpage-title-row">
          ${showBack ? `<button type="button" class="btn-icon subpage-back" id="subpageBack" title="Volver" aria-label="Volver">${icon('arrowLeft', 20)}</button>` : ''}
          <h2 class="subpage-title">${title}</h2>
          <div class="subpage-title-actions" id="subpageTitleActions"></div>
        </div>
      ` : ''}
      <div class="subpage-body" id="subpageBody"></div>
    </div>
  `;
  if (showBack) outlet.querySelector('#subpageBack').addEventListener('click', () => history.back());
  fillContent(outlet.querySelector('#subpageBody'));
}

function renderTool(key) {
  const tool = TOOLS[key];
  renderSubpage(tool.title, (body) => tool.render(body), { showBack: true });
}

function renderSettings() {
  renderSubpage('Configuración', (body) => settings.render(body, user), { showBack: true });
}

// Pantalla completa, sin el padding de .subpage: no reutiliza renderSubpage().
function renderLogin() {
  lastRoute = 'subpage';
  setHeader('');
  const outlet = document.getElementById('outlet');
  outlet.classList.add('outlet-fullbleed');
  outlet.innerHTML = '';
  renderAuth(outlet, (loggedInUser) => {
    user = loggedInUser;
    // replaceState, no pushState: evita resurfacear el login al volver atrás.
    history.replaceState(null, '', hashUrl(''));
    renderRoute();
  }, { showBack: true });
}

// Desvanece el splash apenas la app pintó su primera vista.
function hideIntro() {
  const el = document.getElementById('appIntro');
  if (!el) return;
  el.classList.add('is-hidden');
  setTimeout(() => el.remove(), 420);
}

async function boot() {
  user = currentUser();
  renderShellStructure();
  renderRoute();
  hideIntro();

  if (!user) return;

  // Refresca en segundo plano para reflejar cambios de permisos sin relogueo.
  const fresh = await refreshUser();
  if (!fresh) { logout(); user = null; renderHome(); return; }
  if (JSON.stringify(fresh) !== JSON.stringify(user)) {
    user = fresh;
    renderRoute();
  }
}

boot();
