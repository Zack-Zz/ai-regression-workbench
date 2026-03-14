import type { SystemEventRecord } from '@zarb/shared-types';
import type { Db, SystemEventRow } from '@zarb/storage';
import { SystemEventRepository } from '@zarb/storage';
import type { SaveSystemEventInput } from '@zarb/storage';

export type { SaveSystemEventInput };

function toRecord(r: SystemEventRow): SystemEventRecord {
  const rec: SystemEventRecord = {
    id: r.id,
    eventType: r.event_type,
    payloadSchemaVersion: r.payload_schema_version,
    createdAt: r.created_at,
  };
  if (r.payload_json) rec.payloadJson = r.payload_json;
  return rec;
}

export class SystemEventWriter {
  private readonly repo: SystemEventRepository;
  constructor(db: Db) { this.repo = new SystemEventRepository(db); }
  append(input: SaveSystemEventInput): void { this.repo.save(input); }
  list(limit?: number): SystemEventRecord[] { return this.repo.list(limit).map(toRecord); }
}
