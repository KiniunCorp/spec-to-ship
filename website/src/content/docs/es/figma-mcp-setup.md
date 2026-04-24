---
title: "Configuración de Figma MCP"
description: "Conecta un archivo de Figma a s2s vía MCP para que la etapa de diseño pueda crear y leer frames directamente desde tu cuenta de Figma."
---

## Prerrequisitos

- Cuenta Figma con un archivo para usar en prototipos
- Token personal de acceso a Figma
- Claude Code con soporte MCP

## Paso 1: Obtener un token de acceso de Figma

1. Ve a Figma > Settings > Account
2. Desplázate a "Personal access tokens"
3. Haz clic en "Generate new token"
4. Asígnale un nombre descriptivo (p. ej., "s2s")
5. Copia el token

## Paso 2: Configurar la variable de entorno

```bash
export FIGMA_ACCESS_TOKEN="tu-token"
```

Agrega esta línea a tu perfil de shell (`.zshrc`, `.bashrc`, etc.) para que persista entre sesiones.

## Paso 3: Obtener el file key de Figma

Abre tu archivo de Figma en un navegador. La URL tiene este formato:

```
https://www.figma.com/design/ABC123XYZ/My-File-Name
```

El file key es `ABC123XYZ` — la cadena entre `/design/` y el siguiente `/`.

## Paso 4: Actualizar la configuración de s2s

Edita `config/figma.mcp.json`:

```json
{
  "fileKey": "ABC123XYZ",
  "accessTokenEnvVar": "FIGMA_ACCESS_TOKEN"
}
```

## Paso 5: Configurar el servidor MCP

Agrega un servidor Figma MCP a la configuración MCP de Claude Code. La configuración exacta depende del servidor Figma MCP que uses. Un ejemplo común en `.claude/settings.json` o en la configuración de Claude Desktop:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@anthropic/figma-mcp-server"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "tu-token"
      }
    }
  }
}
```

## Cómo usa Claude Code el Figma MCP

Cuando se ejecuta la etapa de diseño de s2s, Claude Code:

1. Lee el artefacto `FigmaLink.json` para saber qué frames crear
2. Usa las herramientas MCP para crear o actualizar una página y frames en tu archivo de Figma
3. Guarda los IDs de frames y metadatos en `FigmaSnapshot.json`

Cuando ejecutas `pullFromFigma`:

1. Claude Code lee los frames desde Figma vía MCP
2. Extrae capas de texto y metadatos de frames
3. Guarda los resultados en `FigmaSnapshot.json`
4. El loop de iteración puede entonces comparar los cambios

## Solución de problemas

- **"Missing API key"**: Verifica que `FIGMA_ACCESS_TOKEN` esté definida en tu entorno
- **"File not found"**: Revisa el file key en `figma.mcp.json`
- **MCP no disponible**: Asegúrate de que el servidor MCP esté configurado y en ejecución
- **Sin Figma**: s2s funciona correctamente sin Figma — los artefactos de diseño se generan igual como specs en markdown
