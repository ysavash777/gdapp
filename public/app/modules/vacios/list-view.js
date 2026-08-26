// Módulo Programación remota — escanear/tipear un código, elegir ubicación,
// armar una lista de registros y mandarla como "Programar Conteo" a otro
// usuario (ver server/store/programacion-remota.store.js). Va directo al
// escaneo, sin pantalla de inicio. `records` se guarda en localStorage (no
// en la DB): no hace falta compartirlo entre usuarios ni dispositivos, y así
// sobrevive si se cierra la app a mitad de armar la lista.

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { createCameraScanner } from '../../scanner/camera.js';
import * as store from './store.js';

const STORAGE_KEY = 'gd.programacionRemota.records.v1';

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.error('[vacios/list-view] No se pudo guardar en localStorage:', e.message);
  }
}

let records = loadRecords(); // { codigo, ubicacion, descripcion, referencia, fv, pedprov }

function formatQty(saldo) {
  if (saldo == null) return '-';
  return Number.isInteger(saldo) ? String(saldo) : String(saldo);
}

export function renderHome(outlet) {
  outlet.innerHTML = '';
  openWorkspace();
}

// ---------- espacio de trabajo (cámara + lista + programar) ----------

function openWorkspace() {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-back" id="prClose" title="Volver">${icon('arrowLeft', 20)}</button>
      <div class="scan-title">Programación remota</div>
      <div class="scan-header-actions">
        <button class="btn-icon scan-torch" id="prTorch" title="Linterna" hidden>${icon('zap', 20)}</button>
      </div>
    </div>
    <div class="scan-camera" id="prCamera" title="Tocar para apagar/prender la cámara">
      <video id="prVideo" autoplay playsinline muted></video>
      <div class="scan-line"></div>
      <p class="scan-hint" id="prHint" hidden></p>
      <div class="scan-camera-gradient"></div>
    </div>
    <div class="scan-sheet">
      <div class="scan-sheet-head">
        <span id="prSheetHead">Sin registros todavía</span>
        <div class="scan-sheet-tools">
          <button type="button" class="btn-icon" id="prSearchToggle" title="Buscar en los registros">${icon('search', 15)}</button>
          <button type="button" class="manual-toggle" id="prManualToggle" title="Ingresar código manualmente">${icon('plus', 13)} Manual</button>
        </div>
      </div>
      <form class="scan-manual" id="prSearch" hidden>
        <input type="text" id="prSearchInput" placeholder="Buscar por código, ubicación, descripción…" autocomplete="off" />
      </form>
      <form class="scan-manual" id="prManual" hidden>
        <input type="text" inputmode="text" placeholder="Ingresar código manualmente" id="prManualInput" autocomplete="off" />
        <button type="submit" class="btn btn-primary" title="Agregar">${icon('plus', 18)}</button>
      </form>
      <div class="record-list" id="prChips"></div>
      <button type="button" class="btn btn-primary btn-block pr-fab" id="prProgramar" disabled>
        ${iconSolid('zapSolid', 18)} Programar Conteo
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  const cameraBox = overlay.querySelector('#prCamera');
  const videoEl = overlay.querySelector('#prVideo');
  const hintEl = overlay.querySelector('#prHint');
  const torchBtn = overlay.querySelector('#prTorch');
  const sheetHead = overlay.querySelector('#prSheetHead');
  const searchToggle = overlay.querySelector('#prSearchToggle');
  const searchForm = overlay.querySelector('#prSearch');
  const searchInput = overlay.querySelector('#prSearchInput');
  const manualToggle = overlay.querySelector('#prManualToggle');
  const manualForm = overlay.querySelector('#prManual');
  const manualInput = overlay.querySelector('#prManualInput');
  const chipsEl = overlay.querySelector('#prChips');
  const programarBtn = overlay.querySelector('#prProgramar');

  let closed = false;
  let sheetOpen = false; // hay un reg-sheet (ubicación o sesiones) encima
  let searchQuery = '';

  // Ancho fijo (.record-qty, reusado acá para la ubicación); de 4 a 10+
  // caracteres entran achicando la fuente, mismo criterio que qtySizeClass
  // en mapear/editor-view.js.
  function ubicSizeClass(text) {
    const len = String(text || '').length;
    if (len <= 6) return '';
    if (len <= 8) return 'is-md';
    if (len <= 10) return 'is-sm';
    return 'is-xs';
  }

  function visibleRecords() {
    if (!searchQuery) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) => [r.codigo, r.descripcion, r.ubicacion, r.pedprov].filter(Boolean).join(' ').toLowerCase().includes(q));
  }

  function recordCardHTML(r, i) {
    return `
      <button type="button" class="record-card" data-i="${i}">
        <div class="record-qty ${ubicSizeClass(r.ubicacion)}">
          <span class="record-qty-num">${escapeHtml(r.ubicacion || '-')}</span>
          <span class="record-qty-label">Ubicación</span>
        </div>
        <div class="record-info">
          <span class="record-desc">${escapeHtml(r.descripcion || r.codigo)}</span>
          <span class="record-code-line">${escapeHtml(r.codigo)}</span>
          <div class="record-badges">
            <span class="record-resp-badge">Cant ${escapeHtml(formatQty(r.saldo))}</span>
            ${r.fv ? `<span class="record-fecha-badge">FV ${escapeHtml(r.fv)}</span>` : ''}
          </div>
        </div>
        <div class="record-edit-hint" title="Tocar para modificar">${icon('moreVertical', 14)}</div>
      </button>
    `;
  }

  function renderChips() {
    const visible = visibleRecords();
    sheetHead.innerHTML = records.length
      ? `<span class="sheet-count-badge">${records.length}</span> Registro${records.length === 1 ? '' : 's'}`
      : 'Sin registros todavía';
    chipsEl.innerHTML = visible.map((r, i) => recordCardHTML(r, records.indexOf(visible[i]))).join('');
    programarBtn.disabled = records.length === 0;
  }
  renderChips();

  function closeSearch() {
    if (searchForm.hidden) return;
    searchForm.hidden = true;
    searchToggle.classList.remove('is-active');
    searchQuery = '';
    searchInput.value = '';
    renderChips();
  }

  searchToggle.addEventListener('click', () => {
    if (!searchForm.hidden) {
      closeSearch();
      return;
    }
    manualForm.hidden = true;
    searchForm.hidden = false;
    searchToggle.classList.add('is-active');
    searchInput.focus();
  });
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderChips();
  });

  manualToggle.addEventListener('click', () => {
    closeSearch();
    manualForm.hidden = !manualForm.hidden;
    if (!manualForm.hidden) manualInput.focus();
  });

  chipsEl.addEventListener('click', (e) => {
    const card = e.target.closest('.record-card');
    if (!card) return;
    const i = Number(card.dataset.i);
    const rec = records[i];
    if (rec) openUbicacionSheet(rec.referencia || rec.codigo, i);
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    scanner.destroy();
    window.removeEventListener('popstate', cleanup);
    overlay.remove();
  }
  window.addEventListener('popstate', cleanup);
  overlay.querySelector('#prClose').addEventListener('click', () => history.back());

  async function handleCode(raw) {
    if (sheetOpen) return; // ya hay una hoja abierta, no encimar
    const codigo = raw.trim();
    if (!codigo) return;
    if (navigator.vibrate) navigator.vibrate(35);
    openUbicacionSheet(codigo, null);
  }

  const scanner = createCameraScanner({
    videoEl, cameraBox, torchBtn, hintEl,
    onCode: (code) => handleCode(code),
  });

  manualForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = manualInput.value.trim();
    if (!value) return;
    await handleCode(value);
    manualInput.value = '';
    manualForm.hidden = true;
  });

  // ---------- hoja: elegir ubicación tras escanear/tipear/reabrir un chip ----------
  // editIndex != null => reabre un registro ya confirmado, y vuelve a
  // golpear la base en vez de reusar el dato: el stock pudo haberse movido.
  function openUbicacionSheet(codigo, editIndex) {
    sheetOpen = true;
    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title">Producto <b>${escapeHtml(codigo)}</b></span>
          <div class="reg-sheet-head-actions">
            ${editIndex != null ? `<button type="button" class="btn-icon" id="prUbicDelete" title="Quitar registro">${icon('trash', 18)}</button>` : ''}
            <button type="button" class="btn-icon" id="prUbicClose" title="Cerrar">${icon('x', 18)}</button>
          </div>
        </div>
        <div id="prUbicBody"><p class="cq-desc-value">Buscando producto...</p></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    function closeSheet() {
      backdrop.remove();
      sheetOpen = false;
      scanner.setPaused(false);
      scanner.resumeView();
    }
    backdrop.querySelector('#prUbicClose').addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });
    if (editIndex != null) {
      backdrop.querySelector('#prUbicDelete').addEventListener('click', () => {
        records.splice(editIndex, 1);
        saveRecords();
        renderChips();
        showToast('Registro quitado');
        closeSheet();
      });
    }

    let rows = [];
    let selectedIndex = null;

    function renderBody() {
      const bodyEl = backdrop.querySelector('#prUbicBody');
      if (rows.length === 0) {
        bodyEl.innerHTML = '<p class="cq-desc-value">Producto no encontrado en la base (EAN/referencia inexistente).</p>';
        return;
      }
      const first = rows[0];
      bodyEl.innerHTML = `
        <div class="prod-info">
          <div class="pr-prod-desc">${escapeHtml(first.descripcion || 'Producto sin descripción')}</div>
          <div class="pr-prod-codes">
            <span>${iconSolid('barcodeSolid', 12)}${escapeHtml(first.referencia || codigo)}</span>
            <span>${escapeHtml(first.ean || '')}</span>
          </div>
        </div>
        <div class="pr-ubic-list" id="prUbicList">
          ${rows.map((r, i) => `
            <div class="pr-ubicbox ${i === selectedIndex ? 'selected' : ''}" data-i="${i}">
              <div class="pr-ubicbox-top">
                <span class="pr-ubicbox-code">${escapeHtml(r.ubicacion || '(sin ubicación)')}</span>
                ${icon('check', 16)}
              </div>
              <div class="pr-ubicbox-meta">
                <span>Cant <b>${escapeHtml(formatQty(r.saldo))}</b></span>
                <span>FV <b>${escapeHtml(r.fv || '-')}</b></span>
                <span>Ped/Prov <b>${escapeHtml(r.pedprov || '-')}</b></span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      bodyEl.querySelector('#prUbicList').addEventListener('click', (e) => {
        const box = e.target.closest('.pr-ubicbox');
        if (!box) return;
        selectUbicacion(Number(box.dataset.i));
      });
    }

    // Tocar una ubicación ya la registra — sin botón de confirmar aparte.
    function selectUbicacion(index) {
      const row = rows[index];
      if (!row) return;
      const record = {
        codigo: row.referencia || row.ean || codigo,
        ubicacion: row.ubicacion,
        descripcion: row.descripcion,
        referencia: row.referencia || codigo,
        fv: row.fv,
        pedprov: row.pedprov,
      };
      if (editIndex != null) {
        records[editIndex] = record;
        showToast('Ubicación actualizada');
      } else {
        records.push(record);
        showToast('Registro agregado');
      }
      saveRecords();
      renderChips();
      closeSheet();
    }

    store.buscarProducto(codigo)
      .then((res) => {
        rows = res || [];
        if (editIndex != null) {
          const prevUbic = records[editIndex]?.ubicacion;
          const idx = rows.findIndex((r) => r.ubicacion === prevUbic);
          selectedIndex = idx >= 0 ? idx : null;
        }
        renderBody();
      })
      .catch(() => {
        backdrop.querySelector('#prUbicBody').innerHTML = '<p class="cq-desc-value">No se pudo consultar la base. Probá de nuevo.</p>';
      });
  }

  // ---------- hoja: elegir a quién programarle el conteo ----------
  programarBtn.addEventListener('click', () => openSesionesSheet());

  function openSesionesSheet() {
    sheetOpen = true;
    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title">Programar a</span>
          <button type="button" class="btn-icon" id="prSesClose" title="Cerrar">${icon('x', 18)}</button>
        </div>
        <div id="prSesBody"><p class="cq-desc-value">Buscando usuarios en línea...</p></div>
        <button type="button" class="btn btn-primary btn-block" id="prSesConfirm" disabled>${icon('zap', 16)} Enviar</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    function closeSheet() {
      backdrop.remove();
      sheetOpen = false;
      scanner.setPaused(false);
      scanner.resumeView();
    }
    backdrop.querySelector('#prSesClose').addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });

    const confirmBtn = backdrop.querySelector('#prSesConfirm');
    let sesiones = [];
    let selectedId = null;

    function renderSesiones() {
      const bodyEl = backdrop.querySelector('#prSesBody');
      if (sesiones.length === 0) {
        bodyEl.innerHTML = '<p class="cq-desc-value">Ningún usuario en línea con la extensión activa ahora mismo.</p>';
        confirmBtn.disabled = true;
        return;
      }
      bodyEl.innerHTML = `
        <div class="pr-session-list" id="prSessionList">
          ${sesiones.map((s) => `
            <div class="pr-session-row ${String(s.idEmpleado) === String(selectedId) ? 'selected' : ''}" data-id="${s.idEmpleado}">
              <span class="pr-session-dot"></span>
              <span class="pr-session-name">${escapeHtml(s.nombre)}</span>
              ${icon('check', 18)}
            </div>
          `).join('')}
        </div>
      `;
      bodyEl.querySelector('#prSessionList').addEventListener('click', (e) => {
        const row = e.target.closest('.pr-session-row');
        if (!row) return;
        selectedId = row.dataset.id;
        renderSesiones();
      });
      confirmBtn.disabled = selectedId == null;
    }

    store.listSesiones()
      .then((res) => { sesiones = res || []; renderSesiones(); })
      .catch(() => {
        backdrop.querySelector('#prSesBody').innerHTML = '<p class="cq-desc-value">No se pudo consultar quién está en línea. Probá de nuevo.</p>';
      });

    confirmBtn.addEventListener('click', async () => {
      if (selectedId == null) return;
      confirmBtn.disabled = true;
      try {
        await store.programarConteo(records.map((r) => ({ codigo: r.codigo, ubicacion: r.ubicacion })), selectedId);
        records = [];
        saveRecords();
        renderChips();
        closeSheet();
        cleanup();
        showToast('Conteo programado');
      } catch {
        showToast('No se pudo programar el conteo. Probá de nuevo.', { variant: 'warn' });
        confirmBtn.disabled = false;
      }
    });
  }

  scanner.start();
}
