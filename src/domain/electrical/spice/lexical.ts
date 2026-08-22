/**
 * Fail-closed lexical guard for the generic circuit-only SPICE closed subset v1.
 *
 * Agent-authored SPICE is untrusted text. The parser may only see tokens this
 * guard admits. Comments (`*` lines, `$` / `;` tails) and `+` continuations are
 * not authority. An unrecognized character is never skipped.
 */

export interface SourceAnalysisLocation {
  readonly line: number;
  readonly column: number;
}
export interface SourceAnalysisSpan {
  readonly start: SourceAnalysisLocation;
  readonly end: SourceAnalysisLocation;
}

export type SpiceLexicalErrorCode =
  | "unrecognized_token"
  | "invalid_number"
  | "unclosed_parameter_ref";

export class SpiceLexicalError extends Error {
  constructor(
    readonly code: SpiceLexicalErrorCode,
    message: string,
    readonly span?: SourceAnalysisSpan,
  ) {
    super(message);
    this.name = "SpiceLexicalError";
  }
}

export type SpiceTokenKind =
  | "identifier"
  | "number"
  | "directive"
  | "equal"
  | "lparen"
  | "rparen"
  | "lbrace"
  | "rbrace"
  | "eol";

export interface SpiceToken {
  readonly kind: SpiceTokenKind;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly span: SourceAnalysisSpan;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DIRECTIVE = /^\.[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Tokenize one exact UTF-8 circuit-only SPICE source. Empty and
 * comment-only sources yield no tokens; the parser reports the missing
 * circuit. Newlines become `eol` except when the next physical line is a
 * `+` continuation.
 */
export function tokenizeSpiceCircuitSubset(
  sourceText: string,
): readonly SpiceToken[] {
  if (typeof sourceText !== "string") {
    throw new SpiceLexicalError(
      "unrecognized_token",
      "SPICE source must be a string.",
    );
  }

  const positions = new SourcePositions(sourceText);
  const tokens: SpiceToken[] = [];
  let index = 0;
  let pendingEol: { readonly from: number; readonly to: number } | undefined;

  while (index < sourceText.length) {
    const char = sourceText[index]!;
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      pendingEol = { from: index, to: index + 1 };
      index += 1;
      continue;
    }
    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }
    if (atLogicalLineStart(sourceText, index) && char === "*") {
      index = consumeToEol(sourceText, index);
      continue;
    }
    if (atLogicalLineStart(sourceText, index) && char === "+") {
      pendingEol = undefined;
      index += 1;
      continue;
    }
    if (char === "$" || char === ";") {
      index = consumeToEol(sourceText, index);
      continue;
    }
    flushEol(tokens, pendingEol, positions);
    pendingEol = undefined;

    if (char === "=") {
      tokens.push(punctuate("equal", char, index, positions));
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push(punctuate("lparen", char, index, positions));
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push(punctuate("rparen", char, index, positions));
      index += 1;
      continue;
    }
    if (char === "{") {
      tokens.push(punctuate("lbrace", char, index, positions));
      index += 1;
      continue;
    }
    if (char === "}") {
      tokens.push(punctuate("rbrace", char, index, positions));
      index += 1;
      continue;
    }
    if (char === ".") {
      if (isDigit(sourceText[index + 1] ?? "")) {
        const token = consumeNumberToken(sourceText, index, positions);
        tokens.push(token);
        index = token.to;
        continue;
      }
      const end = consumeWhile(
        sourceText,
        index + 1,
        (value) => isIdentifierStart(value) || isDigit(value),
      );
      const text = sourceText.slice(index, end);
      if (!DIRECTIVE.test(text)) {
        throw lexical(
          "unrecognized_token",
          "SPICE directives must match ^.[A-Za-z][A-Za-z0-9_]*$.",
          positions,
          index,
          end,
        );
      }
      tokens.push({
        kind: "directive",
        text,
        from: index,
        to: end,
        span: positions.span(index, end),
      });
      index = end;
      continue;
    }
    if (isDigit(char) || char === "+" || char === "-") {
      const token = consumeNumberToken(sourceText, index, positions);
      tokens.push(token);
      index = token.to;
      continue;
    }
    if (isIdentifierStart(char)) {
      const end = consumeWhile(
        sourceText,
        index,
        (value) => isIdentifierStart(value) || isDigit(value),
      );
      const text = sourceText.slice(index, end);
      if (!IDENTIFIER.test(text) || text.length > 64) {
        throw lexical(
          "unrecognized_token",
          "SPICE identifiers must match ^[A-Za-z_][A-Za-z0-9_]*$ and be at most 64 characters.",
          positions,
          index,
          end,
        );
      }
      tokens.push({
        kind: "identifier",
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
      "The SPICE lexical guard rejected an unrecognized character.",
      positions,
      index,
      index + 1,
    );
  }
  flushEol(tokens, pendingEol, positions);
  return Object.freeze(tokens.map((token) => Object.freeze(token)));
}

export function spiceTokenSpan(
  sourceText: string,
  from: number,
  to: number,
): SourceAnalysisSpan {
  return new SourcePositions(sourceText).span(from, to);
}

const SCALE_SUFFIXES = [
  { suffix: "meg", factor: 1e6 },
  { suffix: "t", factor: 1e12 },
  { suffix: "g", factor: 1e9 },
  { suffix: "k", factor: 1e3 },
  { suffix: "m", factor: 1e-3 },
  { suffix: "u", factor: 1e-6 },
  { suffix: "n", factor: 1e-9 },
  { suffix: "p", factor: 1e-12 },
  { suffix: "f", factor: 1e-15 },
] as const;

/** Parse a closed-subset numeric spelling, including one optional SPICE scale. */
export function spiceNumberValue(spelling: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-z]*)$/.exec(
    spelling,
  );
  if (match === null) {
    throw new SpiceLexicalError(
      "invalid_number",
      "SPICE numbers must be decimal literals with at most one closed-subset scale suffix.",
    );
  }
  const mantissa = Number(match[1]);
  if (!Number.isFinite(mantissa)) {
    throw new SpiceLexicalError(
      "invalid_number",
      "SPICE numbers must be finite.",
    );
  }
  const suffix = (match[2] ?? "").toLowerCase();
  if (suffix.length === 0) return mantissa;
  const scale = SCALE_SUFFIXES.find((item) => item.suffix === suffix);
  if (scale === undefined) {
    throw new SpiceLexicalError(
      "invalid_number",
      "SPICE scale suffixes are t, g, meg, k, m, u, n, p, and f only.",
    );
  }
  const value = mantissa * scale.factor;
  if (!Number.isFinite(value)) {
    throw new SpiceLexicalError(
      "invalid_number",
      "SPICE numbers must be finite after scale application.",
    );
  }
  return value;
}

