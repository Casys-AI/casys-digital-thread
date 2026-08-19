/**
 * Pure source surgery for one module-level numeric literal.
 *
 * Isolated execution accepts exact source bytes only. The sensitivity run
 * therefore substitutes the sealed step into the admitted text instead of
 * inventing a provider argument. The span must already name a finite literal.
 */

import type { SourceAnalysisSpan } from "../../compile/source/source-analysis.ts";

const QUALIFIED_DIGITS = String.raw`[0-9](?:_?[0-9])*`;
const QUALIFIED_INTEGER = String.raw`(?:0|[1-9](?:_?[0-9])*)`;
const QUALIFIED_EXPONENT = String.raw`[eE][+-]?${QUALIFIED_DIGITS}`;
const QUALIFIED_UNSIGNED_DECIMAL = String
  .raw`(?:${QUALIFIED_INTEGER}(?:\.${QUALIFIED_DIGITS}?)?(?:${QUALIFIED_EXPONENT})?|\.${QUALIFIED_DIGITS}(?:${QUALIFIED_EXPONENT})?)`;
const QUALIFIED_UNSIGNED_DECIMAL_LITERAL = new RegExp(
  `^${QUALIFIED_UNSIGNED_DECIMAL}$`,
);
const QUALIFIED_SIGNED_DECIMAL_LITERAL = new RegExp(
  `^[+-]?${QUALIFIED_UNSIGNED_DECIMAL}$`,
);

/** Exact decimal-token grammar owned jointly by analysis and source surgery. */
export function isQualifiedUnsignedDecimalLiteral(text: string): boolean {
  return QUALIFIED_UNSIGNED_DECIMAL_LITERAL.test(text) &&
    Number.isFinite(Number(text.replaceAll("_", "")));
}

export function sourceSpanOffsets(
  sourceText: string,
  span: SourceAnalysisSpan,
): { readonly start: number; readonly end: number } {
  const start = offsetAt(sourceText, span.start.line, span.start.column, "span.start");
  const end = offsetAt(sourceText, span.end.line, span.end.column, "span.end");
  if (end < start) {
    throw new TypeError("source span end must not precede start.");
  }
  return { start, end };
}

export function extractSpannedText(
  sourceText: string,
  span: SourceAnalysisSpan,
): string {
  const { start, end } = sourceSpanOffsets(sourceText, span);
  return sourceText.slice(start, end);
}

export function extractFiniteNumericLiteral(
  sourceText: string,
  span: SourceAnalysisSpan,
): number {
  return parseNumericLiteralText(extractSpannedText(sourceText, span).trim());
}

export interface ModuleLevelNumericBinding {
  readonly name: string;
  readonly value: number;
  readonly valueSpan: SourceAnalysisSpan;
}

/**
 * The qualified Build123d frontend spans the *name* of a parameter, not the
 * RHS literal. Locate the following `= <finite-literal>` from that sealed
 * name span. Expressions are refused.
 */
export function locateModuleLevelNumericBinding(
  sourceText: string,
  nameSpan: SourceAnalysisSpan,
  expectedName: string,
): ModuleLevelNumericBinding {
  const name = extractSpannedText(sourceText, nameSpan);
  if (name !== expectedName) {
    throw new TypeError(
      `spanned binding name ${JSON.stringify(name)} does not equal ` +
        `${JSON.stringify(expectedName)}.`,
    );
  }
  const { end: nameEnd } = sourceSpanOffsets(sourceText, nameSpan);
  let index = nameEnd;
  while (index < sourceText.length && isHorizontalOrNewlineSpace(sourceText[index]!)) {
    index += 1;
  }
  if (sourceText[index] !== "=") {
    throw new TypeError(
      `binding ${JSON.stringify(expectedName)} is not followed by '='.`,
    );
  }
  index += 1;
  while (index < sourceText.length && isHorizontalOrNewlineSpace(sourceText[index]!)) {
    index += 1;
  }
  const literalStart = index;
  if (sourceText[index] === "+" || sourceText[index] === "-") {
    index += 1;
  }
  while (
    index < sourceText.length && /[0-9_+\-.eE]/.test(sourceText[index]!)
  ) {
    index += 1;
  }
  const literal = sourceText.slice(literalStart, index);
  const value = parseNumericLiteralText(literal);
  return {
    name,
    value,
    valueSpan: {
      start: locationAt(sourceText, literalStart),
      end: locationAt(sourceText, index),
    },
  };
}

/**
 * Replace exactly the spanned literal with the canonical decimal form of
 * nextValue. The caller owns nextValue = base + step; this function does not
 * invent a step.
 */
export function substituteModuleLevelNumericLiteral(
  sourceText: string,
  span: SourceAnalysisSpan,
  nextValue: number,
): string {
  if (!Number.isFinite(nextValue)) {
    throw new TypeError("nextValue must be a finite number.");
  }
  extractFiniteNumericLiteral(sourceText, span);
  const { start, end } = sourceSpanOffsets(sourceText, span);
  return `${sourceText.slice(0, start)}${String(nextValue)}${sourceText.slice(end)}`;
}

function parseNumericLiteralText(text: string): number {
  if (!QUALIFIED_SIGNED_DECIMAL_LITERAL.test(text)) {
    throw new TypeError(
      `spanned text ${JSON.stringify(text)} is not a finite numeric literal.`,
    );
  }
  const value = Number(text.replaceAll("_", ""));
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `spanned text ${JSON.stringify(text)} is not a finite numeric literal.`,
    );
  }
  return value;
}

function isHorizontalOrNewlineSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function locationAt(
  sourceText: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (sourceText[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart };
}

function offsetAt(
  sourceText: string,
  line: number,
  column: number,
  path: string,
): number {
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new TypeError(`${path}.line must be a 1-based integer.`);
  }
  if (!Number.isSafeInteger(column) || column < 0) {
    throw new TypeError(`${path}.column must be a non-negative integer.`);
  }
  let currentLine = 1;
  let index = 0;
  while (currentLine < line) {
    const next = sourceText.indexOf("\n", index);
    if (next === -1) {
      throw new TypeError(`${path} line ${line} is past the end of the source.`);
    }
    index = next + 1;
    currentLine += 1;
  }
  const lineEnd = sourceText.indexOf("\n", index);
  const lineLength = (lineEnd === -1 ? sourceText.length : lineEnd) - index;
  if (column > lineLength) {
    throw new TypeError(`${path} column ${column} is past the end of line ${line}.`);
  }
  return index + column;
}
