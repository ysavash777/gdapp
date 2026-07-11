/* ============================================================
   Módulo Desk · Gestión de usuarios
   CRUD real contra /api/users: crear, editar, permisos, contraseña,
   eliminar. Las mutaciones actualizan el estado local en vez de
   refrescar toda la lista, para minimizar peticiones.
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { avatar, AVATAR_IDS } from '/shared/js/avatars.js';
import { apiFetch } from '/shared/js/api.js';

const ERROR_MESSAGES = {
  USERNAME_TAKEN: 'Ese nombre de usuario ya existe.',
  MISSING_FIELDS: 'Completa todos los campos requeridos.',
  INVALID_PASSWORD: 'La contraseña debe tener al menos 4 caracteres.',
  NOT_FOUND: 'El usuario ya no existe.',
  FORBIDDEN: 'No tienes permiso de administrador para esta acción.',
  UNAUTHORIZED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

function errorMessage(err) {
  return ERROR_MESSAGES[err.message] || 'Ocurrió un error. Intenta de nuevo.';
}

export const title = 'Usuarios';

export function render(outlet) {
  const root = document.createElement('div');
  outlet.innerHTML = '';
  outlet.appendChild(root);
  mount(root);
}

async function mount(root) {
  const state = { users: [], catalog: [], total: 0, q: '', loading: true, listError: null };
  let searchDebounce = null;

  drawShell();
  await Promise.all([loadCatalog(), loadUsers()]);

  async function loadCatalog() {
    try {
      const data = await apiFetch('/api/users/permissions-catalog');
      state.catalog = data.catalog;
    } catch {
      state.catalog = [];
    }
  }

  async function loadUsers() {
    if (!root.isConnected) return;
    state.loading = true;
    drawTable();
    try {
      const data = await apiFetch(`/api/users?q=${encodeURIComponent(state.q)}`);
      state.users = data.items;
      state.total = data.total;
      state.listError = null;
    } catch (err) {
      state.users = [];
      state.listError = err;
    }
    state.loading = false;
    if (root.isConnected) drawTable();
  }

  function drawShell() {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Gestión de usuarios</h1>
          <p class="ph-sub muted">Usuarios, contraseñas y permisos de acceso a módulos.</p>
        </div>
        <button class="btn btn-primary" id="btnNew">${icon('plus', 18)} Nuevo usuario</button>
      </div>

      <div class="searchbar" style="margin-bottom: var(--sp-4); max-width: 340px;">
        ${icon('search', 18)}
        <input type="search" id="searchInput" placeholder="Buscar usuario…" value="${state.q}" />
      </div>

      <div class="card" style="padding:0; overflow:hidden;">
        <div id="tableWrap"></div>
      </div>
    `;

    root.querySelector('#btnNew').addEventListener('click', () => openCreateModal());

    root.querySelector('#searchInput').addEventListener('input', (e) => {
      state.q = e.target.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(loadUsers, 250);
    });
  }

  function drawTable() {
    const wrap = root.querySelector('#tableWrap');
    if (!wrap) return;

    if (state.loading) {
      wrap.innerHTML = `<div class="empty-state"><p>Cargando usuarios…</p></div>`;
      return;
    }

    if (state.listError) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${icon('shield', 26)}</div>
          <h3>No se pudo cargar</h3>
          <p>${errorMessage(state.listError)}</p>
        </div>`;
      return;
    }

    if (!state.users.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${icon('users', 26)}</div>
          <h3>Sin resultados</h3>
          <p>No hay usuarios que coincidan con la búsqueda.</p>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Permisos</th>
            <th style="width:140px; text-align:right;">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${state.users.map(rowHTML).join('')}
        </tbody>
      </table>
    `;

    state.users.forEach((u) => {
      const row = wrap.querySelector(`tr[data-id="${u.id}"]`);
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(u));
      row.querySelector('[data-action="password"]').addEventListener('click', () => openPasswordModal(u));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(u));
    });
  }

  function rowHTML(u) {
    const permLabels = u.permissions
      .map((key) => state.catalog.find((c) => c.key === key)?.label || key)
      .join(' · ') || '—';
    return `
      <tr data-id="${u.id}">
        <td>
          <div class="row">
            <div class="avatar" style="width:32px;height:32px;">${avatar(u.avatar, u.username)}</div>
            <strong>${u.username}</strong>
          </div>
        </td>
        <td>
          <span class="badge ${u.role === 'admin' ? 'badge-ok' : 'badge-neutral'}">
            ${u.role === 'admin' ? 'Administrador' : 'Usuario'}
          </span>
        </td>
        <td class="small muted">${permLabels}</td>
        <td style="text-align:right;">
          <button class="btn-icon" data-action="edit" title="Editar usuario y permisos">${icon('edit', 17)}</button>
          <button class="btn-icon" data-action="password" title="Cambiar contraseña">${icon('key', 17)}</button>
          <button class="btn-icon" data-action="delete" title="Eliminar" style="color:var(--danger);">${icon('trash', 17)}</button>
        </td>
      </tr>
    `;
  }

  // ---- Modales ----

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

  function avatarPickerHTML(selectedId) {
    return `
      <div class="field">
        <label>Avatar</label>
        <div class="avatar-picker" data-avatar-picker>
          ${AVATAR_IDS.map((id) => `
            <div class="avatar ${id === selectedId ? 'selected' : ''}" data-id="${id}">${avatar(id)}</div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function wireAvatarPicker(overlay, initial) {
    let selected = initial;
    const picker = overlay.querySelector('[data-avatar-picker]');
    picker.addEventListener('click', (e) => {
      const el = e.target.closest('.avatar');
      if (!el) return;
      selected = Number(el.dataset.id);
      picker.querySelectorAll('.avatar').forEach((a) => a.classList.remove('selected'));
      el.classList.add('selected');
    });
    return () => selected;
  }

  function permissionsHTML(selected) {
    if (!state.catalog.length) return '<p class="small muted">Sin módulos disponibles.</p>';
    const group = (scope, label) => {
      const items = state.catalog.filter((c) => c.scope === scope);
      if (!items.length) return '';
      return `
        <p class="small muted" style="margin-top:6px;">${label}</p>
        ${items.map((c) => `
          <label class="checkbox-row">
            <input type="checkbox" name="perm" value="${c.key}" ${selected.includes(c.key) ? 'checked' : ''} />
            ${c.label}
          </label>
        `).join('')}
      `;
    };
    return group('web', 'Web (/desk)') + group('app', 'App (/app)');
  }

  function readPermissions(form) {
    return Array.from(form.querySelectorAll('input[name="perm"]:checked')).map((el) => el.value);
  }

  function openEditModal(user) {
    let getAvatar;
    openModal({
      headTitle: `Editar ${user.username}`,
      bodyHTML: `
        <div id="modalError"></div>
        <div class="field">
          <label for="f-username">Usuario</label>
          <input id="f-username" name="username" value="${user.username}" required minlength="3" />
        </div>
        <div class="field">
          <label for="f-role">Rol</label>
          <select id="f-role" name="role">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>Usuario</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </div>
        ${avatarPickerHTML(user.avatar)}
        <div class="field">
          <label>Permisos</label>
          ${permissionsHTML(user.permissions)}
        </div>
      `,
      footHTML: `
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar cambios</button>
      `,
      onMount: (overlay) => { getAvatar = wireAvatarPicker(overlay, user.avatar); },
      onSubmit: async (overlay, form, close) => {
        const fd = new FormData(form);
        try {
          const { user: updated } = await apiFetch(`/api/users/${user.id}`, {
            method: 'PATCH',
            body: {
              username: fd.get('username').trim(),
              role: fd.get('role'),
              avatar: getAvatar(),
              permissions: readPermissions(form),
            },
          });
          Object.assign(user, updated);
          drawTable();
          close();
        } catch (err) {
          overlay.querySelector('#modalError').innerHTML = `<p class="form-error">${errorMessage(err)}</p>`;
        }
      },
    });
  }

  function openPasswordModal(user) {
    openModal({
      headTitle: `Contraseña de ${user.username}`,
      bodyHTML: `
        <div id="modalError"></div>
        <div class="field">
          <label for="f-password">Nueva contraseña</label>
          <input id="f-password" name="password" type="password" required minlength="4" placeholder="••••••••" />
        </div>
      `,
      footHTML: `
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Actualizar</button>
      `,
      onSubmit: async (overlay, form, close) => {
        const fd = new FormData(form);
        try {
          await apiFetch(`/api/users/${user.id}/password`, {
            method: 'PATCH',
            body: { password: fd.get('password') },
          });
          close();
        } catch (err) {
          overlay.querySelector('#modalError').innerHTML = `<p class="form-error">${errorMessage(err)}</p>`;
        }
      },
    });
  }

  function openCreateModal() {
    let getAvatar;
    openModal({
      headTitle: 'Nuevo usuario',
      bodyHTML: `
        <div id="modalError"></div>
        <div class="field">
          <label for="f-username">Usuario</label>
          <input id="f-username" name="username" required minlength="3" placeholder="nombre.usuario" />
        </div>
        <div class="field">
          <label for="f-password">Contraseña</label>
          <input id="f-password" name="password" type="password" required minlength="4" placeholder="••••••••" />
        </div>
        <div class="field">
          <label for="f-role">Rol</label>
          <select id="f-role" name="role">
            <option value="user" selected>Usuario</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        ${avatarPickerHTML(1)}
        <div class="field">
          <label>Permisos</label>
          ${permissionsHTML([])}
        </div>
      `,
      footHTML: `
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear usuario</button>
      `,
      onMount: (overlay) => { getAvatar = wireAvatarPicker(overlay, 1); },
      onSubmit: async (overlay, form, close) => {
        const fd = new FormData(form);
        try {
          const { user: created } = await apiFetch('/api/users', {
            method: 'POST',
            body: {
              username: fd.get('username').trim(),
              password: fd.get('password'),
              role: fd.get('role'),
              avatar: getAvatar(),
              permissions: readPermissions(form),
            },
          });
          state.users = [created, ...state.users];
          state.total += 1;
          drawTable();
          close();
        } catch (err) {
          overlay.querySelector('#modalError').innerHTML = `<p class="form-error">${errorMessage(err)}</p>`;
        }
      },
    });
  }

  function confirmDelete(user) {
    if (!confirm(`¿Eliminar al usuario "${user.username}"? Esta acción no se puede deshacer.`)) return;
    apiFetch(`/api/users/${user.id}`, { method: 'DELETE' })
      .then(() => {
        state.users = state.users.filter((u) => u.id !== user.id);
        state.total -= 1;
        drawTable();
      })
      .catch((err) => alert(errorMessage(err)));
  }
}
