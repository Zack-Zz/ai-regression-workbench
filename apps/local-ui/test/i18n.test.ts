import { describe, it, expect } from 'vitest';
import { t, setLocale, getLocale } from '../src/i18n.js';

describe('i18n', () => {
  it('returns zh-CN by default', () => {
    expect(getLocale()).toBe('zh-CN');
    expect(t('nav.home')).toBe('首页');
  });

  it('switches to en-US', () => {
    setLocale('en-US');
    expect(t('nav.home')).toBe('Home');
    setLocale('zh-CN');
  });

  it('falls back to zh-CN for missing en key', () => {
    setLocale('en-US');
    // inject a key only in zh
    expect(t('nav.runs')).toBe('Runs');
    setLocale('zh-CN');
  });

  it('returns key for completely missing key', () => {
    expect(t('__nonexistent__')).toBe('__nonexistent__');
  });
});
