# Guía de Setup Figma MCP

## Prerrequisitos

- Cuenta Figma con archivo de prototipado
- Token personal de Figma
- Claude Code con soporte MCP

## Paso 1: Obtener token de Figma

1. Figma > Settings > Account
2. Personal access tokens
3. Generate new token
4. Copiar token

## Paso 2: Variable de entorno

```bash
export FIGMA_ACCESS_TOKEN="tu-token"
```

## Paso 3: Obtener file key

URL ejemplo:

`https://www.figma.com/design/ABC123XYZ/My-File`

El file key es `ABC123XYZ`.

## Paso 4: Configurar SpecToShip

Edita `config/figma.mcp.json`:

```json
{
  "fileKey": "ABC123XYZ",
  "accessTokenEnvVar": "FIGMA_ACCESS_TOKEN"
}
```

## Paso 5: Configurar servidor MCP

Configura servidor Figma MCP en Claude Code.

## Solución de problemas

- API key faltante: revisa `FIGMA_ACCESS_TOKEN`
- archivo no encontrado: revisa `fileKey`
- MCP no disponible: valida configuración del servidor
