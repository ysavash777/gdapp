# GDapp — Arquitectura

Un solo link de acceso. El servidor detecta el dispositivo en `/` y redirige:
móvil → `/app` (PWA instalable) · escritorio → `/desk` (web).

## Mapa de archivos (dónde tocar cada cosa)

```
server/
  index.js                 Bootstrap Express: monta middleware, rutas y estáticos. No contiene lógica.
  config.js                Puerto y constantes de entorno.
  middleware/device.js     Detección de dispositivo por User-Agent (redirect / → /desk | /app).
  routes/auth.js           API stub: login / registro / logout (usuario + contraseña).
  routes/users.js          API stub: CRUD de usuarios y permisos.

public/
  shared/                  Todo lo compartido entre desk y app.
    styles/tokens.css      Design tokens: colores, tipografía, radios, sombras. ÚNICO lugar para cambiar el tema.
    styles/base.css        Reset, tipografía base, utilidades.
    styles/components.css  Botones, inputs, cards, badges, tablas, modales.
    js/icons.js            Set de iconos SVG (estilo Lucide). Añadir iconos SOLO aquí.
    js/avatars.js          5 avatares claymorphism en SVG.
    js/session.js          Sesión stub (localStorage): login, logout, usuario actual.
    js/auth-view.js        Pantalla de login/registro reutilizada por desk y app.

  desk/                    WEB de escritorio.
    index.html             Shell HTML (sidebar + outlet).
    desk.css               Layout propio del desk (sidebar, topbar).
    desk.js                Router hash + montaje de módulos.
    modules/usuarios.js    Gestión de usuarios (modificar, contraseña, eliminar, permisos).
    modules/mapeos.js      Mapeos.
    modules/basesdatos.js  Bases de datos.

  app/                     PWA móvil.
    index.html             Shell HTML (header + outlet + tab bar).
    app.css                Layout propio de la app (tab bar, safe areas iOS).
    app.js                 Router hash + montaje de módulos.
    manifest.webmanifest   Manifiesto PWA (start_url /app).
    sw.js                  Service worker (cache básico app-shell).
    icons/icon.svg         Icono de la app.
    modules/mapear.js      Mapear.
    modules/negadas.js     Negadas.
    modules/vacios.js      Vacíos.
    modules/consultas.js   Consultas.
```

## Reglas

1. **Un módulo = un archivo.** Cada vista exporta `render(outlet)` y se registra en el router de su shell.
2. **El tema vive en `tokens.css`.** Ningún color/tipografía hardcodeado fuera de ahí.
3. **Iconos solo desde `icons.js`** (SVG inline, nunca emojis).
4. **`shared/` no importa nada de `desk/` ni `app/`.** La dependencia va en una sola dirección.
5. **API**: los stubs viven en `server/routes/`. Cuando haya backend real, solo se tocan esos archivos.
