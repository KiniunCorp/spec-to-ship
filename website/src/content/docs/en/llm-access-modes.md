---
title: "Pipeline Mode & LLM Access"
description: "s2s supports two pipeline modes — chat-native and standalone — and two LLM access modes for standalone CI pipelines."
---

## Pipeline modes

S2S has two pipeline modes, set via `pipelineMode` in `.s2s/config/runtime.json`.

### Chat-native mode (default)

```json
{ "pipelineMode": "chat-native" }
```

In chat-native mode (the default), `s2s stage <stage>` outputs a structured context package to the active chat session. The chat AI reads the package, generates the required artifact, writes it to `.s2s/artifacts/`, and runs `s2s stage <stage> --submit` to record completion. S2S never calls an LLM directly. No `llm.json` is created or required.

### Standalone mode

```json
{ "pipelineMode": "standalone" }
```

In standalone mode, `s2s stage <stage>` calls the LLM API directly and produces the artifact autonomously. Use this for headless CI pipelines or environments without an interactive chat session.

Standalone mode requires `.s2s/config/llm.json`. Use `s2s config edit` to configure it — selecting standalone mode will prompt for provider, model, and API key settings.

---

## LLM access modes (standalone only)

The following modes are only relevant when `pipelineMode: 'standalone'`. In chat-native mode these settings have no effect.

### API mode (`mode: "api"`)

Use direct provider SDK access with API keys.

```json
{
  "mode": "api",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "apiKeyEnvVar": "ANTHROPIC_API_KEY"
}
```

Notes:
- Supported providers: `anthropic`, `openai`.
- Requires an API key in the configured env var.

### OpenAI-compatible mode (`mode: "openai_compatible"`)

Use any OpenAI-compatible endpoint.

```json
{
  "mode": "openai_compatible",
  "provider": "openai",
  "model": "gpt-5.4",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnvVar": "OPENAI_API_KEY"
}
```

Notes:
- Requires API key for the configured endpoint.
- Useful for gateways or self-hosted OpenAI-compatible services.

---

## Recommendation

Use `s2s config edit` to switch between modes interactively. `s2s doctor` validates that the required credentials are present for the selected mode.
