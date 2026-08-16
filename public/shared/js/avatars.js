/* ============================================================
   GDapp · Avatar — solo la inicial del usuario (pedido explícito: se
   eliminaron las imágenes de avatar, nunca más un <img>).
   Uso:  import { avatar } from '/shared/js/avatars.js';
         el.innerHTML = avatar(user.username);
   ============================================================ */

export function avatar(fallback = '') {
  const initial = String(fallback || '?').charAt(0).toUpperCase();
  return `<span class="avatar-fallback">${initial}</span>`;
}
