/* ============================================================
   Módulo App · Mapear — listado de mapeos.
   Abrir un mapeo (nuevo o existente) delega en editor-view.js — ahí
   vive tanto el escaneo como la edición de su contenido.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { formatDateTime, escapeHtml } from './format.js';
import { openEditor } from './editor-view.js';
import { currentUser } from '/shared/js/session.js';

let outletRef = null;
let refreshRef = null;

function actor() {
  return currentUser()?.username || null;
}

function mapeoCardHTML(m) {
  const count = m.codes.length;
  return `
    <div class="mapeo-card" data-id="${m.id}">
      <button class="mapeo-open" data-id="${m.id}">
        <div class="li-icon">${icon('scan', 18)}</div>
        <div class="mapeo-info">
          <span class="mapeo-title">${escapeHtml(m.title)}</span>
          <span class="mapeo-meta">${count} código${count === 1 ? '' : 's'} · ${formatDateTime(m.updatedAt)}</span>
          ${m.updatedBy ? `<span class="mapeo-editor">Editado por <strong>${escapeHtml(m.updatedBy)}</strong></span>` : ''}
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

// Tarjeta "hueso" — misma forma que mapeoCardHTML pero con barras que
// titilan en vez de texto, para no dejar la pantalla en blanco
// mientras store.list() contesta (que puede tardar, sobre todo si
// tiene que ir a la red).
function mapeoCardSkeletonHTML() {
  return `
    <div class="mapeo-card">
      <div class="mapeo-open" style="cursor: default;">
        <div class="cq-skeleton" style="width: 36px; height: 36px; border-radius: var(--r-full); flex-shrink: 0;"></div>
        <div class="mapeo-info">
          <span class="cq-skeleton" style="width: 65%; height: 15px; margin-bottom: 6px;"></span>
          <span class="cq-skeleton" style="width: 40%; height: 12px;"></span>
        </div>
      </div>
    </div>
  `;
}

export async function renderList(outlet, { onNew }) {
  outletRef = outlet;
  refreshRef = () => renderList(outlet, { onNew });

  outlet.innerHTML = `
    <div class="action-hero">
      <div class="searchbar">
        ${icon('search', 18)}
        <input type="search" id="mapeoSearchInput" placeholder="Buscar mapeo..." autocomplete="off" disabled />
      </div>
      <div id="mapeoListWrap">
        <div class="mapeo-list">${[1, 2, 3].map(mapeoCardSkeletonHTML).join('')}</div>
      </div>
    </div>
  `;

  // store.list() ya cae solo a la última foto buena en localStorage si
  // no hay red (ver store.js) — esto solo pasa si NUNCA hubo una foto
  // que guardar (primera vez que se abre Mapear en este dispositivo,
  // sin conexión) o si el error es real (sesión vencida, servidor
  // caído), no de conectividad.
  let mapeos, listError;
  try {
    mapeos = await store.list();
  } catch (err) {
    listError = err;
    mapeos = [];
  }

  if (!outlet.isConnected) return; // se salió de Mapear mientras esperaba

  const listWrap = outlet.querySelector('#mapeoListWrap');
  listWrap.innerHTML = listError
    ? `
      <div class="card cq-fade-in">
        <div class="empty-state">
          <div class="es-icon">${icon('alertTriangle', 26)}</div>
          <h3>No se pudo cargar</h3>
          <p>Sin conexión y sin ningún mapeo visto antes en este dispositivo — conectate al menos una vez para poder seguir sin red después.</p>
          <button type="button" class="btn btn-ghost" id="mapeoRetryBtn" style="margin-top:var(--sp-3);">${icon('refresh', 16)} Reintentar</button>
        </div>
      </div>
    `
    : mapeos.length
    ? `<div class="mapeo-list cq-fade-in">${mapeos.map(mapeoCardHTML).join('')}</div>`
    : `
      <div class="card cq-fade-in">
        <div class="empty-state">
          <div class="es-icon">${icon('scan', 26)}</div>
          <h3>Aún no hay datos</h3>
          <p>Los mapeos que crees van a aparecer acá.</p>
        </div>
      </div>
    `;

  outlet.querySelector('#mapeoSearchInput').disabled = false;

  if (listError) {
    outlet.querySelector('#mapeoRetryBtn').addEventListener('click', refreshRef);
    return;
  }

  // Icono "+" en la fila del título (junto a "Mapear"): abre el menú
  // para elegir cómo empezar un mapeo — crear uno nuevo escaneando, o
  // (a futuro) importarlo ya armado.
  const titleActions = document.getElementById('subpageTitleActions');
  if (titleActions) {
    titleActions.innerHTML = `
      <div class="mapeo-add-wrap">
        <button type="button" class="btn-icon" id="mapeoAddBtn" title="Agregar mapeo">${icon('plus', 20)}</button>
        <div class="mapeo-menu" id="mapeoAddMenu" hidden>
          <button class="user-menu-item" data-action="create">${icon('scan', 16)} Crear mapeo</button>
          <button class="user-menu-item" data-action="import">${icon('download', 16)} Importar mapeo</button>
        </div>
      </div>
    `;
    const addBtn = titleActions.querySelector('#mapeoAddBtn');
    const addMenu = titleActions.querySelector('#mapeoAddMenu');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addMenu.hidden = !addMenu.hidden;
    });
    addMenu.querySelector('[data-action="create"]').addEventListener('click', () => {
      addMenu.hidden = true;
      openCreateModal(onNew);
    });
    addMenu.querySelector('[data-action="import"]').addEventListener('click', () => {
      addMenu.hidden = true;
      showToast('La importación estará disponible próximamente.');
    });
  }

  // Buscador de mapeos por cualquier dato visible en su tarjeta (título,
  // fecha, cantidad de códigos, usuario que lo editó) — siempre abierto,
  // sin toggle: filtra en vivo a medida que se escribe.
  const searchInput = outlet.querySelector('#mapeoSearchInput');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    outlet.querySelectorAll('.mapeo-card').forEach((card) => {
      const haystack = card.textContent.toLowerCase();
      card.style.display = !q || haystack.includes(q) ? '' : 'none';
    });
  });

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
  if (e.target.closest('.mapeo-more') || e.target.closest('.mapeo-add-wrap') || e.target.closest('.mapeo-menu')) return;
  outletRef.querySelectorAll('.mapeo-menu').forEach((m) => { m.hidden = true; });
  const titleActions = document.getElementById('subpageTitleActions');
  if (titleActions) titleActions.querySelectorAll('.mapeo-menu').forEach((m) => { m.hidden = true; });
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
    <div class="modal compact-modal">
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

// Pide el nombre del mapeo antes de crearlo — si se cancela, no se
// crea nada (evita mapeos vacíos sin título elegido).
function openCreateModal(onNew) {
  openModal({
    headTitle: 'Nuevo mapeo',
    bodyHTML: `
      <div class="field">
        <label>Nombre del mapeo</label>
        <input type="text" id="createTitleInput" placeholder="Ingresá un nombre" autocomplete="off" />
      </div>
    `,
    footHTML: `
      <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
      <button type="submit" class="btn btn-primary">Crear</button>
    `,
    onMount: (overlay) => {
      overlay.querySelector('#createTitleInput').focus();
    },
    onSubmit: async (overlay, form, close) => {
      const value = overlay.querySelector('#createTitleInput').value.trim();
      close();
      onNew(value);
    },
  });
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
      if (value) await store.rename(id, value, actor());
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
