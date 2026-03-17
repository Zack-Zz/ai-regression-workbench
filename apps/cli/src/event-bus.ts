import { EventEmitter } from 'node:events';
import type { SSEEvent } from '@zarb/shared-types';

class EventBus extends EventEmitter {}
const bus = new EventBus();
bus.setMaxListeners(100); // allow many SSE connections

export function emitEvent(event: { type: SSEEvent['type']; id?: string; projectId?: string }): void {
  const full: SSEEvent = { ...event, ts: Date.now() };
  bus.emit('sse', full);
  // Keep a rolling buffer of last 100 events for Last-Event-ID replay
  _buffer.push(full);
  if (_buffer.length > 100) _buffer.shift();
}

export const _buffer: SSEEvent[] = [];
export { bus as eventBus };
