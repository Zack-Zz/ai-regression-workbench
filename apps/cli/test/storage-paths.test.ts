import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveConfiguredRelativePath, resolveRelativePathWithinRoot } from '../src/storage-paths.js';

describe('storage path guards', () => {
  it('resolves configured artifact paths inside the configured root', () => {
    const root = '/tmp/workbench/artifacts';
    expect(resolveConfiguredRelativePath(root, 'artifacts', 'artifacts/run-1/tc-1/shot.png'))
      .toBe(join(root, 'run-1', 'tc-1', 'shot.png'));
  });

  it('rejects configured paths that escape the configured root', () => {
    const root = '/tmp/workbench/artifacts';
    expect(resolveConfiguredRelativePath(root, 'artifacts', 'artifacts/../../outside.txt')).toBeNull();
    expect(resolveConfiguredRelativePath(root, 'artifacts', '../outside.txt')).toBeNull();
  });

  it('accepts paths persisted with the configured root basename', () => {
    const root = '/tmp/workbench/custom-shots';
    expect(resolveConfiguredRelativePath(root, 'artifacts', 'custom-shots/run-1/tc-1/shot.png'))
      .toBe(join(root, 'run-1', 'tc-1', 'shot.png'));
  });

  it('rejects generic relative paths that escape the root', () => {
    const root = '/tmp/workbench/data';
    expect(resolveRelativePathWithinRoot(root, '../escape.txt')).toBeNull();
    expect(resolveRelativePathWithinRoot(root, '../../etc/passwd')).toBeNull();
  });
});
