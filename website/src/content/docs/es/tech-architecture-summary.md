---
title: "Resumen de Arquitectura"
description: "Referencia detallada de las capas arquitectónicas de s2s, modelo de dominio, runtime de ejecución, modelo de almacenamiento, comportamiento del CLI y sus compromisos conocidos."
---

## Resumen de arquitectura en un párrafo

s2s es un orquestador CLI en TypeScript que gobierna cómo los clientes de chat AI interactúan con un proyecto de software. Instala un workspace de control (`.s2s/`) en el repositorio destino que contiene archivos de gobernanza, configuración y estado operacional persistente. Cuando un desarrollador envía una solicitud — directamente vía `s2s request` o a través de un cliente de chat que lee los archivos de gobernanza instalados — el Flow Orchestrator clasifica el intent, resuelve el contexto activo del proyecto desde el Ledger y produce la ruta mínima de etapas necesaria. En modo chat-native (por defecto), cada etapa genera un paquete de contexto estructurado para que el AI de la sesión de chat produzca el artefacto; en modo standalone, las etapas se ejecutan como invocaciones independientes de agentes LLM. Para ejecución de engineering, el trabajo se descompone en Slices y se ejecuta en worktrees git aislados con allowlists de comandos, chequeos de aceptación y delivery git bajo política de seguridad de branch/PR. El Ledger es un agregado computado de todas las entidades persistentes (Change, Spec, Slice, Run, Gate) y sirve como fuente de verdad única para trabajo activo, aprobaciones pendientes y decisiones de rutas acumuladas. La CLI expone la superficie completa — intake de solicitudes, ejecución de etapas, inspección de entidades, resolución de gates, backup/restore y diagnósticos de gobernanza — mientras delega la lógica de orquestación y ejecución a subsistemas dedicados.

## Capas arquitectónicas principales

**CLI shell (`src/cli.ts` + `src/cli/`)**
El punto de entrada para toda la interacción del usuario. Parsea comandos y flags, resuelve contexto de proyecto desde el registro local (`~/.s2s/projects.json`) o el directorio `.s2s/` más cercano, y despacha a los handlers de comandos. No vive lógica de negocio aquí — llama a las capas de orquestación, ledger y runtime y formatea el output para humanos o máquinas (`--json`). Catorce módulos extraídos en `src/cli/` manejan IO, estado, tipos y utilidades.

**Flow Orchestrator (`src/orchestrator/` + `src/orchestration/`)**
Cuatro módulos: clasificador de intent, resolvedor de contexto, planificador de flujo y router de etapas. El clasificador puntúa el prompt del usuario contra nueve tipos de intent con matching de señales ponderadas. El resolvedor de contexto carga el estado completo del proyecto desde el Ledger. El planificador de flujo combina intent y contexto para producir una `FlowDecision` (qué etapas invocar, si crear un change nuevo, si se requiere aprobación). El router de etapas convierte eso en una `RouteDecision` explícita con acciones `invoke`/`skip` por etapa y rationale. `src/orchestration/router.ts` envuelve estos en la API pública (`decideOrchestration`, `initializeSpec`, `advanceStageOwnership`) y es dueño de la acumulación de rutas entre refinamientos.

**Capacidades de etapa (`src/agents/`, `src/conductor/`)**
Cuatro agentes LLM de etapa (PM, Research, Design, Engineering), cada uno con un system prompt fijo, artefactos de entrada/salida declarados y un método `run()` que llama al proveedor y parsea la respuesta. En modo chat-native, `buildStageContext()` genera el paquete de contexto estructurado en lugar de llamar al LLM. `src/conductor/pipeline.ts` es la capa de despacho — selecciona el agente correcto para una etapa dada o delega a `runEngineeringExecution` para `engineering_exec`. Los agentes son stateless; todo el contexto se inyecta en tiempo de llamada.

**Modelo de estado operacional (`src/ledger/`)**
Stores CRUD por entidad para Change, Spec, Slice, Run y Gate, cada uno respaldado por archivos JSON individuales bajo `.s2s/artifacts/<projectId>/`. El Ledger es un agregado computado derivado por `deriveLedger()` en cada mutación — no es un log sino un snapshot del estado actual significativo. Ver la sección Modelo de dominio central para detalles de entidades.

