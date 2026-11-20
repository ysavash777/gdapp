// Módulo App · Mapear — listado de mapeos. Abrir uno (nuevo o existente)
// delega en editor-view.js.

import { icon } from '/shared/js/icons.js';
import * as store from './store.js';
import { formatDateTime, formatDateHeading, escapeHtml, capitalize } from './format.js';
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
          ${m.updatedBy ? `<span class="mapeo-editor">Editado por <strong>${escapeHtml(capitalize(m.updatedBy))}</strong></span>` : ''}
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

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Agrupa por día de edición; el listado ya llega ordenado (store.js), solo
// detecta el cambio de día e inserta un sub-encabezado.
function mapeoListHTML(mapeos) {
  let lastKey = null;
  const parts = [];
  for (const m of mapeos) {
    const key = dateKey(m.updatedAt);
    if (key !== lastKey) {
      parts.push(`<div class="mapeo-date-heading">${escapeHtml(formatDateHeading(m.updatedAt))}</div>`);
      lastKey = key;
    }
    parts.push(mapeoCardHTML(m));
  }
  return parts.join('');
}

// Loader mientras store.list() contesta.
function mapeoLoaderHTML() {
  return `
    <div class="gd-bars-loader">
      <span></span><span></span><span></span><span></span>
    </div>
  `;
}

export async function renderList(outlet, { onNew }) {
  outletRef = outlet;
  refreshRef = () => renderList(outlet, { onNew });

  outlet.innerHTML = `
    <div class="action-hero">
      <div class="searchbar" id="mapeoSearchBar" hidden>
        ${icon('search', 18)}
        <input type="search" id="mapeoSearchInput" placeholder="Buscar mapeo..." autocomplete="off" disabled />
        <button type="button" class="searchbar-clear" id="mapeoSearchClear" title="Limpiar búsqueda" aria-label="Limpiar búsqueda" hidden>${icon('x', 14)}</button>
      </div>
      <div id="mapeoListWrap">${mapeoLoaderHTML()}</div>
    </div>
  `;

  // store.list() ya cae al último caché si no hay red; un error acá es real
  // (nunca hubo caché, o falla de sesión/servidor).
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
    ? `<div class="mapeo-list cq-fade-in">${mapeoListHTML(mapeos)}</div>`
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

  const titleActions = document.getElementById('subpageTitleActions');
  if (titleActions) {
    titleActions.innerHTML = `
      <button type="button" class="btn-icon" id="mapeoSearchToggle" title="Buscar mapeo">${icon('search', 20)}</button>
      <div class="mapeo-add-wrap">
        <button type="button" class="btn-icon" id="mapeoAddBtn" title="Agregar mapeo">${icon('plus', 20)}</button>
        <div class="mapeo-menu" id="mapeoAddMenu" hidden>
          <button class="user-menu-item" data-action="create">${icon('scan', 16)} Crear mapeo</button>
          <button class="user-menu-item" data-action="import">${icon('download', 16)} Importar mapeo</button>
        </div>
      </div>
    `;
    const searchToggle = titleActions.querySelector('#mapeoSearchToggle');
    searchToggle.addEventListener('click', () => {
      const searchBar = outlet.querySelector('#mapeoSearchBar');
      const searchInputEl = outlet.querySelector('#mapeoSearchInput');
      const opening = searchBar.hidden;
      searchBar.hidden = !opening;
      searchToggle.classList.toggle('is-active', opening);
      if (opening) {
        searchInputEl.focus();
      } else {
        searchInputEl.value = '';
        applyFilter();
      }
    });
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

  const searchInput = outlet.querySelector('#mapeoSearchInput');
  const searchClear = outlet.querySelector('#mapeoSearchClear');

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    searchClear.hidden = !q;
    const list = outlet.querySelector('.mapeo-list');
    if (!list) return;
    // Oculta el sub-encabezado de fecha si ninguna tarjeta suya quedó visible.
    let currentHeading = null;
    let anyVisible = false;
    Array.from(list.children).forEach((el) => {
      if (el.classList.contains('mapeo-date-heading')) {
        if (currentHeading) currentHeading.style.display = anyVisible ? '' : 'none';
        currentHeading = el;
        anyVisible = false;
        return;
      }
      const visible = !q || el.textContent.toLowerCase().includes(q);
      el.style.display = visible ? '' : 'none';
      if (visible) anyVisible = true;
    });
    if (currentHeading) currentHeading.style.display = anyVisible ? '' : 'none';
  }

  searchInput.addEventListener('input', applyFilter);
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    applyFilter();
    searchInput.focus();
  });

  searchInput.addEventListener('blur', (e) => {
    if (searchInput.value.trim()) return;
    // Si el foco va al botón de lupa, ese click ya cierra por su cuenta:
    // actuar acá también pisaría su "opening" y reabriría el buscador.
    if (e.relatedTarget && e.relatedTarget.id === 'mapeoSearchToggle') return;
    const searchBar = outlet.querySelector('#mapeoSearchBar');
    const searchToggle = document.getElementById('mapeoSearchToggle');
    if (searchBar) searchBar.hidden = true;
    if (searchToggle) searchToggle.classList.remove('is-active');
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
      if (action === 'download') downloadMapeo(id);
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

// GET al mismo origen (la cookie de sesión va sola); el servidor arma el XLSX.
function downloadMapeo(id) {
  const a = document.createElement('a');
  a.href = `/api/mapeos/${id}/export`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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
