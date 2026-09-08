import type { PageMeta } from "../../../vendor/silverbullet/plug-api/types/index.ts";
import { indexMarkdown } from "../../../vendor/silverbullet/plugs/index/indexer.ts";
import { extractFrontMatter } from "../../../vendor/silverbullet/plugs/index/frontmatter.ts";
import { updateITags } from "../../../vendor/silverbullet/plugs/index/tags.ts";
import { parseMarkdown } from "../../../vendor/silverbullet/client/markdown_parser/parser.ts";
import { installSyscalls, setPathLookup, type PathLookup } from "./compat/syscalls.ts";

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
): Promise<LifeloopObject[]> {
  installSyscalls();
  if (lookup) setPathLookup(lookup);
  const objects = (await indexMarkdown(text, meta)) as unknown as LifeloopObject[];
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

// `parseMarkdown` is async in the syscall surface but synchronous underneath.
const parseMarkdownSync = (text: string) => parseMarkdown(text);