**Runtime de ejecución (`src/runtime/engineering-exec.ts`)**
Maneja el ciclo de vida completo de `engineering_exec`: selección de slice, generación de `SLICE_CONTEXT.md`, invocación del worker, recolección de evidencia y delivery git. Ver la sección Runtime y modelo de ejecución.

**Runtime de worktrees (`src/runtime/worktree-provider*.ts`)**
Una capa de abstracción que soporta dos proveedores — `worktrunk` (el binario `wt`) y `native` (comandos git worktree). Ambos implementan la misma interfaz `WorktreeProvider`; las capacidades difieren (Worktrunk soporta modo PR workspace, native no). Ver la sección Runtime y modelo de ejecución.

**Estado repo-local vs. estado de control local**
`.s2s/` en el root del proyecto almacena el estado portable del proyecto — archivos de gobernanza, config, artefactos, logs. `~/.s2s/` es el root de control local de la máquina — registro global de proyectos, directorios de worktrees, workspaces LLM y snapshots de backup. Ver la sección Modelo de estado y almacenamiento.

## Modelo de dominio central

**Change** es el agregado raíz. Representa una unidad de trabajo — una solicitud, refinamiento o fix — con un intent, definición de alcance, mapa de propiedad de etapas y un ciclo de vida de estado (`draft → active → in_review → done`). Un Change está activo a la vez por proyecto. Se enlaza a su Spec actual via `activeSpecId`.

**Spec** es el contrato versionado para un Change. Contiene goals, constraints, criterios de aceptación, contexto de diseño y resúmenes de artefactos por etapa. Cuando un refinamiento es suficientemente significativo, se crea una nueva versión de Spec (`refinedFromSpecId` enlaza la cadena). El estado sigue `draft → active → review_ready → approved → superseded`.

**Slice** es una unidad de trabajo de engineering acotada derivada de `TechSpec.md` y `Backlog.md` durante la etapa de `engineering`. Cada Slice tiene número de secuencia, prioridad, estimación de tamaño, rutas de archivo permitidas/fuera de alcance, referencias a tareas y chequeos de aceptación. Los Slices son el input a `engineering_exec` — la ejecución siempre apunta al próximo Slice listo, no al change completo.

**Run** es el registro de ejecución de un intento de un Slice. Rastrea proveedor, nombre de branch, ruta del worktree, resultado de verificación, número/URL de PR y una lista de ítems de evidencia (artefactos producidos, resultados de tests, outcomes de git). Estado: `pending → running → succeeded / failed / blocked`.

**Gate** es un checkpoint de aprobación humana. Creado después de etapas que requieren revisión (`engineering`, `engineering_exec`). Almacena tipo de gate (`spec_review` o `execution_review`), razón y decisión una vez resuelta. Los gates pendientes bloquean el avance de etapas hasta que se llama `s2s approve` o `s2s reject`.

**Ledger** es un agregado computado actualizado en cada mutación de estado. No almacena datos de entidades — almacena IDs, índices (slices por estado, runs por estado), bloqueadores y campos de decisión de orquestación (`lastIntent`, `lastDecision`, `effectiveRoute`, `effectiveApprovalRequired`). Es la fuente de verdad única para qué está activo, bloqueado o pendiente de aprobación. `effectiveRoute` es la unión de todas las rutas de etapas acumuladas para el Change activo — persiste entre refinamientos para que los gates de aprobación establecidos por decisiones anteriores nunca se pierdan silenciosamente.

**Relaciones entre entidades:**
```
Change (1)
  ├── Spec (1..n, versionado)
  │     └── Slice (0..n, derivado de TechSpec+Backlog)
  │           └── Run (0..n, uno por intento)
  └── Gate (0..n, checkpoints de aprobación)
Ledger (1 por proyecto, computado)
```

## Runtime y modelo de ejecución

**Ejecución slice-first**
`engineering_exec` no ejecuta un plan completo en una pasada. Selecciona el único Slice ejecutable siguiente (menor secuencia, estado `ready`, sin dependencias no resueltas), crea un registro Run, luego ejecuta ese Slice. Esto mantiene la ejecución acotada y recuperable — un fallo afecta el Run de un Slice, no el change completo.

