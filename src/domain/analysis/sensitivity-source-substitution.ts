/**
 * Pure source surgery for one module-level numeric literal.
 *
 * Isolated execution accepts exact source bytes only. The sensitivity run
 * therefore substitutes the sealed step into the admitted text instead of
 * inventing a provider argument. The span must already name a finite literal.
 */

import type { SourceAnalysisSpan } from "./source-analysis.ts";

const NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

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
  const text = extractSpannedText(sourceText, span).trim();
  if (!NUMERIC_LITERAL.test(text)) {
    throw new TypeError(
      `spanned text ${JSON.stringify(text)} is not a finite numeric literal.`,
    );
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `spanned text ${JSON.stringify(text)} is not a finite numeric literal.`,
    );
  }
  return value;
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
