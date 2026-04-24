# SpecToShip - Cost and Token Observability

SpecToShip tracks LLM usage and cost per project under:

- `artifacts/<project_id>/usage/events.ndjson`
- `artifacts/<project_id>/usage/summary.json`
- `artifacts/<project_id>/usage/UsageReport.md`

## What is tracked

- provider/mode/model
- stage and operation
- input/output/total tokens
- exact vs estimated usage
- calculated USD cost
- budget status (`ok`, `warning`, `blocked`)

## Exact vs estimated

- `api` and `openai_compatible` modes: use provider usage when available (exact).
- `cli` mode: uses token estimation (chars/4), always marked as estimated.

## Pricing configuration

Edit `config/pricing.json`:

```json
{
  "version": 1,
  "currency": "USD",
  "models": [
    {
      "provider": "openai",
      "model": "gpt-5.4",
      "inputUsdPer1M": 2.5,
      "outputUsdPer1M": 10.0
    },
    {
      "provider": "codex",
      "model": "cli-default",
      "inputUsdPer1M": 2.5,
      "outputUsdPer1M": 10.0,
      "estimationMultiplier": 1.1
    }
  ]
}
```

If pricing is missing for a model, cost is recorded as `0` and flagged in reports.

## Budget policy

Configure in `config/runtime.json`:

```json
{
  "costControl": {
    "enabled": true,
    "budgetUsd": 50,
    "warnThresholdPct": 80,
    "hardStopThresholdPct": 100
  }
}
```

Behavior:
- warn when reaching threshold
- hard-stop when budget threshold is reached (new LLM requests are blocked for that project)

## Report commands

```bash
just cost-report <project_id>
just cost-report-all
```

or:

```bash
npm run cost:report -- --project-id=<project_id>
npm run cost:report -- --all
```
