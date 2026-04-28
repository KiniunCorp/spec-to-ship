# Figma MCP Setup Guide

## Prerequisites

- A Figma account with a file you want to use for prototyping
- A Figma personal access token
- Claude Code with MCP support

## Step 1: Get a Figma Access Token

1. Go to Figma > Settings > Account
2. Scroll to "Personal access tokens"
3. Click "Generate new token"
4. Give it a descriptive name (e.g., "SpecToShip")
5. Copy the token

## Step 2: Set the Environment Variable

```bash
export FIGMA_ACCESS_TOKEN="your-token-here"
```

Add this to your shell profile (`.zshrc`, `.bashrc`, etc.) for persistence.

## Step 3: Find Your Figma File Key

Open your Figma file in a browser. The URL looks like:

```
https://www.figma.com/design/ABC123XYZ/My-File-Name
```

The file key is `ABC123XYZ` — the string between `/design/` and the next `/`.

## Step 4: Update SpecToShip Config

Edit `config/figma.mcp.json`:

```json
{
  "fileKey": "ABC123XYZ",
  "accessTokenEnvVar": "FIGMA_ACCESS_TOKEN"
}
```

## Step 5: Configure MCP Server

Add a Figma MCP server to your Claude Code MCP settings. The exact configuration depends on which Figma MCP server you're using. A common setup in `.claude/settings.json` or Claude Desktop config:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@anthropic/figma-mcp-server"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

## How Claude Code Uses Figma MCP

When SpecToShip's design stage runs, Claude Code will:

1. Read the `FigmaLink.json` artifact to know what frames to create
2. Use MCP tools to create/update a page and frames in your Figma file
3. Save the frame IDs and metadata to `FigmaSnapshot.json`

When you run `pullFromFigma`:

1. Claude Code reads frames from Figma via MCP
2. Extracts text layers and frame metadata
3. Saves to `FigmaSnapshot.json`
4. The iteration loop can then diff changes

## Troubleshooting

- **"Missing API key"**: Ensure `FIGMA_ACCESS_TOKEN` is set in your environment
- **"File not found"**: Double-check the file key in `figma.mcp.json`
- **MCP not available**: Ensure your MCP server is configured and running
- **Without Figma**: SpecToShip works fine without Figma — design artifacts are still generated as markdown specs
