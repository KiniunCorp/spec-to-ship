---
title: "Introducción"
description: "s2s es una herramienta CLI que agrega estructura, gobernanza y gestión de estado al desarrollo de software asistido por AI junto a Claude Code y Codex."
---

## Descripción general

Spec-To-Ship (`s2s`) es una herramienta de línea de comandos que agrega estructura, gobernanza y gestión de estado al desarrollo de software asistido por AI. Funciona junto a Claude Code y Codex, guiando esas herramientas a través de un flujo de trabajo disciplinado — desde entender qué se solicitó, hasta planificar la cantidad correcta de proceso, hasta ejecutar cambios de código en un workspace aislado. El desarrollador mantiene el control en cada paso. S2S maneja el scaffolding y mantiene un registro de todo.

---

## Para quién es

**Founders técnicos y desarrolladores solos** que usan herramientas de AI coding diariamente y quieren disciplina en la entrega sin el overhead de un equipo de ingeniería completo.

**Equipos de ingeniería pequeños (aproximadamente 3–30 personas)** que han adoptado Claude Code o Codex y están empezando a sentir el costo del output de AI inconsistente y no gobernado — PRs que nadie entiende completamente, funcionalidades que crecieron más allá de su alcance, sin trail de auditoría de lo que realmente se construyó.

**Líderes de ingeniería** que necesitan introducir herramientas de AI sin perder los controles de proceso en los que ya confía su equipo — aprobaciones, decisiones documentadas, artefactos revisables.

El hilo común: personas que encuentran las herramientas de AI coding genuinamente útiles pero quieren que el output sea algo que puedan defender.

---

## Qué problema resuelve

Cuando trabajas con un asistente de AI coding sin ninguna estructura alrededor, algunas cosas tienden a salir mal:

**El AI no sabe qué tipo de trabajo realmente necesitas.** Pídele "arreglar el bug de login" y puede producir un refactor completo. Pídele "agregar dark mode" y puede saltarse la discusión de diseño e ir directo a la implementación. No hay señal sobre el alcance.

**No hay registro de lo que pasó ni por qué.** La ventana de conversación se cierra y el razonamiento desaparece. Si algo falla tres semanas después, no tienes un trail de artefactos para rastrear.

**La aprobación es ad hoc.** Cualquiera en el equipo puede hacer push de cambios generados por AI en cualquier momento, sin un gate consistente entre "el AI sugirió esto" y "esto está listo para entregar".

**El trabajo en paralelo es frágil.** Múltiples sesiones de AI tocando el mismo repositorio al mismo tiempo es una receta para conflictos y trabajo sobreescrito.

S2S aborda los cuatro. Clasifica lo que estás pidiendo, lo enruta solo a través de las etapas que esa solicitud realmente necesita, mantiene un registro estructurado de cada decisión y artefacto, impone aprobación humana en checkpoints significativos, y ejecuta cambios de código en worktrees git aislados para que el trabajo en paralelo se mantenga limpio.

---

## Cómo funciona el flujo de trabajo

**1. Inicializar el proyecto una vez.**
Ejecuta `s2s init` en el directorio de tu proyecto. Configura un workspace `.s2s/` con tu configuración, instala archivos de gobernanza que tu cliente AI lee automáticamente en cada sesión, y registra el proyecto. Esto toma unos minutos y no cambia ningún código existente.

**2. Enviar una solicitud de trabajo.**
Desde tu sesión de chat AI — o directamente desde la terminal — envía una solicitud: `s2s request "agregar rate limiting a la API"`. El orquestador lee la solicitud, clasifica el intent (¿nueva funcionalidad? ¿bug fix? ¿investigación?) y decide el conjunto mínimo de etapas que ese trabajo realmente necesita. Responde con la ruta planeada e indica si se requiere aprobación antes de la ejecución.

**3. Trabajar a través de las etapas usando el patrón de dos fases.**
Para cada etapa que produce artefactos — PM, Research, Design, Engineering — el flujo es:

Primero, ejecuta `s2s stage <etapa>`. S2S genera un paquete de tarea estructurado: exactamente qué construir, el contexto de etapas anteriores y la ruta de archivo donde escribir el artefacto. No se envía nada a un LLM. El AI lee la tarea, genera el artefacto en la sesión de chat y lo escribe en la ruta especificada.

Luego ejecuta `s2s stage <etapa> --submit`. S2S lee el artefacto, ejecuta chequeos de calidad, avanza el estado del proyecto y le dice al AI qué hacer a continuación — continuar a la siguiente etapa, corregir problemas de calidad o esperar un gate de revisión.

S2S maneja toda la lógica de orquestación — enrutamiento, estado, calidad, creación de gates — en el binario. Tus tokens de AI van a generar el artefacto, no a gestionar el flujo de trabajo.

**4. Revisar y aprobar en los gates.**
En puntos significativos — después de que la planificación esté lista, antes de que el código se ejecute — S2S pausa y pide aprobación humana via `s2s approve` o `s2s reject`. Puedes inspeccionar todo: `s2s show change`, `s2s show spec`, `s2s show slices`. Nada avanza sin una decisión deliberada.

