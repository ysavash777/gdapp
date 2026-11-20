// Alerta flotante temporal (toast), para avisar algo puntual sin bloquear con un modal.
//
// Uso clásico: showToast('texto', { variant: 'warn' }) — pastilla simple abajo.
// Uso "rico" (pasar `tone`): ícono + título + detalle opcional, arriba de la
// pantalla (donde nada lo tapa — abajo suele haber un botón de acción):
//   showToast('Sin stock', { tone: 'warn', detail: '7790001' })
// tone: 'success' | 'warn' | 'error'.

import { iconSolid } from './icons.js';

const TONE_ICON = { success: 'checkCircleSolid', warn: 'alertTriangleSolid', error: 'alertTriangleSolid' };

function escape(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

export function showToast(message, { variant = 'default', tone = null, detail = '' } = {}) {
  const old = document.getElementById('gdToast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'gdToast';

  if (tone && TONE_ICON[tone]) {
    toast.className = `gd-toast gd-toast--rich gd-toast--${tone}`;
    toast.setAttribute('role', tone === 'success' ? 'status' : 'alert');
    toast.innerHTML = `
      <span class="gd-toast-icon">${iconSolid(TONE_ICON[tone], 18)}</span>
      <span class="gd-toast-text">
        <span class="gd-toast-title">${escape(message)}</span>
        ${detail ? `<span class="gd-toast-detail">${escape(detail)}</span>` : ''}
      </span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
    return;
  }

  toast.className = `gd-toast${variant === 'warn' ? ' gd-toast--warn' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}
