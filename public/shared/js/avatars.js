// Avatar = solo la inicial del usuario, sin imágenes.
// Uso: el.innerHTML = avatar(user.username);

export function avatar(fallback = '') {
  const initial = String(fallback || '?').charAt(0).toUpperCase();
  return `<span class="avatar-fallback">${initial}</span>`;
}
