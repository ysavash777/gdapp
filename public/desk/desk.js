/* ============================================================
   GDapp · Desk — shell + router hash
   Cada módulo vive en /desk/modules/*.js y exporta { title, render }.
   El sidebar solo muestra los módulos que el usuario tiene entre sus
   permisos (mismo array que la app usa para sus herramientas).
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { avatar } from '/shared/js/avatars.js';
import { currentUser, refreshUser, logout } from '/shared/js/session.js';
import { renderAuth } from '/shared/js/auth-view.js';

import * as usuarios from '/desk/modules/usuarios.js';
import * as mapeos from '/desk/modules/mapeos.js';
import * as basesdatos from '/desk/modules/basesdatos.js';

const MODULES = {
  usuarios: { ...usuarios, icon: 'users' },
  mapeos: { ...mapeos, icon: 'map' },
  basesdatos: { ...basesdatos, icon: 'database' },
};

const root = document.getElementById('root');
let user = null;

function availableModules() {
  const perms = user.permissions || [];
  return Object.entries(MODULES).filter(([key]) => perms.includes(key));
}

function currentRoute() {
  const r = location.hash.replace('#/', '');
  const available = availableModules();
  if (available.some(([key]) => key === r)) return r;
  return available.length ? available[0][0] : null;
}

function renderShell() {
  const available = availableModules();

  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sb-brand">
          <div class="logo">${icon('layers', 20)}</div>
          <div class="name">GDapp</div>
        </div>

        <nav class="sb-nav">
          <div class="sb-section">Módulos</div>
          ${available.map(([key, m]) => `
            <button class="sb-link" data-route="${key}">
              ${icon(m.icon, 19)}<span>${m.title}</span>
            </button>
          `).join('')}
          <div class="grow"></div>
          <button class="sb-link" id="logoutBtn">${icon('logout', 19)}<span>Cerrar sesión</span></button>
        </nav>

        <div class="sb-user">
          <div class="avatar">${avatar(user.avatar, user.username)}</div>
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
  root.querySelector('#logoutBtn').addEventListener('click', () => {
    logout();
    user = null;
    boot();
  });

  renderRoute();
}

function renderRoute() {
  const route = currentRoute();
  const outlet = document.getElementById('outlet');
  if (!outlet) return;

  root.querySelectorAll('.sb-link[data-route]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });

  if (!route) {
    outlet.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">${icon('shield', 26)}</div>
        <h3>Sin módulos asignados</h3>
        <p>Pide a un administrador que te asigne acceso desde Gestión de usuarios.</p>
      </div>
    `;
    return;
  }

  MODULES[route].render(outlet);
}

async function boot() {
  user = currentUser();
  if (!user) {
    renderAuth(root, () => boot());
    return;
  }
  renderShell();

  // Pintamos con el caché al instante y refrescamos en segundo plano:
  // así un cambio de permisos hecho por un admin se ve al recargar,
  // sin depender de que el usuario vuelva a loguearse.
  const fresh = await refreshUser();
  if (!fresh) { logout(); user = null; boot(); return; }
  if (JSON.stringify(fresh) !== JSON.stringify(user)) {
    user = fresh;
    renderShell();
  }
}

window.addEventListener('hashchange', renderRoute);
boot();
