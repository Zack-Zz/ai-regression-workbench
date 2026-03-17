import type { TraceProvider, TraceSummary } from '@zarb/shared-types';

/**
 * NullTraceProvider — used when no trace provider is configured.
 * Always returns null (no trace data available).
 */
export class NullTraceProvider implements TraceProvider {
  getTrace(_traceId: string): Promise<TraceSummary | null> {
    return Promise.resolve(null);
  }
}

/**
 * JaegerTraceProvider — fetches trace summaries from a Jaeger HTTP API.
 * Endpoint format: http://host:16686
 *
 * Degrades gracefully: any network or parse error returns null.
 */
export class JaegerTraceProvider implements TraceProvider {
  constructor(private readonly endpoint: string) {}

  async getTrace(traceId: string): Promise<TraceSummary | null> {
    try {
      const url = `${this.endpoint}/api/traces/${traceId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const body = await res.json() as JaegerResponse;
      return parseJaegerTrace(traceId, body);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Jaeger response parsing
// ---------------------------------------------------------------------------

interface JaegerSpan {
  spanID: string;
  operationName: string;
  duration: number; // microseconds
  tags: Array<{ key: string; value: unknown }>;
  references?: Array<{ refType: string }>;
  process?: { serviceName: string };
}

interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, { serviceName: string }>;
}

interface JaegerResponse {
  data?: JaegerTrace[];
}

function parseJaegerTrace(traceId: string, body: JaegerResponse): TraceSummary | null {
  const trace = body.data?.[0];
  if (!trace) return null;

  const spans = trace.spans;
  const root = spans.find(s => !s.references?.some(r => r.refType === 'CHILD_OF'));
  const rootProcess = root ? (trace.processes[root.spanID] ?? Object.values(trace.processes)[0]) : Object.values(trace.processes)[0];

  const hasError = spans.some(s => s.tags.some(t => t.key === 'error' && t.value === true));

  const errorSpans = spans
    .filter(s => s.tags.some(t => t.key === 'error' && t.value === true))
    .slice(0, 5)
    .map(s => ({
      spanId: s.spanID,
      operation: s.operationName,
      durationMs: Math.round(s.duration / 1000),
      ...(rootProcess?.serviceName ? { service: rootProcess.serviceName } : {}),
    }));

  const topSlowSpans = [...spans]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3)
    .map(s => ({
      spanId: s.spanID,
      operation: s.operationName,
      durationMs: Math.round(s.duration / 1000),
      ...(rootProcess?.serviceName ? { service: rootProcess.serviceName } : {}),
    }));

  return {
    traceId,
    hasError,
    errorSpans,
    topSlowSpans,
    ...(rootProcess?.serviceName ? { rootService: rootProcess.serviceName } : {}),
    ...(root?.operationName ? { rootOperation: root.operationName } : {}),
    ...(root ? { durationMs: Math.round(root.duration / 1000) } : {}),
  };
}

/**
 * SkywalkingTraceProvider — fetches trace summaries from Apache SkyWalking OAP via GraphQL.
 * Endpoint format: http://host:12800
 *
 * Degrades gracefully: any network or parse error returns null.
 */
export class SkywalkingTraceProvider implements TraceProvider {
  constructor(private readonly endpoint: string) {}

  async getTrace(traceId: string): Promise<TraceSummary | null> {
    try {
      const query = `
        query($traceId: ID!) {
          trace: queryTrace(traceId: $traceId) {
            spans {
              spanId traceId segmentId parentSpanId
              serviceCode endpointName startTime endTime
              isError layer tags { key value }
            }
          }
        }`;
      const res = await fetch(`${this.endpoint}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { traceId } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const body = await res.json() as SkywalkingResponse;
      return parseSkywalkingTrace(traceId, body);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// SkyWalking response parsing
// ---------------------------------------------------------------------------

interface SkywalkingSpan {
  spanId: number;
  traceId: string;
  segmentId: string;
  parentSpanId: number;
  serviceCode: string;
  endpointName: string;
  startTime: number; // epoch ms
  endTime: number;   // epoch ms
  isError: boolean;
  layer: string;
  tags: Array<{ key: string; value: string }>;
}

interface SkywalkingResponse {
  data?: { trace?: { spans?: SkywalkingSpan[] } };
}

function parseSkywalkingTrace(traceId: string, body: SkywalkingResponse): TraceSummary | null {
  const spans = body.data?.trace?.spans;
  if (!spans?.length) return null;

  const root = spans.find(s => s.parentSpanId === -1) ?? spans[0];
  const hasError = spans.some(s => s.isError);

  const errorSpans = spans
    .filter(s => s.isError)
    .slice(0, 5)
    .map(s => ({
      spanId: `${s.segmentId}-${String(s.spanId)}`,
      service: s.serviceCode,
      operation: s.endpointName,
      durationMs: s.endTime - s.startTime,
    }));

  const topSlowSpans = [...spans]
    .sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime))
    .slice(0, 3)
    .map(s => ({
      spanId: `${s.segmentId}-${String(s.spanId)}`,
      service: s.serviceCode,
      operation: s.endpointName,
      durationMs: s.endTime - s.startTime,
    }));

  return {
    traceId,
    ...(root ? { rootService: root.serviceCode, rootOperation: root.endpointName, durationMs: root.endTime - root.startTime } : {}),
    hasError,
    errorSpans,
    topSlowSpans,
  };
}

/**
 * createTraceProvider — factory that reads config and returns the appropriate provider.
 */
export function createTraceProvider(config: { provider: string; endpoint: string }): TraceProvider {
  if (config.provider === 'jaeger' && config.endpoint) {
    return new JaegerTraceProvider(config.endpoint);
  }
  if (config.provider === 'skywalking' && config.endpoint) {
    return new SkywalkingTraceProvider(config.endpoint);
  }
  return new NullTraceProvider();
}
