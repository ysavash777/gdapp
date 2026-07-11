/* ============================================================
   GDapp · App

   "Consultas" es de acceso libre (el equipo operativo la usa sin
   cuenta); el resto exige sesión y el permiso correspondiente.

   Sin sesión no hay cabecera: el inicio muestra Consultas activa
   arriba, el resto de herramientas en blanco y negro (sin permiso)
   debajo, y un botón de ancho completo al final para loguearse.

   Con sesión aparece una cabecera simple (saludo + avatar) y el
   mismo formato: habilitadas en color arriba, sin permiso en BW
   debajo — todo ordenado alfabéticamente.

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
  consultas: { ...consultas, icon: 'search', tone: 'ambar' },
  mapear: { ...mapear, icon: 'pin', tone: 'terra' },
  negadas: { ...negadas, icon: 'ban', tone: 'lavanda' },
  vacios: { ...vacios, icon: 'inbox', tone: 'menta' },
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

function renderHome() {
  if (user) {
    setHeader(`
      <h1>Hola, ${user.username}</h1>
      <button class="btn-icon" id="profileBtn" title="Cerrar sesión">
        <span class="avatar">${avatar(user.avatar, user.username)}</span>
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
    <div class="tool-grid">
      ${enabled.map(([key, t]) => `
        <button class="tool-card tone-${t.tone}" data-key="${key}">
          <div class="tc-icon">${icon(t.icon, 26)}</div>
          <div class="tc-body">
            <h3>${t.title}</h3>
            <p>${t.description || ''}</p>
          </div>
          <span class="tc-chevron">${icon('chevronRight', 20)}</span>
        </button>
      `).join('')}
    </div>

    ${disabled.length ? `
      <p class="tool-locked-hint">${user ? 'Sin permiso — pide acceso a un administrador' : 'Inicia sesión para acceder'}</p>
      <div class="tool-grid">
        ${disabled.map(([, t]) => `
          <div class="tool-card is-locked">
            <div class="tc-icon">${icon(t.icon, 26)}</div>
            <div class="tc-body">
              <h3>${t.title}</h3>
              <p>${t.description || ''}</p>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${!user ? `<button class="btn btn-primary btn-block login-cta" id="loginCta">Iniciar sesión</button>` : ''}
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
    <div class="subpage-head">
      <button class="back-link" id="backBtn">${icon('arrowLeft', 18)} Volver</button>
      ${title ? `<h2>${title}</h2>` : ''}
    </div>
    <div id="subpageBody"></div>
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
