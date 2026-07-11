/* ============================================================
   GDapp · Vista de autenticación (login / registro)
   Compartida por /desk y /app. Solo usuario + contraseña.
   Uso:  renderAuth(container, onSuccess)
   ============================================================ */

import { icon } from './icons.js';
import { avatar, AVATAR_IDS } from './avatars.js';
import { login, register } from './session.js';

const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  USERNAME_TAKEN: 'Ese nombre de usuario ya existe.',
  MISSING_FIELDS: 'Completa usuario y contraseña.',
};

export function renderAuth(container, onSuccess) {
  let mode = 'login'; // 'login' | 'register'
  let selectedAvatar = 1;
  let error = null;

  function draw() {
    const isLogin = mode === 'login';
    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand">
            <div class="auth-logo">${icon('layers', 26)}</div>
            <h1>GDapp</h1>
            <p class="small muted">${isLogin ? 'Inicia sesión para continuar' : 'Crea tu cuenta'}</p>
          </div>

          ${error ? `<p class="form-error">${error}</p>` : ''}

          ${isLogin ? '' : `
          <div class="field">
            <label>Elige tu avatar</label>
            <div class="avatar-picker" id="avatarPicker">
              ${AVATAR_IDS.map((id) => `
                <div class="avatar ${id === selectedAvatar ? 'selected' : ''}" data-id="${id}">${avatar(id)}</div>
              `).join('')}
            </div>
          </div>`}

          <form id="authForm" autocomplete="off">
            <div class="field">
              <label for="username">Usuario</label>
              <input id="username" name="username" required minlength="3" placeholder="tu.usuario" />
            </div>
            <div class="field">
              <label for="password">Contraseña</label>
              <input id="password" name="password" type="password" required minlength="4" placeholder="••••••••" />
            </div>
            <button class="btn btn-primary btn-block" type="submit">
              ${isLogin ? 'Entrar' : 'Crear cuenta'}
            </button>
          </form>

          <button class="auth-switch" id="switchMode">
            ${isLogin ? '¿No tienes cuenta? <strong>Regístrate</strong>' : '¿Ya tienes cuenta? <strong>Inicia sesión</strong>'}
          </button>
        </div>
      </div>
    `;

    container.querySelector('#switchMode').addEventListener('click', () => {
      mode = isLogin ? 'register' : 'login';
      draw();
    });

    const picker = container.querySelector('#avatarPicker');
    if (picker) {
      picker.addEventListener('click', (e) => {
        const el = e.target.closest('.avatar');
        if (!el) return;
        selectedAvatar = Number(el.dataset.id);
        picker.querySelectorAll('.avatar').forEach((a) => a.classList.remove('selected'));
        el.classList.add('selected');
      });
    }

    container.querySelector('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = container.querySelector('#username').value.trim();
      const password = container.querySelector('#password').value;
      const data = isLogin
        ? await login(username, password)
        : await register(username, password, selectedAvatar);
      if (data.ok) {
        onSuccess(data.user);
        return;
      }
      error = ERROR_MESSAGES[data.error] || 'Ocurrió un error. Intenta de nuevo.';
      draw();
    });
  }

  draw();
}