**5. Ejecutar en un workspace aislado.**
Cuando se ejecuta engineering, opera sobre una unidad de trabajo acotada (un Slice, derivado del Technical Spec y Backlog) dentro de un worktree git aislado — un directorio de trabajo separado en una rama dedicada. Tu directorio de trabajo principal no se toca hasta que revisas y mergeas.

**6. Continuar de forma segura.**
Después de la ejecución, S2S registra lo que pasó: qué rama, qué PR, si pasó la verificación, qué artefactos se produjeron. Si necesitas refinar el trabajo, envía otra solicitud. El orquestador acumula la nueva ruta en el trabajo existente en lugar de sobreescribir decisiones previas.

---

## Por qué este flujo de trabajo es valioso

**Menos caos.** Cada solicitud pasa por clasificación antes de que pase algo. El AI no decide por sí solo cuánto trabajo hacer — el orquestador decide, basándose en lo que pediste.

**Continuidad entre sesiones.** El estado del trabajo se persiste en `.s2s/` como archivos estructurados — changes, specs, slices, runs, gates de aprobación. Cierra tu laptop, cambia de máquina, vuelve una semana después. El estado del proyecto está exactamente donde lo dejaste.

**Ejecución paralela más segura.** Los cambios de código corren en worktrees aislados, no en tu directorio de trabajo principal. Dos streams de trabajo pueden correr sin pisarse, y cada stream tiene su propia rama y PR.

**Las decisiones están documentadas.** Cada decisión de orquestación — qué fue la solicitud, cómo se clasificó, qué ruta se planeó, quién aprobó qué — está almacenada y es consultable. El trail de artefactos sobrevive a la ventana de chat.

**Cantidad correcta de proceso.** Un bug fix de una línea no se enruta por producto y diseño. Una nueva funcionalidad sí. La herramienta aplica proceso proporcionalmente, no uniformemente.

---

## Qué hace s2s diferente

**Enrutamiento intent-aware.** S2S no ejecuta un pipeline fijo para cada solicitud. Clasifica lo que pediste en nueve tipos de intent — nueva funcionalidad, bug fix, investigación, refinamiento, hotfix y otros — y selecciona solo las etapas que esa solicitud necesita. Este es el comportamiento central, y está completamente implementado.

**Adaptativo entre refinamientos.** Cuando refinas trabajo existente, S2S fusiona la nueva ruta en el plan anterior en lugar de reemplazarlo. Si decisiones anteriores requerían un gate de aprobación, ese gate se preserva incluso después de una solicitud de seguimiento. No puedes eliminar accidentalmente un checkpoint de compliance enviando un mensaje de clarificación.

**Ejecución slice-first.** La ejecución de engineering opera de a una unidad acotada — un Slice derivado del Technical Spec y Backlog. Esto limita el blast radius de cualquier ejecución individual y hace que la recuperación sea directa si algo sale mal.

**Workspaces de ejecución aislados.** Los cambios de código ocurren en worktrees git dedicados, no en tu directorio de trabajo activo. Tu rama principal está limpia hasta que revisas y mergeas explícitamente.

**Gobernanza que el AI realmente lee.** S2S escribe archivos de gobernanza en `.s2s/guardrails/` y shims de compatibilidad en el root (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`). Claude Code y Codex leen estos archivos automáticamente al inicio de cada sesión. El comportamiento del AI está moldeado por gobernanza real, versionada y con detección de conflictos — no un prompt que pegas en una ventana de chat y esperas que persista.

**Funciona con las herramientas que ya usas.** S2S no reemplaza Claude Code o Codex. Corre junto a ellos. Tu cliente de chat se mantiene igual; S2S agrega la capa de orquestación y ejecución por debajo.

---

## Limitaciones actuales

S2S actualmente soporta un stream de trabajo activo por proyecto. Los equipos que ejecutan varias funcionalidades independientes en paralelo a través del mismo proyecto encontrarán esto limitante — el soporte multi-stream es un paso natural pero aún no está en el producto.

El clasificador de intent usa señales de palabras clave ponderadas. Maneja casos comunes — bug fixes, nuevas funcionalidades, investigaciones — de forma confiable, pero solicitudes ambiguas o compuestas pueden ser enrutadas de formas inesperadas. Aún no existe un mecanismo de feedback para corregir clasificaciones erróneas.

La ejecución de engineering está construida alrededor de repositorios que tienen un comando de verificación funcional. Los proyectos sin comando de test o build producirán runs de ejecución sin señal de verificación.

La etapa `iterate` — para loops de refinamiento post-entrega — está definida en el modelo de datos pero aún no es alcanzable desde la superficie CLI.

---

## Posicionamiento

S2S es la capa de gobernanza y orquestación para equipos que han adoptado herramientas de AI coding y quieren entregar con confianza. Aporta clasificación de intent, enrutamiento adaptativo de etapas, ejecución acotada y trails de auditoría persistentes a un flujo de trabajo que de otro modo es rápido pero no gobernado. No reemplaza tu cliente AI ni tu proceso de ingeniería — hace a ambos más disciplinados. Open source, nativo en CLI y construido para funcionar con Claude Code y Codex hoy.
