import { describe, it, expect } from 'vitest';
import { NullTraceProvider, JaegerTraceProvider, createTraceProvider } from '../src/index.js';

describe('NullTraceProvider', () => {
  it('always returns null', async () => {
    const p = new NullTraceProvider();
    expect(await p.getTrace('abc')).toBeNull();
  });
});

describe('createTraceProvider', () => {
  it('returns NullTraceProvider when provider is not jaeger', () => {
    const p = createTraceProvider({ provider: 'none', endpoint: '' });
    expect(p).toBeInstanceOf(NullTraceProvider);
  });

  it('returns JaegerTraceProvider when provider is jaeger', () => {
    const p = createTraceProvider({ provider: 'jaeger', endpoint: 'http://localhost:16686' });
    expect(p).toBeInstanceOf(JaegerTraceProvider);
  });
});

describe('JaegerTraceProvider', () => {
  it('returns null on network error (degrades gracefully)', async () => {
    const p = new JaegerTraceProvider('http://localhost:1'); // unreachable
    const result = await p.getTrace('trace-123');
    expect(result).toBeNull();
  });

  it('returns null when Jaeger returns non-ok status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }) as Response);
    const p = new JaegerTraceProvider('http://localhost:16686');
    const result = await p.getTrace('trace-123');
    expect(result).toBeNull();
    globalThis.fetch = original;
  });

  it('parses a valid Jaeger response into TraceSummary', async () => {
    const jaegerBody = {
      data: [{
        traceID: 'trace-abc',
        spans: [
          {
            spanID: 'span-1',
            operationName: 'GET /api',
            duration: 50_000,
            tags: [],
            references: [],
          },
          {
            spanID: 'span-2',
            operationName: 'db.query',
            duration: 10_000,
            tags: [{ key: 'error', value: true }],
            references: [{ refType: 'CHILD_OF' }],
          },
        ],
        processes: { 'span-1': { serviceName: 'api-service' } },
      }],
    };
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(jaegerBody), { status: 200 }) as Response);
    const p = new JaegerTraceProvider('http://localhost:16686');
    const result = await p.getTrace('trace-abc');
    expect(result).not.toBeNull();
    expect(result?.traceId).toBe('trace-abc');
    expect(result?.hasError).toBe(true);
    expect(result?.errorSpans).toHaveLength(1);
    expect(result?.rootService).toBe('api-service');
    globalThis.fetch = original;
  });

  it('uses base endpoint format (no /api/traces suffix) — default config compatibility', async () => {
    let capturedUrl = '';
    const original = globalThis.fetch;
    globalThis.fetch = (url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }) as Response);
    };
    // Default config endpoint is the base URL without path suffix
    const p = new JaegerTraceProvider('http://localhost:16686');
    await p.getTrace('trace-123');
    expect(capturedUrl).toBe('http://localhost:16686/api/traces/trace-123');
    expect(capturedUrl).not.toContain('/api/traces/api/traces/');
    globalThis.fetch = original;
  });
});
