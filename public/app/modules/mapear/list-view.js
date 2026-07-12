/* ============================================================
   Módulo App · Mapear — listado de mapeos.
   Abrir un mapeo (nuevo o existente) delega en editor-view.js — ahí
   vive tanto el escaneo como la edición de su contenido.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { formatDateTime, escapeHtml } from './format.js';
import { openEditor } from './editor-view.js';

let outletRef = null;
let refreshRef = null;

function mapeoRowHTML(m) {
  return `
    <div class="list-item mapeo-row" data-id="${m.id}">
      <button class="mapeo-open" data-id="${m.id}">
        <div class="li-icon">${icon('scan', 18)}</div>
        <div class="li-main">
          <span class="li-title">${escapeHtml(m.title)}</span>
          <span class="li-sub">${m.codes.length} código${m.codes.length === 1 ? '' : 's'} · ${formatDateTime(m.updatedAt)}</span>
        </div>
      </button>
      <div class="mapeo-actions">
        <button class="btn-icon mapeo-more" data-id="${m.id}" title="Más opciones">${icon('moreVertical', 18)}</button>
        <div class="mapeo-menu" id="mapeoMenu-${m.id}" hidden>
          <button class="user-menu-item" data-action="rename" data-id="${m.id}">${icon('edit', 16)} Renombrar</button>
          <button class="user-menu-item" data-action="download" data-id="${m.id}">${icon('download', 16)} Descargar</button>
          <button class="user-menu-item is-danger" data-action="delete" data-id="${m.id}">${icon('trash', 16)} Eliminar</button>
        </div>
      </div>
    </div>
  `;
}

export async function renderList(outlet, { onNew }) {
  outletRef = outlet;
  refreshRef = () => renderList(outlet, { onNew });

  const mapeos = await store.list();

  outlet.innerHTML = `
    <div class="action-hero">
      <button class="btn btn-primary btn-block" id="newMapeoBtn">${icon('camera', 20)} Nuevo mapeo</button>
      ${mapeos.length
        ? `<div class="list mapeo-list">${mapeos.map(mapeoRowHTML).join('')}</div>`
        : `
          <div class="card">
            <div class="empty-state">
              <div class="es-icon">${icon('scan', 26)}</div>
              <h3>Sin mapeos todavía</h3>
              <p>Cada mapeo que inicies con la cámara va a quedar listado aquí, con sus códigos, cantidad y condición.</p>
            </div>
          </div>
        `}
    </div>
  `;

  outlet.querySelector('#newMapeoBtn').addEventListener('click', onNew);

  outlet.querySelectorAll('.mapeo-open').forEach((btn) => {
    btn.addEventListener('click', () => openEditor({ mapeoId: Number(btn.dataset.id), onClose: refreshRef }));
  });

  outlet.querySelectorAll('.mapeo-more').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = outlet.querySelector(`#mapeoMenu-${btn.dataset.id}`);
      const wasHidden = menu.hidden;
      outlet.querySelectorAll('.mapeo-menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !wasHidden;
    });
  });

  outlet.querySelectorAll('.mapeo-menu [data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const action = btn.dataset.action;
      outlet.querySelectorAll('.mapeo-menu').forEach((m) => { m.hidden = true; });
      if (action === 'rename') openRenameModal(id);
      if (action === 'delete') openDeleteModal(id);
      if (action === 'download') showToast('La descarga estará disponible próximamente.');
    });
  });
}

// Cierra cualquier menú de opciones abierto al tocar fuera de él.
document.addEventListener('click', (e) => {
  if (!outletRef) return;
  if (e.target.closest('.mapeo-more') || e.target.closest('.mapeo-menu')) return;
  outletRef.querySelectorAll('.mapeo-menu').forEach((m) => { m.hidden = true; });
});

function showToast(text) {
  const old = document.getElementById('mapearToast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'mapearToast';
  toast.className = 'exit-toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

// Mismo patrón de modal genérico que usa desk/modules/usuarios.js.
function openModal({ headTitle, bodyHTML, footHTML, onMount, onSubmit }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>${headTitle}</h3>
        <button class="btn-icon" data-close>${icon('x', 18)}</button>
      </div>
      <form id="modalForm">
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-foot">${footHTML}</div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);

  const form = overlay.querySelector('#modalForm');
  if (onMount) onMount(overlay, form);
  if (onSubmit) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await onSubmit(overlay, form, close);
    });
  }
  return { overlay, close };
}

async function openRenameModal(id) {
  const mapeo = await store.get(id);
  if (!mapeo) return;

  openModal({
    headTitle: 'Renombrar mapeo',
    bodyHTML: `
      <div class="field">
        <label>Título</label>
        <input type="text" id="renameInput" value="${escapeHtml(mapeo.title)}" autocomplete="off" />
      </div>
    `,
    footHTML: `
      <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
      <button type="submit" class="btn btn-primary">Guardar</button>
    `,
    onMount: (overlay) => {
      const input = overlay.querySelector('#renameInput');
      input.focus();
      input.select();
    },
    onSubmit: async (overlay, form, close) => {
      const value = overlay.querySelector('#renameInput').value.trim();
      if (value) await store.rename(id, value);
      close();
      if (refreshRef) refreshRef();
    },
  });
}

async function openDeleteModal(id) {
  const mapeo = await store.get(id);
  if (!mapeo) return;

  openModal({
    headTitle: 'Eliminar mapeo',
    bodyHTML: `<p>¿Eliminar “${escapeHtml(mapeo.title)}” y sus ${mapeo.codes.length} código${mapeo.codes.length === 1 ? '' : 's'}? Esta acción no se puede deshacer.</p>`,
    footHTML: `
      <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
      <button type="submit" class="btn btn-danger">Eliminar</button>
    `,
    onSubmit: async (overlay, form, close) => {
      await store.remove(id);
      close();
      if (refreshRef) refreshRef();
    },
  });
}
