import { describe, it, expect } from 'vitest';
import { NullLogProvider, LokiLogProvider, createLogProvider } from '../src/index.js';

describe('NullLogProvider', () => {
  it('always returns null', async () => {
    const p = new NullLogProvider();
    expect(await p.query({ fromTime: '2024-01-01T00:00:00Z', toTime: '2024-01-01T01:00:00Z' })).toBeNull();
  });
});

describe('createLogProvider', () => {
  it('returns NullLogProvider when provider is not loki', () => {
    const p = createLogProvider({ provider: 'none', endpoint: '', defaultLimit: 100 });
    expect(p).toBeInstanceOf(NullLogProvider);
  });

  it('returns LokiLogProvider when provider is loki', () => {
    const p = createLogProvider({ provider: 'loki', endpoint: 'http://localhost:3100', defaultLimit: 100 });
    expect(p).toBeInstanceOf(LokiLogProvider);
  });
});

describe('LokiLogProvider', () => {
  it('returns empty summary (matched: false) on network error (degrades gracefully)', async () => {
    const p = new LokiLogProvider('http://localhost:1');
    const result = await p.query({
      traceIds: ['trace-abc'],
      fromTime: '2024-01-01T00:00:00Z',
      toTime: '2024-01-01T01:00:00Z',
    });
    // Per-field fetch errors are swallowed; returns empty summary rather than null
    expect(result?.matched).toBe(false);
    expect(result?.totalHits).toBe(0);
  });

  it('returns null when all Loki requests return non-ok status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 500 }) as Response);
    const p = new LokiLogProvider('http://localhost:3100');
    const result = await p.query({
      traceIds: ['trace-abc'],
      fromTime: '2024-01-01T00:00:00Z',
      toTime: '2024-01-01T01:00:00Z',
    });
    // Returns empty summary (matched: false) rather than null when fetch fails per-field
    expect(result?.matched).toBe(false);
    globalThis.fetch = original;
  });

  it('parses a valid Loki response into LogSummary', async () => {
    const lokiBody = {
      data: {
        result: [
          {
            stream: { service: 'api-service' },
            values: [
              ['1704067200000000000', 'INFO request received'],
              ['1704067201000000000', 'ERROR database connection failed'],
            ],
          },
        ],
      },
    };
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(lokiBody), { status: 200 }) as Response);
    const p = new LokiLogProvider('http://localhost:3100');
    const result = await p.query({
      traceIds: ['trace-abc'],
      fromTime: '2024-01-01T00:00:00Z',
      toTime: '2024-01-01T01:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result?.matched).toBe(true);
    expect(result?.errorSamples).toHaveLength(1);
    expect(result?.errorSamples[0]?.message).toContain('ERROR');
    globalThis.fetch = original;
  });

  it('includes requestIds and sessionIds in Loki label queries', async () => {
    const capturedUrls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (url: unknown) => {
      capturedUrls.push(decodeURIComponent(String(url)));
      return Promise.resolve(new Response(JSON.stringify({ data: { result: [] } }), { status: 200 }) as Response);
    };
    const p = new LokiLogProvider('http://localhost:3100');
    await p.query({
      requestIds: ['req-abc'],
      sessionIds: ['sess-xyz'],
      fromTime: '2024-01-01T00:00:00Z',
      toTime: '2024-01-01T01:00:00Z',
    });
    // Each configured field generates a separate label-based query
    const allUrls = capturedUrls.join('\n');
    expect(allUrls).toContain('req-abc');
    expect(allUrls).toContain('sess-xyz');
    globalThis.fetch = original;
  });

  it('each configured logField generates a separate label-based Loki query (OR semantics)', async () => {
    const capturedUrls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (url: unknown) => {
      capturedUrls.push(decodeURIComponent(String(url)));
      return Promise.resolve(new Response(JSON.stringify({ data: { result: [] } }), { status: 200 }) as Response);
    };
    // Two configured fields: each should produce its own stream selector query
    const p = new LokiLogProvider('http://localhost:3100', 100, ['traceId', 'requestId']);
    await p.query({
      traceIds: ['trace-abc'],
      fromTime: '2024-01-01T00:00:00Z',
      toTime: '2024-01-01T01:00:00Z',
    });
    // Should have made 2 separate fetch calls (one per field)
    expect(capturedUrls).toHaveLength(2);
    // Each query uses a stream label selector, not a line filter
    expect(capturedUrls[0]).toMatch(/\{traceId=~"[^"]+"\}/);
    expect(capturedUrls[1]).toMatch(/\{requestId=~"[^"]+"\}/);
    // No AND semantics: each query has only one correlation field in its selector
    expect(capturedUrls[0]).not.toContain('requestId');
    expect(capturedUrls[1]).not.toContain('traceId');
    globalThis.fetch = original;
  });

  it('deduplicates log lines that appear in multiple field queries', async () => {
    const lokiBody = {
      data: {
        result: [{
          stream: { service: 'svc' },
          values: [['1704067200000000000', 'INFO same line']],
        }],
      },
    };
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(lokiBody), { status: 200 }) as Response);
    const p = new LokiLogProvider('http://localhost:3100', 100, ['traceId', 'requestId']);
    const result = await p.query({
      traceIds: ['trace-abc'],
      fromTime: '2024-01-01T00:00:00Z',
      toTime: '2024-01-01T01:00:00Z',
    });
    // Same line returned by both queries should be deduplicated
    expect(result?.totalHits).toBe(1);
    globalThis.fetch = original;
  });
});
