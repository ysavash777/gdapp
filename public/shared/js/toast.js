// Alerta flotante temporal (toast), para avisar algo puntual sin bloquear con un modal.

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
