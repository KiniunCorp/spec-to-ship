---
title: "Eficiencia de Tokens"
description: "s2s elimina el overhead de tokens en razonamiento de flujo, reconstrucción de estado y orientación, manteniendo al AI enfocado en generar artefactos."
---

## El problema del overhead

Cuando una sesión de AI coding se ejecuta sin orquestación externa, el AI gasta tokens en cosas que no son generación de artefactos:

- "¿En qué etapa estoy?" — releer la conversación anterior para reconstruir el estado
- "¿Qué se decidió hasta ahora?" — resumir specs y decisiones previas
- "¿Qué comando ejecutar a continuación?" — razonar sobre la posición en el flujo de trabajo
- "¿Se registró ese artefacto?" — incertidumbre sobre si el trabajo anterior persiste

En una sesión típica sin guía para una funcionalidad que pasa por PM → Engineering, una gran fracción del presupuesto de tokens del AI se destina a orientación y razonamiento sobre el flujo de trabajo, no al PRD o TechSpec en sí.

## Lo que s2s maneja en el binario (cero tokens)

Cada operación que s2s realiza en el binario del CLI cuesta cero tokens AI:

| Operación | Costo en tokens |
|-----------|----------------|
| Clasificación de intent | 0 |
| Planificación de ruta de etapas | 0 |
| Construcción del paquete de contexto | 0 |
| Actualización de estado en `.s2s/live.md` | 0 |
| Evaluación de calidad de artefactos | 0 |
| Avance del ledger | 0 |
| Creación y ciclo de vida de gates | 0 |
| Configuración y aislamiento del worktree | 0 |
| Delivery git (branch, push, PR) | 0 |

## Lo que el AI maneja (tokens enfocados)

Cada etapa entrega al AI un paquete de contexto con exactamente lo que necesita. El trabajo del AI en cada etapa es específico y bien definido:

| Etapa | Tarea del AI | Eficiencia de tokens |
|-------|-------------|---------------------|
| `pm` | Escribir PRD.md desde el paquete de contexto | Alta: sin reconstrucción de estado necesaria |
| `research` | Escribir Research.md con investigación enfocada | Alta: decisiones previas están en el paquete |
| `design` | Escribir PrototypeSpec.md | Alta: PRD e investigación están resumidos |
| `engineering` | Escribir TechSpec.md + Backlog.md | Alta: contexto previo completo entregado |

El AI no necesita recordar en qué punto del flujo de trabajo se encuentra. Lee el paquete de contexto, genera el artefacto y envía. `live.md` mantiene el estado entre etapas.

## Comparación aproximada

Para una funcionalidad de complejidad media que pasa por `pm → engineering`:

**Sin s2s (sesión sin guía):**
- Tokens para orientarse al inicio de sesión: ~500–1000
- Tokens por etapa para reconstruir decisiones previas: ~300–800
- Tokens en razonamiento sobre flujo de trabajo: ~200–500 por etapa
- Overhead total: ~1500–3000 tokens para dos etapas

**Con s2s (chat-native):**
- Orientación: leer `live.md` (~150 tokens)
- Por etapa: recibir paquete de contexto enfocado, generar artefacto
- Overhead total: ~200 tokens en ambas etapas

La diferencia escala con la complejidad del proyecto. Los proyectos de larga duración con muchas decisiones previas se benefician más — el AI nunca necesita releer todo el historial de conversación porque `live.md` y el paquete de contexto contienen exactamente lo necesario.

## Configurar el umbral de calidad

Los chequeos de calidad se ejecutan en `--submit`. El umbral controla cuándo se activa el auto-approve versus cuándo se crea un gate de revisión:

```json
{
  "quality": {
    "enabled": true,
    "minAutoApproveScore": 0.85,
    "blockOnFailure": false
  }
}
```

- `minAutoApproveScore`: 0.0–1.0. Por defecto 0.85. Puntajes por debajo de esto generan un mensaje de falla de calidad; el AI debe corregir y reenviar.
- `blockOnFailure`: si es true, la falla de calidad termina con código no-cero (útil en CI). Por defecto false.

Actualiza con `s2s config edit`.

## Modo verbose

Por defecto, s2s imprime líneas con prefijo `[s2s]` antes y después de la salida de la etapa. Para suprimirlas:

```json
{ "verbose": false }
```

en `runtime.json`, o ejecuta `s2s stage <etapa> --no-verbose`. Las líneas de prefijo son informativas y no afectan el contenido del paquete de contexto.
