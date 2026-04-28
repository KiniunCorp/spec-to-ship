# Flujo de Trabajo Chat-Native

## ¿Qué es el modo chat-native?

En modo chat-native (el predeterminado), `s2s` maneja toda la orquestación dentro del binario — clasificación de intent, enrutamiento, gestión de estado, evaluación de calidad — sin realizar ninguna llamada al LLM. La sesión de chat activa es el AI. `s2s` la dirige con un paquete de tarea enfocado, el AI genera el artefacto, y `s2s` registra el resultado.

Esto significa cero tokens AI gastados en "¿qué hago ahora?". El AI recibe exactamente lo que necesita para producir el artefacto y nada más.

## Inicio de sesión

Al inicio de cada sesión, lee `.s2s/live.md`. Siempre contiene:
- El proyecto y feature activos
- Etapa y estado actuales
- La próxima acción a tomar

Si no hay trabajo activo, `live.md` muestra `status: none` y debes esperar que el usuario envíe una solicitud. Si hay trabajo en progreso, sigue el campo `nextAction`.

Para referencia de comandos, lee `.s2s/protocol.md`. Es generado por `s2s init` y `s2s update` y contiene la sintaxis completa de cada comando activo.

## Enviar una solicitud de trabajo

```bash
s2s request "agregar rate limiting a la API"
```

El orquestador clasifica el intent, selecciona la ruta mínima de etapas, crea un Change y Spec, y actualiza `live.md` con la ruta y la primera etapa. La salida indica exactamente qué comando ejecutar a continuación.

## Patrón de dos fases por etapa

Para cada etapa que produce artefactos (`pm`, `research`, `design`, `engineering`):

### Fase 1 — obtener la tarea

```bash
s2s stage pm
```

La salida incluye:
- **OBJECTIVE** — qué artefacto producir y por qué
- **CONTEXT** — artefactos de etapas anteriores, solicitud del usuario, clasificación de intent
- **ARTIFACT SPECIFICATION** — requisitos exactos de contenido
- **Ruta del archivo** — dónde escribir el artefacto
- **WHEN DONE** — el comando `--submit` exacto a ejecutar

`s2s` actualiza `live.md` con `status: context_delivered` y la próxima acción. No se realiza ninguna llamada al LLM.

### Fase 2 — generar y enviar

1. Lee la salida de la tarea con atención — contiene todo el contexto necesario.
2. Genera el contenido del artefacto en la sesión de chat.
3. Escribe el artefacto en la ruta exacta especificada.
4. Ejecuta `--submit`:

```bash
s2s stage pm --submit
```

`s2s` lee el artefacto, ejecuta chequeos de calidad, avanza el ledger y genera la próxima acción. `live.md` se actualiza con el resultado.

### Después del submit — seguir la próxima acción

Tres resultados posibles:

**Calidad pasa, sin gate:**
```
[s2s] pm submitted · quality 91% ✓ · next: s2s stage engineering
```
Ejecuta la siguiente etapa.

**Calidad falla:**
```
[s2s] pm submitted · quality 62% ✗ · threshold 85%
Issues: missing success criteria, no scope boundary defined
```
Corrige los problemas en el archivo del artefacto y vuelve a ejecutar `--submit`.

**Gate de revisión creado:**
```
[s2s] pm submitted · quality 88% ✓ · gate created (gate_abc123)
```
Espera que el usuario ejecute `s2s approve gate_abc123` o `s2s reject gate_abc123`.

## Gates de aprobación

Cuando hay un gate pendiente, `live.md` muestra `status: gate_pending`. No avances a la siguiente etapa. El usuario debe aprobar o rechazar explícitamente mediante:

```bash
s2s approve gate_abc123   # avanzar a la siguiente etapa
s2s reject gate_abc123    # detener; el usuario provee nueva dirección
```

Después de la aprobación, `live.md` se actualiza y puedes continuar.

## Recuperación de sesión

Si pierdes el hilo del proyecto — sesión reiniciada, contexto perdido de pantalla — lee `live.md`:

```bash
cat .s2s/live.md
```

Siempre refleja el estado actual y la próxima acción. No necesitas volver a ejecutar `s2s status` ni releer comandos anteriores.

## Cambiar de cliente de chat

Los archivos de gobernanza de `s2s` son independientes del cliente. Si cambias de Claude Code a Codex (o viceversa), el nuevo cliente lee los mismos archivos `.s2s/guardrails/` y `live.md`. La sesión continúa exactamente donde quedó.

## Etapa engineering_exec

`s2s stage engineering_exec` lanza un agente AI configurado dentro de un worktree git aislado para implementar el código. Esta etapa es diferente a las demás:
- No usa el patrón de dos fases tarea/submit.
- Lanza un subproceso usando la plantilla de ejecución activa.
- El worktree es una rama limpia separada de tu directorio de trabajo.

Después de completar `engineering_exec`, s2s registra el resultado y actualiza `live.md`.
