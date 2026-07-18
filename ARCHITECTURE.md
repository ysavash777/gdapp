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
  middleware/auth.js       requireAuth (exige sesión), requireAdmin (+ role admin), requirePermission(...keys)
                           (+ al menos uno de esos permisos en la lista — una misma ruta puede servir a un
                           permiso de scope 'app' y a su equivalente 'web', ej. routes/mapeos.js) — las tres
                           consultan Supabase (users/sessions), así que son async; un error de red/DB se
                           traduce a 401, no a un 500 críptico.
  store/users.store.js     Repositorio de usuarios — Supabase (tabla `users`). Login, alta, edición, permisos
                           y borrado pasan por aquí. Misma forma de API desde que vivía en memoria
                           (list/findById/create/update/...), solo que ahora todas son async.
  store/sessions.store.js  Repositorio de sesiones — Supabase (tabla `sessions`, token opaco -> user_id).
                           Antes en memoria: se perdían en cada restart del servidor, forzando relogueo.
  routes/auth.js           API: login / logout / me. Sin auto-registro: las cuentas las crea un admin
                           desde Gestión de usuarios. Usa store/users.store.js + store/sessions.store.js.
  routes/users.js          API: listar (con búsqueda+paginación), crear, editar, cambiar contraseña, eliminar.
  routes/database.js       API del módulo Bases de datos: POST /refresh dispara una corrida del motor
                           (todas las fuentes configuradas), GET /status trae el estado de cada una y
                           GET /rows?source=referencia|coordenadas (paginado+búsqueda+orden) lee sus filas.
                           Exige el permiso 'basesdatos', no un rol fijo.
  routes/mapeos.js         API de mapeos: listar/crear/renombrar/eliminar mapeos + agregar/editar/quitar
                           códigos escaneados. Exige el permiso 'mapear' (app) o 'mapeos' (desk) —
                           cualquiera de los dos alcanza (requirePermission acepta varias claves), porque
                           la usan tanto app/modules/mapear (escanea y crea) como desk/modules/mapeos.js
                           (solo consulta/administra lo ya escaneado — misma data, sin nada propio). El
                           actor de cada mutación lo fija esta ruta desde la sesión autenticada
                           (req.user.username), nunca lo manda el cliente. Usa store/mapeos.store.js, que a
                           su vez consulta store/inventory.store.js al agregar un código: si el código
                           coincide con la columna "referencia" de esa fuente, su "descripcion" queda como
                           título del producto (ver store/mapeos.store.js).
  services/copernico-client.js  Cliente HTTP de bajo nivel contra la API de Copernico WMS: login/logout +
                           fetchDataset() genérico (usado por fetchReferencia/fetchCoordenadas, mismo
                           timeout y misma heurística para encontrar el array de filas en la respuesta).
                           Clasifica errores de login (LICENSE_LIMIT, ALREADY_LOGGED_IN, INVALID_CREDENTIALS...)
                           por el texto del mensaje — la API no trae códigos propios.
  services/inventory-engine.js  Orquesta una corrida completa: un login, una consulta por cada fuente en
                           SOURCES (hoy referencia + coordenadas) en secuencia, un solo logout — nunca un
                           login por fuente. Si una fuente falla, las demás igual se intentan. Lock en
                           memoria + en disco: nunca corren dos corridas en simultáneo y el motor nunca se
                           auto-invoca — el único disparador es refresh(), llamado por routes/database.js.
                           Si detecta que quedó una sesión colgada de una corrida anterior (proceso caído a
                           mitad de camino), la cierra con el uid del lock persistido y reintenta el login
                           una sola vez — nunca en loop.
  store/create-data-source-store.js  Fábrica: misma lógica de columnas genéricas + status (empty/ok/error)
                           + persistencia en disco + paginado, instanciada por cada fuente (inventory.store.js
                           = 'referencia'/'inventario_cajas', coordenadas.store.js = 'coordenadas'/
                           'layout_coordenadas'). Agregar una fuente nueva es una línea nueva
                           `require('./create-data-source-store')('nombre', 'tabla_supabase')`.
                           hydrateFromSupabase() (llamado una sola vez al boot, ver server/index.js) trae la
                           última corrida buena desde Supabase si el caché en disco está vacío — sin esto el
                           desk se veía vacío después de cada deploy nuevo en Render (contenedor sin el
                           server/data/*.json de la corrida anterior) hasta apretar "Actualizar DB" a mano.
  services/supabase-client.js  Cliente Supabase compartido (proyecto "bodega-47-inventario", service_role
                           key). getClient() devuelve null si no está configurada (lo usan inventory/
                           coordenadas, que tienen caché local de respaldo); requireClient() lanza en ese
                           caso (lo usan users/sessions/mapeos, que no tienen ningún respaldo local — sin
                           Supabase configurada, login y Mapear no funcionan).
  services/supabase-sync.js  Espejo en Supabase de cada fuente de Copernico que trae datos con éxito —
                           reemplaza toda la tabla real (borra + inserta, sin upsert: Copernico no da
                           ninguna clave estable entre corridas) y deja un registro en sync_log. Best-effort:
                           si falla, se loguea pero no cambia el status local de esa fuente. loadTable()
                           es el sentido inverso: lee la tabla completa, usado por hydrateFromSupabase().
  store/mapeos.store.js    Repositorio de mapeos — Supabase (tablas `mapeos` + `mapeo_codes`). Antes vivía
                           entero en la memoria del NAVEGADOR (se perdía todo al recargar la página); ahora
                           es la única fuente real, con codes embebidos vía `select('*, mapeo_codes(*)')`.
  .env                     COPERNICO_EMAIL / COPERNICO_PASSWORD / COPERNICO_BODEGA del usuario consultor +
                           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — gitignored, nunca se envían al
                           navegador. config.js los carga a mano al arrancar.

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
    modules/mapeos.js      Mapeos: consulta y administración (buscar, ver detalle con sus códigos,
                           renombrar, borrar un código suelto o el mapeo entero) de los mismos mapeos que
                           se escanean desde app/modules/mapear — mismo /api/mapeos, sin store propio.
                           Escanear sigue siendo exclusivo de /app (requiere cámara).
    modules/basesdatos.js  Bases de datos: un solo botón "Actualizar DB" (dispara /api/database/refresh
                           para todas las fuentes) y una tarjeta por fuente (Referencia, Coordenadas,
                           Variables, Líneas picking — solo las dos primeras tienen motor real hoy) con
                           filas + horario en números y un ícono de estado (actualizado/error/sin datos,
                           sin texto). Nunca muestra las filas en sí — ese detalle vive en el servidor,
                           listo para consultarse desde otro módulo (/api/database/rows?source=...) sin
                           que el navegador tenga que cargarlo.

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
    scanner/                Cámara + lectura de códigos, compartido por cualquier herramienta que
                           escanee (hoy Mapear y Consultar grupo) — para no duplicar el manejo de
                           stream/torch/loop de detección en cada una.
      camera.js               createCameraScanner(): stream de cámara, torch, pausar/reanudar vista,
                               loop de detección con debounce por "mismo código" — expone
                               start/destroy/pauseView/resumeView/setPaused/setTorch. Quien lo usa solo
                               recibe códigos ya leídos por onCode(rawValue).
      engines/                Dos motores de lectura intercambiables, cada uno en su archivo:
        index.js                  pickEngine() elige uno según la plataforma y lo cachea.
        android-engine.js         BarcodeDetector nativo (Chrome/Edge/Android) — sin dependencias.
        ios-engine.js             ZXing por software para iOS Safari (no tiene BarcodeDetector),
                                 importado en forma dinámica para que Android no lo descargue nunca.
                                 Usa /shared/js/vendor/zxing.bundle.js — bundle propio generado con
                                 `npm run build:zxing` (ver build/zxing-entry.js), comiteado como
                                 cualquier otro estático porque el resto de la app no tiene build step.
    modules/mapear/         Herramienta Mapear, dividida por pantalla. Un mapeo no tiene estado
                           "finalizado": título y contenido se pueden reeditar siempre.
      index.js               Entrada (title, description, render) — solo orquesta list-view/editor-view.
      store.js                Cliente de /api/mapeos (server/routes/mapeos.js, Supabase), offline-first
                               para los CÓDIGOS de un mapeo ya abierto: addCode/updateCode/removeCode
                               escriben primero en una caché local (localStorage, prefijo `gd.mapear.cache.`)
                               y devuelven al instante, sin esperar la red — el envío real corre después en
                               segundo plano vía sync-engine.js. list()/create()/rename()/remove() (a nivel
                               mapeo) siguen siendo red directa sin caché: solo agregar códigos a un mapeo
                               que ya existe tiene que sobrevivir sin conexión. Cada código carga un
                               `syncStatus` ('syncing'/'synced'/'offline', solo de UI) y store.js expone
                               subscribe(mapeoId, cb) para avisar a editor-view.js cuando ese estado cambia
                               en segundo plano. Misma forma de API que siempre (list/get/create/rename/
                               remove/addCode/updateCode/removeCode) — list-view.js no cambió.
      sync-engine.js           Motor de sincronización: cola (outbox) persistida en localStorage
                               (`gd.mapear.outbox.v1`), un trabajo a la vez — nunca en paralelo, para no
                               saturar el servidor — y solo mientras haya algo pendiente (sin cola no queda
                               ningún timer corriendo). Retoma sola con el evento 'online' o, como red de
                               seguridad, cada 8s mientras siga sin conexión. Ediciones seguidas del mismo
                               código se combinan en un solo trabajo si todavía no se envió. Sigue vivo
                               aunque se cierre el editor (mientras dure la pestaña). Límite conocido: sin
                               coordinación entre pestañas, pensado para una sola pestaña activa por
                               dispositivo.
      list-view.js             Listado de mapeos + menú de opciones por fila (renombrar, descargar —
                               pendiente de implementar—, eliminar con confirmación).
      editor-view.js            Cámara (vía scanner/camera.js) + edición de un mapeo, nuevo o existente:
                               cada código tiene cantidad, condición (rotura/unidades/vencido/otro) y
                               descripción editables, con ingreso manual como respaldo.
      format.js                 Catálogo de condición — el formato genérico (fecha/hora, escape de
                               HTML) se reexporta desde /shared/js/format.js.
    modules/consultas/      Herramienta Consultar grupo: escáner de cámara de solo lectura, sin
                           listado ni persistencia — cada código escaneado dispara una búsqueda y
                           muestra el resultado, sin guardar nada.
      index.js               Entrada — abre el escáner directo, no hay paso intermedio.
      scanner-view.js          Cámara (vía scanner/camera.js) + ficha de resultado (descripción,
                               grilla EAN/Referencia/Grupo, ubicaciones de guardado).
      store.js                 findProduct(code) — hoy siempre devuelve null (sin base conectada);
                               misma forma que tendrá la API real.
    modules/vencimientos.js Herramienta Vencimientos.
    modules/vacios.js      Herramienta Vacíos.
```

## Reglas

1. **Un módulo = un archivo.** Cada vista exporta `render(outlet)` y se registra en el router de su shell.
2. **El tema vive en `tokens.css`.** Ningún color/tipografía hardcodeado fuera de ahí.
3. **Iconos solo desde `icons.js`** (SVG inline, nunca emojis).
4. **`shared/` no importa nada de `desk/` ni `app/`.** La dependencia va en una sola dirección.
5. **API**: la lógica HTTP vive en `server/routes/`; la persistencia vive en `server/store/`. Todos los store/
   (users, sessions, mapeos, inventory/coordenadas, create-data-source-store) hablan con Supabase — nunca
   directo desde routes/ ni desde el frontend.
6. **Herramientas de la app son permisos, no pestañas fijas.** La lista de inicio de `/app` separa
   habilitadas (color, arriba) de las que faltan permiso (blanco y negro, sin click, abajo), ambos
   grupos ordenados alfabéticamente.
7. **"Consultas" es la única herramienta pública** (`PUBLIC_TOOLS` en `app.js`) — pensada para el equipo
   operativo, que no necesita cuenta. Sin sesión aparece igual arriba, en color; el resto se ve en BW
   como aviso de que hace falta loguearse (equipo de inventario).
8. **Usuarios de prueba** (sembrados en la tabla `users` de Supabase — sobreviven un restart):
   `admin / admin1234` (todos los permisos) · `operador / operador1234` (mapeos, mapear, vencimientos, vacíos) ·
   `consulta / consulta1234` (basesdatos, consultas).
