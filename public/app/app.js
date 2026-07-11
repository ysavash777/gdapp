/* ============================================================
   GDapp · App — inicio con herramientas + navegación entrar/volver
   Cada módulo vive en /app/modules/*.js y exporta { title, description, render }.

   "Consultas" es de acceso libre (el equipo operativo la usa sin
   cuenta); el resto exige sesión y el permiso correspondiente. El
   login no se muestra de entrada — se llega a él desde el botón de
   la cabecera, solo si el equipo de inventario necesita loguearse.
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

function availableTools() {
  const perms = user ? user.permissions || [] : [];
  return Object.entries(TOOLS).filter(([key]) => PUBLIC_TOOLS.includes(key) || perms.includes(key));
}

function currentToolKey() {
  const key = location.hash.replace('#/', '');
  return availableTools().some(([k]) => k === key) ? key : null;
}

function renderShell() {
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header" id="appHeader"></header>
      <main class="app-content" id="outlet"></main>
    </div>
  `;
  renderRoute();
}

function renderHeader({ back, title, showLogin }) {
  const header = document.getElementById('appHeader');

  if (back) {
    header.innerHTML = `
      <div class="hd-left">
        <button class="btn-icon" id="backBtn">${icon('arrowLeft', 22)}</button>
        <h1>${title}</h1>
      </div>
      <span class="hd-spacer"></span>
    `;
    header.querySelector('#backBtn').addEventListener('click', () => { location.hash = ''; });
    return;
  }

  header.innerHTML = `
    <h1>${title}</h1>
    ${showLogin
      ? `<button class="btn-icon" id="loginBtn" title="Iniciar sesión">${icon('user', 20)}</button>`
      : `<button class="btn-icon" id="profileBtn" title="Cerrar sesión"><span class="avatar">${avatar(user.avatar)}</span></button>`}
  `;

  if (showLogin) {
    header.querySelector('#loginBtn').addEventListener('click', () => { location.hash = '#/login'; });
  } else {
    header.querySelector('#profileBtn').addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) logout();
    });
  }
}

function renderRoute() {
  const hash = location.hash.replace('#/', '');
  if (hash === 'login') { renderLogin(); return; }

  const key = currentToolKey();
  if (key) renderTool(key);
  else renderHome();
}

function renderHome() {
  renderHeader({ back: false, title: 'GDapp', showLogin: !user });
  const outlet = document.getElementById('outlet');
  const tools = availableTools();

  if (!tools.length) {
    outlet.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">${icon('shield', 26)}</div>
        <h3>Sin herramientas asignadas</h3>
        <p>Pide a un administrador que te asigne acceso desde Gestión de usuarios.</p>
      </div>
    `;
    return;
  }

  outlet.innerHTML = `
    <div class="tool-grid">
      ${tools.map(([key, t]) => `
        <button class="tool-card tone-${t.tone}" data-key="${key}">
          <div class="tc-icon">${icon(t.icon, 24)}</div>
          <div class="tc-body">
            <h3>${t.title}</h3>
            <p>${t.description || ''}</p>
          </div>
          <span class="tc-chevron">${icon('chevronRight', 20)}</span>
        </button>
      `).join('')}
    </div>
  `;

  outlet.querySelectorAll('.tool-card').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.key}`; });
  });
}

function renderTool(key) {
  const tool = TOOLS[key];
  renderHeader({ back: true, title: tool.title });
  tool.render(document.getElementById('outlet'));
}

function renderLogin() {
  renderHeader({ back: true, title: 'Iniciar sesión' });
  renderAuth(document.getElementById('outlet'), (loggedInUser) => {
    user = loggedInUser;
    location.hash = '';
  });
}

async function boot() {
  user = currentUser();
  renderShell();

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
