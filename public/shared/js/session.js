/* ============================================================
   GDapp · Sesión (STUB con localStorage)
   Cuando exista backend real, aquí se cambia por llamadas a /api/auth.
   ============================================================ */

const KEY = 'gdapp.session';

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (data.ok) localStorage.setItem(KEY, JSON.stringify(data.user));
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
    localStorage.setItem(KEY, JSON.stringify(data.user));
  }
  return data;
}

export function logout() {
  localStorage.removeItem(KEY);
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}
