import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile, normalizeAlias } from '../utils/file-io.js';
import { globalS2SHomePath } from '../utils/paths.js';
import type { GlobalRegistry, GlobalRegistryProject } from '../types.js';

let registeredTemplateVersion = '0.0.0';

export function setRegistryTemplateVersion(version: string): void {
  registeredTemplateVersion = version;
}

export function registryPath(): string {
  return path.join(globalS2SHomePath(), 'projects.json');
}

export function loadRegistry(): GlobalRegistry {
  const filePath = registryPath();
  const parsed = readJsonFile<GlobalRegistry>(filePath);
  if (!parsed || !Array.isArray(parsed.projects)) {
    return { version: 1, projects: [] };
  }
  const rawProjects = parsed.projects.map((project) => ({
    alias: normalizeAlias(project.alias),
    appPath: path.resolve(project.appPath),
    s2sPath: path.resolve(project.s2sPath),
    createdAt: String(project.createdAt || new Date().toISOString()),
    updatedAt: String(project.updatedAt || new Date().toISOString()),
    lastUsedAt: String(project.lastUsedAt || new Date().toISOString()),
    templateVersion: String(project.templateVersion || registeredTemplateVersion),
  }));
  const sanitizedProjects = sanitizeRegistryProjects(rawProjects);
  const next: GlobalRegistry = {
    version: Number(parsed.version || 1),
    projects: sanitizedProjects,
  };
  if (JSON.stringify(rawProjects) !== JSON.stringify(sanitizedProjects)) {
    saveRegistry(next);
  }
  return next;
}

export function saveRegistry(registry: GlobalRegistry): void {
  const filePath = registryPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonFile(filePath, registry);
}

export function sanitizeRegistryProjects(projects: GlobalRegistryProject[]): GlobalRegistryProject[] {
  const byPath = new Map<string, GlobalRegistryProject>();
  for (const project of projects) {
    const appPath = path.resolve(project.appPath);
    if (!existsSync(appPath)) continue;

    const normalized: GlobalRegistryProject = {
      alias: normalizeAlias(project.alias || path.basename(appPath)),
      appPath,
      s2sPath: path.resolve(project.s2sPath || path.join(appPath, '.s2s')),
      createdAt: String(project.createdAt || new Date().toISOString()),
      updatedAt: String(project.updatedAt || new Date().toISOString()),
      lastUsedAt: String(project.lastUsedAt || new Date().toISOString()),
      templateVersion: String(project.templateVersion || registeredTemplateVersion),
    };
    const existing = byPath.get(appPath);
    if (!existing || normalized.updatedAt > existing.updatedAt) {
      byPath.set(appPath, normalized);
    }
  }

  const takenAliases: string[] = [];
  const deduped = Array.from(byPath.values()).map((project) => {
    const alias = dedupeAlias(normalizeAlias(project.alias), takenAliases);
    takenAliases.push(alias);
    return { ...project, alias };
  });
  deduped.sort((a, b) => a.alias.localeCompare(b.alias));
  return deduped;
}

export function dedupeAlias(alias: string, taken: string[]): string {
  const used = new Set(taken.map((value) => normalizeAlias(value)));
  if (!used.has(alias)) return alias;
  let index = 2;
  while (used.has(`${alias}-${index}`)) index += 1;
  return `${alias}-${index}`;
}

export function updateRegistryForProject(aliasInput: string, appRoot: string, s2sPath: string): void {
  const registry = loadRegistry();
  const now = new Date().toISOString();
  const appPath = path.resolve(appRoot);
  const existingByPath = registry.projects.find((entry) => path.resolve(entry.appPath) === appPath);
  const baseAlias = normalizeAlias(aliasInput || path.basename(appPath));
  const alias = existingByPath
    ? existingByPath.alias
    : dedupeAlias(baseAlias, registry.projects.map((entry) => entry.alias));

  if (existingByPath) {
    existingByPath.alias = alias;
    existingByPath.s2sPath = s2sPath;
    existingByPath.updatedAt = now;
    existingByPath.lastUsedAt = now;
    existingByPath.templateVersion = registeredTemplateVersion;
  } else {
    registry.projects.push({
      alias,
      appPath,
      s2sPath,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      templateVersion: registeredTemplateVersion,
    });
  }
  registry.projects.sort((a, b) => a.alias.localeCompare(b.alias));
  saveRegistry(registry);
}

export function removeProjectFromRegistryByPath(appRoot: string): number {
  const registry = loadRegistry();
  const normalizedPath = path.resolve(appRoot);
  const before = registry.projects.length;
  registry.projects = registry.projects.filter((entry) => path.resolve(entry.appPath) !== normalizedPath);
  const removed = before - registry.projects.length;
  if (removed > 0) {
    saveRegistry(registry);
  }
  return removed;
}
