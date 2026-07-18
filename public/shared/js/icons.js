/* ============================================================
   GDapp · Iconos SVG (trazo 1.7, estilo premium tipo Lucide)
   Uso:  import { icon } from '/shared/js/icons.js';
         el.innerHTML = icon('users', 20);
   Añadir iconos SOLO en este archivo.
   ============================================================ */

const PATHS = {
  // Navegación / módulos
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M17.5 14.2c2.4.4 4 2.3 4 5.1"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  inbox: '<path d="M3 13.5 5.4 5h13.2L21 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-5.5Z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  pin: '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',

  // Acciones
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  edit: '<path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Z"/><path d="m14.5 7 3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  key: '<circle cx="8" cy="15.5" r="4.5"/><path d="m11.2 12.3 8.3-8.3"/><path d="m17 7 2.5 2.5"/><path d="m14 10 2 2"/>',
  shield: '<path d="M12 3 5 5.8v5.4c0 4.5 3 8 7 9.8 4-1.8 7-5.3 7-9.8V5.8L12 3Z"/><path d="m9 11.6 2.2 2.2L15.5 9.5"/>',
  logout: '<path d="M15 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20h-4"/><path d="m10 8-4 4 4 4"/><path d="M6 12h10"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.9A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.7 17.7 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4.3-1"/><path d="M10 10a3 3 0 0 0 4.1 4.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5"/>',
  filter: '<path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5Z"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  scan: '<path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9"/><path d="M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9"/><path d="M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15"/><path d="M4 12h16"/>',
  package: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5"/><path d="M12 12v9"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 3.2 1 5.1 2 6.5H4c1-1.4 2-3.3 2-6.5Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>',
  camera: '<path d="M14.5 4h-5L7.2 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.2L14.5 4Z"/><circle cx="12" cy="13" r="3.5"/>',
  zap: '<path d="M11 2 3 14h7l-1 8 9-12h-7l1-8Z"/>',
  moreVertical: '<circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 3v3"/><path d="M16 3v3"/>',
  calendarAlert: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 3v3"/><path d="M16 3v3"/><path d="M12 13v3"/><circle cx="12" cy="18.3" r="0.4" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20.5 11A8.5 8.5 0 0 0 5.6 6.3L3 8.8"/><path d="M3 4v4.8h4.8"/><path d="M3.5 13A8.5 8.5 0 0 0 18.4 17.7L21 15.2"/><path d="M21 20v-4.8h-4.8"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  alertTriangle: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
};

export function icon(name, size = 20, strokeWidth = 1.7) {
  const p = PATHS[name];
  if (!p) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

export const iconNames = Object.keys(PATHS);
