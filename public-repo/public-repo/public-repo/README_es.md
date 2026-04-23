<p align="center">
  <img src="assets/logo-horizontal.png" alt="Spec-To-Ship (s2s)" width="460" />
</p>

<p align="center">
  <a href="https://github.com/KiniunCorp/spec-to-ship/actions/workflows/ci.yml"><img src="https://github.com/KiniunCorp/spec-to-ship/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/spec-to-ship"><img src="https://img.shields.io/npm/v/spec-to-ship.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://github.com/KiniunCorp/spec-to-ship/stargazers"><img src="https://img.shields.io/github/stars/KiniunCorp/spec-to-ship?style=flat-square" alt="GitHub stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT" /></a>
</p>

<p align="center">
  <a href="#por-qué-s2s">Por qué s2s</a> · <a href="#cómo-funciona">Cómo funciona</a> · <a href="#instalación">Instalación</a> · <a href="#inicio-rápido">Inicio rápido</a> · <a href="#etapas">Etapas</a> · <a href="#referencia-de-comandos">Comandos</a> · <a href="#documentación">Docs</a>
</p>

# Spec-To-Ship (`s2s`)

<!-- GIF inicio rápido   — generá con: vhs docs/demo.tape        (requiere charmbracelet/vhs) -->
<!-- GIF integración Claude — generá con: vhs docs/demo-claude.tape (requiere ANTHROPIC_API_KEY) -->
<!-- GIF integración Codex  — generá con: vhs docs/demo-codex.tape  (requiere OPENAI_API_KEY)    -->

`s2s` le da a tus sesiones de chat con IA un flujo de trabajo de ingeniería estructurado. Cada solicitud se clasifica, se enruta por las etapas correctas, se registra de extremo a extremo y se pone a tu aprobación — mientras tu cliente de chat AI realiza el trabajo real.

Compatible con **Claude Code, Codex, OpenCode** y cualquier herramienta de chat AI que lea gobernanza basada en archivos. Sin lock-in.

## Por qué s2s

Las herramientas de chat con IA son poderosas — pero una sesión de chat sin estructura no tiene memoria, ni proceso, ni guardarraíles. Sin estructura:

- El trabajo que necesita diseño se codifica antes de entenderse
- Los bug fixes se saltan la spec e introducen nuevos bugs
- Cada sesión empieza desde cero — sin estado, sin trazabilidad
- El código corre sin que ningún humano haya visto el plan

`s2s` envuelve tu cliente de chat existente con una capa de proceso liviana. Las etapas correctas corren en el orden correcto. Nada sobre-ingeniería. Nada omite pasos necesarios. Tú apruebas antes de que se ejecute cualquier código.

## Cómo funciona

`s2s` es chat-native. No lo ejecutas directamente — tu cliente de chat AI lo hace automáticamente.

Cuando ejecutas `s2s init` en un proyecto, instala archivos de gobernanza que tu cliente de chat lee al inicio de cada sesión. A partir de entonces, cuando le das una tarea a tu AI, llama a `s2s request` para clasificar el intent, selecciona las etapas mínimas necesarias y trabaja en cada etapa usando paquetes de tareas enfocados — todo dentro de la sesión de chat.

```
Tú:   "agregar rate limiting a la API"

AI:   s2s request "agregar rate limiting a la API"
      → intent: new_feature  ·  ruta: pm → engineering → engineering_exec

AI:   s2s stage pm
      ← tarea: escribir PRD.md para rate limiting
      [genera PRD.md en la sesión de chat]
      s2s stage pm --submit
      → calidad aprobada  ·  siguiente: engineering

AI:   s2s stage engineering
      ← tarea: escribir TechSpec.md + Backlog.md
      [genera specs en la sesión de chat]
      s2s stage engineering --submit
      → gate de aprobación creado  ·  esperando: s2s approve <id>

Tú:   s2s approve <id>
      → engineering_exec comienza en un worktree git aislado
```

El orquestador decide la ruta según lo que pediste. **Un bug fix va directo a engineering. Una nueva funcionalidad pasa por producto, diseño e ingeniería. Una pregunta de investigación solo corre la etapa de research.** Nada sobre-ingeniería, nada omite pasos necesarios.

Tú apruebas antes de que corra cualquier código. Los cambios ocurren en un worktree git aislado — tu rama principal queda intacta hasta que revisas y haces merge.

## Cuándo usar s2s

| Escenario | Sin s2s | Con s2s |
|---|---|---|
| **Nueva funcionalidad** | Chat → código → esperanza | PM → diseño → engineering → aprobación → ejecución |
| **Bug fix** | Describir el bug, obtener parche | Clasificado como bug fix, directo a spec de engineering + ejecución |
| **Spike de investigación** | Ida y vuelta abierta | Etapa de research delimitada, output estructurado en Research.md |
| **Refactor** | Riesgoso, sin plan | Spec de engineering primero, ejecución en worktree aislado |
| **Pregunta / explicación** | Respuesta puntual, se pierde en el chat | Almacenada y consultable, trazable al cambio que la originó |

## Instalación

**npm (todas las plataformas):**

```bash
npm install -g spec-to-ship
```

**Homebrew (macOS):**

```bash
brew tap kiniuncorp/s2s
brew install s2s
```

Para actualizar: `brew upgrade s2s`

**Desde código fuente:**

