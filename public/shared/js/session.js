// Sesión: el servidor identifica al usuario por cookie httpOnly, localStorage solo
// cachea datos para pintar la UI al instante. refreshUser() trae permisos/rol al día.

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
  // Los catálogos locales intentan refrescarse al cargar, pero sin sesión dan 401
  // hasta el próximo 'online' — este evento les avisa que ya hay sesión para reintentar.
  window.dispatchEvent(new Event('gd-session-ready'));
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

// Trae del servidor los datos actuales del usuario y actualiza el caché local.
// Devuelve null si la sesión ya no es válida.
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

// El usuario cambia su propia contraseña; no pide la actual (la sesión ya autenticada
// es la puerta). No toca el caché local: username/rol/permisos no cambian.
export async function changePassword(newPassword) {
  const res = await fetch('/api/auth/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
  return res.json();
}

// No hace location.reload(): en una PWA instalada puede perder el modo standalone.
// El caller re-renderiza la vista en el propio documento.
export function logout() {
  localStorage.removeItem(KEY);
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
