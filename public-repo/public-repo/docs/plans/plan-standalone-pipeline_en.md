# Plan: Standalone Pipeline Mode (Path A)

**Status:** Deferred — document only. Implement after chat-native rearchitecture is stable.

## What it is

An optional execution mode where s2s runs its own LLM calls directly against an API provider
(Anthropic, OpenAI, or compatible), without relying on the chat UI being present. The chat AI
is not involved in artifact generation — s2s is self-contained.

## Why it is valuable

- **CI/CD pipelines:** run `s2s stage pm` in a GitHub Action or similar without a human chat session.
- **Scheduled automation:** nightly research sweeps, automated spec refresh on codebase changes.
- **Headless review workflows:** a bot creates a draft PRD and opens it for human review.
- **Testing:** exercise the full artifact pipeline in automated test environments.
- **Power users:** run multiple stages unattended, gate on quality score, continue only on pass.

This complements the primary chat-native model — it does not replace it.

## How it builds on existing code

Most of the infrastructure is already in place:

| Component | File | Status |
|-----------|------|--------|
| Agent definitions (PM, research, design, engineering) | `src/agents/*.ts` | Exists |
| Pipeline orchestrator | `src/conductor/pipeline.ts` | Exists |
| Quality checks + scoring | `src/quality/checks.ts` | Exists |
| API provider (Anthropic/OpenAI) | `src/providers/anthropic.ts`, `openai.ts` | Exists |
| Provider factory | `src/providers/interface.ts` | Exists |
| Cost tracking | `src/costs/tracker.ts` | Exists |

The main issue today is that the default LLM config (`config/llm.json`) uses `mode: 'cli'`, which
spawns the chat UI binary as a subprocess. That is always wrong. Fix: default to `mode: 'api'`.

## What needs to change

### 1. Remove `mode: 'cli'` as an auto-configured default

`mode: 'cli'` should be removed from `ensureConfigFiles` in `src/cli.ts`. It must not be written
into `llm.json` during init or repair. If a user manually sets it, that is their choice — but s2s
should never configure it automatically.

### 2. Default `llm.json` to `mode: 'api'`

```json
{
  "mode": "api",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "apiKeyEnvVar": "ANTHROPIC_API_KEY"
}
```

The key is read from the environment variable at runtime, never stored in config.

### 3. Add `standalone` mode toggle to `runtime.json`

```json
{
  "execution": {
    "mode": "chat-native"
  }
}
```

`mode: "chat-native"` is the default. Setting `"standalone"` opts into Path A.
In chat-native mode, `s2s stage pm` outputs a task context and exits; the pipeline is not invoked.
In standalone mode, `s2s stage pm` runs the agent pipeline and writes the artifact itself.

### 4. Add quality auto-approve threshold

```json
{
  "quality": {
    "enabled": true,
    "minAutoApproveScore": 0.85,
    "blockOnFailure": false
  }
}
```

- `minAutoApproveScore`: 0.0–1.0. If a stage's quality score is at or above this threshold, the
  stage is automatically approved without creating a review gate. Default: `0.85`.
- `blockOnFailure`: if `true`, a stage whose score is below the threshold blocks and exits with
  a non-zero code instead of continuing. Default: `false` (warn but continue).
- `enabled`: master switch. Default: `true`.

`s2s config edit` should expose these fields.

### 5. Provider setup in `s2s config edit`

Add a guided flow:
- Ask which mode: `chat-native` (default, no API key needed) or `standalone` (requires API key).
- If `standalone`: ask provider (anthropic/openai/compatible), model, API key env var name.
- Validate that the env var is set before accepting.

### 6. Remove `src/providers/cli.ts`

This file implements calling a CLI binary as an LLM provider. There is no valid use case for it
that is not better served by either:
- `mode: 'api'` for standalone execution, or
- chat-native mode where no LLM call is made by s2s at all.

Delete the file. Remove `case 'cli'` from `src/providers/interface.ts`.

## Quality auto-approve in standalone mode

After each stage completes, `runStage` already calls `runQualityChecks` and `getStageQuality`.

Extend `handleStageCommand` to compare `stageCheck.score` against `runtime.quality.minAutoApproveScore`:

```
score >= threshold  →  advance without gate, print quality score in output
score < threshold   →  if blockOnFailure: exit 1 with quality report
                        else: warn and advance (same as today)
```

The quality report is already written to `QualityReport.json` per run.

## Implementation order

1. Remove `mode: 'cli'` from `ensureConfigFiles` and `defaultLLMConfig`.
2. Delete `src/providers/cli.ts`, remove `case 'cli'` from `interface.ts`.
3. Add `execution.mode` toggle to `RuntimeConfig` type and `runtime.json` defaults.
4. Add `quality` block to `RuntimeConfig` and plumb into `handleStageCommand`.
5. Add standalone mode guard: when `execution.mode === 'standalone'`, run the pipeline;
   when `'chat-native'`, output context and exit (see chat-native plan).
6. Expose both fields in `s2s config edit`.
7. Update `s2s doctor` to validate API key is present when mode is standalone.

## What this is NOT

- A replacement for chat-native mode.
- A way to run stages faster or cheaper (the chat AI already has the model).
- The default configuration for new projects.
