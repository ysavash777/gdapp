/* ============================================================
   GDapp · App

   "Consultar grupo" es de acceso libre (el equipo operativo la usa
   sin cuenta); el resto exige sesión y el permiso correspondiente.

   Sin sesión no hay cabecera: el inicio muestra la herramienta
   pública en color arriba, el resto en blanco y negro (sin permiso)
   debajo, y un botón de ancho completo al final para loguearse.

   Con sesión aparece una cabecera de una sola fila: avatar + saludo,
   ambos a la izquierda. Mismo formato de lista: habilitadas en
   color arriba, sin permiso en BW debajo — todo alfabético.

   Toda la pantalla de inicio se ajusta a la altura disponible sin
   generar scroll vertical (ver home-layout en app.css).

   Cada módulo vive en /app/modules/*.js y exporta { title, description, render }.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { avatar } from '/shared/js/avatars.js';
import { currentUser, refreshUser, logout } from '/shared/js/session.js';
import { renderAuth } from '/shared/js/auth-view.js';

import * as mapear from '/app/modules/mapear.js';
import * as negadas from '/app/modules/negadas.js';
import * as vacios from '/app/modules/vacios.js';
import * as consultas from '/app/modules/consultas.js';

const TOOLS = {
  consultas: { ...consultas, icon: 'search' },
  mapear: { ...mapear, icon: 'scan' },
  negadas: { ...negadas, icon: 'ban' },
  vacios: { ...vacios, icon: 'package' },
};

const PUBLIC_TOOLS = ['consultas'];

const root = document.getElementById('root');
let user = null;

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
  const key = location.hash.replace('#/', '');
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
  const hash = location.hash.replace('#/', '');
  if (hash === 'login') { renderLogin(); return; }

  const key = currentToolKey();
  if (key) renderTool(key);
  else renderHome();
}

function toolCardHTML(key, t) {
  return `
    <button class="tool-card" data-key="${key}">
      <div class="tc-top">
        <div class="tc-icon tone-${key}">${icon(t.icon, 18)}</div>
        <span class="tc-chevron">${icon('chevronRight', 18)}</span>
      </div>
      <div class="tc-body">
        <h3>${t.title}</h3>
        <p>${t.description || ''}</p>
      </div>
    </button>
  `;
}

function lockedCardHTML(key, t) {
  return `
    <div class="tool-card is-locked">
      <div class="tc-top">
        <div class="tc-icon tone-${key}">${icon(t.icon, 18)}</div>
      </div>
      <div class="tc-body">
        <h3>${t.title}</h3>
        <p>${t.description || ''}</p>
      </div>
    </div>
  `;
}

function renderHome() {
  if (user) {
    setHeader(`
      <button class="hd-user" id="profileBtn" title="Cerrar sesión">
        <span class="avatar">${avatar(user.avatar, user.username)}</span>
        <h1>Hola, ${user.username}</h1>
      </button>
    `);
    document.getElementById('profileBtn').addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) logout();
    });
  } else {
    setHeader('');
  }

  const enabled = enabledTools();
  const disabled = disabledTools();
  const outlet = document.getElementById('outlet');

  outlet.innerHTML = `
    <div class="home-layout">
      ${enabled.map(([key, t]) => toolCardHTML(key, t)).join('')}
      ${disabled.map(([key, t]) => lockedCardHTML(key, t)).join('')}
      ${!user ? `<button class="btn btn-primary btn-block login-cta" id="loginCta">Iniciar sesión</button>` : ''}
      <p class="app-footer">GStock 1.0.0</p>
    </div>
  `;

  outlet.querySelectorAll('.tool-card[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.key}`; });
  });

  const cta = outlet.querySelector('#loginCta');
  if (cta) cta.addEventListener('click', () => { location.hash = '#/login'; });
}

// Herramientas y login comparten esta plantilla: sin cabecera fija,
// solo un enlace de volver arriba del contenido.
function renderSubpage(title, fillContent) {
  setHeader('');
  const outlet = document.getElementById('outlet');
  outlet.innerHTML = `
    <div class="subpage">
      <div class="subpage-head">
        <button class="back-link" id="backBtn">${icon('arrowLeft', 18)} Volver</button>
        ${title ? `<h2>${title}</h2>` : ''}
      </div>
      <div class="subpage-body" id="subpageBody"></div>
    </div>
  `;
  outlet.querySelector('#backBtn').addEventListener('click', () => { location.hash = ''; });
  fillContent(outlet.querySelector('#subpageBody'));
}

function renderTool(key) {
  const tool = TOOLS[key];
  renderSubpage(tool.title, (body) => tool.render(body));
}

function renderLogin() {
  renderSubpage('Iniciar sesión', (body) => {
    renderAuth(body, (loggedInUser) => {
      user = loggedInUser;
      location.hash = '';
    });
  });
}

async function boot() {
  user = currentUser();
  renderShellStructure();
  renderRoute();

  if (!user) return;

  // Pintamos con el caché al instante y refrescamos en segundo plano:
  // así un cambio de permisos hecho por un admin se ve al recargar,
  // sin depender de que el usuario vuelva a loguearse.
  const fresh = await refreshUser();
  if (!fresh) { logout(); return; }
  if (JSON.stringify(fresh) !== JSON.stringify(user)) {
    user = fresh;
    renderRoute();
  }
}

window.addEventListener('hashchange', renderRoute);
boot();
