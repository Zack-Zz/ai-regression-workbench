import type { Db } from '../db.js';
import type { SystemEventType } from '@zarb/shared-types';

export interface SystemEventRow {
  id: string;
  event_type: SystemEventType;
  payload_schema_version: number;
  payload_json: string | null;
  created_at: string;
}

export interface SaveSystemEventInput {
  id: string;
  eventType: SystemEventType;
  payloadSchemaVersion?: number;
  payloadJson?: string;
  createdAt: string;
}

export class SystemEventRepository {
  constructor(private readonly db: Db) {}

  save(input: SaveSystemEventInput): void {
    this.db
      .prepare(`
        INSERT INTO system_events (id, event_type, payload_schema_version, payload_json, created_at)
        VALUES (@id, @eventType, @payloadSchemaVersion, @payloadJson, @createdAt)
      `)
      .run({
        id: input.id,
        eventType: input.eventType,
        payloadSchemaVersion: input.payloadSchemaVersion ?? 1,
        payloadJson: input.payloadJson ?? null,
        createdAt: input.createdAt,
      });
  }

  list(limit = 50): SystemEventRow[] {
    return this.db
      .prepare('SELECT * FROM system_events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as SystemEventRow[];
  }
}
