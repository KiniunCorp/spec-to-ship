import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FigmaConfig } from '../types/index.js';

const CONFIG_PATH = resolve(process.cwd(), 'config', 'figma.mcp.json');

export function loadFigmaConfig(): FigmaConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as FigmaConfig;

    if (!config.fileKey) {
      return null;
    }

    return config;
  } catch {
    return null;
  }
}

export function isFigmaConfigured(): boolean {
  const config = loadFigmaConfig();
  return config !== null && config.fileKey !== '';
}
