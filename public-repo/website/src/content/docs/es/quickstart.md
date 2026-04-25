---
title: "Inicio Rápido"
description: "Inicializa un proyecto con s2s init, luego trabaja desde tu cliente de chat AI usando enrutamiento de etapas por intent y workspaces de ejecución aislados."
---

## Modelo del producto

Spec-To-Ship (`s2s`) es un orquestador SDLC de línea de comandos. Lo inicializas una vez con `s2s init`, luego trabajas desde tu cliente de chat (`claude-cli` o `codex-cli`). S2S clasifica tu intent, planea la ruta mínima de etapas y mantiene la ejecución gobernada a través de estado operacional, aislamiento de worktrees y contratos de runtime.

## Primer uso

```bash
cd /ruta/a/app
s2s init
```

## Flujo diario

1. Iniciar/reanudar chat en un proyecto configurado:
   - `s2s`
2. O iniciar chat explícito con app y ruta:
   - `s2s claude-cli` (path actual)
   - `s2s codex-cli /ruta/a/app`
3. Revisar versión instalada cuando haga falta:
   - `s2s help`
   - `s2s version`
   - `s2s --version`
   - `s2s -v`
4. Enviar solicitud freeform al orquestador:
   - `s2s request "construir un dashboard de releases con gates de aprobación"`
   - `s2s request "arreglar el bug de timeout en el flujo de auth"`
   - El orquestador clasifica el intent, planea la ruta mínima y crea o reutiliza un Change y Spec.
5. Inspeccionar estado del flujo y entidades cuando sea necesario:
   - `s2s status`
   - `s2s show change`
   - `s2s show slices`
   - `s2s show runs`
   - `s2s config`
   - `s2s doctor`
6. Resolver gates de aprobación:
   - `s2s approve`
   - `s2s reject`
7. Crear/restaurar snapshots de seguridad cuando se necesite:
   - `s2s backup`
   - `s2s restore --latest`
   - `s2s restore --snapshot=<snapshot-id>`
8. Ejecutar etapas usando el patrón de dos fases (modo chat-native):

   **Fase 1 — obtener la tarea:**
   - `s2s stage pm`
   - `s2s stage research`
   - `s2s stage design`
   - `s2s stage engineering`

   Esto genera un paquete de tarea estructurado: objetivo, contexto, especificación del artefacto y rutas exactas de archivo. S2S actualiza `.s2s/live.md` con `status: context_delivered` y la próxima acción.

   **Fase 2 — generar y enviar:**
   - Genera los artefactos descritos en el paquete de tarea.
   - Escribe cada artefacto en la ruta especificada.
   - Ejecuta `s2s stage <etapa> --submit` para registrar la compleción y avanzar el flujo.

   Después de `--submit`, sigue la instrucción de próxima acción en la salida:
   - Calidad pasa, sin gate: continúa a la siguiente etapa.
   - Calidad falla: corrige los problemas listados y vuelve a enviar.
   - Gate de revisión creado: espera `s2s approve <gateId>` o `s2s reject <gateId>`.

   Otras opciones de etapa:
   - `s2s stage <etapa> --refine "agregar dark mode a la funcionalidad existente"` — refinar con un intent específico
   - `s2s stage <etapa> --refine` — refinar el change activo (fallback genérico)
   - `s2s stage engineering_exec` — ejecuta el pipeline de agentes en un worktree aislado (modo standalone o invocación explícita)

## Observabilidad de sesión

Al iniciar chat, `s2s` muestra un Session Banner con:
- estado de S2S
- alias y path del proyecto
- cliente seleccionado

Los toggles están en `.s2s/config/runtime.json` bajo `chatObservability`:
- `sessionBannerEnabled`
- `wrapperPrefixEnabled`
- `wrapperPrefixTemplate`

Usa `s2s config edit` para actualizar estos valores en modo interactivo. El wrapper prefix está disponible solo para sesiones lanzadas por CLI (`codex-cli` / `claude-cli`), no para sesiones desktop.

La política de discrepancias de guardrails también está en `.s2s/config/runtime.json`:
- `guardrailPolicy=strict`: una discrepancia bloquea `s2s stage` y falla `s2s doctor`.
- `guardrailPolicy=warn`: la discrepancia se reporta como warning.
- `guardrailPolicy=prompt`: init/config te pide elegir entre strict, warn o abortar.

## Flujo desktop