**`SLICE_CONTEXT.md`**
Generado en tiempo de ejecución por `buildSliceContextDocument()` y escrito en artefactos. Es un contrato de ejecución estructurado que contiene: IDs de proyecto/change/spec/slice/run, descripción exacta de la tarea, chequeos de aceptación, rutas de archivo permitidas y fuera de alcance, constraints técnicos, resumen de diseño del Spec y reglas de reporte de bloqueadores. Este documento es lo que el agente worker de engineering recibe como instrucción principal.

**Aislamiento de worktrees**
Cada ejecución de Slice corre en un worktree git aislado bajo `~/.s2s/worktrees/<repo-slug>/<slice-id>/`. El worktree es un directorio de trabajo separado del mismo repositorio Git, en una rama dedicada (`s2s-<provider>/<change-id>`). Los cambios de código ocurren en el worktree, no en el directorio de trabajo principal. Dos proveedores:

- **Native** — usa `git worktree add/remove`, persiste metadatos de sesión en `~/.s2s/runtime/worktree-provider/native/<repo-slug>/`. Sin soporte de PR workspace.
- **Worktrunk** — usa el binario `wt` para gestión centralizada de sesiones. Soporta modo `openPullRequestWorkspace` (un workspace completo de revisión de PR separado del worktree de change). Estado rastreado en archivos de config de Worktrunk más `~/.s2s/runtime/worktree-provider/worktrunk/<repo-slug>/`.

**Seguridad de branch y PR**
Antes de hacer push, `engineering_exec` verifica en la rama actual si hay PRs cerrados o mergeados (`gh pr list --head <branch> --state all`). Si se encuentran PRs cerrados/mergeados en esa rama, crea una rama nueva y abre un PR nuevo, evitando contaminar la rama de delivery.

**Evidencia de Run**
Un Run acumula ítems de evidencia durante la ejecución: output de verificación, reporte de ejecución, lista de artefactos materializados, branch git, número y URL de PR, y un booleano `verificationPassed`. Esta evidencia se persiste en el registro del Run y está disponible para inspección vía `s2s show runs`.

## Modelo de estado y almacenamiento

**En Git (commiteado, portable)**
Nada de s2s está diseñado para ser commiteado por defecto. El directorio `.s2s/` típicamente está en gitignore. Excepción: los equipos pueden optar por commitear `.s2s/artifacts/` para trazabilidad o `.s2s/config/` para configuración compartida, pero s2s no lo impone.

**Repo-local (`.s2s/`, scoped al proyecto)**
- `project.json` — metadatos del proyecto, versión de schema, rango de compatibilidad de CLI
- `project.local.json` — estado local de la máquina (timestamps de último uso, flags de actualizaciones pendientes)
- `config/runtime.json` — política de guardrail, modo y plantilla de ejecución, rutas de worktree, toggles de observabilidad
- `config/llm.json` — proveedor LLM, modelo, modo de acceso (solo modo standalone)
- `config/execution.templates.json` — plantillas de ejecución por cliente
- `guardrails/AGENTS.md`, `CODEX.md`, `CLAUDE.md` — instrucciones canónicas de gobernanza para clientes AI
- `artifacts/<projectId>/` — todos los archivos JSON de entidades (changes, specs, slices, runs, gates, ledger) — ubicado en `.s2s/`
- `logs/orchestrator.log` — advertencias no fatales del orquestador
- `backups/` — snapshots de seguridad locales antes de migraciones

**Local de la máquina (`~/.s2s/`)**
- `projects.json` — registro global de proyectos mapeando alias → ruta de proyecto
- `runtime/worktree-provider/{native|worktrunk}/{repo-slug}/` — metadatos de sesión del proveedor
- `worktrees/<repo-slug>/<slice-id>/` — directorios de worktrees para aislamiento de ejecución
- `llm-workspaces/<project-hash>/` — contexto de workspace LLM por proyecto
- `backups/projects/<project-hash>/<snapshot-id>/` — snapshots de backup globales

