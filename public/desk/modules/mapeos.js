/* ============================================================
   Módulo Desk · Mapeos — consulta y administración de los mapeos
   creados desde la herramienta Mapear de /app. Misma API real
   (/api/mapeos, permiso 'mapear' o 'mapeos' — cualquiera de los dos
   alcanza, ver server/middleware/auth.js) que usa el celular: lo que
   se escanea ahí aparece acá tal cual, sin nada propio de este
   módulo — Supabase es la única fuente.

   Solo lectura + administración liviana (renombrar, borrar un código
   suelto, borrar el mapeo entero) — escanear requiere cámara y sigue
   siendo exclusivo de /app.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { apiFetch } from '/shared/js/api.js';
import { formatDateTime, escapeHtml, conditionLabel } from '/app/modules/mapear/format.js';

const ERROR_MESSAGES = {
  NOT_FOUND: 'El mapeo ya no existe.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  UNAUTHORIZED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

function errorMessage(err) {
  return ERROR_MESSAGES[err.message] || 'Ocurrió un error. Intenta de nuevo.';
}

export const title = 'Mapeos';

export function render(outlet) {
  const root = document.createElement('div');
  outlet.innerHTML = '';
  outlet.appendChild(root);
  mount(root);
}

async function mount(root) {
  const state = { mapeos: [], q: '', loading: true, listError: null };

  drawShell();
  await loadMapeos();

  async function loadMapeos() {
    if (!root.isConnected) return;
    state.loading = true;
    drawTable();
    try {
      const data = await apiFetch('/api/mapeos');
      state.mapeos = data.items;
      state.listError = null;
    } catch (err) {
      state.mapeos = [];
      state.listError = err;
    }
    state.loading = false;
    if (root.isConnected) drawTable();
  }

  function drawShell() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Mapeos</h1>
          <p class="ph-sub muted">Consulta y administración de los mapeos escaneados desde la app.</p>
        </div>
      </div>

      <div class="searchbar" style="margin-bottom: var(--sp-4); max-width: 340px;">
        ${icon('search', 18)}
        <input type="search" id="searchInput" placeholder="Buscar mapeo…" />
      </div>

      <div class="card" style="padding:0; overflow:hidden;">
        <div id="tableWrap"></div>
      </div>
    `;

    root.querySelector('#searchInput').addEventListener('input', (e) => {
      state.q = e.target.value.trim().toLowerCase();
      drawTable();
    });
  }

  function visibleMapeos() {
    if (!state.q) return state.mapeos;
    return state.mapeos.filter((m) => {
      const haystack = [m.title, m.updatedBy, m.createdBy].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(state.q);
    });
  }

  function drawTable() {
    const wrap = root.querySelector('#tableWrap');
    if (!wrap) return;

    if (state.loading) {
      wrap.innerHTML = `<div class="empty-state"><p>Cargando mapeos…</p></div>`;
      return;
    }

    if (state.listError) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${icon('map', 26)}</div>
          <h3>No se pudo cargar</h3>
          <p>${errorMessage(state.listError)}</p>
        </div>`;
      return;
    }

    const items = visibleMapeos();
    if (!items.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${icon('map', 26)}</div>
          <h3>Sin mapeos todavía</h3>
          <p>${state.mapeos.length ? 'No hay mapeos que coincidan con la búsqueda.' : 'Los mapeos que se creen desde la app van a aparecer acá.'}</p>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Título</th>
            <th>Códigos</th>
            <th>Actualizado</th>
            <th>Editado por</th>
            <th style="width:100px; text-align:right;">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(rowHTML).join('')}
        </tbody>
      </table>
    `;

    items.forEach((m) => {
      const row = wrap.querySelector(`tr[data-id="${m.id}"]`);
      row.addEventListener('dblclick', () => openDetailModal(m.id));
      row.querySelector('[data-action="view"]').addEventListener('click', () => openDetailModal(m.id));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(m));
    });
  }

  function rowHTML(m) {
    return `
      <tr data-id="${m.id}">
        <td><strong>${escapeHtml(m.title)}</strong></td>
        <td>${m.codes.length}</td>
        <td class="small muted">${formatDateTime(m.updatedAt)}</td>
        <td class="small muted">${m.updatedBy ? escapeHtml(m.updatedBy) : '—'}</td>
        <td style="text-align:right;">
          <button class="btn-icon" data-action="view" title="Ver detalle">${icon('eye', 17)}</button>
          <button class="btn-icon" data-action="delete" title="Eliminar" style="color:var(--danger);">${icon('trash', 17)}</button>
        </td>
      </tr>
    `;
  }

  // ---- Detalle ----

  async function openDetailModal(id) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:720px;">
        <div class="modal-head">
          <h3 id="detailTitle">Cargando…</h3>
          <div class="row" style="gap:var(--sp-2);">
            <button class="btn-icon" id="detailRename" title="Renombrar" hidden>${icon('edit', 17)}</button>
            <button class="btn-icon" data-close title="Cerrar">${icon('x', 18)}</button>
          </div>
        </div>
        <div class="modal-body" id="detailBody">
          <div class="empty-state"><p>Cargando…</p></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);

    let mapeo;
    try {
      const data = await apiFetch(`/api/mapeos/${id}`);
      mapeo = data.mapeo;
    } catch (err) {
      overlay.querySelector('#detailBody').innerHTML = `<p class="form-error">${errorMessage(err)}</p>`;
      return;
    }

    const renameBtn = overlay.querySelector('#detailRename');
    renameBtn.hidden = false;
    renameBtn.addEventListener('click', () => openRenameModal(mapeo, (updated) => {
      Object.assign(mapeo, updated);
      drawDetail();
    }));

    drawDetail();

    function drawDetail() {
      overlay.querySelector('#detailTitle').textContent = mapeo.title;
      const body = overlay.querySelector('#detailBody');
      if (!mapeo.codes.length) {
        body.innerHTML = `
          <div class="empty-state">
            <div class="es-icon">${icon('scan', 24)}</div>
            <h3>Sin códigos todavía</h3>
            <p>Este mapeo no tiene ningún código escaneado.</p>
          </div>`;
        return;
      }
      const sorted = mapeo.codes.slice().sort((a, b) => new Date(b.touchedAt) - new Date(a.touchedAt));
      body.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Cant.</th>
              <th>Motivo</th>
              <th>Escaneado</th>
              <th style="width:40px;"></th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(codeRowHTML).join('')}
          </tbody>
        </table>
      `;
      sorted.forEach((c) => {
        body.querySelector(`[data-code-id="${c.id}"]`).addEventListener('click', () => deleteCode(c));
      });
    }

    function codeRowHTML(c) {
      const motivo = conditionLabel(c.condition) || 'Sin motivo';
      const extra = c.condition === 'rotura' && c.roturaResponsible ? ` (${c.roturaResponsible === 'rappi' ? 'Rappi' : 'IDL'})`
        : c.condition === 'vencido' ? ' (IDL)'
        : c.condition === 'unidades' && c.expiryDate ? ` · Vto ${escapeHtml(c.expiryDate)}`
        : c.condition === 'otro' && c.customReason ? ` (${escapeHtml(c.customReason)})`
        : '';
      return `
        <tr>
          <td class="small">${escapeHtml(c.code)}</td>
          <td class="small">${escapeHtml(c.description || 'Producto sin descripción')}</td>
          <td class="small">${c.quantity}</td>
          <td class="small muted">${motivo}${extra}</td>
          <td class="small muted">${formatDateTime(c.scannedAt)}</td>
          <td style="text-align:right;">
            <button class="btn-icon" data-code-id="${c.id}" title="Eliminar código" style="color:var(--danger);">${icon('trash', 15)}</button>
          </td>
        </tr>
      `;
    }

    async function deleteCode(c) {
      if (!confirm(`¿Eliminar el código "${c.code}"?`)) return;
      try {
        const data = await apiFetch(`/api/mapeos/${mapeo.id}/codes/${c.id}`, { method: 'DELETE' });
        mapeo = data.mapeo;
        drawDetail();
        const idx = state.mapeos.findIndex((x) => x.id === mapeo.id);
        if (idx >= 0) state.mapeos[idx] = mapeo;
        drawTable();
      } catch (err) {
        alert(errorMessage(err));
      }
    }
  }

  function openRenameModal(mapeo, onRenamed) {
    openModal({
      headTitle: 'Renombrar mapeo',
      bodyHTML: `
        <div id="modalError"></div>
        <div class="field">
          <label for="f-title">Título</label>
          <input id="f-title" name="title" value="${escapeHtml(mapeo.title)}" required />
        </div>
      `,
      footHTML: `
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      `,
      onMount: (overlay) => {
        const input = overlay.querySelector('#f-title');
        input.focus();
        input.select();
      },
      onSubmit: async (overlay, form, close) => {
        const fd = new FormData(form);
        try {
          const { mapeo: updated } = await apiFetch(`/api/mapeos/${mapeo.id}`, {
            method: 'PATCH',
            body: { title: fd.get('title').trim() },
          });
          const idx = state.mapeos.findIndex((m) => m.id === updated.id);
          if (idx >= 0) state.mapeos[idx] = updated;
          drawTable();
          onRenamed(updated);
          close();
        } catch (err) {
          overlay.querySelector('#modalError').innerHTML = `<p class="form-error">${errorMessage(err)}</p>`;
        }
      },
    });
  }

  function confirmDelete(m) {
    if (!confirm(`¿Eliminar el mapeo "${m.title}" y sus ${m.codes.length} código${m.codes.length === 1 ? '' : 's'}? Esta acción no se puede deshacer.`)) return;
    apiFetch(`/api/mapeos/${m.id}`, { method: 'DELETE' })
      .then(() => {
        state.mapeos = state.mapeos.filter((x) => x.id !== m.id);
        drawTable();
      })
      .catch((err) => alert(errorMessage(err)));
  }

  // ---- Modal genérico (mismo patrón que desk/modules/usuarios.js) ----
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
}
