/* ============================================================
   GDapp · Desk — shell + router hash
   Cada módulo vive en /desk/modules/*.js y exporta { title, render }.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { avatar } from '/shared/js/avatars.js';
import { currentUser, logout } from '/shared/js/session.js';
import { renderAuth } from '/shared/js/auth-view.js';

import * as usuarios from '/desk/modules/usuarios.js';
import * as mapeos from '/desk/modules/mapeos.js';
import * as basesdatos from '/desk/modules/basesdatos.js';

const MODULES = {
  usuarios: { ...usuarios, icon: 'users' },
  mapeos: { ...mapeos, icon: 'map' },
  basesdatos: { ...basesdatos, icon: 'database' },
};

const DEFAULT_ROUTE = 'mapeos';
const root = document.getElementById('root');

function currentRoute() {
  const r = location.hash.replace('#/', '');
  return MODULES[r] ? r : DEFAULT_ROUTE;
}

function renderShell(user) {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sb-brand">
          <div class="logo">${icon('layers', 20)}</div>
          <div class="name">GDapp</div>
        </div>

        <nav class="sb-nav">
          <div class="sb-section">Módulos</div>
          ${Object.entries(MODULES).map(([key, m]) => `
            <button class="sb-link" data-route="${key}">
              ${icon(m.icon, 19)}<span>${m.title}</span>
            </button>
          `).join('')}
          <div class="grow"></div>
          <button class="sb-link" id="logoutBtn">${icon('logout', 19)}<span>Cerrar sesión</span></button>
        </nav>

        <div class="sb-user">
          <div class="avatar">${avatar(user.avatar)}</div>
          <div class="u-meta">
            <div class="u-name">${user.username}</div>
            <div class="u-role">${user.role === 'admin' ? 'Administrador' : 'Usuario'}</div>
          </div>
        </div>
      </aside>

      <main class="content" id="outlet"></main>
    </div>
  `;

  root.querySelectorAll('.sb-link[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.route}`; });
  });
  root.querySelector('#logoutBtn').addEventListener('click', logout);

  renderRoute();
}

function renderRoute() {
  const route = currentRoute();
  const outlet = document.getElementById('outlet');
  if (!outlet) return;

  root.querySelectorAll('.sb-link[data-route]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });

  MODULES[route].render(outlet);
}

function boot() {
  const user = currentUser();
  if (!user) {
    renderAuth(root, () => boot());
    return;
  }
  renderShell(user);
}

window.addEventListener('hashchange', renderRoute);
boot();
