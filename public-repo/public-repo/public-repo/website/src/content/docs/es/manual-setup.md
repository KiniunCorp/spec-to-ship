---
title: "Configuración Manual"
description: "Guía paso a paso para configurar un workspace de proyecto s2s y el scaffold de la app sin usar la inicialización automática de s2s."
---

Esta guía cubre la ruta de configuración manual cuando necesitas preparar el workspace fuera de `s2s init`.

## Bootstrap de workspace

Inicializa la estructura recomendada a partir del nombre de la app:

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

## Inicialización de scaffold app

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
