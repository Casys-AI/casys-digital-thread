/**
 * Fail-closed lexical guard for the generic Modelica closed subset v2.
 *
 * The subset is locked to the LinearThermalRamp kit form: one root `model`,
 * scalar `parameter Real` / `output Real` declarations, and a single
 * `equation` section of `der(id) = expr` or `id = expr`. This tokenizer
 * admits only that vocabulary. An unrecognized character is never skipped.
 *
 * Line comments, block comments, and double-quoted strings are admitted
 * because the kit source carries a description string; they are not authority.
 *
 * WHY THIS EXISTS — agent-authored Modelica is untrusted text. The later
 * parser may only see tokens this guard admits. If the subset grows beyond
 * about fifteen forms, migrate to tree-sitter-modelica WASM rather than
 * stretching this hand-written guard.
 */

/** Structurally compatible with source-analysis spans without importing it. */
export interface SourceAnalysisLocation {
  readonly line: number;
  readonly column: number;
}
export interface SourceAnalysisSpan {
  readonly start: SourceAnalysisLocation;
  readonly end: SourceAnalysisLocation;
}

export type ModelicaLexicalErrorCode =
  | "unrecognized_token"
  | "unclosed_string"
  | "unclosed_comment";

export class ModelicaLexicalError extends Error {
  constructor(
    readonly code: ModelicaLexicalErrorCode,
    message: string,
    readonly span?: SourceAnalysisSpan,
  ) {
    super(message);
    this.name = "ModelicaLexicalError";
  }
}

export type ModelicaTokenKind =
  | "keyword"
  | "identifier"
  | "number"
  | "string"
  | "equal"
  | "semicolon"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "dot"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "lt"
  | "gt";

export interface ModelicaToken {
  readonly kind: ModelicaTokenKind;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly span: SourceAnalysisSpan;
}

const KEYWORDS = new Set([
  "model",
  "end",
  "parameter",
  "output",
  "Real",
  "equation",
  "der",
  "true",
  "false",
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PUNCTUATION = new Map<
  string,
  Exclude<ModelicaTokenKind, "keyword" | "identifier" | "number" | "string">
>([
  ["=", "equal"],
  [";", "semicolon"],
  ["(", "lparen"],
  [")", "rparen"],
  ["[", "lbracket"],
  ["]", "rbracket"],
  [",", "comma"],
  [".", "dot"],
  ["+", "plus"],
  ["-", "minus"],
  ["*", "star"],
  ["/", "slash"],
  ["<", "lt"],
  [">", "gt"],
]);

/**
 * Tokenize one exact UTF-8 Modelica source. Fail closed on any character
 * outside the v1 vocabulary. Empty and whitespace-only sources yield no
 * tokens; the parser reports `modelica-missing-model-block`.
 *
 * Brackets are tokenized so the parser can emit `modelica-array-declaration`
 * instead of collapsing `[n]` into a lexical error.
 */
export function tokenizeModelicaSubset(
  sourceText: string,
): readonly ModelicaToken[] {
  if (typeof sourceText !== "string") {
    throw new ModelicaLexicalError(
      "unrecognized_token",
      "Modelica source must be a string.",
    );
  }

  const positions = new SourcePositions(sourceText);
  const tokens: ModelicaToken[] = [];
  let index = 0;

  while (index < sourceText.length) {
    const char = sourceText[index]!;
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && sourceText[index + 1] === "/") {
      index = consumeLineComment(sourceText, index);
      continue;
    }
    if (char === "/" && sourceText[index + 1] === "*") {
      index = consumeBlockComment(sourceText, index, positions);
      continue;
    }
    if (char === '"') {
      const token = consumeString(sourceText, index, positions);
      tokens.push(token);
      index = token.to;
      continue;
    }
    if (isDigit(char) || (char === "." && isDigit(sourceText[index + 1] ?? ""))) {
      const end = consumeNumber(sourceText, index);
      tokens.push({
        kind: "number",
        text: sourceText.slice(index, end),
        from: index,
        to: end,
        span: positions.span(index, end),
      });
      index = end;
      continue;
    }
    const punct = PUNCTUATION.get(char);
    if (punct !== undefined) {
      tokens.push(punctuate(punct, char, index, positions));
      index += 1;
      continue;
    }
    if (isIdentifierStart(char)) {
      const end = consumeWhile(
        sourceText,
        index,
        (value) => isIdentifierStart(value) || isDigit(value),
      );
      const text = sourceText.slice(index, end);
      if (!IDENTIFIER.test(text)) {
        throw lexical(
          "unrecognized_token",
          "Modelica identifiers must match ^[A-Za-z_][A-Za-z0-9_]*$.",
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
      "The Modelica lexical guard rejected an unrecognized character.",
      positions,
      index,
      index + 1,
    );
  }

  return Object.freeze(tokens.map((token) => Object.freeze(token)));
}

export function modelicaTokenSpan(
  sourceText: string,
  from: number,
  to: number,
): SourceAnalysisSpan {
  return new SourcePositions(sourceText).span(from, to);
}

function consumeLineComment(sourceText: string, start: number): number {
  let index = start + 2;
  while (index < sourceText.length && sourceText[index] !== "\n") index += 1;
  return index;
}

function consumeBlockComment(
  sourceText: string,
  start: number,
  positions: SourcePositions,
): number {
  let index = start + 2;
  while (index + 1 < sourceText.length) {
    if (sourceText[index] === "*" && sourceText[index + 1] === "/") {
      return index + 2;
    }
    index += 1;
  }
  throw lexical(
    "unclosed_comment",
    "The Modelica lexical guard rejected an unclosed block comment.",
    positions,
    start,
    sourceText.length,
  );
}

function consumeString(
  sourceText: string,
  start: number,
  positions: SourcePositions,
): ModelicaToken {
  let index = start + 1;
  while (index < sourceText.length) {
    if (sourceText[index] === '"') {
      const end = index + 1;
      return {
        kind: "string",
        text: sourceText.slice(start, end),
        from: start,
        to: end,
        span: positions.span(start, end),
      };
    }
    index += 1;
  }
  throw lexical(
    "unclosed_string",
    "The Modelica lexical guard rejected an unclosed string literal.",
    positions,
    start,
    sourceText.length,
  );
}

function consumeNumber(sourceText: string, start: number): number {
  let index = start;
  if (sourceText[index] === ".") {
    index = consumeWhile(sourceText, index + 1, isDigit);
  } else {
    index = consumeWhile(sourceText, index, isDigit);
    if (sourceText[index] === ".") {
      index = consumeWhile(sourceText, index + 1, isDigit);
    }
  }
  const exponent = sourceText[index];
  if (exponent === "e" || exponent === "E") {
    let expIndex = index + 1;
    if (sourceText[expIndex] === "+" || sourceText[expIndex] === "-") {
      expIndex += 1;
    }
    if (isDigit(sourceText[expIndex] ?? "")) {
      return consumeWhile(sourceText, expIndex, isDigit);
    }
  }
  return index;
}

function punctuate(
  kind: Exclude<ModelicaTokenKind, "keyword" | "identifier" | "number" | "string">,
  text: string,
  index: number,
  positions: SourcePositions,
): ModelicaToken {
  return {
    kind,
    text,
    from: index,
    to: index + 1,
    span: positions.span(index, index + 1),
  };
}

function lexical(
  code: ModelicaLexicalErrorCode,
  message: string,
  positions: SourcePositions,
  from: number,
  to: number,
): ModelicaLexicalError {
  return new ModelicaLexicalError(code, message, positions.span(from, to));
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

function isIdentifierStart(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") ||
    char === "_";
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
