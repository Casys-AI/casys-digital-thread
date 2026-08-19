/**
 * Fail-closed lexical guard for the architecture SysML closed subset.
 *
 * The subset is locked to the three server-rendered write forms: a package
 * block, a part definition that is empty or a block, and `part usage : Type;`.
 * This tokenizer never accepts comments, strings, numbers, attributes, or any
 * other byte sequence. Rejection is explicit; an unrecognized character is
 * never skipped.
 *
 * WHY THIS EXISTS — agent-authored SysML is untrusted text. The later parser
 * may only see tokens this guard admits. A regex allowlist would silently
 * accept comments or attributes. The renderer remains the authority for
 * `model.write-architecture@1`; this module only bounds what Digital Thread
 * will tokenize.
 */

import type {
  SourceAnalysisLocation,
  SourceAnalysisSpan,
} from "../../compile/source/source-analysis.ts";

export const MAX_ARCHITECTURE_SYSML_SOURCE_BYTES = 262_144;

export type ArchitectureSysmlLexicalErrorCode =
  | "empty_source"
  | "source_too_large"
  | "unrecognized_token"
  | "comment_not_qualified"
  | "string_not_qualified"
  | "number_not_qualified"
  | "attribute_not_qualified";

export class ArchitectureSysmlLexicalError extends Error {
  constructor(
    readonly code: ArchitectureSysmlLexicalErrorCode,
    message: string,
    readonly span?: SourceAnalysisSpan,
  ) {
    super(message);
    this.name = "ArchitectureSysmlLexicalError";
  }
}

export type ArchitectureSysmlTokenKind =
  | "keyword"
  | "identifier"
  | "lbrace"
  | "rbrace"
  | "colon"
  | "semicolon";

export interface ArchitectureSysmlToken {
  readonly kind: ArchitectureSysmlTokenKind;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly span: SourceAnalysisSpan;
}

const KEYWORDS = new Set(["package", "part", "def"]);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Tokenize one exact UTF-8 architecture SysML source. Fail closed on any
 * character that is not a subset keyword, identifier, `{`, `}`, `:`, `;`, or
 * ASCII whitespace.
 */
