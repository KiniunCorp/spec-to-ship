# Plantillas de Ejecución (Codex / Claude / OpenCode)

Las plantillas de ejecución controlan cómo `s2s stage engineering_exec` lanza un agente de AI en un worktree para implementar cambios de código.

> **Nota sobre el modo de pipeline:** En el modo `chat-native` (por defecto), las etapas que producen artefactos (`pm`, `research`, `design`, `engineering`) no usan plantillas de ejecución — generan un paquete de tarea para la sesión de chat activa. Las plantillas de ejecución solo aplican cuando se ejecuta `s2s stage engineering_exec` (que lanza un subproceso en un worktree) o cuando se configura `pipelineMode: 'standalone'`. Ver [Modos de Acceso LLM](./llm-access-modes_es.md) para configuración standalone.

Las plantillas de ejecución se definen en:

- `config/execution.templates.json`

El selector activo está en:

- `config/runtime.json` -> `execution.templateId`

## Plantillas estrictas recomendadas

### Codex estricto

```json
{
  "execution": {
    "mode": "shell",
    "templateId": "codex_strict",
    "timeoutMs": 1200000,
    "allowedCommands": ["codex", "claude", "opencode", "just", "pnpm", "node", "git"],
    "allowUnsafeRawCommand": false
  }
}
```

### Claude estricto

```json
{
  "execution": {
    "mode": "shell",
    "templateId": "claude_strict",
    "timeoutMs": 1800000,
    "allowedCommands": ["codex", "claude", "opencode", "just", "pnpm", "node", "git"],
    "allowUnsafeRawCommand": false
  }
}
```

### OpenCode estricto

```json
{
  "execution": {
    "mode": "shell",
    "templateId": "opencode_strict",
    "timeoutMs": 1800000,
    "allowedCommands": ["codex", "claude", "opencode", "just", "pnpm", "node", "git"],
    "allowUnsafeRawCommand": false
  }
}
```

## Caveat OpenCode (runtime-ready configurable)

Las plantillas `opencode_*` están listas para runtime y son configurables. Si tu instalación local de OpenCode usa flags distintos, ajusta:

- `command`
- `args`

en `config/execution.templates.json` para `opencode_strict` / `opencode_fast`.

## Política de ramas

Las ramas de entrega técnica usan:

- `s2s-<provider>/<change-id>`

Ejemplos:
- `s2s-codex/auth-refactor`
- `s2s-claude/checkout-ui`
- `s2s-opencode/fix-build`

## Checklist de seguridad

1. Mantener `allowUnsafeRawCommand` en `false`.
2. Mantener `allowedCommands` al mínimo.
3. Usar plantillas estrictas en producción.
4. Definir `timeoutMs` por tarea.
