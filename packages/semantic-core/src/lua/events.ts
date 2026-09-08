/**
 * Events, a job queue, and custom syntax — the last three host APIs.
 *
 * Each is a *registry* plus a way to drive it, kept apart on purpose: declaring a
 * listener is data, and firing one is an action a client decides to take. That
 * split is what lets the same code run headlessly in a test and in an editor.
 */

export type EventListener = { name: string; run: unknown };
export type QueueSubscription = { queue: string; batchSize: number; run: unknown };

/**
 * Custom syntax a vault declares.
 *
 * SilverBullet uses this for two things at once — highlighting a span, and
 * rendering it inline. VS Code separates them: highlighting is semantic tokens at
 * runtime, and rendering is the Markdown preview. Both halves come from the same
 * declaration, so a vault writes it once.
 */
export type SyntaxSpec = {
  name: string;
  startMarker: string;
  endMarker: string;
  mode: "inline" | "block";
  /** Rendered content, when the declaration supplies a renderer. */
  render?: unknown;
};

export type Registries = {
  events: EventListener[];
  queues: QueueSubscription[];
  syntax: SyntaxSpec[];
};

export const emptyRegistries = (): Registries => ({ events: [], queues: [], syntax: [] });

/**
 * Where a script's `event.listen` name maps onto something we actually have.
 *
 * SilverBullet's event names are kept rather than renamed, so a vault's scripts
 * do not have to be edited — but only the ones with a real counterpart fire.
 * Anything else is accepted and never called, which is honest: the listener
 * exists, the event does not.
 */
export const SUPPORTED_EVENTS = new Set([
  "page:index",
  "editor:pageLoaded",
  "editor:pageSaved",
  "file:changed",
  "cron:secondPassed",
]);

export function unsupportedEvents(registries: Registries): string[] {
  return [...new Set(registries.events.map((e) => e.name))]
    .filter((name) => !SUPPORTED_EVENTS.has(name))
    .sort();
}

/**
 * A minimal message queue.
 *
 * `mq.send` puts a message on a named queue, `mq.subscribe` declares who reads it,
 * and a client drains it. In memory and not durable: everything a script can do is
 * read-only, so a message lost on restart cannot lose work — the queue is a way to
 * defer, not a place to keep anything.
 */
export class MessageQueue {
  private readonly queues = new Map<string, unknown[]>();

  send(queue: string, body: unknown): void {
    const existing = this.queues.get(queue);
    if (existing) existing.push(body);
    else this.queues.set(queue, [body]);
  }

  depth(queue: string): number {
    return this.queues.get(queue)?.length ?? 0;
  }

  /** Take up to `batchSize` messages. They are removed whether or not the run succeeds. */
  take(queue: string, batchSize: number): unknown[] {
    const pending = this.queues.get(queue);
    if (!pending?.length) return [];
    return pending.splice(0, Math.max(1, batchSize));
  }

  queueNames(): string[] {
    return [...this.queues.keys()].sort();
  }
}

/**
 * Find every span a custom syntax matches.
 *
 * The markers are regular expressions written for SilverBullet, and they are used
 * as given. A broken one is reported rather than throwing, because it arrived in
 * a note and a note must not be able to break the editor.
 */
export type SyntaxMatch = { spec: SyntaxSpec; from: number; to: number; body: string };

export function findSyntaxMatches(
  text: string,
  specs: SyntaxSpec[],
): { matches: SyntaxMatch[]; errors: { name: string; error: string }[] } {
  const matches: SyntaxMatch[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const spec of specs) {
    let start: RegExp;
    let end: RegExp;
    try {
      const flags = spec.mode === "block" ? "gm" : "g";
      start = new RegExp(spec.startMarker, flags);
      end = new RegExp(spec.endMarker, flags);
    } catch (error) {
      errors.push({ name: spec.name, error: (error as Error).message });
      continue;
    }

    let cursor = 0;
    for (;;) {
      start.lastIndex = cursor;
      const opened = start.exec(text);
      if (!opened) break;

      end.lastIndex = opened.index + opened[0].length;
      const closed = end.exec(text);
      if (!closed) break;

      matches.push({
        spec,
        from: opened.index,
        to: closed.index + closed[0].length,
        body: text.slice(opened.index + opened[0].length, closed.index),
      });
      cursor = closed.index + closed[0].length;
    }
  }

  // Sorted and de-overlapped: two declarations can match the same span, and
  // highlighting one region twice produces tokens an editor cannot place.
  matches.sort((a, b) => a.from - b.from);
  const kept: SyntaxMatch[] = [];
  let end = -1;
  for (const match of matches) {
    if (match.from >= end) {
      kept.push(match);
      end = match.to;
    }
  }
  return { matches: kept, errors };
}
