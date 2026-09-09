import type { PageMeta } from "../../../vendor/silverbullet/plug-api/types/index.ts";
import { indexMarkdown } from "../../../vendor/silverbullet/plugs/index/indexer.ts";
import { extractFrontMatter } from "../../../vendor/silverbullet/plugs/index/frontmatter.ts";
import { commentedRange, updateITags } from "../../../vendor/silverbullet/plugs/index/tags.ts";
import { extractItemFromNode } from "../../../vendor/silverbullet/plugs/index/item.ts";
import { parseMarkdown } from "../../../vendor/silverbullet/client/markdown_parser/parser.ts";
import { traverseTree } from "../../../vendor/silverbullet/plug-api/lib/tree.ts";
import { installSyscalls, setPathLookup, withExtractionConfig, type PathLookup } from "./compat/syscalls.ts";

import { DEFAULT_CYCLE, validateTaskStates, type CycleStates } from "./mutations/tasks.ts";

export type LifeloopObject = {
  ref: string;
  tag: string;
  page?: string;
  itags?: string[];
  range?: [number, number];
  inComment?: boolean;
  [key: string]: unknown;
};

/** Bare file metadata, the shape SilverBullet's own `fileMetaToPageMeta` produces. */
export function pageMetaFor(name: string, lastModified = "", created = ""): PageMeta {
  return { ref: name, name, tag: "page", perm: "rw", lastModified, created };
}

/**
 * Markdown in, objects out. The orchestration — indexer order, comment marking,
 * anchor records, recipient stamping — is SilverBullet's own `indexMarkdown`,
 * called rather than reproduced, so there is nothing here to drift.
 *
 * Note this returns everything *except* the page object itself: `indexMarkdown`
 * filters `pageIndexPage` out, because the caller knows the page metadata already.
 */
export async function extractObjects(
  text: string,
  meta: PageMeta,
  lookup?: PathLookup,
  taskStates?: CycleStates,
): Promise<LifeloopObject[]> {
  installSyscalls();
  if (lookup) setPathLookup(lookup);
  if (taskStates) validateTaskStates(taskStates);
  const configuration = taskStates === undefined ? {} : {
    taskStates: Object.fromEntries(taskStates.map(s => [s.state, { name: s.state, done: s.done === true }])),
  };
  const objects = (await withExtractionConfig(configuration, () => indexMarkdown(text, meta))) as unknown as LifeloopObject[];
  return [pageObject(text, meta), ...objects];
}

/**
 * The page object itself.
 *
 * `indexMarkdown` deliberately omits it — upstream's `pageIndexPage` also prunes
 * aspiring-page records through syscalls, which is index maintenance our store
 * does natively. So the *assembly* is reproduced here (the one Tier 1 thing that
 * is, recorded in COMPATIBILITY.md) while the subtle half — inherited tags — stays
 * upstream's `updateITags`.
 *
 * The ordering of the spread is upstream's and matters: page metadata appears at
 * both ends so real file facts like `name` and `lastModified` cannot be overridden
 * by frontmatter claiming to set them.
 */
export function pageObject(text: string, meta: PageMeta): LifeloopObject {
  const frontmatter = extractFrontMatter(parseMarkdownSync(text));
  const combined: any = { ...meta, ...frontmatter, ...meta };
  combined.tags = [...new Set(frontmatter.tags ?? [])];
  combined.tag = "page";
  if (combined.aliases && !Array.isArray(combined.aliases)) combined.aliases = [];
  updateITags(combined, frontmatter);
  return combined as LifeloopObject;
}

/** Parse current editor text into SilverBullet item/task objects without indexing it. */
export function extractLiveItems(
  text: string,
  meta: PageMeta,
  taskStates: CycleStates = DEFAULT_CYCLE,
): LifeloopObject[] {
  validateTaskStates(taskStates);
  const tree = parseMarkdownSync(text);
  const frontmatter = extractFrontMatter(tree);
  const complete = ["x", "X", ...taskStates.filter((state) => state.done).map((state) => state.state)];
  const cache = new Map<number, ReturnType<typeof extractItemFromNode>>();
  const items: LifeloopObject[] = [];
  traverseTree(tree, (node) => {
    if (node.type !== "ListItem") return false;
    const item = extractItemFromNode(
      meta.name, node, frontmatter, true, complete, cache, meta.lastModified,
    ) as unknown as LifeloopObject;
    items.push(commentedRange(node) ? { ...item, inComment: true } : item);
    return false;
  }, true);
  return items;
}

// `parseMarkdown` is async in the syscall surface but synchronous underneath.
const parseMarkdownSync = (text: string) => parseMarkdown(text);
