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

   Navegación: se usa history.pushState/replaceState en vez de asignar
   location.hash directamente, porque en algunos navegadores asignar
   el hash también dispara 'popstate' (no solo 'hashchange'), lo que
   confundiría al botón/gesto de volver del dispositivo con un avance
   normal. Con pushState, 'popstate' solo se dispara en retrocesos o
   avances reales de historial — así el botón de volver siempre puede
   distinguirse de un toque hacia adelante.

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

// --- Historial: el botón/gesto de volver del dispositivo nunca debe
// resurfacear el login, y desde el inicio debe pedir una segunda
// pulsación antes de salir de la app. ---
let lastRoute = 'home'; // 'home' | 'subpage', refleja la última vista renderizada
let exitArmed = false;
let exitTimer = null;

function hashUrl(hash) {
  return location.pathname + location.search + (hash ? `#/${hash}` : '');
}

// Avanza a una vista nueva (tocar una tarjeta, "Iniciar sesión", "Volver").
// pushState nunca dispara 'popstate', así que renderizamos a mano.
function pushRoute(hash) {
  history.pushState({ gdapp: true }, '', hashUrl(hash));
  renderRoute();
}

// Guarda de retorno: asegura que siempre haya una entrada propia para
// interceptar el primer "volver" del dispositivo en el inicio.
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

// Solo dispara con un retroceso/avance real de historial (botón o
// gesto del dispositivo) — nunca con nuestras propias navegaciones.
window.addEventListener('popstate', () => {
  if (lastRoute !== 'home') return; // volver desde una herramienta/login es normal.
  if (exitArmed) return; // segunda pulsación: se deja salir de verdad.
  exitArmed = true;
  showExitToast();
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => { exitArmed = false; }, 2000);
});

// El hash también puede cambiar por una navegación real hacia
// atrás/adelante (no solo por pushRoute) — hay que re-renderizar.
window.addEventListener('hashchange', renderRoute);

// Cierra el menú del avatar al tocar fuera. Un solo listener a nivel
// documento, consultando el DOM en vivo — el header se reconstruye
// por completo en cada render, así que no conviene cerrar sobre
// referencias que puedan quedar obsoletas.
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (!menu || menu.hidden) return;
  const btn = document.getElementById('avatarBtn');
  if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
  menu.hidden = true;
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
  // El login se ve a pantalla completa, sin el padding que sí necesitan
  // el inicio y las herramientas — se restablece por defecto en cada
  // render y solo renderLogin() lo vuelve a activar.
  document.getElementById('outlet').classList.remove('outlet-fullbleed');

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

function lockedCardHTML(t) {
  return `
    <div class="tool-card is-locked">
      <div class="tc-top">
        <div class="tc-icon">${icon(t.icon, 18)}</div>
      </div>
      <div class="tc-body">
        <h3>${t.title}</h3>
        <p>${t.description || ''}</p>
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
          <span class="avatar">${avatar(user.avatar, user.username)}</span>
          <h1>Hola, ${user.username}</h1>
        </button>
        <div class="user-menu" id="userMenu" hidden>
          <button class="user-menu-item" id="logoutItem">${icon('logout', 18)} Cerrar sesión</button>
        </div>
      </div>
      <button class="btn-icon" id="notifBtn" title="Notificaciones">${icon('bell', 20)}</button>
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
  } else {
    setHeader('');
  }

  const enabled = enabledTools();
  const disabled = disabledTools();
  const outlet = document.getElementById('outlet');

  outlet.innerHTML = `
    <div class="home-layout">
      ${enabled.map(([key, t]) => toolCardHTML(key, t)).join('')}
      ${disabled.map(([, t]) => lockedCardHTML(t)).join('')}
      ${!user ? `<button class="btn btn-primary btn-block login-cta" id="loginCta">Iniciar sesión</button>` : ''}
      <p class="app-footer">GStock 1.0.0</p>
    </div>
  `;

  outlet.querySelectorAll('.tool-card[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => pushRoute(btn.dataset.key));
  });

  const cta = outlet.querySelector('#loginCta');
  if (cta) cta.addEventListener('click', () => pushRoute('login'));
}

// Herramientas y login comparten esta plantilla: sin cabecera ni
// botón de volver — la navegación hacia atrás es el gesto/botón
// físico del dispositivo (ver el manejo de popstate más arriba).
function renderSubpage(title, fillContent) {
  lastRoute = 'subpage';
  setHeader('');
  const outlet = document.getElementById('outlet');
  outlet.innerHTML = `
    <div class="subpage">
      ${title ? `<h2 class="subpage-title">${title}</h2>` : ''}
      <div class="subpage-body" id="subpageBody"></div>
    </div>
  `;
  fillContent(outlet.querySelector('#subpageBody'));
}

function renderTool(key) {
  const tool = TOOLS[key];
  renderSubpage(tool.title, (body) => tool.render(body));
}

// El login va a pantalla completa (sin el padding de .subpage), así
// que no reutiliza renderSubpage().
function renderLogin() {
  lastRoute = 'subpage';
  setHeader('');
  const outlet = document.getElementById('outlet');
  outlet.classList.add('outlet-fullbleed');
  outlet.innerHTML = '';
  renderAuth(outlet, (loggedInUser) => {
    user = loggedInUser;
    // Reemplaza la entrada del login en vez de apilar una nueva: así,
    // al volver atrás desde el inicio ya logueado, no se resurfacea
    // el panel de login.
    history.replaceState(null, '', hashUrl(''));
    renderRoute();
  }, { showBack: true });
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
  if (!fresh) { logout(); user = null; renderHome(); return; }
  if (JSON.stringify(fresh) !== JSON.stringify(user)) {
    user = fresh;
    renderRoute();
  }
}

boot();
