# GDapp

Plataforma interna de gestión de inventario con **un solo link de acceso**: el
servidor detecta el dispositivo y sirve la interfaz correspondiente — la
**WEB** (`/desk`) en escritorio o la **PWA instalable** (`/app`) en móvil —
sin apps separadas que mantener ni URLs distintas que comunicar.

Node.js/Express en el backend, Supabase como base de datos y autenticación,
frontend vanilla (sin framework ni bundler en runtime) organizado por módulos
independientes.

```bash
npm install
npm start
# http://localhost:3000 — redirige según dispositivo
# Forzar vista: ?view=desk · ?view=app
```

Despliegue en Render vía `render.yaml` (Blueprint) o como Web Service
estándar (`npm install` / `npm start`).

## Módulos

| WEB (`/desk`) | APP (`/app`) |
|---|---|
| Gestión de usuarios | Mapear |
| Mapeos | Vencimientos |
| Bases de datos | Vacíos |
| | Consultar grupo |

El acceso a cada módulo se controla por permisos asignables desde Gestión de
usuarios, no por rutas hardcodeadas.

## Estructura

Ver [ARCHITECTURE.md](ARCHITECTURE.md) — mapa completo de archivos y reglas de
organización (un módulo = un archivo; tema solo en `tokens.css`; iconos solo
en `icons.js`).