export function tokenizeArchitectureSysml(
  sourceText: string,
): readonly ArchitectureSysmlToken[] {
  if (typeof sourceText !== "string") {
    throw new ArchitectureSysmlLexicalError(
      "empty_source",
      "Architecture SysML source must be a string.",
    );
  }
  const bytes = new TextEncoder().encode(sourceText);
  if (bytes.byteLength > MAX_ARCHITECTURE_SYSML_SOURCE_BYTES) {
    throw new ArchitectureSysmlLexicalError(
      "source_too_large",
      `Architecture SysML source is ${bytes.byteLength} UTF-8 bytes; the closed subset permits at most ${MAX_ARCHITECTURE_SYSML_SOURCE_BYTES}.`,
    );
  }

  const positions = new SourcePositions(sourceText);
  const tokens: ArchitectureSysmlToken[] = [];
  let index = 0;

  while (index < sourceText.length) {
    const char = sourceText[index]!;
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (
      char === "/" && (sourceText[index + 1] === "/" || sourceText[index + 1] === "*")
    ) {
      throw lexical(
        "comment_not_qualified",
        "Comments are not qualified in the architecture SysML closed subset.",
        positions,
        index,
        index + 2,
      );
    }
    if (char === "-" && sourceText[index + 1] === "-") {
      throw lexical(
        "comment_not_qualified",
        "Comments are not qualified in the architecture SysML closed subset.",
        positions,
        index,
        index + 2,
      );
    }
    if (char === "#") {
      throw lexical(
        "comment_not_qualified",
        "Comments are not qualified in the architecture SysML closed subset.",
        positions,
        index,
        index + 1,
      );
    }
    if (char === '"' || char === "'") {
      throw lexical(
        "string_not_qualified",
        "String literals are not qualified in the architecture SysML closed subset.",
        positions,
        index,
        index + 1,
      );
    }
    if (char === "@") {
      throw lexical(
        "attribute_not_qualified",
        "Attributes are not qualified in the architecture SysML closed subset.",
        positions,
        index,
        index + 1,
      );
    }
    if (isDigit(char)) {
      const end = consumeWhile(
        sourceText,
        index,
        (value) => isDigit(value) || value === "." || value === "_",
      );
      throw lexical(
        "number_not_qualified",
        "Numeric literals are not qualified in the architecture SysML closed subset.",
        positions,
        index,
        end,
      );
    }
    if (char === "{") {
      tokens.push(punct("lbrace", char, index, positions));
      index += 1;
      continue;
    }
    if (char === "}") {
      tokens.push(punct("rbrace", char, index, positions));
      index += 1;
      continue;
    }
    if (char === ":") {
      tokens.push(punct("colon", char, index, positions));
      index += 1;
      continue;
    }
    if (char === ";") {
      tokens.push(punct("semicolon", char, index, positions));
      index += 1;
      continue;
    }
    if (isLetter(char)) {
      const end = consumeWhile(
        sourceText,
        index,
        (value) => isLetter(value) || isDigit(value) || value === "_",
      );
      const text = sourceText.slice(index, end);
      if (!IDENTIFIER.test(text)) {
        throw lexical(
          "unrecognized_token",
          "Architecture SysML identifiers must match ^[A-Za-z][A-Za-z0-9_]*$.",
          positions,
          index,
          end,
        );
      }
      tokens.push({
        kind: KEYWORDS.has(text) ? "keyword" : "identifier",
        text,
        from: index,
        to: end,
        span: positions.span(index, end),
      });
      index = end;
      continue;
    }
    throw lexical(
      "unrecognized_token",
      "The architecture SysML lexical guard rejected an unrecognized character.",
      positions,
      index,
      index + 1,
    );
  }

  if (tokens.length === 0) {
    throw new ArchitectureSysmlLexicalError(
      "empty_source",
      "Architecture SysML source contains no closed-subset tokens.",
      positions.span(0, 0),
    );
  }
  return Object.freeze(tokens.map((token) => Object.freeze(token)));
}

export function architectureSysmlTokenSpan(
  sourceText: string,
  from: number,
  to: number,
): SourceAnalysisSpan {
  return new SourcePositions(sourceText).span(from, to);
}

function punct(
  kind: Exclude<ArchitectureSysmlTokenKind, "keyword" | "identifier">,
  text: string,
  index: number,
  positions: SourcePositions,
): ArchitectureSysmlToken {
  return {
    kind,
    text,
    from: index,
    to: index + 1,
    span: positions.span(index, index + 1),
  };
}

function lexical(
  code: ArchitectureSysmlLexicalErrorCode,
  message: string,
  positions: SourcePositions,
  from: number,
  to: number,
): ArchitectureSysmlLexicalError {
  return new ArchitectureSysmlLexicalError(code, message, positions.span(from, to));
}

function consumeWhile(
  sourceText: string,
  start: number,
  predicate: (char: string) => boolean,
): number {
  let index = start;
  while (index < sourceText.length && predicate(sourceText[index]!)) index += 1;
  return index;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isLetter(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

class SourcePositions {
  readonly #lineStarts: readonly number[];

  constructor(sourceText: string) {
    const starts = [0];
    for (let index = 0; index < sourceText.length; index++) {
      if (sourceText[index] === "\n") starts.push(index + 1);
    }
    this.#lineStarts = starts;
  }

  span(from: number, to: number): SourceAnalysisSpan {
    return { start: this.location(from), end: this.location(to) };
  }

  location(offset: number): SourceAnalysisLocation {
    let low = 0;
    let high = this.#lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.#lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - this.#lineStarts[low]! };
  }
}
