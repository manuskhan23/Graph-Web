/**
 * Central event bus. Every subsystem publishes here; SSE, the activity log and
 * the notification centre subscribe. Keeps long-running work decoupled from HTTP.
 */
import type { NexusEvent, NexusEventType } from '../types.js';

export type EventListener = (event: NexusEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();
  private counter = 0;
  private buffer: NexusEvent[] = [];
  private readonly bufferSize: number;

  constructor(bufferSize = 250) {
    this.bufferSize = bufferSize;
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replay recent events so a reconnecting client does not lose history. */
  replay(sinceId = 0): NexusEvent[] {
    return this.buffer.filter((e) => e.id > sinceId);
  }

  emit(
    type: NexusEventType,
    message: string,
    data: Record<string, unknown> = {},
    context: { taskId?: string | null; projectId?: string | null } = {},
  ): NexusEvent {
    const event: NexusEvent = {
      id: ++this.counter,
      type,
      at: Date.now(),
      taskId: context.taskId ?? null,
      projectId: context.projectId ?? null,
      message,
      data,
    };
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // A broken listener must never break the emitter.
        console.error('[nexus][events] listener failed:', err);
      }
    }
    return event;
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

/** Process-wide bus. Tests create isolated buses instead. */
export const eventBus = new EventBus();
