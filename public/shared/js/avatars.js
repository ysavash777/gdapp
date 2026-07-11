/* ============================================================
   GDapp · 5 avatares Claymorphism por defecto (SVG)
   Uso:  import { avatar } from '/shared/js/avatars.js';
         el.innerHTML = avatar(3);        // 1..5
   Cada avatar es una carita de "arcilla" con luz suave superior
   y sombra interna inferior (efecto clay).
   ============================================================ */

// Paletas de arcilla: [base, sombra, luz, mejilla, fondo]
const CLAY = {
  1: { base: '#e8927c', dark: '#c96a55', light: '#ffc4b0', cheek: '#d97862', bg: '#fbeae4' }, // terracota
  2: { base: '#7fb89a', dark: '#578f72', light: '#b5e0c8', cheek: '#68a384', bg: '#e7f2ec' }, // menta
  3: { base: '#8f9fd1', dark: '#6577ad', light: '#c3cdf0', cheek: '#7889bd', bg: '#eaedf8' }, // lavanda
  4: { base: '#e3b263', dark: '#bc8a3c', light: '#f7d99c', cheek: '#cf9c4d', bg: '#faf0dd' }, // ámbar
  5: { base: '#a58b76', dark: '#7d6653', light: '#d3bda9', cheek: '#8f7561', bg: '#f1eae4' }, // arcilla
};

function clayFace(n) {
  const c = CLAY[n];
  const uid = `clay${n}`;
  return `
<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="${uid}-head" cx="38%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${c.light}"/>
      <stop offset="55%" stop-color="${c.base}"/>
      <stop offset="100%" stop-color="${c.dark}"/>
    </radialGradient>
    <radialGradient id="${uid}-sheen" cx="35%" cy="22%" r="45%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="96" height="96" fill="${c.bg}"/>
  <!-- sombra de apoyo -->
  <ellipse cx="48" cy="84" rx="26" ry="6" fill="${c.dark}" opacity="0.25"/>
  <!-- cabeza clay -->
  <circle cx="48" cy="48" r="32" fill="url(#${uid}-head)"/>
  <circle cx="48" cy="48" r="32" fill="url(#${uid}-sheen)"/>
  <!-- brillo superior -->
  <ellipse cx="38" cy="30" rx="12" ry="7" fill="#ffffff" opacity="0.35" transform="rotate(-18 38 30)"/>
  <!-- ojos -->
  <circle cx="38" cy="48" r="3.4" fill="#2c2620"/>
  <circle cx="58" cy="48" r="3.4" fill="#2c2620"/>
  <circle cx="39.2" cy="46.8" r="1.1" fill="#ffffff"/>
  <circle cx="59.2" cy="46.8" r="1.1" fill="#ffffff"/>
  <!-- mejillas -->
  <ellipse cx="33" cy="56" rx="4.5" ry="2.8" fill="${c.cheek}" opacity="0.75"/>
  <ellipse cx="63" cy="56" rx="4.5" ry="2.8" fill="${c.cheek}" opacity="0.75"/>
  <!-- sonrisa -->
  <path d="M42 58 q6 5 12 0" stroke="#2c2620" stroke-width="2.4" stroke-linecap="round" fill="none"/>
</svg>`;
}

export function avatar(n = 1) {
  const id = Math.min(5, Math.max(1, Number(n) || 1));
  return clayFace(id);
}

export const AVATAR_IDS = [1, 2, 3, 4, 5];
