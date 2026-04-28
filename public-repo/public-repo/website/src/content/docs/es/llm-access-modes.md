---
title: "Modo de Pipeline y Acceso LLM"
description: "s2s admite dos modos de pipeline — chat-native y standalone — y dos modos de acceso LLM para pipelines CI sin interfaz interactiva."
---

## Modos de pipeline

S2S tiene dos modos de pipeline, configurados mediante `pipelineMode` en `.s2s/config/runtime.json`.

### Modo chat-native (por defecto)

```json
{ "pipelineMode": "chat-native" }
```

En modo chat-native (el predeterminado), `s2s stage <etapa>` envía un paquete de contexto estructurado a la sesión de chat activa. El AI de chat lee el paquete, genera el artefacto requerido, lo escribe en `.s2s/artifacts/`, y ejecuta `s2s stage <etapa> --submit` para registrar la compleción. S2S nunca llama a un LLM directamente. No se crea ni requiere `llm.json`.

### Modo standalone

```json
{ "pipelineMode": "standalone" }
```

En modo standalone, `s2s stage <etapa>` llama directamente a la API del LLM y produce el artefacto de forma autónoma. Úsalo para pipelines CI sin interfaz interactiva o entornos sin sesión de chat activa.

El modo standalone requiere `.s2s/config/llm.json`. Usa `s2s config edit` para configurarlo — al seleccionar modo standalone se pedirá proveedor, modelo y configuración de API key.

---

## Modos de acceso LLM (solo modo standalone)

Los siguientes modos solo son relevantes cuando `pipelineMode: 'standalone'`. En modo chat-native estas configuraciones no tienen efecto.

### Modo API (`mode: "api"`)

Acceso directo por SDK del proveedor con API keys.

```json
{
  "mode": "api",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "apiKeyEnvVar": "ANTHROPIC_API_KEY"
}
```

Notas:
- Proveedores soportados: `anthropic`, `openai`.
- Requiere API key en la variable de entorno configurada.

### Modo OpenAI-compatible (`mode: "openai_compatible"`)

Usa cualquier endpoint compatible con OpenAI.

```json
{
  "mode": "openai_compatible",
  "provider": "openai",
  "model": "gpt-5.4",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnvVar": "OPENAI_API_KEY"
}
```

Notas:
- Requiere API key para el endpoint configurado.
- Útil para gateways o servicios self-hosted compatibles con OpenAI.

---

## Recomendación

Usa `s2s config edit` para cambiar entre modos de forma interactiva. `s2s doctor` valida que las credenciales requeridas estén presentes para el modo seleccionado.
