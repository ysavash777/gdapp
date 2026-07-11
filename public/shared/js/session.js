/* ============================================================
   GDapp · Sesión.
   El servidor identifica al usuario por una cookie httpOnly (no
   por lo que guardamos aquí) — localStorage solo cachea sus datos
   para pintar la UI al instante. refreshUser() trae la versión
   actual (permisos/rol al día) sin necesidad de volver a loguearse.
   ============================================================ */

const KEY = 'gdapp.session';

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function save(user) {
  localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (data.ok) save(data.user);
  return data;
}

export async function register(username, password, avatarId = 1) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, avatar: avatarId }),
  });
  const data = await res.json();
  if (data.ok) {
    data.user.avatar = avatarId;
    save(data.user);
  }
  return data;
}

// Trae del servidor los datos actuales del usuario logueado (según
// la cookie de sesión) y actualiza el caché local. Devuelve null si
// la sesión ya no es válida (p. ej. el usuario fue eliminado).
export async function refreshUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? save(data.user) : null;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(KEY);
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}
