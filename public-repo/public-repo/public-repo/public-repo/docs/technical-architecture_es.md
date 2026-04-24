# Arquitectura Técnica Spec-To-Ship (ES)

## Vista general

Spec-To-Ship usa un modelo de orquestación en tres capas:

1. **CLI shell** (`s2s`)
   - Resolución de contexto de proyecto y gestión del registro
   - Bootstrap, migración y materialización de gobernanza del proyecto
   - Envío de solicitudes freeform vía `s2s request`
   - Normalización de runtime y configuración

2. **Flow Orchestrator** (`src/orchestrator/` + `src/orchestration/`)
   - Clasificación de intent (9 tipos de intent, puntuados por confianza)
   - Resolución de contexto (estado del ledger, entidades activas, gates pendientes)
   - Planificación de ruta de etapas: mínimo de etapas suficientes para el intent clasificado
   - Creación y avance del ciclo de vida de Change/Spec

3. **Plano de ejecución** (`src/conductor/`, `src/agents/`, `src/runtime/`)
   - Ejecución de etapas (agentes PM, Research, Design, Engineering)
   - Ejecución engineering slice-first en worktrees git aislados
   - Operaciones de delivery git/worktree (branch, push, PR, merge)

## Adapters de chat actuales

- `codex-cli` (Codex)
- `claude-cli` (Claude Code)

## Módulos principales

- `src/cli.ts` (~5200 líneas) — punto de entrada CLI: handlers de comandos, ayuda, configuración de proyecto
- `src/cli/` (14 módulos) — utilidades CLI extraídas: IO, tipos, gestión de proyecto, utils
- `src/orchestrator/` — clasificador de intent, resolvedor de contexto, planificador de flujo
- `src/orchestration/` — router de orquestación y política de aprobación
- `src/ledger/` — estado operacional: entidades Change, Spec, Slice, Run, Gate, Ledger
- `src/conductor/` — pipeline de ejecución de etapas (orquestación de agentes)
- `src/agents/` — agentes LLM de PM, Research, Design, Engineering
- `src/runtime/` — ejecución de engineering, proveedores de worktree, delivery git
- `src/governance/` — generación de plantillas de gobernanza
- `src/onboarding/` — máquina de estados de onboarding
- `src/providers/` — abstracción de proveedores LLM
- `src/artifacts/` — almacenamiento persistente de artefactos
- `src/quality/` — chequeos de artefactos y quality gates

## Modelo de gobernanza

### Workspace de control por proyecto

`<app-root>/.s2s/`

- `project.json`: metadatos del proyecto y compatibilidad de versión
- `project.local.json`: estado local (actualizaciones pendientes, timestamps de último uso)
- `config/`: configuración de runtime y modelo, política de backup, excepciones de gobernanza
- `guardrails/`: políticas de adapter y comportamiento (`AGENTS.md`, `CODEX.md`, `CLAUDE.md`)
- `artifacts/`: salidas de etapas y trazabilidad de onboarding (dentro de `.s2s/`)
- `logs/`, `backups/`: logs de migración y snapshots de seguridad operativa

### Archivos root de compatibilidad (gestionados)

- `AGENTS.md`
- `CODEX.md`
- `CLAUDE.md`

Estos archivos contienen shims gestionados que importan la gobernanza canónica desde `.s2s/guardrails/*`.

## Modelo de estado operacional

Seis tipos de entidad persistidos como archivos JSON individuales bajo `.s2s/artifacts/<projectId>/`:

```
Change (agregado raíz)
  ├── Spec (contrato versionado)
  │     └── Slice (unidad de trabajo ejecutable derivada de TechSpec + Backlog)
  │           └── Run (registro de ejecución de un intento)
  └── Gate (punto de control de aprobación)
Ledger (agregado computado, actualizado en cada mutación)
```

El Ledger es la fuente de verdad para los IDs de change/spec activos, gates pendientes, estado de slices/runs y la última decisión de orquestación. Incluye `effectiveRoute` (unión acumulada de todas las etapas del change activo, en orden de pipeline) y `effectiveApprovalRequired` (verdadero si alguna decisión pasada requirió aprobación humana).

