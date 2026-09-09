import { originalSourceOffset } from "@lifeloop/semantic-core";
import { parseMarkdown } from "../../../vendor/silverbullet/client/markdown_parser/parser.ts";
import { collectNodesOfType, findNodeOfType } from "../../../vendor/silverbullet/plug-api/lib/tree.ts";

export type QueryToken = { text: string; from: number; to: number };
export type QueryOption = { key: QueryToken; value: QueryToken; fields: QueryToken[] };
export type LocatedQuery = {
  projection?: QueryToken;
  options: QueryOption[];
  malformed: QueryToken[];
};
export type LocatedQueryFence = {
  language: "lifeloop" | "query";
  marker: "`" | "~";
  markerLength: number;
  source: string;
  bodyFrom: number;
  bodyTo: number;
  openLine: number;
  closeLine: number;
  closeLength: number;
  query: LocatedQuery;
};

type Line = { text: string; from: number; to: number; next: number; line: number };

function lines(source: string, base = 0): Line[] {
  const found: Line[] = [];
  let from = 0;
  let line = 0;
  while (from <= source.length) {
    const newline = source.indexOf("\n", from);
    const next = newline === -1 ? source.length : newline + 1;
    let to = newline === -1 ? source.length : newline;
    if (to > from && source[to - 1] === "\r") to--;
    found.push({ text: source.slice(from, to), from: base + from, to: base + to, next: base + next, line });
    if (newline === -1) break;
    from = next;
    line++;
  }
  return found;
}

const token = (text: string, from: number): QueryToken => ({ text, from, to: from + text.length });

/** Parse the tiny query-block syntax while retaining exact UTF-16 offsets. */
export function parseLocatedQuery(source: string, base = 0): LocatedQuery {
  const meaningful = lines(source, base).filter((line) => line.text.trim().length > 0);
  if (!meaningful.length) return { options: [], malformed: [] };

  const head = meaningful[0];
  const headIndent = head.text.search(/\S/);
  const projectionText = head.text.slice(headIndent).split(/\s+/)[0];
  const projection = token(projectionText, head.from + headIndent);
  const options: QueryOption[] = [];
  const malformed: QueryToken[] = [];

  for (const line of meaningful.slice(1)) {
    const match = /^(\s*)([A-Za-z]+)\s*:(\s*)(.*?)(\s*)$/.exec(line.text);
    if (!match) {
      const start = line.text.search(/\S/);
      const text = line.text.trim();
      malformed.push(token(text, line.from + Math.max(0, start)));
      continue;
    }
    const keyFrom = line.from + match[1].length;
    const colon = line.text.indexOf(":", match[1].length + match[2].length);
    const valueFrom = line.from + colon + 1 + match[3].length;
    const value = token(match[4], valueFrom);
    const fields: QueryToken[] = [];
    let cursor = 0;
    for (const part of match[4].split(",")) {
      const leading = part.search(/\S|$/);
      const text = part.trim();
      if (text) fields.push(token(text, valueFrom + cursor + leading));
      cursor += part.length + 1;
    }
    options.push({ key: token(match[2], keyFrom), value, fields });
  }
  return { projection, options, malformed };
}

/** Recognized query fences, including an unfinished final block for completion. */
export function findLocatedQueryFences(source: string): LocatedQueryFence[] {
  const sourceLines = lines(source);
  const found: LocatedQueryFence[] = [];
  for (const fence of collectNodesOfType(parseMarkdown(source), "FencedCode")) {
    const info = findNodeOfType(fence, "CodeInfo")?.children?.[0].text ?? "";
    const language = /^(lifeloop|query)(?:[ \t].*)?$/.exec(info)?.[1] as "lifeloop" | "query" | undefined;
    if (!language) continue;
    const marks = fence.children?.filter((child) => child.type === "CodeMark") ?? [];
    const opening = marks[0]?.children?.[0].text ?? "";
    if (!/^(`{3,}|~{3,})$/.test(opening)) continue;
    const marker = opening[0] as "`" | "~";
    const markerLength = opening.length;
    const openOffset = originalSourceOffset(source, fence.from ?? 0);
    const open = sourceLines.find((line) => openOffset >= line.from && openOffset <= line.to)!;
    const closing = marks[1];
    const closeOffset = closing ? originalSourceOffset(source, closing.from ?? source.length) : source.length;
    const close = closing
      ? sourceLines.find((line) => closeOffset >= line.from && closeOffset <= line.to)!
      : sourceLines.at(-1)!;
    const bodyFrom = open.next;
    const bodyTo = closing ? close.from : source.length;
    const body = source.slice(bodyFrom, bodyTo).replace(/\r?\n$/, "");
    found.push({
      language,
      marker,
      markerLength,
      source: body,
      bodyFrom,
      bodyTo,
      openLine: open.line,
      closeLine: close.line,
      closeLength: close.text.length,
      query: parseLocatedQuery(body, bodyFrom),
    });
  }
  return found;
}
