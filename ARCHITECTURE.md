# GDapp — Arquitectura

Un solo link de acceso. El servidor detecta el dispositivo en `/` y redirige:
móvil → `/app` (PWA instalable) · escritorio → `/desk` (web).

## Mapa de archivos (dónde tocar cada cosa)

```
server/
  index.js                 Bootstrap Express: monta middleware, rutas y estáticos. No contiene lógica.
  config.js                Puerto y constantes de entorno.
  middleware/device.js     Detección de dispositivo por User-Agent (redirect / → /desk | /app).
  permissions.js           Catálogo de módulos asignables como permiso, con scope 'web' o 'app'.
                           ÚNICO lugar para añadir uno nuevo (aparece solo en el modal de Usuarios).
  store/users.store.js     Repositorio de usuarios (hoy en memoria). Login, alta, edición, permisos y borrado
                           pasan por aquí — cuando exista base de datos, solo se reemplaza el cuerpo de este
                           archivo; routes/ y el frontend no cambian.
  routes/auth.js           API: login / logout / me. Sin auto-registro: las cuentas las crea un admin
                           desde Gestión de usuarios. Usa store/users.store.js.
  routes/users.js          API: listar (con búsqueda+paginación), crear, editar, cambiar contraseña, eliminar.

public/
  shared/                  Todo lo compartido entre desk y app.
    styles/tokens.css      Design tokens: colores, tipografía, radios, sombras. ÚNICO lugar para cambiar el tema.
    styles/base.css        Reset, tipografía base, utilidades.
    styles/components.css  Botones, inputs, cards, badges, tablas, modales.
    js/icons.js            Set de iconos SVG (estilo Lucide). Añadir iconos SOLO aquí.
    js/avatars.js          Resuelve id de avatar → ruta de imagen en avatars/ (con fallback a inicial).
    avatars/               Imágenes JPG de avatar (avatar.jpg predeterminado, avatar-1..5.jpg elegibles).
                           Ver README dentro de la carpeta para los nombres exactos.
    js/session.js          Sesión (localStorage) + llamadas reales a /api/auth.
    js/auth-view.js        Pantalla de login (sin registro) reutilizada por desk y app.
    js/api.js              Cliente fetch mínimo (JSON + manejo de error) usado por los módulos.

  desk/                    WEB de escritorio.
    index.html             Shell HTML (sidebar + outlet).
    desk.css               Layout propio del desk (sidebar, topbar).
    desk.js                Router hash + montaje de módulos.
    modules/usuarios.js    Gestión de usuarios (modificar, contraseña, eliminar, permisos).
    modules/mapeos.js      Mapeos.
    modules/basesdatos.js  Bases de datos.

  app/                     PWA móvil.
    index.html             Shell HTML (header opcional + outlet).
    app.css                Layout propio de la app (lista de herramientas, safe areas iOS).
    app.js                 Sin sesión: sin cabecera; el inicio empieza directo con la lista de
                           herramientas (Consultas en color arriba, el resto en BW sin permiso
                           debajo, botón de ancho completo "Iniciar sesión" al final).
                           Con sesión: cabecera de una fila (saludo + avatar); mismo formato de
                           lista, orden alfabético, habilitadas en color arriba y sin permiso en
                           BW debajo. Entrar a una herramienta o al login (hash #/login) quita la
                           cabecera y muestra solo un enlace "Volver" sobre el contenido.
    manifest.webmanifest   Manifiesto PWA (start_url /app).
    sw.js                  Service worker (cache básico app-shell).
    icons/icon.png         Icono de la app (favicon, ícono de instalación PWA y splash al abrirla).
    modules/mapear/        Herramienta Mapear (escáner de cámara), dividida por pantalla:
      index.js               Entrada (title, description, render) — solo orquesta list-view/scanner-view.
      store.js                Datos, hoy en memoria pero con forma de API (list/get/create/addCode/finish,
                               todas async) — cuando exista server/routes/mapeos.js, solo se reescribe acá.
      list-view.js             Listado de mapeos + detalle de solo lectura de uno ya hecho.
      scanner-view.js           Escáner de cámara (BarcodeDetector) para un mapeo nuevo, con ingreso manual
                               como respaldo si el navegador no soporta lectura automática.
      format.js                 Fecha/hora e ítem de código, compartidos entre list-view y scanner-view.
    modules/negadas.js     Herramienta Negadas.
    modules/vacios.js      Herramienta Vacíos.
    modules/consultas.js   Herramienta Consultas.
```

## Reglas

1. **Un módulo = un archivo.** Cada vista exporta `render(outlet)` y se registra en el router de su shell.
2. **El tema vive en `tokens.css`.** Ningún color/tipografía hardcodeado fuera de ahí.
3. **Iconos solo desde `icons.js`** (SVG inline, nunca emojis).
4. **`shared/` no importa nada de `desk/` ni `app/`.** La dependencia va en una sola dirección.
5. **API**: la lógica HTTP vive en `server/routes/`; la persistencia vive en `server/store/`. Cuando llegue la
   base de datos real, solo se reescribe `store/users.store.js` (misma forma: list/findById/create/update/...).
6. **Herramientas de la app son permisos, no pestañas fijas.** La lista de inicio de `/app` separa
   habilitadas (color, arriba) de las que faltan permiso (blanco y negro, sin click, abajo), ambos
   grupos ordenados alfabéticamente.
7. **"Consultas" es la única herramienta pública** (`PUBLIC_TOOLS` en `app.js`) — pensada para el equipo
   operativo, que no necesita cuenta. Sin sesión aparece igual arriba, en color; el resto se ve en BW
   como aviso de que hace falta loguearse (equipo de inventario).
8. **Usuarios de prueba** (sembrados en memoria, se pierden al reiniciar el servidor):
   `admin / admin1234` (todos los permisos) · `operador / operador1234` (mapeos, mapear, negadas, vacíos) ·
   `consulta / consulta1234` (basesdatos, consultas).
