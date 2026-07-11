/* ============================================================
   GDapp · App — shell móvil + router hash
   Cada módulo vive en /app/modules/*.js y exporta { title, render }.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { avatar } from '/shared/js/avatars.js';
import { currentUser, logout } from '/shared/js/session.js';
import { renderAuth } from '/shared/js/auth-view.js';

import * as mapear from '/app/modules/mapear.js';
import * as negadas from '/app/modules/negadas.js';
import * as vacios from '/app/modules/vacios.js';
import * as consultas from '/app/modules/consultas.js';

const MODULES = {
  mapear: { ...mapear, icon: 'pin' },
  negadas: { ...negadas, icon: 'ban' },
  vacios: { ...vacios, icon: 'inbox' },
  consultas: { ...consultas, icon: 'search' },
};

const DEFAULT_ROUTE = 'mapear';
const root = document.getElementById('root');

function currentRoute() {
  const r = location.hash.replace('#/', '');
  return MODULES[r] ? r : DEFAULT_ROUTE;
}

function renderShell(user) {
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <h1 id="pageTitle"></h1>
        <button class="btn-icon" id="profileBtn" title="Cerrar sesión">
          <span class="avatar">${avatar(user.avatar)}</span>
        </button>
      </header>

      <main class="app-content" id="outlet"></main>

      <nav class="tabbar">
        ${Object.entries(MODULES).map(([key, m]) => `
          <button class="tab" data-route="${key}">
            ${icon(m.icon, 22)}
            <span>${m.title}</span>
          </button>
        `).join('')}
      </nav>
    </div>
  `;

  root.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.route}`; });
  });

  // Por ahora el avatar cierra sesión; luego abrirá el perfil.
  root.querySelector('#profileBtn').addEventListener('click', () => {
    if (confirm('¿Cerrar sesión?')) logout();
  });

  renderRoute();
}

function renderRoute() {
  const route = currentRoute();
  const outlet = document.getElementById('outlet');
  if (!outlet) return;

  document.getElementById('pageTitle').textContent = MODULES[route].title;
  root.querySelectorAll('.tab').forEach((btn) => {
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
