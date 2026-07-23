/* ============================================================
   Módulo Desk · Bases de datos
   Un botón "Actualizar DB" para todas las fuentes de una — hoy
   dispara el motor de "Referencia", "Coordenadas" y "Variables"
   (server/services/inventory-engine.js, un solo login, una consulta
   por fuente, un solo logout) — y, además, un botón puntual en cada
   tarjeta para actualizar SOLO esa fuente (mismo motor, mismo login
   único, filtrado a una sola — ver refresh(sourceKeys) en
   inventory-engine.js). Los dos disparadores comparten el mismo lock
   del servidor: nunca pueden correr dos actualizaciones en simultáneo,
   sea masiva o puntual. Líneas picking todavía no tiene motor propio:
   la tarjeta ya existe con la forma final, pero no hace nada al
   tocarla (sin botón de actualizar).

   Cada tarjeta es sobre todo una vidriera de estado (ícono, sin
   texto). Tampoco se muestran las filas traídas acá, solo la cantidad
   y el horario (el detalle vive en el servidor, listo para
   consultarse desde otro módulo sin que el navegador tenga que
   cargarlo).

   La barra de progreso (botón masivo Y cada tarjeta puntual) usa
   shared/js/db-refresh.js para estimar cuánto va a tardar — tiempo
   REAL medido de la última corrida de cada fuente (Copernico + espejo
   en Supabase), nunca un número fijo igual para todas: no tiene
   sentido animar Referencia y Coordenadas al mismo ritmo si una trae
   ~11000 filas y la otra ~20000.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { formatDateTime, escapeHtml } from '/shared/js/format.js';
import { fetchStatus, triggerRefresh, estimateSourceMs, estimateTotalMs } from '/shared/js/db-refresh.js';

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

// Íconos premium (nunca CSS dibujado) por estado — sin texto al lado:
// el color + la forma del ícono ya distinguen los tres casos.
const STATUS_ICON = {
  ok: { name: 'check', cls: 'is-ok', title: 'Actualizado y cargado' },
  error: { name: 'alertTriangle', cls: 'is-error', title: 'Error al actualizar' },
  empty: { name: 'inbox', cls: 'is-empty', title: 'Sin datos' },
  // Copernico contestó bien (por eso no es "error"), pero el respaldo
  // en Supabase — lo único que sobrevive un restart/deploy en Render —
  // está fallando: los datos de esta fuente NO van a sobrevivir el
  // próximo restart, aunque se vean bien ahora mismo.
  mirrorError: { name: 'alertTriangle', cls: 'is-warn', title: 'Actualizado, pero el respaldo en Supabase está fallando: no sobrevivirá un restart' },
};

const EMPTY_SOURCE = { status: 'empty', lastUpdatedAt: null, rowCount: 0, durationMs: null, mirrorDurationMs: null, mirrorStatus: 'unknown', mirrorError: null };

const SOURCES = [
  { key: 'referencia', label: 'Referencia', icon: 'database', active: true },
  { key: 'variables', label: 'Variables', icon: 'layers', active: true },
  { key: 'coordenadas', label: 'Coordenadas', icon: 'pin', active: true },
  { key: 'lineas_picking', label: 'Líneas picking', icon: 'grid', active: false },
];
const ACTIVE_SOURCES = SOURCES.filter((s) => s.active);
const ACTIVE_KEYS = ACTIVE_SOURCES.map((s) => s.key);

export const title = 'Bases de datos';

export function render(outlet) {
  const root = document.createElement('div');
  outlet.innerHTML = '';
  outlet.appendChild(root);
  mount(root);
}

async function mount(root) {
  const state = {
    refreshing: false,
    runningKeys: null, // null = nada corriendo; array = corrida en curso (masiva o de una sola fuente)
    error: null,
    sources: Object.fromEntries(ACTIVE_SOURCES.map((s) => [s.key, { ...EMPTY_SOURCE }])),
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

  // Sin datos de progreso real (Copernico no informa avance, solo
  // responde entero al final): el relleno avanza una sola vez de 0 a
  // ~92% calibrado contra la estimación real (nunca en loop) y se
  // completa de golpe cuando la corrida real termina (antes o después
  // de lo estimado) — ver finishFill().
  function startFill(fillEl, ms) {
    if (!fillEl) return;
    fillEl.style.transition = 'none';
    fillEl.style.width = '0%';
    void fillEl.offsetWidth; // fuerza reflow: sin esto el navegador podía fusionar este cambio con el de abajo y saltar directo a 92%, sin animar
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
    return !!keys && keys.length === ACTIVE_KEYS.length && ACTIVE_KEYS.every((k) => keys.includes(k));
  }

  // Arranca la animación correcta según qué se esté corriendo: si son
  // TODAS las fuentes activas, el relleno del botón masivo; si es una
  // sola, el relleno de esa tarjeta puntual — nunca los dos a la vez,
  // porque el servidor no deja correr dos actualizaciones juntas.
  function startProgressFor(keys) {
    if (isMassRun(keys)) {
      startFill(root.querySelector('.db-refresh-btn-fill'), estimateTotalMs(state.sources, ACTIVE_KEYS));
    } else if (keys?.length === 1) {
      startFill(root.querySelector(`.db-source-card[data-key="${keys[0]}"] .db-source-progress-fill`), estimateSourceMs(state.sources, keys[0]));
    }
  }

  function finishProgressFor(keys) {
    if (isMassRun(keys)) {
      finishFill(root.querySelector('.db-refresh-btn-fill'));
    } else if (keys?.length === 1) {
      finishFill(root.querySelector(`.db-source-card[data-key="${keys[0]}"] .db-source-progress-fill`));
    }
  }

  async function loadStatus() {
    let data = null;
    try {
      data = await fetchStatus();
      applySources(data.sources);
    } catch {
      // Sin conexión al status: se queda con el último estado local
      // conocido (por defecto "Sin datos") en vez de romper la vista.
    }
    drawCards();
    if (data?.running) {
      // Alguien más (otra pestaña/persona) ya disparó una corrida —
      // los botones se muestran ocupados igual, en vez de dejar pensar
      // que se puede tocar de nuevo, y se refleja cuando esa corrida
      // ajena termine. Nunca dispara una corrida nueva por su cuenta.
      state.refreshing = true;
      state.runningKeys = data.runningKeys || ACTIVE_KEYS;
      drawButton();
      drawCards();
      startProgressFor(state.runningKeys);
      await pollUntilDone();
    } else {
      drawButton();
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
    drawButton();
    drawCards();
  }

  // sourceKey: omitido = corrida masiva (botón de arriba); con valor,
  // solo esa fuente (botón puntual de la tarjeta).
  async function handleRefresh(sourceKey) {
    if (state.refreshing) return;
    state.refreshing = true;
    state.runningKeys = sourceKey ? [sourceKey] : ACTIVE_KEYS;
    state.error = null;
    drawButton();
    drawCards();
    startProgressFor(state.runningKeys);
    try {
      // Solo dispara la corrida — no espera a que termine (eso puede
      // tardar 30-100+ segundos, según Copernico). El resultado final
      // se conoce por polling a /status, igual que cuando la corrida
      // la arranca otra pestaña — mismo pollUntilDone() para los dos
      // casos, sin mantener una conexión HTTP gigante abierta.
      await triggerRefresh(sourceKey);
    } catch (err) {
      // No llegó ni a arrancar (ej. ALREADY_RUNNING) — no hay nada
      // que esperar.
      finishProgressFor(state.runningKeys);
      state.refreshing = false;
      state.runningKeys = null;
      state.error = err;
      drawButton();
      drawCards();
      return;
    }
    await pollUntilDone();
  }

  function drawShell() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Bases de datos</h1>
          <p class="ph-sub muted">Fuentes de datos de Copernico WMS disponibles para la operación.</p>
        </div>
        <button class="btn btn-primary db-refresh-btn" id="btnRefresh">
          <span class="db-refresh-btn-tint"></span>
          <span class="db-refresh-btn-fill"></span>
          <span class="db-refresh-btn-content">${icon('refresh', 18)} Actualizar DB</span>
        </button>
      </div>
      <p class="form-error" id="refreshError" style="display:none;"></p>
      <div class="db-source-grid" id="sourceGrid"></div>
    `;
    root.querySelector('#btnRefresh').addEventListener('click', () => handleRefresh());
  }

  function drawButton() {
    const btn = root.querySelector('#btnRefresh');
    if (!btn) return;
    btn.disabled = state.refreshing;
    btn.classList.toggle('is-loading', isMassRun(state.runningKeys));

    const errEl = root.querySelector('#refreshError');
    if (errEl) {
      errEl.textContent = state.error ? errorMessage(state.error) : '';
      errEl.style.display = state.error ? '' : 'none';
    }
  }

  function sourceCardHTML(src) {
    const s = src.active ? state.sources[src.key] : EMPTY_SOURCE;
    const st = (s.status === 'ok' && s.mirrorStatus === 'error') ? STATUS_ICON.mirrorError : (STATUS_ICON[s.status] || STATUS_ICON.empty);
    const hasData = s.rowCount > 0;
    const isRunningThis = !!state.runningKeys && state.runningKeys.length === 1 && state.runningKeys[0] === src.key;

    return `
      <div class="card db-source-card" data-key="${src.key}">
        <div class="db-source-head">
          <div class="db-source-name">
            <div class="tc-icon-sm">${icon(src.icon, 18)}</div>
            <h3>${src.label}</h3>
          </div>
          <div class="db-source-head-actions">
            ${src.active ? `
              <button type="button" class="btn-icon db-source-refresh${isRunningThis ? ' is-loading' : ''}" data-key="${src.key}" title="Actualizar ${src.label}" ${state.refreshing ? 'disabled' : ''}>${icon('refresh', 15)}</button>
            ` : ''}
            <div class="db-status-icon ${st.cls}" title="${st.title}">${icon(st.name, 16)}</div>
          </div>
        </div>
        <div class="db-source-metrics">
          <div class="metric">
            <span class="num">${hasData ? s.rowCount.toLocaleString('es') : '—'}</span>
            <span class="lbl">Filas</span>
          </div>
          <div class="metric">
            <span class="num" style="font-size: var(--text-sm); font-weight: 600;">${hasData ? escapeHtml(formatDateTime(s.lastUpdatedAt)) : '—'}</span>
            <span class="lbl">Actualizado</span>
          </div>
        </div>
        ${src.active ? `
          <div class="db-source-progress">
            <div class="db-source-progress-fill"></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function drawCards() {
    const grid = root.querySelector('#sourceGrid');
    if (!grid) return;
    grid.innerHTML = SOURCES.map(sourceCardHTML).join('');
    grid.querySelectorAll('.db-source-refresh').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRefresh(btn.dataset.key);
      });
    });
  }
}