function consumeNumberToken(
  sourceText: string,
  start: number,
  positions: SourcePositions,
): SpiceToken {
  let index = start;
  if (sourceText[index] === "+" || sourceText[index] === "-") index += 1;
  if (sourceText[index] === ".") {
    const next = index + 1;
    if (!isDigit(sourceText[next] ?? "")) {
      throw lexical(
        "invalid_number",
        "SPICE numbers must have a digit after a leading decimal point.",
        positions,
        start,
        next,
      );
    }
    index = consumeWhile(sourceText, next, isDigit);
  } else {
    if (!isDigit(sourceText[index] ?? "")) {
      throw lexical(
        "invalid_number",
        "A leading sign must introduce a SPICE number.",
        positions,
        start,
        index,
      );
    }
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
    if (!isDigit(sourceText[expIndex] ?? "")) {
      throw lexical(
        "invalid_number",
        "SPICE exponents must include at least one digit.",
        positions,
        start,
        expIndex,
      );
    }
    index = consumeWhile(sourceText, expIndex, isDigit);
  }
  const suffixStart = index;
  index = consumeWhile(sourceText, index, isIdentifierStart);
  const spelling = sourceText.slice(start, index);
  try {
    spiceNumberValue(spelling);
  } catch (error) {
    if (error instanceof SpiceLexicalError) {
      throw lexical(
        "invalid_number",
        error.message,
        positions,
        start,
        index,
      );
    }
    throw error;
  }
  if (suffixStart < index && isDigit(sourceText[index] ?? "")) {
    throw lexical(
      "invalid_number",
      "SPICE numbers must not mix a scale suffix with trailing digits.",
      positions,
      start,
      index + 1,
    );
  }
  return {
    kind: "number",
    text: spelling,
    from: start,
    to: index,
    span: positions.span(start, index),
  };
}

function flushEol(
  tokens: SpiceToken[],
  pending: { readonly from: number; readonly to: number } | undefined,
  positions: SourcePositions,
): void {
  if (pending === undefined) return;
  if (tokens.length === 0 || tokens[tokens.length - 1]?.kind === "eol") return;
  tokens.push({
    kind: "eol",
    text: "\n",
    from: pending.from,
    to: pending.to,
    span: positions.span(pending.from, pending.to),
  });
}

function atLogicalLineStart(sourceText: string, index: number): boolean {
  let cursor = index;
  while (cursor > 0) {
    const previous = sourceText[cursor - 1]!;
    if (previous === "\n") return true;
    if (previous === " " || previous === "\t" || previous === "\r") {
      cursor -= 1;
      continue;
    }
    return false;
  }
  return true;
}

function consumeToEol(sourceText: string, start: number): number {
  let index = start;
  while (index < sourceText.length && sourceText[index] !== "\n") index += 1;
  return index;
}

function punctuate(
  kind: Exclude<
    SpiceTokenKind,
    "identifier" | "number" | "directive" | "eol"
  >,
  text: string,
  index: number,
  positions: SourcePositions,
): SpiceToken {
  return {
    kind,
    text,
    from: index,
    to: index + 1,
    span: positions.span(index, index + 1),
  };
}

function lexical(
  code: SpiceLexicalErrorCode,
  message: string,
  positions: SourcePositions,
  from: number,
  to: number,
): SpiceLexicalError {
  return new SpiceLexicalError(code, message, positions.span(from, to));
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
