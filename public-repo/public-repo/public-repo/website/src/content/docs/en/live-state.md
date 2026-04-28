---
title: "Live State (.s2s/live.md)"
description: ".s2s/live.md is a machine-written file that always contains the current project state and the next action the AI should take, updated after every s2s command."
---

## What is live.md?

`.s2s/live.md` is a machine-written Markdown file that always contains the current project state and the next action the AI should take. It is written by `s2s` after every significant command and is the authoritative "where am I?" file for chat sessions.

Reading `live.md` is cheaper than re-running `s2s status` (~150 tokens vs ~400 tokens) and works even after context has scrolled away in a long session.

## Format

```markdown
# S2S Live State

**Updated:** 2026-04-10T14:23:11.000Z
**Project:** my-app
**Feature:** add rate limiting to the API

## Current State

| Field | Value |
|-------|-------|
| Stage | engineering |
| Status | context_delivered |
| Route | pm → engineering → engineering_exec |
| Next action | generate artifact(s) for 'engineering' stage, write to .s2s/artifacts/, then run: s2s stage engineering --submit |
```

## Status values

| Status | Meaning |
|--------|---------|
| `none` | No active work. Wait for user to submit a request via `s2s request`. |
| `context_delivered` | `s2s stage <stage>` was run. Task package was output. AI should generate the artifact and run `--submit`. |
| `submitted` | `--submit` was run. Quality check passed and no gate was required. The next action points to the next stage. |
| `gate_pending` | A review gate was created. Do not advance. Wait for `s2s approve` or `s2s reject`. |
| `approved` | A gate was approved. Follow the next action. |
| `rejected` | A gate was rejected. Wait for user to provide new direction. |

## When s2s writes live.md

| Command | What it writes |
|---------|---------------|
| `s2s init` / `s2s update` | `status: none` if no active work |
| `s2s request "<prompt>"` | Route and first stage, `status: none` (request recorded; first stage not yet run) |
| `s2s stage <stage>` | `status: context_delivered`, next action = run `--submit` |
| `s2s stage <stage> --submit` (quality pass) | `status: submitted` or `approved`, next action = next stage |
| `s2s stage <stage> --submit` (quality fail) | `status: context_delivered`, next action = fix and re-submit |
| `s2s stage <stage> --submit` (gate created) | `status: gate_pending`, next action = wait for approve/reject |
| `s2s approve <gateId>` | `status: approved`, next action = next stage |
| `s2s reject <gateId>` | `status: rejected`, next action = wait for user |
| `s2s stage engineering_exec` (standalone) | `status: approved` or `submitted` based on quality result |

## How the AI uses live.md

At session start, the governance files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) instruct the AI to read `live.md` to orient. If there is active work, the AI follows the `nextAction` field. If status is `none`, the AI waits for user input.

During a stage, if the AI loses track (long session, context compacted), it reads `live.md` instead of trying to reconstruct state from prior output.

## Rules

- `live.md` is written exclusively by `s2s`. The AI must never modify it.
- The AI reads `live.md`; it does not write to it.
- If `live.md` does not exist, run `s2s` or `s2s status` to regenerate it.
- If `live.md` shows an unexpected status, run `s2s doctor` to check for configuration issues.
