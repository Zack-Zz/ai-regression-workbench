import type { LogProvider, LogQuery, LogSummary } from '@zarb/shared-types';

/**
 * NullLogProvider — used when no log provider is configured.
 * Always returns null (no log data available).
 */
export class NullLogProvider implements LogProvider {
  query(_input: LogQuery): Promise<LogSummary | null> {
    return Promise.resolve(null);
  }
}

/**
 * LokiLogProvider — queries Grafana Loki via its HTTP query_range API.
 * Endpoint format: http://host:3100
 *
 * logFields: configured label names to use for correlation ID matching.
 * Each field is queried independently as a Loki label selector, and results
 * are merged. This preserves label semantics while supporting alternative
 * configured field names.
 *
 * Degrades gracefully: any network or parse error returns null.
 */
export class LokiLogProvider implements LogProvider {
  private readonly logFields: string[];

  constructor(
    private readonly endpoint: string,
    private readonly defaultLimit: number = 100,
    logFields?: string[],
  ) {
    this.logFields = logFields ?? ['trace_id', 'request_id', 'session_id'];
  }

  async query(input: LogQuery): Promise<LogSummary | null> {
    try {
      const allLines = await this.fetchAllLines(input);
      if (allLines === null) return null;
      return buildLogSummary(allLines);
    } catch {
      return null;
    }
  }

  private async fetchAllLines(input: LogQuery): Promise<LokiLine[] | null> {
    // Build one query per configured field, each with the relevant IDs for that field type.
    // traceIds → trace-related fields, requestIds → request-related fields,
    // sessionIds → session-related fields. Since logFields is a flat list of candidates,
    // we apply each ID type to all configured fields and deduplicate results.
    const idGroups: Array<{ field: string; ids: string[] }> = [];
    const allIds = [
      ...(input.traceIds ?? []),
      ...(input.requestIds ?? []),
      ...(input.sessionIds ?? []),
    ];
    if (allIds.length === 0) return [];

    for (const field of this.logFields) {
      idGroups.push({ field, ids: allIds });
    }

    const seen = new Set<string>();
    const merged: LokiLine[] = [];

    for (const { field, ids } of idGroups) {
      const lines = await this.fetchForField(field, ids, input);
      for (const line of lines) {
        const key = `${line.timestamp}:${line.message}`;
        if (!seen.has(key)) { seen.add(key); merged.push(line); }
      }
    }
    return merged;
  }

  private async fetchForField(field: string, ids: string[], input: LogQuery): Promise<LokiLine[]> {
    try {
      const streamFilters: string[] = [`${field}=~"${ids.join('|')}"`];
      if (input.services?.length) {
        streamFilters.push(`service=~"${input.services.join('|')}"`);
      }
      let logql = `{${streamFilters.join(',')}}`;
      if (input.keywords?.length) {
        logql += ` |~ "${input.keywords.join('|')}"`;
      }

      const params = new URLSearchParams({
        query: logql,
        start: new Date(input.fromTime).getTime().toString() + '000000',
        end: new Date(input.toTime).getTime().toString() + '000000',
        limit: String(input.limit ?? this.defaultLimit),
      });
      const url = `${this.endpoint}/loki/api/v1/query_range?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const body = await res.json() as LokiResponse;
      return extractLines(body);
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Loki response parsing
// ---------------------------------------------------------------------------

interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>; // [nanosecond timestamp, log line]
}

interface LokiResponse {
  data?: {
    result?: LokiStream[];
  };
}

interface LokiLine {
  timestamp: string;
  level?: string;
  service?: string;
  message: string;
}

function extractLines(body: LokiResponse): LokiLine[] {
  const streams = body.data?.result ?? [];
  const lines: LokiLine[] = [];
  for (const stream of streams) {
    const service = stream.stream['service'];
    for (const [ts, line] of stream.values) {
      const level = extractLevel(line);
      lines.push({
        timestamp: new Date(Number(BigInt(ts) / 1_000_000n)).toISOString(),
        ...(level ? { level } : {}),
        ...(service ? { service } : {}),
        message: line,
      });
    }
  }
  return lines;
}

function buildLogSummary(allLines: LokiLine[]): LogSummary {
  const errorSamples = allLines
    .filter(l => l.level === 'error' || l.level === 'ERROR' || /error|exception/i.test(l.message))
    .slice(0, 5);

  const highlights = allLines
    .filter(l => l.level === 'warn' || l.level === 'WARN' || errorSamples.includes(l))
    .slice(0, 10)
    .map(l => l.message);

  return {
    matched: allLines.length > 0,
    totalHits: allLines.length,
    highlights,
    errorSamples,
  };
}

function extractLevel(line: string): string | undefined {
  const m = /\b(ERROR|WARN|INFO|DEBUG|error|warn|info|debug)\b/.exec(line);
  return m?.[1];
}

/**
 * createLogProvider — factory that reads config and returns the appropriate provider.
 */
export function createLogProvider(config: { provider: string; endpoint: string; defaultLimit: number; logFields?: string[] }): LogProvider {
  if (config.provider === 'loki' && config.endpoint) {
    return new LokiLogProvider(config.endpoint, config.defaultLimit, config.logFields);
  }
  return new NullLogProvider();
}
