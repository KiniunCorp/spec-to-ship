---
title: "Estado en Vivo (.s2s/live.md)"
description: ".s2s/live.md es un archivo escrito por la máquina que siempre contiene el estado actual del proyecto y la próxima acción que el AI debe tomar, actualizado tras cada comando s2s."
---

## ¿Qué es live.md?

`.s2s/live.md` es un archivo Markdown escrito por la máquina que siempre contiene el estado actual del proyecto y la próxima acción que el AI debe tomar. Es escrito por `s2s` después de cada comando significativo y es el archivo autoritativo "¿dónde estoy?" para las sesiones de chat.

Leer `live.md` es más eficiente que volver a ejecutar `s2s status` (~150 tokens vs ~400 tokens) y funciona incluso cuando el contexto se ha desplazado en una sesión larga.

## Formato

```markdown
# S2S Live State

**Updated:** 2026-04-10T14:23:11.000Z
**Project:** my-app
**Feature:** agregar rate limiting a la API

## Current State

| Field | Value |
|-------|-------|
| Stage | engineering |
| Status | context_delivered |
| Route | pm → engineering → engineering_exec |
| Next action | generate artifact(s) for 'engineering' stage, write to .s2s/artifacts/, then run: s2s stage engineering --submit |
```

## Valores de status

| Status | Significado |
|--------|------------|
| `none` | Sin trabajo activo. Esperar que el usuario envíe una solicitud via `s2s request`. |
| `context_delivered` | Se ejecutó `s2s stage <etapa>`. El paquete de tarea fue enviado. El AI debe generar el artefacto y ejecutar `--submit`. |
| `submitted` | Se ejecutó `--submit`. El chequeo de calidad pasó y no se requirió gate. La próxima acción apunta a la siguiente etapa. |
| `gate_pending` | Se creó un gate de revisión. No avanzar. Esperar `s2s approve` o `s2s reject`. |
| `approved` | Un gate fue aprobado. Seguir la próxima acción. |
| `rejected` | Un gate fue rechazado. Esperar que el usuario provea nueva dirección. |

## Cuándo s2s escribe live.md

| Comando | Qué escribe |
|---------|------------|
| `s2s init` / `s2s update` | `status: none` si no hay trabajo activo |
| `s2s request "<prompt>"` | Ruta y primera etapa, `status: none` (solicitud registrada; primera etapa no ejecutada aún) |
| `s2s stage <etapa>` | `status: context_delivered`, próxima acción = ejecutar `--submit` |
| `s2s stage <etapa> --submit` (calidad pasa) | `status: submitted` o `approved`, próxima acción = siguiente etapa |
| `s2s stage <etapa> --submit` (calidad falla) | `status: context_delivered`, próxima acción = corregir y reenviar |
| `s2s stage <etapa> --submit` (gate creado) | `status: gate_pending`, próxima acción = esperar approve/reject |
| `s2s approve <gateId>` | `status: approved`, próxima acción = siguiente etapa |
| `s2s reject <gateId>` | `status: rejected`, próxima acción = esperar al usuario |
| `s2s stage engineering_exec` (standalone) | `status: approved` o `submitted` según resultado de calidad |

## Cómo usa el AI live.md

Al inicio de la sesión, los archivos de gobernanza (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) instruyen al AI a leer `live.md` para orientarse. Si hay trabajo activo, el AI sigue el campo `nextAction`. Si el status es `none`, el AI espera input del usuario.

Durante una etapa, si el AI pierde el hilo (sesión larga, contexto comprimido), lee `live.md` en lugar de intentar reconstruir el estado desde la salida anterior.

## Reglas

- `live.md` es escrito exclusivamente por `s2s`. El AI nunca debe modificarlo.
- El AI lee `live.md`; no lo escribe.
- Si `live.md` no existe, ejecutar `s2s` o `s2s status` para regenerarlo.
- Si `live.md` muestra un status inesperado, ejecutar `s2s doctor` para verificar problemas de configuración.
