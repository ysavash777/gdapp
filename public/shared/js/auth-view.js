/* ============================================================
   GDapp · Vista de autenticación (solo login — sin registro).
   Compartida por /desk y /app. Ventana partida en dos: arriba una
   imagen con degradado hacia negro, abajo los campos.
   Uso:  renderAuth(container, onSuccess)
   ============================================================ */

import { icon } from './icons.js';
import { login } from './session.js';

const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  MISSING_FIELDS: 'Completa usuario y contraseña.',
};

export function renderAuth(container, onSuccess) {
  let error = null;
  let pendingUsername = '';
  let pendingPassword = '';

  function draw() {
    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-top">
            <div class="auth-image" style="background-image:url('/shared/images/login-bg.svg')"></div>
            <div class="auth-gradient"></div>
          </div>

          <div class="auth-bottom">
            <div class="auth-bottom-inner">
              ${error ? `<p class="form-error">${error}</p>` : ''}

              <form id="authForm" autocomplete="off">
                <div class="field">
                  <label for="username">Usuario</label>
                  <input id="username" name="username" required minlength="3" placeholder="Ingresa tu usuario" value="${pendingUsername}" />
                </div>
                <div class="field">
                  <label for="password">Contraseña</label>
                  <div class="password-wrap">
                    <input id="password" name="password" type="password" required minlength="4" placeholder="Ingresa tu contraseña" value="${pendingPassword}" />
                    <button type="button" class="pw-toggle" id="pwToggle" aria-label="Mostrar contraseña">${icon('eye', 18)}</button>
                  </div>
                </div>
                <button class="btn btn-primary btn-block" type="submit">Entrar</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#pwToggle').addEventListener('click', () => {
      const pwInput = container.querySelector('#password');
      const btn = container.querySelector('#pwToggle');
      const showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      btn.innerHTML = icon(showing ? 'eye' : 'eyeOff', 18);
      btn.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
    });

    container.querySelector('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameVal = container.querySelector('#username').value.trim();
      const passwordVal = container.querySelector('#password').value;
      const data = await login(usernameVal, passwordVal);
      if (data.ok) {
        onSuccess(data.user);
        return;
      }
      pendingUsername = usernameVal;
      pendingPassword = passwordVal;
      error = ERROR_MESSAGES[data.error] || 'Ocurrió un error. Intenta de nuevo.';
      draw();
    });
  }

  draw();
}
