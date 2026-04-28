---
title: "Execution Templates"
description: "Execution templates control how s2s stage engineering_exec spawns an AI agent in an isolated worktree to implement code changes."
---

Execution templates control how `s2s stage engineering_exec` spawns an AI agent in a worktree to implement code changes.

> **Note on pipeline mode:** In the default `chat-native` pipeline mode, artifact-producing stages (`pm`, `research`, `design`, `engineering`) do not use execution templates — they output a task package for the active chat session. Execution templates only apply when `s2s stage engineering_exec` runs (which spawns a subprocess in a worktree) or when `pipelineMode: 'standalone'` is set. See [LLM Access Modes](/en/llm-access-modes/) for standalone configuration.

Execution templates are defined in:

- `config/execution.templates.json`

Runtime selector is defined in:

- `config/runtime.json` -> `execution.templateId`

## Recommended strict templates

### Codex strict

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

### Claude strict

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

### OpenCode strict

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

## OpenCode configuration

`opencode_*` templates are runtime-ready and configurable. If your local OpenCode CLI uses different flags, update:

- `command`
- `args`

inside `config/execution.templates.json` for `opencode_strict` / `opencode_fast`.

## Branch naming

Engineering delivery branches use:

- `s2s-<provider>/<change-id>`

Examples:
- `s2s-codex/auth-refactor`
- `s2s-claude/checkout-ui`
- `s2s-opencode/fix-build`

## Safety checklist

1. Keep `allowUnsafeRawCommand` set to `false`.
2. Keep `allowedCommands` minimal.
3. Use strict templates in production.
4. Keep `timeoutMs` bounded per task.
