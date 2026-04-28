---
title: "Changelog"
description: "Release history for spec-to-ship — what changed and when."
---

## 0.2.56

**Repo governance**
- `sync-public.yml` now creates a matching GitHub release on `KiniunCorp/spec-to-ship` after every publish, using the same tag, title, and notes as the source release.

---

## 0.2.55

**Gate approval hardening**
- Guardrail layer: Clarified that the AI should never attempt to call `s2s approve` or `s2s reject` — gate approval is always a human action via chat interaction.
- CLI layer: `s2s approve` and `s2s reject` now require an interactive terminal or piped stdin, ignoring `--yes` to prevent AI bypass.
- Planner layer: Fixed `requiresHumanApproval()` to return `true` whenever `engineering_exec` is in the recommended stages — ensuring `implementation_only` and other fast-track intents always gate before code execution.
- Classifier layer: Removed broad generic verbs from `implementation_only` signals to prevent misclassification of new-project requests. Added `new_feature` signals for "build", "let's build", "new app/site/service", and similar prompts.

---

## 0.2.54

**README and brand**
- Added "Why s2s" problem framing section, inline nav bar, and "When to use s2s" scenario table to README.
- Added `assets/` directory with logo files (horizontal, vertical, icon, text variants).
- Added VHS demo scripts for generating terminal demo GIFs.

---

## 0.2.53

**Messaging**
- README rewrite: chat-native concept leads; client-agnostic messaging; OpenCode added alongside Claude Code and Codex; Quick Start reduced to `s2s init` + open your chat client.

---

## 0.2.52

**OSS launch**
- Namespace migrated from `guschiriboga` to `KiniunCorp`.
- Homebrew tap updated to `kiniuncorp/s2s`.
- Added OSS metadata to `package.json`.

> **Note:** If you were using the old tap, update with:
> ```bash
> brew untap guschiriboga/s2s && brew tap kiniuncorp/s2s
> ```

---

## Older releases

Earlier changelog entries are available in the [GitHub repository](https://github.com/KiniunCorp/spec-to-ship/blob/main/CHANGELOG.md).
