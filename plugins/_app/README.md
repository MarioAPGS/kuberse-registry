# _app - Template de Componente UI para Kubrain

Template para crear componentes React que se integran dinamicamente en el frontend de Kubrain.

El componente se desarrolla como una app React normal (con dev server, hot-reload, etc.)
y al hacer build se exporta como un modulo ESM que kubrain carga bajo demanda.

---

## Lifecycle Completo

### 1. Crear el proyecto

```bash
# Copiar el template
cp -r plugins/_app my-app
cd my-app

# Personalizar
# - Cambiar "my-app" en package.json por el nombre real
# - Cambiar YOUR_USERNAME en kuberse-entity.yaml
# - Cambiar "my-service" por el nombre de tu servicio

# Instalar dependencias
npm install
```

### 2. Desarrollar en local

```bash
npm run dev
# Abre http://localhost:5180
```

Esto levanta un servidor React completo con:
- Hot-reload (cambias codigo, se actualiza al instante)
- Proxy a `/api/*` → `localhost:3000` (kubrain o tu backend)
- React DevTools funcionan normalmente

**Archivos de desarrollo:**
- `index.html` — HTML del dev server
- `src/main.tsx` — Monta React en el DOM
- `src/App.tsx` — Wrapper que simula las props de kubrain

**Archivo que se exporta:**
- `src/index.tsx` — El componente real (export default)

**Regla importante:** Tu componente (`src/index.tsx`) debe funcionar solo con las props
que recibe. No depende de `main.tsx` ni `App.tsx` — esos son solo para desarrollo.

### 3. Editar el componente

Edita `src/index.tsx`. Este es el componente que kubrain cargara:

```tsx
import { useState, useEffect } from 'react'

interface Props {
  apiHost: string  // Props definidas en el YAML
}

export default function MyComponent({ apiHost }: Props) {
  // Tu logica aqui...
  // Puedes usar cualquier hook de React
  // Puedes hacer fetch a apiHost (pasa por el gateway de kubrain)
  return <div>...</div>
}
```

**Requisitos del componente:**
- Debe ser el `export default`
- Puede usar hooks de React normalmente
- Puede hacer `fetch` al backend via `apiHost` (gateway de kubrain)
- NO debe importar React como dependencia bundleada (el build lo maneja)
- Puede importar librerias propias (se incluyen en el bundle)
- NO puede importar librerias que dependan de React (se duplicaria)

### 4. Probar con el proxy

Si tu backend esta corriendo (en kubrain o standalone), el proxy redirige:

```
http://localhost:5180/api/v1/my-service/health
  → http://localhost:3000/api/v1/my-service/health
    → (gateway kubrain) → http://my-service.svc:8080/health
```

Puedes cambiar el target del proxy en `vite.config.ts` si tu backend corre en otro puerto.

### 5. Build para produccion

```bash
npm run build
```

Genera: `dist/component.mjs` (~5-50KB dependiendo de tu codigo, SIN React incluido).

Puedes verificar que funciona:
```bash
ls -la dist/component.mjs
# Deberia ser un archivo relativamente pequeno (React no esta dentro)
```

### 6. Crear tag y release

```bash
git init  # si es un repo nuevo
git add .
git commit -m "feat: initial component"
git tag v1.0.0
git push origin main --tags
```

El CI (GitHub Actions o Gitea Actions) automaticamente:
1. Hace `npm ci && npm run build`
2. Crea un Release con tag `v1.0.0`
3. Sube `dist/component.mjs` como asset del release

**URL resultante del asset:**
- GitHub: `https://github.com/<owner>/<repo>/releases/download/v1.0.0/component.mjs`
- Gitea: `https://gitea.example.com/<owner>/<repo>/releases/download/v1.0.0/component.mjs`

### 7. Registrar en kubrain

Edita el `kuberse-entity.yaml` de tu servicio (el que kubrain ingesta):

```yaml
spec:
  # Backend (gateway)
  api:
    - name: my-service
      host: http://my-service.my-namespace.svc.cluster.local:8080

  # Frontend (componente UI)
  app:
    - component: https://github.com/<owner>/<repo>/releases/download/v1.0.0/component.mjs
      display: sidebar           # donde aparece el boton (sidebar | topbar)
      title: Mi Servicio         # texto del boton
      icon: https://...icon.svg  # opcional: URL de un icono
      props:                     # props que recibe el componente
        apiHost: /api/v1/my-service
```

Haz push del YAML. Kubrain lo ingesta en el proximo ciclo (o fuerza con `POST /api/v1/ingestion/sync`).

### 8. Resultado

1. En el sidebar de kubrain aparece un boton "Mi Servicio"
2. Al pulsarlo se abre un modal
3. El modal carga `component.mjs` desde la URL del release
4. Se renderiza tu componente con las props del YAML
5. Tu componente llama a `/api/v1/my-service/*` → kubrain proxea al servicio real

---

## Estructura de archivos

```
_app/
├── .github/workflows/release.yaml   ← CI para GitHub
├── .gitea/workflows/release.yaml    ← CI para Gitea
├── .gitignore
├── index.html                       ← HTML del dev server (solo desarrollo)
├── kuberse-entity.yaml              ← Ejemplo de registro en kubrain
├── package.json
├── tsconfig.json
├── vite.config.ts                   ← Config dual: dev server + lib build
├── src/
│   ├── main.tsx                     ← Entry point dev (solo desarrollo)
│   ├── App.tsx                      ← Wrapper dev con props simuladas
│   └── index.tsx                    ← COMPONENTE REAL (export default)
└── README.md                        ← Este archivo
```

---

## Campos de spec.app[]

| Campo | Obligatorio | Descripcion |
|-------|-------------|-------------|
| `component` | Si | URL del bundle `.mjs` (release asset) |
| `display` | Si | Ubicacion del boton: `sidebar` o `topbar` |
| `title` | Si | Texto que se muestra en el boton |
| `icon` | No | URL de un icono (SVG o PNG 16x16). Si no se pone, usa icono generico |
| `props` | No | Objeto key-value pasado como props al componente |

---

## Actualizar version

1. Haz cambios en `src/index.tsx`
2. `npm run build` para verificar
3. Actualiza version en `package.json`
4. `git tag v1.1.0 && git push --tags`
5. Actualiza la URL en `kuberse-entity.yaml` (cambia `v1.0.0` → `v1.1.0`)
6. Push → kubrain re-ingesta → el modal carga la nueva version

---

## Limitaciones

- El componente se renderiza dentro de un modal aislado (no tiene acceso al estado global de kubrain)
- Solo puede comunicarse con el backend via fetch (las props son el unico input)
- Si el componente falla, se muestra un error en el modal sin afectar a kubrain
- Las librerias que dependan de React (ej: react-router) no se pueden usar porque duplicarian React
- CSS debe ser inline styles o CSS-in-JS (no hay carga de archivos CSS externos)