1. En la inicialización guiada (`s2s init`), selecciona el cliente de lanzamiento por número:
   - `codex-cli`
   - `claude-cli`
   - `codex-desktop`
   - `claude-desktop`
2. Si seleccionas cliente desktop, abre el mismo root de la app en el workspace desktop e inicia chat allí.
3. Si luego ejecutas `s2s` en terminal con modo desktop activo:
   - s2s muestra guía para desktop
   - s2s ofrece cambiar a la app CLI equivalente
   - si mantienes modo desktop, no lanza ninguna CLI
4. Cambia la preferencia en cualquier momento con:
   - `s2s config edit`

## Reglas de resolución de proyecto

Los comandos de proyecto aceptan `[project]` opcional al final:

- `s2s config mi-proyecto`
- `s2s config edit mi-proyecto`
- `s2s stage engineering mi-proyecto`
- `s2s status mi-proyecto`

Comportamiento:

1. Si existe `.s2s` en el path actual o ancestros, se usa contexto local.
2. Si no hay contexto local, `[project]` es obligatorio.
3. Si se pasa `[project]`, el explícito tiene prioridad.

Listar proyectos:

```bash
s2s list
```

## Orientación de sesión con live.md y protocol.md

`.s2s/live.md` es escrito por s2s después de cada comando significativo. Siempre contiene:
- El proyecto y feature activos
- La etapa y estado actuales
- La próxima acción que el AI debe tomar

Al inicio de una sesión, lee `.s2s/live.md` para orientarte sin volver a ejecutar comandos. Si la salida de s2s ya no es visible en pantalla, leer `live.md` es más eficiente que volver a ejecutar `s2s status`.

`.s2s/protocol.md` es generado por `s2s init` y `s2s update`. Contiene la referencia completa de comandos para la versión actual de la CLI — propósito, argumentos, flags y ejemplos de cada comando activo. Si no estás seguro de la sintaxis de un comando, lee `protocol.md` antes de intentar adivinarlo.

## Estructura gestionada por s2s

```text
<app-root>/.s2s/
  project.json
  project.local.json
  config/
    runtime.json
    backup.policy.json
    governance.exceptions.json
  guardrails/
  artifacts/
    <projectId>/
      changes/
      specs/
      slices/
      runs/
      gates/
      ledger.json
  logs/
    orchestrator.log
  backups/
```

Archivos shim de compatibilidad en el root del proyecto:

- `AGENTS.md`
- `CODEX.md`
- `CLAUDE.md`

Ubicación de estado global:

```text
~/.s2s/
  projects.json
  runtime/worktree-provider/
  worktrees/<project>/
  backups/projects/<project-hash>/<snapshot-id>/
```

## Resolución de problemas

1. `No local .s2s context found`
   - Ocurre en comandos de proyecto cuando no hay contexto local.
   - Ejecuta dentro de un proyecto configurado o pasa `[project]`.

2. `Command not found in PATH: codex` / `claude`
   - Instala y autentica ese CLI de chat primero.

3. Bloqueo por compatibilidad de versión
   - Actualiza `s2s` y vuelve a ejecutar.

4. Problemas en ejecución de engineering
   - Verifica dependencias y comandos de verificación del repo destino.

5. Warning por desalineación desktop/terminal
   - Aparece cuando `lastClient` está en modo desktop y ejecutas `s2s` desde terminal.
   - Abre la app desktop sobre el mismo root del repo o usa `s2s config edit` y cambia a `codex-cli`/`claude-cli`.

6. Wrapper prefix habilitado con cadencia inconsistente
   - El wrapper header está diseñado para la primera respuesta y cambios de agente.
   - En modo terminal totalmente interactivo, s2s puede hacer fallback a passthrough por compatibilidad.
   - Mantén Session Banner habilitado para visibilidad determinística al inicio.

7. `stage '<x>' blocked by strict guardrail policy`
   - Los guardrails canónicos o los overrides fuera de los shims root contienen instrucciones en conflicto con `.s2s/guardrails/*`.
   - Ejecuta `s2s doctor` para revisar discrepancias y corregirlas.
   - Si necesitas continuar temporalmente, cambia a `warn` con `s2s config edit`.

8. Errores del orquestador o enrutamiento inesperado
   - Los errores no fatales del orquestador se registran en `.s2s/logs/orchestrator.log`.
   - Ejecuta con `--verbose` para ver advertencias del orquestador en stderr.
   - Usa `s2s request "<prompt>"` para reenviar el intent y dejar que el orquestador vuelva a planificar la ruta.
