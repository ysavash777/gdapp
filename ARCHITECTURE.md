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
                           GET /rows?source=referencia|coordenadas|variables (paginado+búsqueda+orden) lee sus filas.
                           Exige el permiso 'basesdatos', no un rol fijo.
  routes/mapeos.js         API de mapeos: listar/crear/renombrar/eliminar mapeos + agregar/editar/quitar
                           códigos escaneados, más GET /lookup-catalog (catálogo liviano de Variables para
                           el catálogo local offline del celular, ver mapear/lookup-catalog.js — tiene que
                           estar declarado antes de GET /:id). Exige el permiso 'mapear' (app) o 'mapeos' (desk) —
                           cualquiera de los dos alcanza (requirePermission acepta varias claves), porque
                           la usan tanto app/modules/mapear (escanea y crea) como desk/modules/mapeos.js
                           (solo consulta/administra lo ya escaneado — misma data, sin nada propio). El
                           actor de cada mutación lo fija esta ruta desde la sesión autenticada
                           (req.user.username), nunca lo manda el cliente. Usa store/mapeos.store.js, que a
                           su vez consulta store/variables.store.js al agregar un código: si el código
                           (un EAN-13) coincide con la columna "referencia" de esa fuente, su "descripcion"
                           queda como título del producto, "productoean" (el código corto interno, no el de
                           barras) y "codgrupoprm" (grupo/familia) se guardan aparte — los tres en columnas
                           propias de `mapeo_codes` (ver store/mapeos.store.js). Antes se buscaba en
                           Referencia, pero solo Variables tiene el grupo/familia del producto.
  routes/consultas.js      API de Consultar grupo, de solo lectura: GET /lookup?code=... busca el código en
                           Variables (mismo catálogo que Mapear) y, si tiene un grupo real (ni vacío ni "SIN
                           GRUPO" — ese valor cubre 8000+ productos y cruzarlo daría un rango sin sentido),
                           cruza contra Coordenadas por la columna "tipo_producto" (confirmado con datos
                           reales que es el mismo código de grupo/familia que "codgrupoprm" de Variables) —
                           agrupa las ubicaciones de ese grupo por PASILLO Y NIVEL usando las columnas REALES
                           de Coordenadas, nunca cortando la ubicación completa por regex: "fila_piso" es el
                           pasillo (pese al nombre confuso — no es una fila numérica, ej. "MFCA" o "B"),
                           "columna_piso" es el módulo, y "piso" es el nivel (levelOf(): "01"/"1"/"00" es
                           Picking, cada piso de estantería de ahí en más es su propio "Nivel N" — nunca un
                           "Altura" genérico que los mezcle: confirmado con datos reales que el grupo "PM"
                           reparte su mismo pasillo en 5 pisos distintos). Bug real ya corregido: el ancho de
                           columna_piso VARÍA por pasillo (2 dígitos para "B"/"PM", 3 para "MFCA" —
                           confirmado con datos reales: "089"/"091"/"024") — la primera versión asumía
                           siempre 2 dígitos y cortaba mal los módulos de 3 (mostraba "MFCA09" en vez de
                           "MFCA095"); ahora usa columna_piso directo, sin adivinar. aisleRanges() devuelve
                           solo el extremo de abajo y el de arriba (columna_piso comparada como número, no
                           como texto) DE CADA COMBINACIÓN PASILLO+NIVEL (nunca la lista completa, que puede
                           ser 1500+, ni un solo rango que mezclaría picking con cualquier nivel o dos niveles
                           entre sí), más hasta DOS ubicaciones sugeridas — una para Picking y otra para
                           Altura (la mejor entre TODOS los niveles de estantería combinados, no una por cada
                           Nivel N exacto): la del grupo con menos filas de Referencia encima en cada
                           categoría (la mejor aproximación disponible a "más vacía" con los datos que hay
                           conectados), con la posición COMPLETA (ubicacion) sin tocar. Exige el
                           permiso 'consultas'.
  routes/catalog.js       API de catálogo liviano de existencia: GET /lookup devuelve [referencia,
                           descripcion, ean] (arrays, mismo criterio que /api/mapeos/lookup-catalog) de
                           TODA Variables, sin "grupo" (ese dato solo lo necesita el autocompletado de
                           Mapear, no la validación de existencia). Lo consumen shared/js/product-catalog.js
                           desde Mapear Y Consultar grupo para decidir ANTES de escanear si vale la pena
                           abrir una ventana — no exige un permiso de módulo puntual (solo requireAuth):
                           no es dato sensible ni exclusivo de una herramienta.
  services/copernico-client.js  Cliente HTTP de bajo nivel contra la API de Copernico WMS: login/logout +
                           fetchDataset() genérico (usado por fetchReferencia/fetchCoordenadas/fetchVariables,
                           mismo timeout y misma heurística para encontrar el array de filas en la respuesta).
                           Clasifica errores de login (LICENSE_LIMIT, ALREADY_LOGGED_IN, INVALID_CREDENTIALS...)
                           por el texto del mensaje — la API no trae códigos propios.
  services/inventory-engine.js  Orquesta una corrida completa: un login, una consulta por cada fuente en
                           SOURCES (hoy referencia + coordenadas + variables) en secuencia, un solo logout — nunca un
                           login por fuente. Si una fuente falla, las demás igual se intentan. Lock en
                           memoria + en disco: nunca corren dos corridas en simultáneo y el motor nunca se
                           auto-invoca — el único disparador es refresh(), llamado por routes/database.js.
                           Si detecta que quedó una sesión colgada de una corrida anterior (proceso caído a
                           mitad de camino), la cierra con el uid del lock persistido y reintenta el login
                           una sola vez — nunca en loop.
  store/create-data-source-store.js  Fábrica: misma lógica de columnas genéricas + status (empty/ok/error)
                           + persistencia en disco + paginado, instanciada por cada fuente (inventory.store.js
                           = 'referencia'/'inventario_cajas', coordenadas.store.js = 'coordenadas'/
                           'layout_coordenadas', variables.store.js = 'variables'/'variables_logisticas').
                           Agregar una fuente nueva es una línea nueva
                           `require('./create-data-source-store')('nombre', 'tabla_supabase')` + sumarla en
                           inventory-engine.js (SOURCES) y routes/database.js (STORES) + la tabla en Supabase
                           (columnas = sanitizeKey() de cada clave real que devuelve la API de Copernico —
                           ojo con camelCase: "productoEAN" sanea a "productoean", SIN guion bajo, porque
                           sanitizeKey no separa por mayúscula/minúscula, solo por caracteres no alfanuméricos;
                           conviene verificar el nombre exacto con un fetch real antes de crear la tabla).
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
                           es el sentido inverso: lee la tabla completa, paginando con .range() de 1000 en
                           1000 (PostgREST nunca devuelve más de eso en un solo select, sin importar cuántas
                           filas tenga la tabla real) — usado por hydrateFromSupabase(), que además toma el
                           `synced_at` real de las filas como lastUpdatedAt en vez de la hora del hidratado.
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
    js/session.js          Sesión (localStorage) + llamadas reales a /api/auth. save() (login y
                           refreshUser) dispara el evento global 'gd-session-ready' — lo escuchan los
                           catálogos locales (js/product-catalog.js, mapear/lookup-catalog.js) para
                           reintentar su descarga: sin esto, la primera llamada de cada uno (al cargar el
                           módulo, típicamente ANTES de que haya sesión, con la pantalla de login todavía
                           puesta) daba 401 y se quedaba así hasta el próximo evento 'online', dejando el
                           catálogo vacío toda la sesión aunque el login fuera exitoso.
    js/auth-view.js        Pantalla de login (sin registro) reutilizada por desk y app.
    js/api.js              Cliente fetch mínimo (JSON + manejo de error) usado por los módulos.
    js/product-catalog.js  Catálogo local de existencia de producto (referencia/descripcion/ean),
                           descargado una vez (GET /api/catalog/lookup, arrays) y cacheado en localStorage
                           (`gd.productCatalog.v1`). Lo usan app/modules/mapear/editor-view.js y
                           app/modules/consultas/scanner-view.js para decidir, ANTES de abrir cualquier
                           ventana, si un código escaneado existe en Variables: existsLocal(code) — si el
                           catálogo nunca se pudo descargar en este dispositivo (hasData() === false, sin
                           red desde el primer uso), no hay forma de saber si existe o no, así que los
                           llamadores dejan pasar el escaneo en vez de bloquearlo. Se refresca solo al
                           cargar el módulo y en cada evento 'online' — mismo patrón que
                           app/modules/mapear/lookup-catalog.js (que sigue existiendo aparte, con "grupo"
                           incluido, porque a Mapear le sirve además para autocompletar esos campos).
    js/toast.js             Alerta flotante temporal genérica (showToast(msg, {variant})) — mismo patrón
                           visual que el "Presiona de nuevo para salir" de app/app.js (clase .gd-toast en
                           app/app.css); variant 'warn' para avisos de código no encontrado.

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
                           Variables, Líneas picking — solo la última todavía no tiene motor real) con
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
                               segundo plano vía sync-engine.js. create()/rename() (a nivel mapeo) siguen
                               siendo red directa sin caché: crear o renombrar un mapeo entero sí requiere
                               conexión. list() sí tiene caché de respaldo (`gd.mapear.listCache.v1`,
                               actualizada en cada list() bueno): si la red falla por falta de conexión
                               (nunca si el servidor responde con un error real — eso no debe esconderse
                               detrás de datos viejos), usa la última foto buena, pisando cada mapeo con su
                               propia caché individual si tiene algo más nuevo — sin esto, reabrir la app
                               entera sin conexión dejaba el listado vacío aunque cada mapeo individual ya
                               sobreviviera offline. remove() también limpia esa foto. Cada código carga un
                               `syncStatus` ('syncing'/'synced'/'offline', solo de UI) y un `clientId` fijo
                               para toda su vida (a diferencia de `id`, que empieza siendo temporal y el
                               motor lo reemplaza por el real apenas confirma el alta) — editor-view.js debe
                               usar clientId para ubicar un código a lo largo de una edición, nunca guardar
                               `id` en una variable de vida larga: si el remapeo ocurre mientras el sheet de
                               registro sigue abierto (con buena conexión puede pasar en menos de un
                               segundo), un updateCode contra el id viejo tira NOT_FOUND y la edición se
                               pierde en silencio. store.js expone subscribe(mapeoId, cb) para avisar a
                               editor-view.js cuando ese estado cambia en segundo plano. Misma forma de API
                               que siempre (list/get/create/rename/remove/addCode/updateCode/removeCode) —
                               list-view.js no cambió.
      sync-engine.js           Motor de sincronización: cola (outbox) persistida en localStorage
                               (`gd.mapear.outbox.v1`), un trabajo a la vez — nunca en paralelo, para no
                               saturar el servidor — y solo mientras haya algo pendiente (sin cola no queda
                               ningún timer corriendo). Retoma sola con el evento 'online' o, como red de
                               seguridad, cada 8s mientras siga sin conexión. Ediciones seguidas del mismo
                               código se combinan en un solo trabajo si todavía no se envió. Sigue vivo
                               aunque se cierre el editor (mientras dure la pestaña). Límite conocido: sin
                               coordinación entre pestañas, pensado para una sola pestaña activa por
                               dispositivo.
      lookup-catalog.js        Catálogo local liviano de Variables (código -> descripción + EAN corto +
                               grupo/familia), descargado una vez (GET /api/mapeos/lookup-catalog, servido
                               como arrays para no repetir claves en 14000+ filas) y cacheado en localStorage
                               (`gd.mapear.lookupCatalog.v2`). store.js lo consulta al agregar un código para
                               completar esos tres campos AL INSTANTE, antes de cualquier red — así se ven
                               incluso sin conexión, no solo una vez que el motor de sync confirma el alta
                               (que igual los corrige después con el dato fresco del servidor). Se refresca
                               solo al cargar el módulo y en cada evento 'online'.
      list-view.js             Listado de mapeos + menú de opciones por fila (renombrar, descargar —
                               pendiente de implementar—, eliminar con confirmación). Mientras store.list()
                               contesta, muestra 3 tarjetas "hueso" (mapeoCardSkeletonHTML, con .cq-skeleton)
                               en vez de pantalla en blanco — la lista real reemplaza eso con un fundido. Si
                               store.list() tira (sin red y sin ninguna foto guardada todavía — recién
                               instalada la app, nunca hubo conexión) muestra un estado de error con botón
                               "Reintentar" en vez de romper la pantalla.
      editor-view.js            Cámara (vía scanner/camera.js) + edición de un mapeo, nuevo o existente:
                               cada código tiene cantidad, condición (rotura/unidades/vencido/otro) y
                               descripción editables, con ingreso manual como respaldo. registerCode()
                               valida primero contra /shared/js/product-catalog.js (existsLocal) si el
                               código existe en Variables — si no, solo una alerta flotante (showToast,
                               shared/js/toast.js): nunca agrega el código ni abre su ventana de registro
                               para algo que ya se sabe que no está en el catálogo. Guard de reentrancia
                               (`registering`, junto con activeSheetBackdrop): mientras un registro está
                               en curso o su ventana sigue abierta, cualquier escaneo nuevo (cámara o
                               manual) se ignora — sin esto, dos lecturas casi simultáneas del mismo código
                               (la cámara puede seguir detectando unos milisegundos más mientras arranca el
                               alta, antes de que scanner.setPaused(true) surta efecto) terminaban creando
                               dos registros y abriendo dos ventanas encimadas. Al escanear un
                               código que el catálogo local todavía no pudo resolver (pendingLookup: recién
                               agregado, syncStatus 'syncing' y sin descripción todavía), Descripción/EAN/
                               Grupo muestran un placeholder tipo "hueso" en vez de declarar "sin datos"
                               antes de tiempo — se resuelven con un fundido en cuanto el motor de sync
                               confirma el alta (mismo mecanismo que ya actualiza esos campos en vivo).
      format.js                 Catálogo de condición — el formato genérico (fecha/hora, escape de
                               HTML) se reexporta desde /shared/js/format.js.
    modules/consultas/      Herramienta Consultar grupo: escáner de cámara de solo lectura, sin
                           listado ni persistencia — cada código escaneado dispara una búsqueda y
                           muestra el resultado, sin guardar nada.
      index.js               Entrada — abre el escáner directo, no hay paso intermedio.
      scanner-view.js          Cámara (vía scanner/camera.js) + ficha de resultado. lookupCode() valida
                               primero contra /shared/js/product-catalog.js (existsLocal) si el código
                               existe en Variables — si no, solo una alerta flotante (showToast,
                               shared/js/toast.js) y nunca abre la ficha, que hubiera terminado igual en
                               "Sin datos en la base" después de gastar una llamada al servidor. Si ya hay
                               una ficha abierta (activeSheetBackdrop), ignora cualquier escaneo nuevo —
                               nunca dos fichas encimadas. La descripción ES el
                               título del sheet (sin "Producto encontrado" ni un encabezado "Descripción"
                               aparte) — nunca más de 2 líneas (titleSizeClass() la achica en escalones
                               is-md/is-sm antes de llegar al -webkit-line-clamp:2 de .reg-sheet-title, que
                               es la red de seguridad final). Grilla EAN/Referencia/Grupo con la clase extra
                               `cq-info-grid` para compartir el mismo gris (var(--n-200)) que las otras dos
                               cajas del módulo — sin esa clase, .reg-info-grid se queda en el gris de
                               Mapear (var(--surface-2)), así que el cambio no afecta a ese módulo; las tres
                               cajas llevan además `width:100%` explícito para quedar simétricas. Las dos
                               cajas: "Ubicación sugerida" (sin ícono — solo texto: hasta dos filas, una
                               "Picking" y otra "Altura", cada una con su posición COMPLETA sin simplificar,
                               ej. "G450103", porque a diferencia del rango acá hay que poder pararse ahí
                               exacto — product.suggestions del server, nunca una sola aunque el grupo tenga
                               ambos tipos de ubicación) y el rango de ubicaciones — una fila por combinación
                               pasillo+nivel EXACTO (nunca solo por pasillo, ni un "Altura" genérico: dos
                               pisos de estantería distintos, ej. Nivel 2 y Nivel 3, mandan cada uno su
                               propia fila — confirmado con datos reales, ej. el grupo "PM" reparte su mismo
                               pasillo en 5 pisos, cada uno a una altura física distinta), cada fila con su
                               propio extremo de abajo -> de arriba ya simplificado a pasillo+módulo (el
                               server lo manda armado con fila_piso+columna_piso — el front ya no adivina
                               nada por regex, así que un ancho de módulo de 2 o 3 dígitos nunca se corta
                               mal), su etiqueta Picking/Nivel N y un ícono de flecha real (arrowRight) —
                               nunca la lista completa. Los chips de ubicación (.cq-location-chip) tienen
                               ancho FIJO (no mínimo, y `flex: 0 0 64px` — sin eso, flex-shrink:1 por defecto
                               deja que el contenido empuje el ancho más allá del fijo): chipSizeClass()
                               achica la fuente en escalones is-md/is-sm en vez de dejar crecer la caja, para
                               que dos chips de distinto largo ("B4" vs "MFCA095") midan exactamente lo
                               mismo. Todo ese cálculo vive server-side en
                               routes/consultas.js.
                               El sheet se abre AL TOQUE, con placeholders tipo "hueso" (.cq-skeleton, con
                               shimmer) en cada campo — el cruce contra Coordenadas/Referencia no es
                               instantáneo, y sin esto el usuario ve la cámara congelada un par de segundos y
                               aprieta "Buscar" varias veces pensando que no pasó nada. Cuando
                               /api/consultas/lookup contesta, showResult() reemplaza cada bloque con los
                               datos reales con un fundido (.cq-fade-in), nunca de golpe.
      store.js                 findProduct(code) — cliente de GET /api/consultas/lookup.
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
