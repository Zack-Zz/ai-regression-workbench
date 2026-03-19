import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { WORKBENCH_DIR } from '@zarb/config';

export function resolveStoragePath(configPath: string, configuredPath: string | undefined, fallbackSegments: string[]): string {
  const workspaceRoot = resolve(dirname(configPath), '..');
  if (!configuredPath || configuredPath.trim() === '') {
    return join(workspaceRoot, WORKBENCH_DIR, ...fallbackSegments);
  }
  return resolve(workspaceRoot, configuredPath);
}

function isWithinRoot(rootDir: string, absPath: string): boolean {
  const rel = relative(rootDir, absPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function resolveRelativePathWithinRoot(rootDir: string, relativePath: string): string | null {
  if (!relativePath.trim()) return null;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const absRoot = resolve(rootDir);
  const absPath = resolve(absRoot, normalized);
  return isWithinRoot(absRoot, absPath) ? absPath : null;
}

export function resolveArtifactAbsolutePath(artifactRoot: string, relativeArtifactPath: string): string | null {
  return resolveRelativePathWithinRoot(dirname(artifactRoot), relativeArtifactPath);
}

export function resolveRootRelativePath(rootDir: string, relativePath: string): string | null {
  return resolveRelativePathWithinRoot(dirname(rootDir), relativePath);
}

export function resolveConfiguredRelativePath(rootDir: string, defaultPrefix: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${defaultPrefix}/`;
  const configuredPrefix = `${rootDir.split(/[/\\]/).pop() ?? defaultPrefix}/`;
  const strippedPath = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized.startsWith(configuredPrefix)
      ? normalized.slice(configuredPrefix.length)
      : normalized;
  return resolveRelativePathWithinRoot(rootDir, strippedPath);
}

export function mustResolveConfiguredRelativePath(rootDir: string, defaultPrefix: string, relativePath: string): string {
  const resolvedPath = resolveConfiguredRelativePath(rootDir, defaultPrefix, relativePath);
  if (!resolvedPath) {
    throw new Error(`Path escapes configured root: ${relativePath}`);
  }
  return resolvedPath;
}

export function toConfiguredRelativePath(rootDir: string, defaultPrefix: string, ...segments: string[]): string {
  return join(rootDir.split(/[/\\]/).pop() ?? defaultPrefix, ...segments);
}