```bash
git clone https://github.com/KiniunCorp/spec-to-ship.git
cd spec-to-ship
npm install && npm run build && npm link
```

## Inicio rápido

```bash
cd /ruta/a/tu-proyecto
s2s init
```

Verificá que todo esté listo:

```bash
s2s doctor
```

Eso es todo el setup que necesitas. `s2s init` crea `.s2s/` e instala los archivos de gobernanza en el root de tu proyecto.

**Abre tu cliente de chat AI en el mismo directorio y dale una tarea.** El cliente lee los archivos de gobernanza automáticamente, llama a `s2s request` y trabaja las etapas en la sesión. Se te pedirá aprobación antes de que corra cualquier código.

## Clientes de chat compatibles

`s2s` es agnóstico al cliente. Funciona con cualquier herramienta AI que lea gobernanza basada en archivos al inicio de la sesión.

| Cliente | Lee automáticamente |
|---|---|
| **Claude Code** | `CLAUDE.md` + `.s2s/guardrails/CLAUDE.md` |
| **Codex** | `CODEX.md` + `.s2s/guardrails/CODEX.md` |
| **OpenCode** | `AGENTS.md` + `.s2s/guardrails/AGENTS.md` |
| **Cualquier otro cliente** | Configura tu cliente para leer `AGENTS.md` al inicio de sesión |

## Qué gestiona s2s

- **Clasificación de intent** — 9 tipos de intent; selecciona las etapas mínimas que cada solicitud realmente necesita
- **Estado persistente** — cada cambio, spec, decisión y gate almacenado entre sesiones y consultable
- **Validación de calidad** — verificación de artefactos antes de que avance cualquier etapa
- **Gates de aprobación** — revisión humana requerida antes de ejecutar código; nada corre desatendido
- **Ejecución aislada** — los cambios de código ocurren en un worktree git dedicado, nunca en tu directorio activo
- **Trail de auditoría** — registro completo de qué se pidió, cómo se enrutó, qué se construyó y quién aprobó

## Etapas

| Etapa | Salida |
|---|---|
| `pm` | `PRD.md` — requerimientos del producto |
| `research` | `Research.md` — investigación técnica |
| `design` | `PrototypeSpec.md` — interfaz y arquitectura |
| `engineering` | `TechSpec.md`, `Backlog.md` — plan de implementación |
| `engineering_exec` | cambios de código, verificación, branch y PR en git |

## Referencia de comandos

Estos comandos son llamados por tu cliente AI durante la sesión. También puedes ejecutarlos directamente.

```
s2s                              # estado del proyecto y próxima acción
s2s init [ruta]                  # inicializa o repara .s2s en un proyecto
s2s request "<prompt>"           # clasifica el intent y planea la ruta de trabajo
s2s stage <etapa>                # emite paquete de tarea para una etapa
s2s stage <etapa> --submit       # valida el artefacto y avanza el flujo
s2s approve <gateId>             # aprueba un gate pendiente
s2s reject <gateId>              # rechaza un gate pendiente
s2s status                       # estado completo: cambios, specs, gates, slices
s2s doctor                       # valida gobernanza, config y readiness del chat
s2s update                       # refresca archivos .s2s a la versión actual del CLI
s2s config edit                  # edita configuración del proyecto en modo interactivo
s2s backup / restore             # snapshot y restauración del estado .s2s
s2s help [topic]                 # ayuda por comando
```

## Documentación

- [Manual de Usuario (ES)](./docs/user-manual_es.md) / [User Manual (EN)](./docs/user-manual_en.md)
- [Flujo Chat-Native (ES)](./docs/chat-native-workflow_es.md) / [Chat-Native Workflow (EN)](./docs/chat-native-workflow_en.md)
- [Arquitectura Técnica (ES)](./docs/technical-architecture_es.md) / [Technical Architecture (EN)](./docs/technical-architecture_en.md)
- [Operación Técnica y Seguridad (ES)](./docs/technical-operations-security_es.md) / [Technical Operations (EN)](./docs/technical-operations-security_en.md)
- [Backup y Restore (ES)](./docs/backup-and-restore_es.md) / [Backup and Restore (EN)](./docs/backup-and-restore_en.md)
- [Versionado y Migraciones (ES)](./docs/versioning-and-migrations_es.md) / [Versioning (EN)](./docs/versioning-and-migrations_en.md)
- [Distribución Homebrew (ES)](./docs/homebrew-distribution_es.md) / [Homebrew Distribution (EN)](./docs/homebrew-distribution_en.md)
- [Mapa de Documentación (ES)](./docs/documentation-map_es.md) / [Documentation Map (EN)](./docs/documentation-map_en.md)

## Desarrollo

```bash
npm install
npm run check          # release gate completo (typecheck + build + 29 tests de contrato)
npm run cli -- --help  # ejecutar desde código fuente
```

Cada cambio va en su propio branch y se mergea a `main` vía PR. Ver [Versionado y Migraciones](./docs/versioning-and-migrations_es.md) para la política de versiones.

## Contribuciones

Las contribuciones son bienvenidas. Por favor abre un issue antes de enviar un PR para cambios no triviales. Ejecuta `npm run check` antes de enviar — todos los checks deben pasar. Ver [CONTRIBUTING.md](./CONTRIBUTING.md) para el flujo completo.

## Licencia

[MIT](./LICENSE)
