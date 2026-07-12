/* ============================================================
   Módulo App · Mapear — listado de mapeos + detalle de uno ya hecho.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { formatDateTime, codeItemHTML } from './format.js';

function statusBadgeHTML(m) {
  return m.finishedAt
    ? `<span class="badge badge-ok">${icon('check', 13)} Finalizado</span>`
    : `<span class="badge badge-warn">En curso</span>`;
}

function mapeoItemHTML(m) {
  return `
    <button class="list-item mapeo-item" data-id="${m.id}">
      <div class="li-icon">${icon('scan', 18)}</div>
      <div class="li-main">
        <span class="li-title">Mapeo #${m.id}</span>
        <span class="li-sub">${m.codes.length} código${m.codes.length === 1 ? '' : 's'} · ${formatDateTime(m.createdAt)}</span>
      </div>
      ${statusBadgeHTML(m)}
      <span class="li-chevron">${icon('chevronRight', 16)}</span>
    </button>
  `;
}

export async function renderList(outlet, { onNew }) {
  const mapeos = await store.list();

  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block" id="newMapeoBtn">${icon('camera', 20)} Nuevo mapeo</button>
      ${mapeos.length
        ? `<div class="list mapeo-list">${mapeos.map(mapeoItemHTML).join('')}</div>`
        : `
          <div class="card">
            <div class="empty-state">
              <div class="es-icon">${icon('scan', 26)}</div>
              <h3>Sin mapeos todavía</h3>
              <p>Cada mapeo que inicies con la cámara va a quedar listado aquí, con sus códigos escaneados.</p>
            </div>
          </div>
        `}
    </div>
  `;

  outlet.querySelector('#newMapeoBtn').addEventListener('click', onNew);
  outlet.querySelectorAll('.mapeo-item').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(Number(btn.dataset.id)));
  });
}

// Detalle de solo lectura: mismo overlay a pantalla completa que usa el
// escáner (ver scan-overlay en app.css), sin cámara — solo para que el
// usuario pueda volver a validar los códigos de un mapeo ya hecho.
async function openDetail(id) {
  const mapeo = await store.get(id);
  if (!mapeo) return;

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay detail-overlay';
  overlay.innerHTML = `
    <div class="scan-header">
      <button class="btn-icon scan-close" id="detailClose" title="Cerrar">${icon('x', 20)}</button>
      <div class="scan-count">Mapeo #${mapeo.id}</div>
      <span class="scan-header-spacer"></span>
    </div>
    <div class="detail-body">
      <div class="detail-meta">
        ${statusBadgeHTML(mapeo)}
        <span class="li-sub">${formatDateTime(mapeo.createdAt)}</span>
      </div>
      ${mapeo.codes.length
        ? `<ul class="scan-codes detail-codes">${mapeo.codes.slice().reverse().map(codeItemHTML).join('')}</ul>`
        : `
          <div class="empty-state">
            <div class="es-icon">${icon('scan', 24)}</div>
            <h3>Sin códigos</h3>
            <p>Este mapeo no tiene códigos registrados.</p>
          </div>
        `}
    </div>
  `;
  document.body.appendChild(overlay);

  // El primer "volver" del dispositivo cierra este detalle (no sale
  // de la herramienta) — se logra con una entrada de historial propia.
  history.pushState({ mapeoDetail: true }, '', location.href);
  let closedByPop = false;
  function onPopState() {
    closedByPop = true;
    close();
  }
  window.addEventListener('popstate', onPopState);

  function close() {
    window.removeEventListener('popstate', onPopState);
    overlay.remove();
    if (!closedByPop) history.back();
  }
  overlay.querySelector('#detailClose').addEventListener('click', close);
}
