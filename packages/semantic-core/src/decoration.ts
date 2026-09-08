import type { Store } from "./store.ts";

/**
 * Page decoration — what a page looks like wherever it is *listed*.
 *
 * Upstream reads `pageDecoration` from frontmatter and applies it in its own tree,
 * its own picker and its own link rendering. We read the same key from the same
 * index, so a vault arriving from SilverBullet is already decorated; where it can
 * be applied is a different question, and an honest answer is shorter than the
 * feature:
 *
 *   prefix       applied — pickers, completions, and as a badge in the Explorer
 *   hide         applied — kept out of pickers and completions
 *   tree.hide    applied — the same, in list surfaces we own
 *   tree.priority applied — ordering in the surfaces we own
 *   icon         no equivalent: Explorer icons come from the user's icon theme
 *   cssClasses   no equivalent: there is no stylesheet to hook into
 *
 * VS Code's own Quick Open cannot be decorated by an extension at all, so a page
 * hidden here is still reachable there. That is stated rather than papered over:
 * `hide` is tidying, never privacy.
 */

export type PageDecoration = {
  prefix?: string;
  icon?: string;
  hide?: boolean;
  cssClasses?: string[];
  tree?: { hide?: boolean; priority?: number };
};

/** Read a decoration off whatever the frontmatter held, ignoring the rest. */
export function decorationOf(value: unknown): PageDecoration | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const tree = raw.tree && typeof raw.tree === "object" ? raw.tree as Record<string, unknown> : {};
  const decoration: PageDecoration = {
    prefix: typeof raw.prefix === "string" ? raw.prefix : undefined,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    hide: raw.hide === true,
    cssClasses: Array.isArray(raw.cssClasses) ? raw.cssClasses.map(String) : undefined,
    tree: {
      hide: tree.hide === true,
      priority: typeof tree.priority === "number" ? tree.priority : 0,
    },
  };
  return decoration;
}

/** Every decorated page in the space, by page name. */
export function decorations(store: Store): Map<string, PageDecoration> {
  const found = new Map<string, PageDecoration>();
  for (const page of store.objects("page")) {
    const decoration = decorationOf(page.pageDecoration);
    if (decoration) found.set(String(page.ref), decoration);
  }
  return found;
}

/** A page's display name — the prefix in front, the name unchanged behind it. */
export function labelFor(page: string, decoration?: PageDecoration): string {
  return decoration?.prefix ? `${decoration.prefix}${page}` : page;
}

export type Listing = "picker" | "tree";

/**
 * Whether a page belongs in a list.
 *
 * `hide` keeps it out of everything; `tree.hide` only out of tree-shaped surfaces,
 * which is upstream's distinction and worth keeping — the two are used for
 * different things, and collapsing them would make one of them useless.
 */
export function visible(decoration: PageDecoration | undefined, listing: Listing): boolean {
  if (!decoration) return true;
  if (decoration.hide) return false;
  return !(listing === "tree" && decoration.tree?.hide);
}

const parent = (page: string) => page.includes("/") ? page.slice(0, page.lastIndexOf("/")) : "";

/**
 * Order pages the way the space tree does.
 *
 * Priority sorts a page against its *siblings* only, higher first, and everything
 * left at the default keeps its alphabetical order among itself. Sorting globally
 * by priority instead would let a number on one page reorder a folder it is not in
 * — which is the bug this rule exists to prevent.
 */
export function ordered(pages: string[], found: Map<string, PageDecoration>): string[] {
  return [...pages].sort((a, b) => {
    if (parent(a) === parent(b)) {
      const priority = (found.get(b)?.tree?.priority ?? 0) - (found.get(a)?.tree?.priority ?? 0);
      if (priority !== 0) return priority;
    }
    return a.localeCompare(b);
  });
}
