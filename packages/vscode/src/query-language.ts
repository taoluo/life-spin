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
  for (let i = 0; i < sourceLines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})(lifeloop|query)(?:[ \t].*)?$/.exec(sourceLines[i].text);
    if (!open) continue;
    const marker = open[1][0] as "`" | "~";
    const markerLength = open[1].length;
    let close = i + 1;
    for (; close < sourceLines.length; close++) {
      const candidate = /^\s*(`+|~+)\s*$/.exec(sourceLines[close].text);
      if (candidate && candidate[1][0] === marker && candidate[1].length >= markerLength) break;
    }
    const closed = close < sourceLines.length;
    const bodyFrom = sourceLines[i].next;
    const bodyTo = closed ? sourceLines[close].from : source.length;
    const body = source.slice(bodyFrom, bodyTo).replace(/\r?\n$/, "");
    found.push({
      language: open[2] as "lifeloop" | "query",
      marker,
      markerLength,
      source: body,
      bodyFrom,
      bodyTo,
      openLine: sourceLines[i].line,
      closeLine: closed ? sourceLines[close].line : sourceLines.at(-1)!.line,
      closeLength: closed ? sourceLines[close].text.length : sourceLines.at(-1)!.text.length,
      query: parseLocatedQuery(body, bodyFrom),
    });
    if (closed) i = close;
    else break;
  }
  return found;
}