**Por qué existe la separación**
El estado repo-local es configuración del proyecto y artefactos de trabajo — pertenece conceptualmente al proyecto, puede compartirse con compañeros de equipo y sigue al repositorio. El estado local de la máquina es infraestructura de runtime — los directorios de worktrees son rutas absolutas en una máquina, el registro de proyectos mapea rutas del sistema de archivos local, y los snapshots de backup pueden contener configuración específica de la máquina. Mezclar ambos haría `.s2s/` no portable entre máquinas y miembros del equipo.

## Modelo de comportamiento del CLI

**`s2s` raíz (sin argumentos)**
Llama a `handleDefaultChatCommand()`. Resuelve contexto de proyecto desde el `.s2s/` más cercano o el registro. Si se encuentra un proyecto y está sano, lanza el cliente de chat configurado. Si no hay proyecto configurado, imprime una superficie de estado/ayuda ligera con el siguiente comando sugerido.

**`s2s init [path]`**
Valida prerequisites. Corre la máquina de estados de onboarding: crea `.s2s/`, escribe `project.json`, genera `runtime.json` con prompts guiados, escribe archivos de gobernanza en `.s2s/guardrails/`, upserta shims de compatibilidad en el root, registra el proyecto en `~/.s2s/projects.json`. Idempotente — volver a ejecutar repara el estado en lugar de recrear desde cero.

**Comandos de proyecto** (`stage`, `request`, `status`, `show`, `approve`, `reject`, `config`, `doctor`, `backup`, `restore`, `update`)
Todos aceptan un argumento `[project]` final opcional. Orden de resolución: (1) flag explícito `--repo <path>`, (2) argumento explícito `[project]`, (3) `.s2s/` más cercano en directorio actual o ancestros, (4) fallo con guía.

## Fortalezas de la arquitectura

**Enrutamiento mínimo intent-aware.** El orquestador clasifica el intent antes de seleccionar etapas. Un bug fix nunca corre pm o design. Una pregunta de investigación solo corre research. Este es el valor central del producto.

**Acumulación de rutas entre refinamientos.** `effectiveRoute` es aditivo. Los gates de aprobación establecidos por decisiones anteriores sobreviven a los refinamientos.

**Límite de ejecución slice-first.** `engineering_exec` opera en un Slice a la vez. Los fallos están acotados. Las re-ejecuciones son específicas.

**Separación limpia de entidades.** Change, Spec, Slice, Run y Gate son entidades independientes con sus propios stores y máquinas de estados de ciclo de vida.

**La gobernanza es datos, no convención.** Los tres archivos de guardrail se generan desde plantillas tipadas. La detección de conflictos corre en cada llamada a `s2s stage` en modo strict.

**Prompts de agentes intent-aware.** Los agentes internos de etapa reciben la decisión completa del orquestador como contexto.

**Abstracción de worktrees.** Tanto Worktrunk como git worktrees nativos están soportados detrás de una sola interfaz.

## Compromisos conocidos y puntos de presión futuros

**Un Change activo por proyecto.** El modelo de dominio soporta múltiples changes, pero la resolución de "change activo" elige un ganador. Los equipos con múltiples funcionalidades en paralelo necesitarán una superficie de gestión multi-change más clara.

**Costo de recomputación del Ledger.** `deriveLedger()` carga todas las entidades en cada llamada. A bajo conteo de entidades es negligible. Al crecer los directorios de artefactos, se necesitará un modelo de actualización incremental.

**Sin rollback para ejecución parcial de etapa.** Si un agente LLM crashea a mitad de etapa, los artefactos que escribió están incompletos y no hay rollback integrado.

**El clasificador de intent es basado en reglas, no aprendido.** Funciona bien para casos claros pero producirá rutas inesperadas en prompts ambiguos o multi-intent.

**`src/cli.ts` sigue siendo grande.** La extracción de 14 módulos lo redujo de ~6,500 a ~5,200 líneas, pero sigue siendo el archivo más grande del codebase.

**Sin enrutamiento de solicitudes multi-proyecto.** `s2s request` está scoped a un solo proyecto.

**La etapa `iterate` existe en el sistema de tipos pero no está implementada.** `PipelineStage` incluye `'iterate'` pero no es alcanzable desde la superficie CLI.
