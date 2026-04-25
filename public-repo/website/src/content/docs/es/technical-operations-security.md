---
title: "Operaciones y Seguridad"
description: "Controles operativos, configuración de runtime, modelo de seguridad de gobernanza y checklist de producción para ejecutar s2s en modo chat-first."
---

## Modo operativo

El modo operativo actual es gobernanza chat-first con runtime local por proyecto en `.s2s`.
Adapters de chat soportados en la superficie CLI:

- `codex-cli` (`s2s codex-cli`)
- `claude-cli` (`s2s claude-cli`)

## Archivos runtime críticos

- `.s2s/config/runtime.json`
- `.s2s/config/llm.json` (solo modo standalone)
- `.s2s/config/execution.templates.json`
- `.s2s/project.json`

## Controles operativos clave

En `runtime.json`:

- `guardrailPolicy` (`strict|warn|prompt`)
- `execution.templateId`
- `execution.allowedCommands`
- `execution.timeoutMs`
- `execution.allowUnsafeRawCommand`
- `workspace.projectRepoPath`
- `workspace.worktreesRootPath`

En `llm.json` (solo modo standalone):

- `mode` (`api` | `openai_compatible`)
- `provider`
- `model`
- `apiKeyEnvVar`

## Política recomendada para producción

1. Usar `guardrailPolicy=strict`.
2. Usar plantillas estrictas (`codex_strict`, `claude_strict` u `opencode_strict`).
3. Mantener la allowlist de comandos mínima.
4. Mantener `allowUnsafeRawCommand` desactivado.
5. Definir timeouts acotados por ejecución.
6. Mantener aprobación humana para decisiones de merge.
7. Forzar seguridad de rama antes de push: si la rama actual está ligada a PRs cerrados/mergeados, cambiar a rama nueva y abrir PR nuevo.
8. Definir severidad de update release con `S2S_PROJECT_UPDATE_CLASS` (`soft` o `hard`) antes de publicar.

## Modelo de seguridad de gobernanza

1. s2s mantiene shims de compatibilidad en root:
- `AGENTS.md`
- `CODEX.md`
- `CLAUDE.md`

2. s2s mantiene la política canónica del proyecto en `.s2s/guardrails/`.
   - Si hay conflicto entre los shims root de compatibilidad y `.s2s/guardrails/*`, `.s2s/guardrails/*` es la fuente de verdad.

3. Seguridad de config/migración:
- backups en `.s2s/backups/`
- snapshots globales en `~/.s2s/backups/projects/<project-hash>/<snapshot-id>/`
- logs en `.s2s/logs/`
- chequeos de compatibilidad CLI desde `.s2s/project.json`

## Checklist operativo

- Verificar que el CLI de chat seleccionado esté instalado y autenticado.
- Ejecutar `s2s doctor` y resolver discrepancias bloqueantes antes de correr etapas.
- Validar plantilla y allowlist en `runtime.json` antes de ejecutar etapas.
- Ejecutar `s2s status` antes de etapas críticas.
- Asegurar que `gh` esté disponible cuando `autoPush` está activo (requerido para chequeo de seguridad de rama por estado de PR).
- Confirmar severidad esperada de update de proyecto (`soft`/`hard`) para el release y documentarla en changelog/notas de release.
- Definir política del equipo para versionar o ignorar `.s2s/`.
