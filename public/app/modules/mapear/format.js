/* ============================================================
   Módulo App · Mapear — formato compartido entre list-view.js
   (detalle de un mapeo) y scanner-view.js (lista en vivo).
   ============================================================ */

import { icon } from '/shared/js/icons.js';

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function codeItemHTML(c) {
  return `
    <li class="scan-code ${c.duplicate ? 'is-duplicate' : ''}">
      <span class="sc-icon">${icon('check', 14)}</span>
      <span class="sc-code">${c.code}</span>
      ${c.duplicate ? '<span class="sc-flag">Repetido</span>' : ''}
      <span class="sc-time">${formatTime(c.scannedAt)}</span>
    </li>
  `;
}
