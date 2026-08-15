/* ============================================================
   Módulo App · Configuración — hoy solo "Actualizar bases de datos"
   (mismo motor que el desk, ver server/services/inventory-engine.js):
   un botón para las tres fuentes juntas y uno puntual por fuente,
   compartiendo la lógica de estimación/estado con desk/modules/
   basesdatos.js vía shared/js/db-refresh.js (misma cuenta real de
   cuánto tarda cada una, no dos números distintos en cada shell).

   Exige el permiso 'basesdatos' — el mismo que ya protege esta acción
   en el desk (server/routes/database.js), así que basta con no
   pedirle nada al servidor si el usuario no lo tiene: no hay ruta
   nueva que proteger, la de siempre ya rechaza sin ese permiso.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { formatDateTime, escapeHtml } from '/shared/js/format.js';
import { fetchStatus, triggerRefresh, estimateSourceMs, estimateTotalMs } from '/shared/js/db-refresh.js';
import { changePassword } from '/shared/js/session.js';

const ERROR_MESSAGES = {
  LICENSE_LIMIT: 'No hay licencias disponibles en Copernico en este momento. Probá de nuevo más tarde.',
  ALREADY_LOGGED_IN: 'El usuario consultor ya tiene una sesión activa en otro dispositivo y no se pudo liberar automáticamente.',
  ALREADY_RUNNING: 'Ya hay una actualización en curso — esperá a que termine.',
  MISSING_CREDENTIALS: 'Faltan las credenciales del usuario consultor en el servidor.',
  INVALID_CREDENTIALS: 'Las credenciales del usuario consultor son inválidas.',
  LOGIN_FAILED: 'No se pudo iniciar sesión en Copernico.',
  FETCH_FAILED: 'Copernico no devolvió los datos de esta fuente.',
  NETWORK: 'No se pudo conectar con Copernico. Revisá la conexión.',
  TIMEOUT: 'Copernico no respondió a tiempo. Probá de nuevo en un momento.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  UNAUTHORIZED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  UNKNOWN_SOURCE: 'Esa fuente no existe.',
};

function errorMessage(err) {
  return ERROR_MESSAGES[err.message] || 'Ocurrió un error al actualizar la base de datos.';
}

const STATUS_ICON = {
  ok: { name: 'check', cls: 'is-ok', title: 'Actualizado y cargado' },
  error: { name: 'alertTriangle', cls: 'is-error', title: 'Error al actualizar' },
  empty: { name: 'inbox', cls: 'is-empty', title: 'Sin datos' },
  mirrorError: { name: 'alertTriangle', cls: 'is-warn', title: 'Actualizado, pero el respaldo en Supabase está fallando' },
};

const EMPTY_SOURCE = { status: 'empty', lastUpdatedAt: null, rowCount: 0, durationMs: null, mirrorDurationMs: null, mirrorStatus: 'unknown', mirrorError: null };

// Solo las tres activas: a diferencia del desk (que muestra "Líneas
// picking" como vidriera de lo que vendrá, ocupando un lugar fijo en
// una grilla de 4), esta lista de mobile no necesita reservar espacio
// para una fuente que todavía no hace nada.
const SOURCES = [
  { key: 'referencia', label: 'Referencia', icon: 'database' },
  { key: 'variables', label: 'Variables', icon: 'layers' },
  { key: 'coordenadas', label: 'Coordenadas', icon: 'pin' },
];
const KEYS = SOURCES.map((s) => s.key);

// La contraseña se pinta al instante (formulario estático), pero
// Bases de datos necesita un pedido al servidor (loadStatus()) — sin
// esperarlo, la pantalla se armaba en dos tiempos (contraseña ya
// visible, bases de datos apareciendo un instante después de la
// nada), que se ve roto. Un spinner mínimo cubre esa espera y recién
// entonces se muestra todo junto, ya completo.
export async function render(root, user) {
  const hasDbPerm = user?.permissions?.includes('basesdatos');

  if (!hasDbPerm) {
    root.innerHTML = `<div class="settings-screen" id="settingsRoot"></div>`;
    const pwBlock = document.createElement('div');
    root.querySelector('#settingsRoot').appendChild(pwBlock);
    mountPassword(pwBlock);
    return;
  }

  root.innerHTML = `<div class="settings-loading"><div class="settings-spinner"></div></div>`;

  const dbBlock = document.createElement('div');
  await mountDatabases(dbBlock); // corre detached del documento — sus listeners igual quedan atados

  if (!root.isConnected) return; // se salió de Configuración mientras cargaba

  const pwBlock = document.createElement('div');
  mountPassword(pwBlock);

  root.innerHTML = `<div class="settings-screen" id="settingsRoot"></div>`;
  const container = root.querySelector('#settingsRoot');
  container.appendChild(dbBlock);
  // Separador minimalista entre las dos secciones ya resueltas.
  container.appendChild(document.createElement('hr')).className = 'settings-separator';
  container.appendChild(pwBlock);
}

async function mountDatabases(root) {
  const state = {
    refreshing: false,
    runningKeys: null,
    error: null,
    sources: Object.fromEntries(KEYS.map((k) => [k, { ...EMPTY_SOURCE }])),
  };

  drawShell();
  await loadStatus();

  function applySources(sourcesMeta) {
    for (const key in sourcesMeta) {
      if (!state.sources[key]) continue;
      const meta = sourcesMeta[key];
      state.sources[key] = {
        status: meta.status,
        lastUpdatedAt: meta.lastUpdatedAt,
        rowCount: meta.rowCount,
        durationMs: meta.durationMs || state.sources[key].durationMs,
        mirrorDurationMs: meta.mirrorDurationMs || state.sources[key].mirrorDurationMs,
        mirrorStatus: meta.mirrorStatus,
        mirrorError: meta.mirrorError,
      };
    }
  }

  function startFill(fillEl, ms) {
    if (!fillEl) return;
    fillEl.style.transition = 'none';
    fillEl.style.width = '0%';
    void fillEl.offsetWidth;
    fillEl.style.transition = `width ${ms}ms linear`;
    fillEl.style.width = '92%';
  }

  function finishFill(fillEl) {
    if (!fillEl) return;
    fillEl.style.transition = 'width 250ms ease';
    fillEl.style.width = '100%';
    setTimeout(() => {
      fillEl.style.transition = 'none';
      fillEl.style.width = '0%';
    }, 300);
  }

  function isMassRun(keys) {
    return !!keys && keys.length === KEYS.length && KEYS.every((k) => keys.includes(k));
  }

  function startProgressFor(keys) {
    if (isMassRun(keys)) {
      startFill(root.querySelector('.settings-progress-fill'), estimateTotalMs(state.sources, KEYS));
    } else if (keys?.length === 1) {
      startFill(root.querySelector(`.settings-source-row[data-key="${keys[0]}"] .settings-source-progress-fill`), estimateSourceMs(state.sources, keys[0]));
    }
  }

  function finishProgressFor(keys) {
    if (isMassRun(keys)) {
      finishFill(root.querySelector('.settings-progress-fill'));
    } else if (keys?.length === 1) {
      finishFill(root.querySelector(`.settings-source-row[data-key="${keys[0]}"] .settings-source-progress-fill`));
    }
  }

  async function loadStatus() {
    let data = null;
    try {
      data = await fetchStatus();
      applySources(data.sources);
    } catch {
      // Sin conexión: se queda con lo último bueno que había en memoria.
    }
    drawRows();
    if (data?.running) {
      state.refreshing = true;
      state.runningKeys = data.runningKeys || KEYS;
      drawHead();
      drawRows();
      startProgressFor(state.runningKeys);
      await pollUntilDone();
    } else {
      drawHead();
    }
  }

  async function pollUntilDone() {
    while (root.isConnected) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!root.isConnected) return;
      try {
        const data = await fetchStatus();
        if (!data.running) { applySources(data.sources); break; }
      } catch {
        break;
      }
    }
    finishProgressFor(state.runningKeys);
    state.refreshing = false;
    state.runningKeys = null;
    drawHead();
    drawRows();
  }

  async function handleRefresh(sourceKey) {
    if (state.refreshing) return;
    state.refreshing = true;
    state.runningKeys = sourceKey ? [sourceKey] : KEYS;
    state.error = null;
    drawHead();
    drawRows();
    startProgressFor(state.runningKeys);
    try {
      await triggerRefresh(sourceKey);
    } catch (err) {
      finishProgressFor(state.runningKeys);
      state.refreshing = false;
      state.runningKeys = null;
      state.error = err;
      drawHead();
      drawRows();
      return;
    }
    await pollUntilDone();
  }

  function drawShell() {
    root.innerHTML = `
      <section class="settings-block">
        <div class="settings-block-head">
          <div>
            <h2>Bases de datos</h2>
            <p class="settings-hint">Fuentes de Copernico WMS.</p>
          </div>
          <button type="button" class="btn-icon settings-refresh-all" id="btnRefreshAll" title="Actualizar todas">${icon('refresh', 18)}</button>
        </div>
        <div class="settings-progress"><div class="settings-progress-fill"></div></div>
        <p class="form-error" id="refreshError" style="display:none;"></p>
        <div class="settings-source-list" id="sourceList"></div>
      </section>
    `;
    root.querySelector('#btnRefreshAll').addEventListener('click', () => handleRefresh());
  }

  function drawHead() {
    const btn = root.querySelector('#btnRefreshAll');
    if (!btn) return;
    btn.disabled = state.refreshing;
    btn.classList.toggle('is-loading', isMassRun(state.runningKeys));

    const errEl = root.querySelector('#refreshError');
    if (errEl) {
      errEl.textContent = state.error ? errorMessage(state.error) : '';
      errEl.style.display = state.error ? '' : 'none';
    }
  }

  function sourceRowHTML(src) {
    const s = state.sources[src.key];
    const st = (s.status === 'ok' && s.mirrorStatus === 'error') ? STATUS_ICON.mirrorError : (STATUS_ICON[s.status] || STATUS_ICON.empty);
    const hasData = s.rowCount > 0;
    const isRunningThis = !!state.runningKeys && state.runningKeys.length === 1 && state.runningKeys[0] === src.key;

    return `
      <div class="settings-source-row" data-key="${src.key}">
        <div class="settings-source-top">
          <div class="settings-source-info">
            <div class="settings-source-icon">${icon(src.icon, 16)}</div>
            <div>
              <h3>${src.label}</h3>
              <p>${hasData ? `${s.rowCount.toLocaleString('es')} filas · ${escapeHtml(formatDateTime(s.lastUpdatedAt))}` : 'Sin datos'}</p>
            </div>
          </div>
          <div class="settings-source-actions">
            <button type="button" class="btn-icon settings-source-refresh${isRunningThis ? ' is-loading' : ''}" data-key="${src.key}" title="Actualizar ${src.label}" ${state.refreshing ? 'disabled' : ''}>${icon('refresh', 14)}</button>
            <div class="settings-status-icon ${st.cls}" title="${st.title}">${icon(st.name, 13)}</div>
          </div>
        </div>
        <div class="settings-source-progress"><div class="settings-source-progress-fill"></div></div>
      </div>
    `;
  }

  function drawRows() {
    const list = root.querySelector('#sourceList');
    if (!list) return;
    list.innerHTML = SOURCES.map(sourceRowHTML).join('');
    list.querySelectorAll('.settings-source-refresh').forEach((btn) => {
      btn.addEventListener('click', () => handleRefresh(btn.dataset.key));
    });
  }
}

const PASSWORD_ERROR_MESSAGES = {
  INVALID_PASSWORD: 'La contraseña nueva debe tener al menos 4 caracteres.',
};

// Sección de autogestión: cualquier usuario logueado la ve, sin
// depender del permiso 'basesdatos' que sí exige el bloque de arriba.
function mountPassword(root) {
  root.innerHTML = `
    <section class="settings-block">
      <div class="settings-block-head">
        <div>
          <h2>Contraseña</h2>
          <p class="settings-hint">Actualizá la contraseña de tu cuenta.</p>
        </div>
      </div>
      <form id="pwForm" class="settings-password-form" autocomplete="off">
        <div class="field">
          <label for="pwNew">Contraseña nueva</label>
          <input id="pwNew" type="password" required minlength="4" autocomplete="new-password" placeholder="Ingresa tu nueva contraseña" />
        </div>
        <p class="form-error" id="pwError" style="display:none;"></p>
        <p class="form-success" id="pwSuccess" style="display:none;">Contraseña actualizada.</p>
        <button type="submit" class="btn btn-primary" id="pwSubmit">Actualizar contraseña</button>
      </form>
    </section>
  `;

  const form = root.querySelector('#pwForm');
  const errEl = root.querySelector('#pwError');
  const okEl = root.querySelector('#pwSuccess');
  const submitBtn = root.querySelector('#pwSubmit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    submitBtn.disabled = true;

    const newPassword = root.querySelector('#pwNew').value;

    try {
      const data = await changePassword(newPassword);
      if (data.ok) {
        form.reset();
        okEl.style.display = '';
      } else {
        errEl.textContent = PASSWORD_ERROR_MESSAGES[data.error] || 'No se pudo actualizar la contraseña.';
        errEl.style.display = '';
      }
    } catch {
      errEl.textContent = 'Sin conexión. Probá de nuevo.';
      errEl.style.display = '';
    } finally {
      submitBtn.disabled = false;
    }
  });
}
