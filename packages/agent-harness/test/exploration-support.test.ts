import { describe, expect, it } from 'vitest';
import { pushRecent } from '../src/exploration/recent-context.js';
import {
  normalizeActionSelector,
  normalizeUrlForDecision,
} from '../src/exploration/action-utils.js';
import { buildPageSnapshot } from '../src/exploration/page-state.js';
import type { PageProbe } from '../src/exploration/types.js';

describe('exploration support helpers', () => {
  it('pushRecent appends values and trims to the requested limit', () => {
    const items = ['a', 'b'];

    pushRecent(items, 'c', 2);

    expect(items).toEqual(['b', 'c']);
  });

  it('normalizeUrlForDecision strips query and hash noise down to origin + path', () => {
    expect(normalizeUrlForDecision('https://example.com/admin/users?page=2#details')).toBe('https://example.com/admin/users');
    expect(normalizeUrlForDecision('not a url')).toBe('not a url');
  });

  it('normalizeActionSelector rewrites link and button shorthands for click actions', () => {
    expect(normalizeActionSelector('click', 'link:Users')).toBe('a:has-text("Users")');
    expect(normalizeActionSelector('click', 'button:Save "Draft"')).toBe('button:has-text("Save \\"Draft\\"")');
    expect(normalizeActionSelector('fill', 'input[name="email"]')).toBe('input[name="email"]');
  });

  it('buildPageSnapshot keeps compact counts and optional DOM summary fields', () => {
    const page: PageProbe = {
      url: 'https://example.com/dashboard',
      title: 'Dashboard',
      consoleErrors: ['TypeError: x'],
      networkErrors: [{ url: 'https://example.com/api/users', status: 500 }],
      formCount: 2,
      linkCount: 5,
      domSummary: {
        headings: ['Users'],
        primaryButtons: ['Save'],
        navLinks: ['Home'],
        inputHints: ['Search'],
        ctaCandidates: ['button:Save'],
        textSnippet: 'Manage users',
      },
    };

    expect(buildPageSnapshot(page)).toEqual({
      url: 'https://example.com/dashboard',
      title: 'Dashboard',
      formCount: 2,
      linkCount: 5,
      consoleErrors: 1,
      networkErrors: 1,
      headings: ['Users'],
      primaryButtons: ['Save'],
      navLinks: ['Home'],
      ctaCandidates: ['button:Save'],
      inputHints: ['Search'],
      textSnippet: 'Manage users',
    });
  });
});
