# SpecToShip - Configuración Manual Detallada

Esta guía documenta la ruta de setup manual (sin inicialización automática con `s2s`).

## 1) Bootstrap de workspace

Estructura recomendada según el nombre de app:

```bash
npm run workspace:bootstrap -- --app-name=superapp
```

Por defecto, el inicializador recomienda y configura:

```text
superapp-workdir/
|_ superapp
|_ superapp-worktrees
|_ spec-to-ship
```

Si el usuario acepta, crea carpetas faltantes y puede mover `spec-to-ship` a la estructura recomendada.

Rutas personalizadas:

```bash
npm run workspace:bootstrap -- \
  --app-name=superapp \
  --app-path=../app \
  --worktrees-path=../worktrees
```

Esto actualiza `config/runtime.json` para que todas las etapas usen esas rutas.

## 2) Inicialización de scaffold app

Flujo interactivo (recomendado):

```bash
npm run workspace:bootstrap
```

Este flujo ofrece dos modos:
- `recommended`: baseline probado (Next.js + TypeScript + Supabase-ready + recetas `just` del lado app)
- `custom`: stack libre, manteniendo contratos de ejecución requeridos (`just change-worktree`, `just agent-verify`, carpetas OpenSpec)

Para worktrees:
- Usa `just change-worktree <change-id> [provider]` con `provider` en `codex|claude|opencode`.

Comando directo de scaffold:

```bash
npm run app:scaffold -- --mode=recommended
```
