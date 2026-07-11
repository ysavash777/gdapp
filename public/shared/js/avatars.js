/* ============================================================
   GDapp · Avatares — imágenes JPG en /shared/avatars/.
   avatar.jpg es el predeterminado; avatar-1.jpg … avatar-5.jpg son
   las opciones elegibles (ver README en esa carpeta). Si el archivo
   todavía no existe, se muestra una inicial de respaldo en vez de
   un ícono roto.
   Uso:  import { avatar } from '/shared/js/avatars.js';
         el.innerHTML = avatar(3, user.username);
   ============================================================ */

export const AVATAR_IDS = [1, 2, 3, 4, 5];

export function avatarSrc(id) {
  return id ? `/shared/avatars/avatar-${id}.jpg` : '/shared/avatars/avatar.jpg';
}

export function avatar(id, fallback = '') {
  const initial = String(fallback || id || '?').charAt(0).toUpperCase();
  return `
    <img src="${avatarSrc(id)}" alt="" class="avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
    <span class="avatar-fallback">${initial}</span>
  `;
}
