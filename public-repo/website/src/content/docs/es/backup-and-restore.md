---
title: "Backup y Restore"
description: "Respalda y restaura el estado de gobernanza y runtime que gestiona s2s, con snapshots automáticos de seguridad antes de cada restore."
---

Esta guía explica cómo respaldar y restaurar el estado de gobernanza/runtime que gestiona `s2s`.

## Qué se incluye

`s2s backup` guarda:

- Workspace local completo `.s2s/`
- Shims root de compatibilidad para clientes de chat:
  - `AGENTS.md`
  - `CODEX.md`
  - `CLAUDE.md`

## Ubicación global de backups

Los backups se guardan de forma global (fuera del repo app) con aislamiento por proyecto:

```text
~/.s2s/backups/projects/<project-hash>/<snapshot-id>/
  manifest.json
  s2s/
  root/
```

- `<project-hash>`: hash determinístico del path absoluto del root app
- `<snapshot-id>`: id tipo timestamp ISO

## Comandos

Crear backup (contexto actual de proyecto):

```bash
s2s backup
```

Crear backup para proyecto explícito (alias/path):

```bash
s2s backup mi-proyecto
```

Restaurar último snapshot:

```bash
s2s restore --latest
```

Restaurar snapshot específico:

```bash
s2s restore --snapshot=<snapshot-id>
```

Restaurar proyecto específico:

```bash
s2s restore mi-proyecto --latest
```

## Comportamiento de seguridad en restore

Antes de escribir archivos restaurados, `s2s restore` crea siempre un backup automático de seguridad pre-restore.

Esto permite revertir cualquier restore haciendo otro restore.

## Cómo inspeccionar snapshots disponibles

Usa shell para listar snapshots del proyecto:

```bash
ls ~/.s2s/backups/projects
ls ~/.s2s/backups/projects/<project-hash>
```

Tip: la salida de `s2s backup` imprime el snapshot id y el path del directorio de backup del proyecto.

## Política recomendada de uso

1. Crear backup antes de cambios grandes de configuración (`s2s config edit`).
2. Crear backup antes de transiciones de etapa con cambios runtime riesgosos.
3. Incluir backup/restore en el checklist operativo de delivery.
4. Ten en cuenta que `s2s` también crea snapshots automáticos pre-policy cuando se aplican decisiones de discrepancias en init/config.
