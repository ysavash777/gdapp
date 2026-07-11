/* ============================================================
   GDapp · Cliente API mínimo compartido.
   Centraliza fetch + parseo JSON + manejo de error para que los
   módulos no repitan boilerplate. Uso:
     await apiFetch('/api/users', { method: 'POST', body: {...} })
   ============================================================ */

export async function apiFetch(path, options = {}) {
  const { body, headers, ...rest } = options;
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP_${res.status}`);
  }
  return data;
}
