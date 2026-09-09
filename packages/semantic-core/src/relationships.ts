import type { LifeloopObject } from "./extract.ts";
import type { Store } from "./store.ts";
import { shift } from "./projections.ts";
import { tasks } from "./query.ts";

export type Interaction = {
  ref: string;
  page: string;
  date: string;
  kind: string;
  text: string;
  people: string[];
  offset: number;
};

export type InteractionRow = Omit<Interaction, "offset">;

export type PersonContext = {
  person: LifeloopObject;
  interactions: Interaction[];
  lastInteraction?: Interaction;
  openFollowups: LifeloopObject[];
  cadenceDays?: number;
  reconnectOn?: string;
};

export type ReconnectSignal = {
  person: string;
  kind: "reconnect" | "never-contacted";
  due: string | null;
  lastInteraction?: Interaction;
};

export type PersonRow = {
  person: string;
  groups: string[];
  birthday?: string;
  contactEveryDays?: number;
  lastInteractionDate?: string;
  reconnectOn?: string;
  openFollowups: number;
};

export type ReconnectRow = {
  person: string;
  kind: ReconnectSignal["kind"];
  due: string | null;
  lastInteractionDate?: string;
};

export type PersonContextRow = PersonRow & {
  openFollowupRefs: string[];
  recentInteractions: InteractionRow[];
};

export type BirthdaySignal = {
  person: string;
  birthday: string;
  nextBirthday: string;
  daysUntil: number;
};

export const relationshipDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};

export const pageDate = (page: LifeloopObject): string | null => {
  const journal = String(page.ref).startsWith("Journal/") ||
    (page.itags as string[] | undefined)?.includes("journal");
  if (!journal) return null;
  const declared = relationshipDate(page.date);
  if (declared) return declared;
  const name = String(page.ref).split("/").at(-1);
  return relationshipDate(name);
};

export const cadence = (value: unknown): number | undefined => {
  const match = typeof value === "string" ? /^(\d+)d$/.exec(value.trim()) : null;
  if (!match) return undefined;
  const days = Number(match[1]);
  const probe = new Date("9999-12-31T00:00:00Z");
  probe.setUTCDate(probe.getUTCDate() + days);
  return days > 0 && Number.isSafeInteger(days) && Number.isFinite(probe.getTime())
    ? days : undefined;
};

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());

export const birthday = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return undefined;
  const year = match[1] ?? "2000"; // leap year keeps 02-29 valid as an annual fact
  const date = `${year}-${match[2]}-${match[3]}`;
  return relationshipDate(date) ? raw : undefined;
};

export const nextBirthday = (value: string, from: string): string | undefined => {
  const monthDay = value.slice(-5);
  let year = Number(from.slice(0, 4));
  // A leap-day birthday may need to skip several years; it never moves to Feb 28.
  for (let attempts = 0; attempts < 8; attempts++, year++) {
    const candidate = relationshipDate(`${year}-${monthDay}`);
    if (candidate && candidate >= from) return candidate;
  }
  return undefined;
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function people(store: Store): LifeloopObject[] {
  return store.objects("page").filter((page) =>
    (page.itags as string[] | undefined)?.includes("person"),
  );
}

/** Direct task links are action targets; inherited links are context only. */
export function directPersonLinks(store: Store, task: LifeloopObject): string[] {
  const persons = new Set(people(store).map((person) => String(person.ref)));
  return [...new Set(((task.links as string[] | undefined) ?? []).filter((link) => persons.has(link)))];
}

/** Explicit interaction items with a trustworthy journal date and direct Person links. */
export function interactions(store: Store): Interaction[] {
  const persons = new Set(people(store).map((person) => String(person.ref)));
  const pages = new Map(store.objects("page").map((page) => [String(page.ref), page]));
  const found: Interaction[] = [];
  for (const item of store.objects("item")) {
    if (item.inComment === true || typeof item.interaction !== "string" || !item.interaction.trim()) continue;
    const page = String(item.page ?? "");
    const date = pageDate(pages.get(page) ?? { ref: page, tag: "page" });
    if (!date) continue;
    const linked = ((item.links as string[] | undefined) ?? []).filter((link) => persons.has(link));
    if (!linked.length) continue;
    found.push({
      ref: String(item.ref), page, date,
      kind: item.interaction.trim(), text: String(item.name ?? item.text ?? "").trim(),
      people: [...new Set(linked)],
      offset: (item.range as [number, number] | undefined)?.[0] ?? 0,
    });
  }
  return found.sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
}

export function personContext(store: Store, person: string): PersonContext | null {
  const page = people(store).find((candidate) => candidate.ref === person);
  if (!page) return null;
  const history = interactions(store).filter((entry) => entry.people.includes(person));
  const cadenceDays = cadence(page["contact-every"]);
  const shifted = cadenceDays && history[0] ? shift(history[0].date, cadenceDays) : undefined;
  const reconnectOn = shifted ? relationshipDate(shifted) ?? undefined : undefined;
  return {
    person: page,
    interactions: history,
    lastInteraction: history[0],
    openFollowups: tasks.open(store).filter((task) =>
      ((task.ilinks as string[] | undefined) ?? []).includes(person),
    ),
    cadenceDays,
    ...(reconnectOn ? { reconnectOn } : {}),
  };
}

/** Due relationship work only. Future cadence belongs in Upcoming, not Today. */
export function reconnectSignals(store: Store, date: string): ReconnectSignal[] {
  const activeReconnects = new Set(
    tasks.open(store)
      .filter((task) => task.reconnect === true || task.reconnect === "true")
      .flatMap((task) => (task.ilinks as string[] | undefined) ?? []),
  );
  const signals: ReconnectSignal[] = [];
  for (const person of people(store)) {
    const name = String(person.ref);
    const context = personContext(store, name);
    if (!context?.cadenceDays || activeReconnects.has(name)) continue;
    if (!context.lastInteraction) {
      signals.push({ person: name, kind: "never-contacted", due: null });
    } else if (context.reconnectOn && context.reconnectOn <= date) {
      signals.push({ person: name, kind: "reconnect", due: context.reconnectOn, lastInteraction: context.lastInteraction });
    }
  }
  return signals.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.person.localeCompare(b.person));
}

