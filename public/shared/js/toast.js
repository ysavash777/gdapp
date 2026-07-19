/* ============================================================
   Alerta flotante temporal (toast) — mismo patrón visual que el
   "Presiona de nuevo para salir" de app/app.js (clase .gd-toast en
   app/app.css), generalizado para que cualquier módulo pueda avisar
   algo puntual sin bloquear la interacción con un modal.
   ============================================================ */

export function showToast(message, { variant = 'default' } = {}) {
  const old = document.getElementById('gdToast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'gdToast';
  toast.className = `gd-toast${variant === 'warn' ? ' gd-toast--warn' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}
