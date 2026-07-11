# GDapp

Plataforma con **un solo link de acceso**: el servidor detecta el dispositivo y abre
la **WEB** (`/desk`) en escritorio o la **PWA instalable** (`/app`) en móvil.

## Ejecutar en local

```bash
npm install
npm start
# → http://localhost:3000  (redirige según dispositivo)
# Forzar vista: http://localhost:3000/?view=desk  ·  /?view=app
```

## Desplegar en Render

1. Sube el repo a GitHub.
2. En Render: **New → Blueprint** y selecciona el repo (usa `render.yaml`), o
   **New → Web Service** con build `npm install` y start `npm start`.

## Módulos

| WEB (/desk) | APP (/app) |
|---|---|
| Gestión de usuarios | Mapear |
| Mapeos | Negadas |
| Bases de datos | Vacíos |
| | Consultas |

## Estructura

Ver [ARCHITECTURE.md](ARCHITECTURE.md) — mapa completo de archivos y reglas de organización
(un módulo = un archivo; tema solo en `tokens.css`; iconos solo en `icons.js`).