export function personRows(store: Store): PersonRow[] {
  return people(store).map((person) => {
    const name = String(person.ref);
    const context = personContext(store, name)!;
    const born = birthday(person.birthday);
    return {
      person: name,
      groups: strings(person.groups),
      ...(born ? { birthday: born } : {}),
      ...(context.cadenceDays !== undefined ? { contactEveryDays: context.cadenceDays } : {}),
      ...(context.lastInteraction ? { lastInteractionDate: context.lastInteraction.date } : {}),
      ...(context.reconnectOn ? { reconnectOn: context.reconnectOn } : {}),
      openFollowups: context.openFollowups.length,
    };
  }).sort((a, b) => a.person.localeCompare(b.person));
}

export function interactionRows(
  store: Store,
  filter: { person?: string; from?: string; to?: string; kind?: string } = {},
): InteractionRow[] {
  return interactions(store).filter((entry) =>
    (!filter.person || entry.people.includes(filter.person)) &&
    (!filter.from || entry.date >= filter.from) &&
    (!filter.to || entry.date <= filter.to) &&
    (!filter.kind || entry.kind === filter.kind)
  ).map(({ offset: _offset, ...entry }) => entry);
}

export function reconnectRows(store: Store, date: string): ReconnectRow[] {
  return reconnectSignals(store, date).map((signal) => ({
    person: signal.person,
    kind: signal.kind,
    due: signal.due,
    ...(signal.lastInteraction ? { lastInteractionDate: signal.lastInteraction.date } : {}),
  }));
}

export function personContextRows(store: Store, person: string): PersonContextRow[] {
  const context = personContext(store, person);
  if (!context) return [];
  const row = personRows(store).find((candidate) => candidate.person === person)!;
  return [{
    ...row,
    openFollowupRefs: context.openFollowups.map((task) => String(task.ref)),
    recentInteractions: context.interactions.slice(0, 10).map(({ offset: _offset, ...entry }) => entry),
  }];
}

/** Annual Person facts due from `date` through the configured look-ahead. */
export function birthdaySignals(store: Store, date: string, days: number): BirthdaySignal[] {
  if (!relationshipDate(date) || !Number.isInteger(days) || days < 0) return [];
  const signals: BirthdaySignal[] = [];
  for (const row of personRows(store)) {
    if (!row.birthday) continue;
    const next = nextBirthday(row.birthday, date);
    if (!next) continue;
    const distance = daysBetween(date, next);
    if (distance <= days) {
      signals.push({ person: row.person, birthday: row.birthday, nextBirthday: next, daysUntil: distance });
    }
  }
  return signals.sort((a, b) => a.daysUntil - b.daysUntil || a.person.localeCompare(b.person));
}