## Modelo de pipeline chat-native

S2S opera en modo `chat-native` por defecto. En este modelo, s2s es dueño de la orquestación y el registro; el AI de chat es dueño de la generación de artefactos.

### Patrón de dos fases por etapa

Para cada etapa que produce artefactos (`pm`, `research`, `design`, `engineering`):

**Fase 1 — entrega de contexto:** `s2s stage <etapa>` genera un paquete de tarea estructurado (objetivo, contexto, especificación del artefacto, rutas de archivo e instrucción WHEN DONE). S2S escribe `.s2s/live.md` con `status: context_delivered` y la próxima acción. No se realiza ninguna llamada al LLM.

**Fase 2 — submit:** Una vez que el AI de chat genera y escribe el artefacto, ejecuta `s2s stage <etapa> --submit`. S2S lee el artefacto, ejecuta chequeos de calidad, avanza el estado del ledger, crea un gate si es requerido y actualiza `.s2s/live.md` con el resultado y la próxima acción.

### Lo que s2s maneja (cero tokens AI)

- Clasificación de intent y planificación de rutas
- Construcción del paquete de contexto
- Evaluación de calidad de artefactos
- Avance del estado del ledger y ciclo de vida de gates
- `.s2s/live.md` — el archivo "dónde estoy" para el AI de chat
- `.s2s/protocol.md` — referencia de comandos generada para la versión actual del CLI

### Lo que el AI de chat maneja (tokens AI enfocados)

- Leer el paquete de contexto y entender la tarea
- Generar el contenido del artefacto (PRD, TechSpec, etc.)
- Escribir los artefactos en las rutas especificadas
- Ejecutar `--submit` y seguir la instrucción de próxima acción

### Modo standalone

Configurar `pipelineMode: 'standalone'` en `runtime.json` hace que `s2s stage <etapa>` llame directamente a la API del LLM. Es una opción explícita para entornos CI sin sesión de chat interactiva. Ver [Modos de Acceso LLM](./llm-access-modes_es.md) para detalles de configuración.

## Contrato de etapas

1. `pm` — requerimientos de producto (`PRD.md`)
2. `research` — investigación técnica (`Research.md`)
3. `design` — interfaz y arquitectura (`PrototypeSpec.md`)
4. `engineering` — spec técnica y backlog (`TechSpec.md`, `Backlog.md`)
5. `engineering_exec` — ejecución slice-first en worktree aislado (solo modo standalone en proyectos chat-native)

El orquestador determina qué etapas son necesarias para una solicitud dada — no todas las solicitudes requieren todas las etapas.

## Flujo del orquestador

`s2s request "<prompt>"` dispara:

1. **Clasificador de intent** — puntúa el prompt contra 9 tipos de intent (nueva funcionalidad, bug fix, investigación, refinamiento, etc.)
2. **Resolvedor de contexto** — carga el estado completo del proyecto (ledger, entidades activas, gates pendientes)
3. **Planificador de flujo** — produce la ruta mínima de etapas, decisión de reutilización de change/spec, requisito de aprobación

La decisión del orquestador se persiste en el Ledger. Las rutas se acumulan entre refinamientos: si el mismo change recibe múltiples solicitudes, `effectiveRoute` es la unión de todas las etapas requeridas, en orden de pipeline.

Los agentes internos de etapa reciben el contexto de la decisión del orquestador (solicitud del usuario, intent clasificado, ruta recomendada, posición de etapa) para producir artefactos enfocados en el intent específico.

## Estado de runtime en la máquina local

`~/.s2s/`

- `projects.json` — registro global de proyectos
- `runtime/worktree-provider/{kind}/{repoSlug}/` — metadatos de sesión de worktree
- `worktrees/<project>/` — directorios de worktree gestionados
- `backups/projects/<project-hash>/<snapshot>/` — snapshots de backup del proyecto
