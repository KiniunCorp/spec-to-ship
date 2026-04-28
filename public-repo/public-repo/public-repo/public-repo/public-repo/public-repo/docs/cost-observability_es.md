# SpecToShip - Observabilidad de Costos y Tokens

SpecToShip registra uso y costo LLM por proyecto en:

- `artifacts/<project_id>/usage/events.ndjson`
- `artifacts/<project_id>/usage/summary.json`
- `artifacts/<project_id>/usage/UsageReport.md`

## Qué se registra

- provider/modo/modelo
- etapa y operación
- tokens de entrada/salida/total
- uso exacto vs estimado
- costo USD calculado
- estado de presupuesto (`ok`, `warning`, `blocked`)

## Exacto vs estimado

- Modos `api` y `openai_compatible`: usan usage del proveedor cuando está disponible (exacto).
- Modo `cli`: usa estimación de tokens (chars/4), siempre marcado como estimado.

## Configuración de precios

Edita `config/pricing.json`:

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

Si no existe precio para un modelo, el costo se registra como `0` y se marca en reportes.

## Política de presupuesto

Configura en `config/runtime.json`:

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

Comportamiento:
- warning al alcanzar umbral
- hard-stop al llegar al umbral de bloqueo (se bloquean nuevas llamadas LLM para ese proyecto)

## Comandos de reporte

```bash
just cost-report <project_id>
just cost-report-all
```

o:

```bash
npm run cost:report -- --project-id=<project_id>
npm run cost:report -- --all
```
