// Módulo Programación remota — escanear/tipear un código, elegir ubicación,
// armar una lista de registros y mandarla como "Programar Conteo" a otro
// usuario (ver server/store/programacion-remota.store.js). Va directo al
// escaneo, sin pantalla de inicio. `records` se guarda en localStorage (no
// en la DB): no hace falta compartirlo entre usuarios ni dispositivos, y así
// sobrevive si se cierra la app a mitad de armar la lista.

import { icon, iconSolid } from '/shared/js/icons.js';
import { escapeHtml } from '/shared/js/format.js';
import { showToast } from '/shared/js/toast.js';
import { existsLocal, hasData } from '/shared/js/product-catalog.js';
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
  return `${saldo} UN`;
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
  let activeBackdrop = null; // el backdrop de esa hoja — vive en document.body, no dentro de `overlay`
  let searchQuery = '';

  function visibleRecords() {
    if (!searchQuery) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) => [r.codigo, r.descripcion, r.ubicacion, r.pedprov].filter(Boolean).join(' ').toLowerCase().includes(q));
  }

  function recordCardHTML(r, i) {
    return `
      <button type="button" class="pr-record" data-i="${i}">
        <div class="pr-record-head">
          <span class="pr-record-ubic">${iconSolid('caja', 12)}${escapeHtml(r.ubicacion || '-')}</span>
          <span class="pr-record-hint" title="Tocar para modificar">${icon('moreVertical', 14)}</span>
        </div>
        <span class="pr-record-desc">${escapeHtml(r.descripcion || r.codigo)}</span>
        <div class="pr-record-meta">
          <span class="pr-record-meta-item">${iconSolid('barcodeSolid', 11)}${escapeHtml(r.referencia || r.codigo)}</span>
          <span class="pr-record-meta-item">${icon('calendarAlert', 12)}${escapeHtml(r.fv || '-')}</span>
          <span class="pr-record-meta-item">${iconSolid('tagSolid', 12)}${escapeHtml(r.pedprov || '-')}</span>
        </div>
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
    const card = e.target.closest('.pr-record');
    if (!card) return;
    const i = Number(card.dataset.i);
    const rec = records[i];
    if (rec) openUbicacionSheet(rec.referencia || rec.codigo, i);
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    // El backdrop de la hoja abierta (ubicación o sesiones) vive en
    // document.body, NUNCA dentro de `overlay` — sin esto, deslizar
    // para atrás con una hoja abierta se llevaba puesto el espacio de
    // trabajo pero dejaba la hoja huérfana, tapando la pantalla.
    if (activeBackdrop) {
      activeBackdrop.remove();
      activeBackdrop = null;
    }
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
    // Valida contra el catálogo local (Variables) ANTES de ir a buscar
    // ubicación — mismo criterio que Mapear/Consultar grupo: si el
    // código ni siquiera es un SKU real, ir a buscarle ubicación en
    // Referencia es una consulta de más que nunca va a encontrar nada.
    // Se salta solo si el catálogo local todavía está vacío (sin red
    // desde el primer uso), donde no hay forma de saber si existe.
    if (hasData() && !existsLocal(codigo)) {
      showToast(`Código no encontrado: ${codigo}`, { variant: 'warn' });
      return;
    }
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
          <span class="reg-sheet-title">${editIndex == null ? 'Producto encontrado' : 'Editar registro'}</span>
          <div class="reg-sheet-head-actions">
            ${editIndex != null ? `<button type="button" class="btn-icon" id="prUbicDelete" title="Quitar registro">${icon('trash', 18)}</button>` : ''}
            <button type="button" class="btn-icon" id="prUbicClose" title="Cerrar">${icon('x', 18)}</button>
          </div>
        </div>
        <div id="prUbicBody"><p class="cq-desc-value">Buscando producto...</p></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    activeBackdrop = backdrop;

    function closeSheet() {
      backdrop.remove();
      activeBackdrop = null;
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
            ${first.ean ? `<span>${iconSolid('tagSolid', 12)}${escapeHtml(first.ean)}</span>` : ''}
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
                <span>${icon('package', 12)}<b>${escapeHtml(formatQty(r.saldo))}</b></span>
                <span>${icon('calendarAlert', 12)}<b>${escapeHtml(r.fv || '-')}</b></span>
                <span>${iconSolid('tagSolid', 12)}<b>${escapeHtml(r.pedprov || '-')}</b></span>
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

  // ---------- hoja: wizard de 3 pasos (Programar a / Contador / N° conteo) ----------
  programarBtn.addEventListener('click', () => openProgramarWizard());

  function openProgramarWizard() {
    sheetOpen = true;
    scanner.setPaused(true);
    scanner.setTorch(false);
    scanner.pauseView();

    const backdrop = document.createElement('div');
    backdrop.className = 'reg-sheet-backdrop';
    backdrop.innerHTML = `
      <div class="reg-sheet">
        <div class="reg-sheet-head">
          <span class="reg-sheet-title">Programar conteo</span>
          <button type="button" class="btn-icon" id="prWizClose" title="Cerrar">${icon('x', 18)}</button>
        </div>
        <div class="pr-wizard">
          <div class="pr-wizard-steps">
            <button type="button" class="pr-wizard-step" id="prWizDot1" data-step="1">
              <span class="pr-wizard-dot">1</span><span class="pr-wizard-label">Programar a</span>
            </button>
            <div class="pr-wizard-connector" id="prWizConn1"></div>
            <button type="button" class="pr-wizard-step" id="prWizDot2" data-step="2" disabled>
              <span class="pr-wizard-dot">2</span><span class="pr-wizard-label">Contador</span>
            </button>
            <div class="pr-wizard-connector" id="prWizConn2"></div>
            <button type="button" class="pr-wizard-step" id="prWizDot3" data-step="3" disabled>
              <span class="pr-wizard-dot">3</span><span class="pr-wizard-label">N° conteo</span>
            </button>
          </div>
          <div class="pr-wizard-viewport">
            <div class="pr-wizard-track" id="prWizTrack">
              <div class="pr-wizard-panel" id="prWizPanel1"><p class="cq-desc-value">Buscando usuarios en línea...</p></div>
              <div class="pr-wizard-panel" id="prWizPanel2"></div>
              <div class="pr-wizard-panel" id="prWizPanel3"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    activeBackdrop = backdrop;

    // El teclado nativo, en el celular, no achica el viewport de layout
    // (position:fixed sigue midiendo la pantalla completa) — solo el
    // "visual viewport" se achica. Sin esto la hoja seguía anclada
    // abajo de TODA la pantalla, y el teclado la tapaba desde ahí,
    // dejando el input de contador escondido detrás mientras se tipea.
    // Siguiendo al visual viewport, la hoja queda siempre pegada justo
    // arriba del teclado.
    function syncKeyboardViewport() {
      const vv = window.visualViewport;
      if (!vv) return;
      backdrop.style.top = `${vv.offsetTop}px`;
      backdrop.style.height = `${vv.height}px`;
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncKeyboardViewport);
      window.visualViewport.addEventListener('scroll', syncKeyboardViewport);
      syncKeyboardViewport();
    }

    let pollTimer = null;
    let sesionesPollTimer = null;
    function closeSheet() {
      if (pollTimer) clearInterval(pollTimer);
      if (sesionesPollTimer) clearInterval(sesionesPollTimer);
      resizeObserver.disconnect();
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', syncKeyboardViewport);
        window.visualViewport.removeEventListener('scroll', syncKeyboardViewport);
      }
      backdrop.remove();
      activeBackdrop = null;
      sheetOpen = false;
      scanner.setPaused(false);
      scanner.resumeView();
    }
    backdrop.querySelector('#prWizClose').addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { closeSheet(); return; }
      // Cierra el desplegable de sugerencias (paso Contador) al tocar
      // afuera, sin cerrar toda la hoja — un solo listener acá evita
      // sumar uno nuevo cada vez que renderPaso2() se vuelve a llamar
      // (retroceder y avanzar entre pasos).
      const openMenu = backdrop.querySelector('.pr-combo-menu:not([hidden])');
      if (openMenu && !e.target.closest('.pr-combo')) openMenu.hidden = true;
    });

    const track = backdrop.querySelector('#prWizTrack');
    const wizViewport = track.parentElement;
    const dots = [null, backdrop.querySelector('#prWizDot1'), backdrop.querySelector('#prWizDot2'), backdrop.querySelector('#prWizDot3')];
    const conns = [null, backdrop.querySelector('#prWizConn1'), backdrop.querySelector('#prWizConn2')];
    const panels = [null, backdrop.querySelector('#prWizPanel1'), backdrop.querySelector('#prWizPanel2'), backdrop.querySelector('#prWizPanel3')];

    let step = 1;
    let maxDone = 0; // hasta qué paso hay datos completos — habilita retroceder/navegar por los puntos
    let targetId = null;
    let targetNombre = '';
    let contadorId = null;

    // Solo se puede IR a un paso ya completado (o al actual) — nunca
    // saltar adelante sin completar el de la izquierda.
    function goToStep(n) {
      if (n > maxDone + 1) return;
      step = n;
      // Corrimiento en píxeles medidos (nunca un % de CSS sobre el
      // propio ancho del track, que quedaba mal resuelto acá y el
      // panel vecino se veía "atrás", pisado por el anterior).
      track.style.transform = `translateX(-${(n - 1) * wizViewport.clientWidth}px)`;
      // El viewport tiene overflow:hidden pero sigue siendo scrolleable
      // por foco/teclado — un input que recibe foco puede quedar
      // "centrado" por el navegador vía scrollLeft, que se suma al
      // translateX de arriba y descuadra todo. Nunca debería moverse
      // por su cuenta: el slider es 100% el transform.
      wizViewport.scrollLeft = 0;
      for (let i = 1; i <= 3; i++) {
        dots[i].classList.toggle('is-active', i === n);
        dots[i].classList.toggle('is-done', i <= maxDone && i !== n);
        dots[i].disabled = i > maxDone + 1;
      }
      conns[1]?.classList.toggle('is-done', maxDone >= 1);
      conns[2]?.classList.toggle('is-done', maxDone >= 2);
    }
    for (let i = 1; i <= 3; i++) dots[i].addEventListener('click', () => goToStep(i));

    // El corrimiento es en píxeles medidos del viewport, así que si su
    // ancho cambia (rotar el celular, achicar la ventana) hay que
    // volver a aplicarlo — sin esto, un resize a mitad de flujo dejaba
    // el panel activo mal alineado, aunque los tres midieran bien.
    const resizeObserver = new ResizeObserver(() => goToStep(step));
    resizeObserver.observe(wizViewport);

    // ---------- paso 1: Programar a (sesiones online) ----------
    function renderPaso1(sesiones) {
      panels[1].innerHTML = sesiones.length === 0
        ? '<p class="cq-desc-value">Ningún usuario en línea con la extensión activa ahora mismo.</p>'
        : `
          <div class="pr-session-list" id="prSessionList">
            ${sesiones.map((s) => `
              <div class="pr-session-row ${String(s.idEmpleado) === String(targetId) ? 'selected' : ''}" data-id="${s.idEmpleado}" data-nombre="${escapeHtml(s.nombre)}">
                <span class="pr-session-dot"></span>
                <span class="pr-session-name">${escapeHtml(s.nombre)}</span>
                ${icon('check', 18)}
              </div>
            `).join('')}
          </div>
        `;
      panels[1].querySelector('#prSessionList')?.addEventListener('click', (e) => {
        const row = e.target.closest('.pr-session-row');
        if (!row) return;
        targetId = row.dataset.id;
        targetNombre = row.dataset.nombre;
        maxDone = Math.max(maxDone, 1);
        renderPaso1(sesiones); // repinta la selección
        dots[2].disabled = false;
        goToStep(2);
        renderPaso2();
      });
    }
    function fetchSesiones() {
      store.listSesiones()
        .then((res) => renderPaso1(res || []))
        .catch(() => {
          if (maxDone < 1) panels[1].innerHTML = '<p class="cq-desc-value">No se pudo consultar quién está en línea. Probá de nuevo.</p>';
        });
    }
    fetchSesiones();
    // Si Copérnico todavía no estaba abierto del lado del empleado, el
    // paso 1 arranca vacío — sin esto había que cerrar y volver a abrir
    // la hoja para que aparezca, una vez que se conecta. Se actualiza
    // solo mientras el usuario sigue elegiendo (para de sondear apenas
    // hay alguien elegido, así no le repinta la lista bajo el dedo).
    sesionesPollTimer = setInterval(() => {
      if (maxDone >= 1) { clearInterval(sesionesPollTimer); sesionesPollTimer = null; return; }
      fetchSesiones();
    }, 4000);

    // ---------- paso 2: Contador (buscar por nombre en Copernico) ----------
    // Elegir una sugerencia solo LLENA el campo — hace falta tocar
    // "Generar conteo" a propósito, para que un tap de más en la lista
    // de sugerencias nunca dispare un conteo con el contador equivocado.
    let searchTimer = null;
    function renderPaso2() {
      panels[2].innerHTML = `
        <p class="pr-wizard-hint">Programando a <b>${escapeHtml(targetNombre)}</b></p>
        <div class="pr-combo">
          <form class="scan-manual" id="prContadorForm">
            <input type="text" id="prContadorInput" placeholder="Buscar contador por nombre…" autocomplete="off" />
          </form>
          <div class="pr-combo-menu" id="prContadorMenu" hidden></div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="prGenerarBtn" disabled>${iconSolid('zapSolid', 16)} Generar conteo</button>
      `;
      const input = panels[2].querySelector('#prContadorInput');
      const menu = panels[2].querySelector('#prContadorMenu');
      const generarBtn = panels[2].querySelector('#prGenerarBtn');
      panels[2].querySelector('#prContadorForm').addEventListener('submit', (e) => e.preventDefault());

      function invalidateSelection() {
        contadorId = null;
        generarBtn.disabled = true;
      }
      input.addEventListener('input', () => {
        invalidateSelection();
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) { menu.hidden = true; menu.innerHTML = ''; return; }
        searchTimer = setTimeout(async () => {
          let empleados = [];
          try { empleados = await store.buscarContadores(q); } catch { /* silencioso, ver placeholder abajo */ }
          menu.hidden = false;
          menu.innerHTML = empleados.length
            ? empleados.map((e) => `<div class="pr-combo-option" data-id="${e.idEmpleado}" data-nombre="${escapeHtml(e.nombre)}">${escapeHtml(e.nombre)}</div>`).join('')
            : '<p class="pr-combo-empty">Sin resultados.</p>';
        }, 300);
      });
      menu.addEventListener('click', (e) => {
        const opt = e.target.closest('.pr-combo-option');
        if (!opt) return;
        contadorId = opt.dataset.id;
        input.value = opt.dataset.nombre;
        menu.hidden = true;
        generarBtn.disabled = false;
      });
      generarBtn.addEventListener('click', async () => {
        if (!contadorId) return;
        const contadorNombre = input.value.trim();
        maxDone = Math.max(maxDone, 2);
        dots[3].disabled = false;
        goToStep(3);
        await generarConteo(contadorNombre);
      });
      // preventScroll: sin esto, el foco automático hacía que el propio
      // navegador scrollee ".pr-wizard-viewport" para "mostrar" el input
      // recién creado — como ese contenedor es scrolleable aunque tenga
      // overflow:hidden, ese scroll se sumaba al translateX del slider y
      // dejaba todo el paso 2 corrido y tapado, sin volver atrás nunca.
      input.focus({ preventScroll: true });
    }

    // ---------- paso 3: generar y mostrar el N° de conteo ----------
    async function generarConteo(contadorNombre) {
      panels[3].innerHTML = `
        <div class="pr-wizard-loading">
          <span class="sync-status-icon is-spinning">${icon('refresh', 22)}</span>
          <p class="cq-desc-value">Generando conteo para <b>${escapeHtml(contadorNombre)}</b>...</p>
        </div>
      `;
      let originClientId;
      try {
        originClientId = await store.programarConteo(
          records.map((r) => ({ codigo: r.codigo, ubicacion: r.ubicacion })),
          targetId,
          contadorId,
        );
      } catch {
        panels[3].innerHTML = `
          <div class="pr-wizard-result is-error">
            ${iconSolid('alertTriangleSolid', 40)}
            <span class="pr-wizard-result-label">No se pudo enviar</span>
            <p class="pr-wizard-result-hint">Revisá tu conexión y volvé a intentar.</p>
            <button type="button" class="btn btn-primary btn-block" id="prWizRetry">Volver a intentar</button>
          </div>
        `;
        panels[3].querySelector('#prWizRetry').addEventListener('click', () => goToStep(2));
        return;
      }
      // Los registros ya se mandaron: se limpia la lista de la herramienta
      // (la cámara sigue lista para el próximo lote), sin cerrar esta hoja
      // — el número de conteo se muestra hasta que el usuario lo cierre.
      const itemCount = records.length;
      records = [];
      saveRecords();
      renderChips();

      let elapsedMs = 0;
      pollTimer = setInterval(async () => {
        elapsedMs += 2000;
        let resultado = null;
        try { resultado = await store.obtenerResultado(originClientId); } catch { /* reintenta en el próximo tick */ }
        if (!resultado) {
          if (elapsedMs > 20000 && !panels[3].querySelector('.pr-wizard-hint')) {
            panels[3].querySelector('.pr-wizard-loading').insertAdjacentHTML('beforeend',
              '<p class="pr-wizard-hint">Está tardando más de lo esperado — podés cerrar esta ventana, el conteo sigue procesándose igual.</p>');
          }
          return;
        }
        clearInterval(pollTimer);
        pollTimer = null;
        // Sin botón "Cerrar" acá — la cruz del encabezado del modal ya
        // cierra la hoja, un segundo botón para lo mismo era redundante.
        if (resultado.ok) {
          // El número solo se ve chico y "flotando" en un panel de alto
          // fijo — en vez de agrandar el modal, se llena el mismo
          // espacio con un resumen útil (a quién y cuántos ítems) en
          // vez de dejarlo vacío.
          panels[3].innerHTML = `
            <div class="pr-wizard-result">
              ${iconSolid('checkCircleSolid', 40)}
              <span class="pr-wizard-result-label">Conteo generado</span>
              <span class="pr-wizard-result-number">${escapeHtml(resultado.idConteo || '-')}</span>
              <p class="pr-wizard-result-hint">Asignado a <b>${escapeHtml(targetNombre)}</b> · contador <b>${escapeHtml(contadorNombre)}</b> · ${itemCount} ${itemCount === 1 ? 'ítem' : 'ítems'}</p>
            </div>
          `;
        } else {
          // Flat y premium a propósito, nunca un toast: el motivo real
          // más común es que Copernico no encontró stock en la
          // ubicación elegida — se dice así, en criollo, en vez de
          // mostrar el detalle técnico crudo que manda la extensión.
          panels[3].innerHTML = `
            <div class="pr-wizard-result is-error">
              ${iconSolid('alertTriangleSolid', 40)}
              <span class="pr-wizard-result-label">Conteo no creado</span>
              <p class="pr-wizard-result-hint">Revisá que la ubicación seleccionada tenga stock disponible.</p>
            </div>
          `;
        }
      }, 2000);
    }

    goToStep(1);
  }

  scanner.start();
}
