/**
 * Bare numeric literals in CAD expressions that reach `result`.
 *
 * These are constructor-photo holes, not levers. They have a span and a
 * value, never a invented name such as `width`. A named module-level
 * literal (`thickness = 5`) is excluded here; it belongs to named-cad-levers.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import {
  isQualifiedUnsignedDecimalLiteral,
} from "../../sensitivity/study/sensitivity-source-substitution.ts";
import type { SourceAnalysisBundle, SourceAnalysisSpan } from "./source-analysis.ts";

export interface UnnamedCadConstructorLiteral {
  readonly sourceId: string;
  readonly hostSymbolId: string;
  readonly hostSymbolName: string;
  readonly value: number;
  readonly span: SourceAnalysisSpan;
}

const MODULE_LEVEL_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/;

export function listUnnamedCadConstructorLiterals(
  sourceText: string,
  analysis: SourceAnalysisBundle,
): readonly UnnamedCadConstructorLiteral[] {
  if (analysis.source.role !== "cad-script") return deepFreeze([]);
  const results = analysis.symbols.filter((symbol) =>
    symbol.kind === "artifact" && symbol.name === "result"
  );
  if (results.length !== 1) return deepFreeze([]);
  const resultId = results[0]!.id;
  const outgoing = new Map<string, string[]>();
  for (const dependency of analysis.dependencies) {
    const targets = outgoing.get(dependency.fromSymbolId) ?? [];
    targets.push(dependency.toSymbolId);
    outgoing.set(dependency.fromSymbolId, targets);
  }
  const hosts = analysis.symbols.filter((symbol) =>
    symbol.id === resultId || reachesSymbol(symbol.id, resultId, outgoing)
  );
  const literals: UnnamedCadConstructorLiteral[] = [];
  for (const host of hosts) {
    const assignment = moduleLevelAssignment(sourceText, host.name);
    if (assignment === undefined) continue;
    for (const literal of scanConstructorArgumentLiterals(assignment.rhs)) {
      literals.push({
        sourceId: analysis.source.id,
        hostSymbolId: host.id,
        hostSymbolName: host.name,
        value: literal.value,
        span: {
          start: locationAt(sourceText, assignment.rhsStart + literal.start),
          end: locationAt(sourceText, assignment.rhsStart + literal.end),
        },
      });
    }
  }
  literals.sort((left, right) =>
    compareSpan(left.span, right.span) ||
    compareText(left.hostSymbolId, right.hostSymbolId)
  );
  return deepFreeze(dedupeBySpan(literals));
}

function moduleLevelAssignment(
  sourceText: string,
  name: string,
): { readonly rhs: string; readonly rhsStart: number } | undefined {
  let lineStart = 0;
  while (lineStart <= sourceText.length) {
    const newline = sourceText.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? sourceText.length : newline;
    const lineText = sourceText.slice(lineStart, lineEnd);
    if (!lineText.startsWith(" ") && !lineText.startsWith("\t")) {
      const match = MODULE_LEVEL_ASSIGNMENT.exec(lineText);
      if (match?.[1] === name) {
        const equals = lineText.indexOf("=");
        const rhsStart = lineStart + equals + 1;
        return { rhs: sourceText.slice(rhsStart, lineEnd), rhsStart };
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return undefined;
}

function scanConstructorArgumentLiterals(
  rhs: string,
): readonly { start: number; end: number; value: number }[] {
  const found: { start: number; end: number; value: number }[] = [];
  let index = 0;
  while (index < rhs.length) {
    const char = rhs[index]!;
    if (isIdentifierStart(char)) {
      index += 1;
      while (index < rhs.length && isIdentifierPart(rhs[index]!)) index += 1;
      continue;
    }
    const literal = readDecimalLiteral(rhs, index);
    if (literal !== undefined && isConstructorArgumentSlot(rhs, index, literal.end)) {
      found.push(literal);
      index = literal.end;
      continue;
    }
    index += 1;
  }
  return found;
}

function readDecimalLiteral(
  text: string,
  start: number,
): { start: number; end: number; value: number } | undefined {
  let index = start;
  if (text[index] === "+" || text[index] === "-") index += 1;
  const unsignedStart = index;
  if (index >= text.length) return undefined;
  while (index < text.length && /[0-9_.eE]/.test(text[index]!)) index += 1;
  if (index === unsignedStart) return undefined;
  const unsigned = text.slice(unsignedStart, index);
  if (!isQualifiedUnsignedDecimalLiteral(unsigned)) return undefined;
  const token = text.slice(start, index);
  const value = Number(token.replaceAll("_", ""));
  if (!Number.isFinite(value)) return undefined;
  return { start, end: index, value };
}

function isConstructorArgumentSlot(text: string, start: number, end: number): boolean {
  const previous = previousNonSpace(text, start);
  const next = nextNonSpace(text, end);
  return (previous === "(" || previous === ",") &&
    (next === "," || next === ")" || next === "#" || next === undefined);
}

function previousNonSpace(text: string, index: number): string | undefined {
  let cursor = index - 1;
  while (cursor >= 0 && (text[cursor] === " " || text[cursor] === "\t")) {
    cursor -= 1;
  }
  return cursor >= 0 ? text[cursor] : undefined;
}

function nextNonSpace(text: string, index: number): string | undefined {
  let cursor = index;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
    cursor += 1;
  }
  return cursor < text.length ? text[cursor] : undefined;
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function reachesSymbol(
  startId: string,
  targetId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
): boolean {
  const pending = [...(outgoing.get(startId) ?? [])];
  const visited = new Set<string>([startId]);
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
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

function compareSpan(left: SourceAnalysisSpan, right: SourceAnalysisSpan): number {
  return left.start.line - right.start.line ||
    left.start.column - right.start.column ||
    left.end.line - right.end.line ||
    left.end.column - right.end.column;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dedupeBySpan(
  literals: readonly UnnamedCadConstructorLiteral[],
): UnnamedCadConstructorLiteral[] {
  const seen = new Set<string>();
  const unique: UnnamedCadConstructorLiteral[] = [];
  for (const literal of literals) {
    const key = `${literal.span.start.line}:${literal.span.start.column}:` +
      `${literal.span.end.line}:${literal.span.end.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(literal);
  }
  return unique;
}
