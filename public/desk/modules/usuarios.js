/* ============================================================
   Módulo Desk · Gestión de usuarios
   Modificar usuario, contraseña, eliminar y permisos.
   (Estructura UI — la lógica se conectará a /api/users)
   ============================================================ */

import { icon } from '/shared/js/icons.js';
import { avatar } from '/shared/js/avatars.js';

export const title = 'Usuarios';

const DEMO = [
  { id: 1, username: 'admin', role: 'admin', avatar: 1, permissions: ['usuarios', 'mapeos', 'basesdatos'] },
  { id: 2, username: 'operador', role: 'user', avatar: 3, permissions: ['mapeos'] },
  { id: 3, username: 'consulta', role: 'user', avatar: 5, permissions: ['basesdatos'] },
];

export function render(outlet) {
  outlet.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Gestión de usuarios</h1>
        <p class="ph-sub muted">Usuarios, contraseñas y permisos de acceso a módulos.</p>
      </div>
      <button class="btn btn-primary">${icon('plus', 18)} Nuevo usuario</button>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="st-value">${DEMO.length}</div><div class="st-label">Usuarios activos</div></div>
      <div class="stat"><div class="st-value">1</div><div class="st-label">Administradores</div></div>
      <div class="stat"><div class="st-value">3</div><div class="st-label">Módulos con acceso</div></div>
    </div>

    <div class="card" style="padding:0; overflow:hidden;">
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
          ${DEMO.map((u) => `
            <tr>
              <td>
                <div class="row">
                  <div class="avatar" style="width:32px;height:32px;">${avatar(u.avatar)}</div>
                  <strong>${u.username}</strong>
                </div>
              </td>
              <td>
                <span class="badge ${u.role === 'admin' ? 'badge-ok' : 'badge-neutral'}">
                  ${u.role === 'admin' ? 'Administrador' : 'Usuario'}
                </span>
              </td>
              <td class="small muted">${u.permissions.join(' · ')}</td>
              <td style="text-align:right;">
                <button class="btn-icon" title="Editar usuario y permisos">${icon('edit', 17)}</button>
                <button class="btn-icon" title="Cambiar contraseña">${icon('key', 17)}</button>
                <button class="btn-icon" title="Eliminar" style="color:var(--danger);">${icon('trash', 17)}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
