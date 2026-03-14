import type { RunEventItem, RunEventPage, RunEventsQuery } from '@zarb/shared-types';
import type { Db, RunEventRow } from '@zarb/storage';
import { RunEventRepository } from '@zarb/storage';
import type { SaveRunEventInput } from '@zarb/storage';

export type { SaveRunEventInput };

function toItem(r: RunEventRow): RunEventItem {
  const item: RunEventItem = {
    eventId: r.id,
    runId: r.run_id,
    eventType: r.event_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    payloadSchemaVersion: r.payload_schema_version,
    createdAt: r.created_at,
  };
  if (r.payload_json) item.payload = JSON.parse(r.payload_json) as Record<string, unknown>;
  return item;
}

export class RunEventWriter {
  private readonly repo: RunEventRepository;
  constructor(db: Db) { this.repo = new RunEventRepository(db); }
  append(input: SaveRunEventInput): void { this.repo.save(input); }
}

export class RunEventReader {
  private readonly repo: RunEventRepository;
  constructor(db: Db) { this.repo = new RunEventRepository(db); }

  list(runId: string, query: RunEventsQuery = {}): RunEventPage {
    const { items, nextCursor } = this.repo.list(runId, query);
    const page: RunEventPage = { items: items.map(toItem) };
    if (nextCursor) page.nextCursor = nextCursor;
    return page;
  }
}
