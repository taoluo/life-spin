import type { Store } from "./store.ts";

/**
 * Identities, mentions and signatures.
 *
 * All of this is already in the index — `identity` objects, `at-mention`,
 * `authored` and `recipients` relations — because extraction is upstream's and we
 * call it rather than reproduce it. What was missing was everything above the
 * index: nothing completed a name, nothing listed what was addressed to you, and
 * nothing could query it. This file is that layer, and it reads the index only.
 *
 * The two directions matter and are kept apart, as upstream keeps them: `@name` in
 * text **addresses** someone, and `-- @name` ending a block **credits** them.
 * Collapsing them would put every reply into the replier's own inbox.
 */

export type Identity = {
  /** The `@name` identifier, `@` included. */
  ref: string;
  /** The bare name. */
  name: string;
  description?: string;
  /** How many times it has been mentioned — used only to order completions. */
  mentions: number;
};

export type Mention = {
  /** The identity addressed, `@` included. */
  to: string;
  page: string;
  /** The object the mention sits in — a task, an item, or the page. */
  from: string;
  fromTag: string;
  snippet: string;
  /** Character offset of the `@name` in the page, when the index recorded one. */
  pos?: number;
};

const relations = (store: Store, kind: string) =>
  store.objects("relation").filter((r) => r.kind === kind);

/**
 * Every identity the space knows.
 *
 * Any name is a valid mention and nothing needs declaring, so the list is built
 * from what has actually been written down — plus whatever `identity.define`
 * contributed, which the caller passes in because reading a declaration means
 * running the block that declares it, and that is a setting we do not own here.
 */
export function identities(store: Store, defined: { name: string; description?: string }[] = []): Identity[] {
  const counts = new Map<string, number>();
  for (const relation of relations(store, "at-mention")) {
    const to = String(relation.to ?? "");
    if (to) counts.set(to, (counts.get(to) ?? 0) + 1);
  }

  const byRef = new Map<string, Identity>();
  for (const object of store.objects("identity")) {
    const ref = String(object.ref);
    byRef.set(ref, {
      ref,
      name: String(object.name ?? ref.replace(/^@/, "")),
      mentions: counts.get(ref) ?? 0,
    });
  }
  for (const declared of defined) {
    const ref = `@${declared.name}`;
    const existing = byRef.get(ref);
    if (existing) existing.description = declared.description;
    else byRef.set(ref, { ref, name: declared.name, description: declared.description, mentions: 0 });
  }

  // Most-mentioned first: the name you use every day should not be the fifth
  // suggestion. Ties are alphabetical so the list does not shuffle between runs.
  return [...byRef.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

function mentionOf(relation: Record<string, unknown>): Mention {
  const range = relation.range as number[] | undefined;
  return {
    to: String(relation.to ?? ""),
    page: String(relation.page ?? ""),
    from: String(relation.from ?? ""),
    fromTag: String(relation.fromTag ?? "page"),
    snippet: String(relation.snippet ?? "").trim(),
    pos: Array.isArray(range) ? range[0] : undefined,
  };
}

/** Every `@name` addressed to `to`, in page order. */
export function mentions(store: Store, to?: string): Mention[] {
  const wanted = to ? (to.startsWith("@") ? to : `@${to}`) : undefined;
  return relations(store, "at-mention")
    .filter((r) => !wanted || r.to === wanted)
    .map(mentionOf)
    .sort((a, b) => a.page.localeCompare(b.page) || (a.pos ?? 0) - (b.pos ?? 0));
}

/** Every `-- @name` signature crediting `to`. */
export function authored(store: Store, to?: string): Mention[] {
  const wanted = to ? (to.startsWith("@") ? to : `@${to}`) : undefined;
  return relations(store, "authored")
    .filter((r) => !wanted || r.to === wanted)
    .map(mentionOf);
}

/**
 * The mentions still asking something of you.
 *
 * A mention on a task that is done has been dealt with, so it drops out — that is
 * our reading, and it is stated here rather than buried, because upstream's
 * "open mentions" is defined by its own inbox UI and we do not have that UI to
 * point at. Everything else stays: a mention in a paragraph has no completion
 * state, and guessing one would quietly hide requests.
 */
export function openMentions(store: Store, to: string): Mention[] {
  const done = new Set(
    store.objects("task").filter((t) => t.done === true).map((t) => String(t.ref)),
  );
  return mentions(store, to).filter((m) => !done.has(m.from));
}

/** Mentions grouped by the page they were written on, pages in name order. */
export function byPage(list: Mention[]): { page: string; mentions: Mention[] }[] {
  const groups = new Map<string, Mention[]>();
  for (const mention of list) {
    const existing = groups.get(mention.page);
    if (existing) existing.push(mention);
    else groups.set(mention.page, [mention]);
  }
  return [...groups.entries()]
    .map(([page, mentions]) => ({ page, mentions }))
    .sort((a, b) => a.page.localeCompare(b.page));
}
