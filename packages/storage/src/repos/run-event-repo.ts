import type { Db } from '../db.js';
import type { RunEventType } from '@zarb/shared-types';

export interface RunEventRow {
  id: string;
  run_id: string;
  entity_type: string;
  entity_id: string;
  event_type: RunEventType;
  payload_schema_version: number;
  payload_json: string | null;
  created_at: string;
}

export interface SaveRunEventInput {
  id: string;
  runId: string;
  entityType: string;
  entityId: string;
  eventType: RunEventType;
  payloadSchemaVersion?: number;
  payloadJson?: string;
  createdAt: string;
}

export interface ListRunEventsFilter {
  /** Opaque cursor: base64-encoded "<createdAt>|<id>" from previous page's last item. */
  cursor?: string;
  limit?: number;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  return { createdAt: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

export class RunEventRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveRunEventInput): void {
    this.db
      .prepare(`
        INSERT INTO run_events (id, run_id, entity_type, entity_id, event_type, payload_schema_version, payload_json, created_at)
        VALUES (@id, @runId, @entityType, @entityId, @eventType, @payloadSchemaVersion, @payloadJson, @createdAt)
      `)
      .run({
        id: input.id,
        runId: input.runId,
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventType,
        payloadSchemaVersion: input.payloadSchemaVersion ?? 1,
        payloadJson: input.payloadJson ?? null,
        createdAt: input.createdAt,
      });
  }

  list(runId: string, filter: ListRunEventsFilter = {}): { items: RunEventRow[]; nextCursor?: string } {
    const limit = filter.limit ?? 50;
    const rows = filter.cursor
      ? (() => {
          const { createdAt, id } = decodeCursor(filter.cursor);
          return this.db
            .prepare(
              `SELECT * FROM run_events
               WHERE run_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
               ORDER BY created_at ASC, id ASC LIMIT ?`,
            )
            .all(runId, createdAt, createdAt, id, limit + 1) as RunEventRow[];
        })()
      : (this.db
          .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`)
          .all(runId, limit + 1) as RunEventRow[]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const result: { items: RunEventRow[]; nextCursor?: string } = { items };
    if (hasMore && last) result.nextCursor = encodeCursor(last.created_at, last.id);
    return result;
  }
}
