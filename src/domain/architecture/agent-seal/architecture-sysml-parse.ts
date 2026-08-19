/**
 * Pure parser for the locked architecture SysML closed subset.
 *
 * It accepts exactly the three renderer write forms after the lexical guard:
 * a package block of part definitions, a part definition that is empty or a
 * block of usages, and a standalone `part usage : Type;`. Anything else that
 * still tokenizes is recorded as an unresolved construct. Unresolved is
 * first-class and is never omitted.
 *
 * This module does no I/O and does not insert into SysON. Bindings are later
 * emitted as symbol ids by the analyzer; this AST still carries names only as
 * display facts.
 */

import type { SourceAnalysisSpan } from "../../compile/source/source-analysis.ts";
import {
  type ArchitectureSysmlToken,
  tokenizeArchitectureSysml,
} from "./architecture-sysml-lexical.ts";

export const SYSML_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
export const SYSML_USAGE_IDENTIFIER = /^[a-z][A-Za-z0-9_]*$/;

export type ArchitectureSysmlForm = "package" | "part-definition" | "part-usage";

export type ArchitectureSysmlParseErrorCode =
  | "syntax_not_recognized"
  | "unexpected_token"
  | "unclosed_block";

export class ArchitectureSysmlParseError extends Error {
  constructor(
    readonly code: ArchitectureSysmlParseErrorCode,
    message: string,
    readonly span?: SourceAnalysisSpan,
  ) {
    super(message);
    this.name = "ArchitectureSysmlParseError";
  }
}

export interface ArchitectureSysmlUnresolved {
  readonly kind: string;
  readonly message: string;
  readonly span: SourceAnalysisSpan;
}

export interface ArchitectureSysmlUsageNode {
  readonly kind: "part-usage";
  readonly usageName: string;
  readonly targetName: string;
  readonly span: SourceAnalysisSpan;
  readonly usageNameSpan: SourceAnalysisSpan;
  readonly targetNameSpan: SourceAnalysisSpan;
}

export interface ArchitectureSysmlPartDefNode {
  readonly kind: "part-definition";
  readonly definitionName: string;
  readonly bodyStyle: "empty" | "block";
  readonly usages: readonly ArchitectureSysmlUsageNode[];
  readonly span: SourceAnalysisSpan;
  readonly nameSpan: SourceAnalysisSpan;
}

export interface ArchitectureSysmlPackageNode {
  readonly kind: "package";
  readonly packageName: string;
  readonly definitions: readonly ArchitectureSysmlPartDefNode[];
  readonly span: SourceAnalysisSpan;
  readonly nameSpan: SourceAnalysisSpan;
}

export interface ArchitectureSysmlParse {
  readonly form: ArchitectureSysmlForm;
  readonly package?: ArchitectureSysmlPackageNode;
  readonly definition?: ArchitectureSysmlPartDefNode;
  readonly usage?: ArchitectureSysmlUsageNode;
  readonly unresolved: readonly ArchitectureSysmlUnresolved[];
}

/**
 * Parse one closed-subset source. The lexical guard runs first; syntax that
 * cannot start one of the three write forms is rejected rather than reported
 * as an empty-unresolved success.
 */
export function parseArchitectureSysmlSubset(
  sourceText: string,
): ArchitectureSysmlParse {
  const tokens = tokenizeArchitectureSysml(sourceText);
  const cursor = new TokenCursor(tokens);
  const unresolved: ArchitectureSysmlUnresolved[] = [];
  const first = cursor.peek();
  if (first === undefined) {
    throw new ArchitectureSysmlParseError(
      "syntax_not_recognized",
      "Architecture SysML source does not start with a closed-subset write form.",
    );
  }

  let form: ArchitectureSysmlForm;
  let pkg: ArchitectureSysmlPackageNode | undefined;
  let definition: ArchitectureSysmlPartDefNode | undefined;
  let usage: ArchitectureSysmlUsageNode | undefined;

  if (isKeyword(first, "package")) {
    form = "package";
    pkg = parsePackage(cursor, unresolved);
  } else if (isKeyword(first, "part") && isKeyword(cursor.peekAt(1), "def")) {
    form = "part-definition";
    definition = parsePartDef(cursor, unresolved);
  } else if (isKeyword(first, "part")) {
    form = "part-usage";
    const parsedUsage = tryParseUsage(cursor);
    if (parsedUsage === undefined) {
      throw new ArchitectureSysmlParseError(
        "syntax_not_recognized",
        "Architecture SysML source does not start with a closed-subset write form.",
        first.span,
      );
    }
    usage = parsedUsage;
    if (!SYSML_USAGE_IDENTIFIER.test(usage.usageName)) {
      unresolved.push({
        kind: "sysml-usage-identifier-not-qualified",
        message:
          "A PartUsage name must be a camelCase SysML usage identifier in the closed subset.",
        span: usage.usageNameSpan,
      });
    }
  } else {
    throw new ArchitectureSysmlParseError(
      "syntax_not_recognized",
      "Architecture SysML source does not start with a closed-subset write form.",
      first.span,
    );
  }

  if (!cursor.done) {
    const remainder = consumeRemainder(cursor);
    if (remainder !== undefined) unresolved.push(remainder);
  }

  return Object.freeze({
    form,
    ...(pkg === undefined ? {} : { package: pkg }),
    ...(definition === undefined ? {} : { definition }),
    ...(usage === undefined ? {} : { usage }),
    unresolved: Object.freeze([...unresolved]),
  });
}

function parsePackage(
  cursor: TokenCursor,
  unresolved: ArchitectureSysmlUnresolved[],
): ArchitectureSysmlPackageNode {
  const start = cursor.expectKeyword("package");
  const name = cursor.expectIdentifier("package name");
  cursor.expectKind("lbrace", "package body");
  const definitions: ArchitectureSysmlPartDefNode[] = [];
  while (!cursor.done && !isKind(cursor.peek(), "rbrace")) {
    if (isPartDefStart(cursor)) {
      definitions.push(parsePartDef(cursor, unresolved));
      continue;
    }
    const extra = consumeUnqualified(cursor);
    if (extra === undefined) break;
    unresolved.push(extra);
  }
  const end = cursor.expectKind("rbrace", "package close");
  return Object.freeze({
    kind: "package",
    packageName: name.text,
    definitions: Object.freeze(definitions),
    span: mergeSpan(start.span, end.span),
    nameSpan: name.span,
  });
}

function parsePartDef(
  cursor: TokenCursor,
  unresolved: ArchitectureSysmlUnresolved[],
): ArchitectureSysmlPartDefNode {
  const start = cursor.expectKeyword("part");
  cursor.expectKeyword("def");
  const name = cursor.expectIdentifier("part definition name");
  cursor.expectKind("lbrace", "part definition body");
  if (isKind(cursor.peek(), "rbrace")) {
    const end = cursor.take()!;
    return Object.freeze({
      kind: "part-definition",
      definitionName: name.text,
      bodyStyle: "empty",
      usages: Object.freeze([]),
      span: mergeSpan(start.span, end.span),
      nameSpan: name.span,
    });
  }
  const usages: ArchitectureSysmlUsageNode[] = [];
  while (!cursor.done && !isKind(cursor.peek(), "rbrace")) {
    if (isUsageStart(cursor)) {
      const usage = tryParseUsage(cursor);
      if (usage === undefined) {
        const extra = consumeUnqualified(cursor);
        if (extra === undefined) break;
        unresolved.push(extra);
        continue;
      }
      if (!SYSML_USAGE_IDENTIFIER.test(usage.usageName)) {
        unresolved.push({
          kind: "sysml-usage-identifier-not-qualified",
          message:
            "A PartUsage name must be a camelCase SysML usage identifier in the closed subset.",
          span: usage.usageNameSpan,
        });
      }
      usages.push(usage);
      continue;
    }
    const extra = consumeUnqualified(cursor);
    if (extra === undefined) break;
    unresolved.push(extra);
  }
  const end = cursor.expectKind("rbrace", "part definition close");
  return Object.freeze({
    kind: "part-definition",
    definitionName: name.text,
    bodyStyle: "block",
    usages: Object.freeze(usages),
    span: mergeSpan(start.span, end.span),
    nameSpan: name.span,
  });
}

function tryParseUsage(cursor: TokenCursor): ArchitectureSysmlUsageNode | undefined {
  const part = cursor.peek();
  const name = cursor.peekAt(1);
  const colon = cursor.peekAt(2);
  const target = cursor.peekAt(3);
  const semi = cursor.peekAt(4);
  if (
    !isKeyword(part, "part") ||
    name?.kind !== "identifier" ||
    !isKind(colon, "colon") ||
    target?.kind !== "identifier" ||
    !isKind(semi, "semicolon")
  ) {
    return undefined;
  }
  cursor.take();
  cursor.take();
  cursor.take();
  cursor.take();
  const end = cursor.take()!;
  return Object.freeze({
    kind: "part-usage",
    usageName: name.text,
    targetName: target.text,
    span: mergeSpan(part!.span, end.span),
    usageNameSpan: name.span,
    targetNameSpan: target.span,
  });
}

function isPartDefStart(cursor: TokenCursor): boolean {
  return isKeyword(cursor.peek(), "part") && isKeyword(cursor.peekAt(1), "def");
}

function isUsageStart(cursor: TokenCursor): boolean {
  return isKeyword(cursor.peek(), "part") && !isKeyword(cursor.peekAt(1), "def");
}

function consumeUnqualified(
  cursor: TokenCursor,
): ArchitectureSysmlUnresolved | undefined {
  const first = cursor.peek();
  if (first === undefined || isKind(first, "rbrace")) return undefined;
  const start = first.span;
  let last = first.span;
  let depth = 0;
  while (!cursor.done) {
    const token = cursor.peek()!;
    if (depth === 0 && isKind(token, "rbrace")) break;
    cursor.take();
    last = token.span;
    if (isKind(token, "lbrace")) {
      depth += 1;
      continue;
    }
    if (isKind(token, "rbrace")) {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth === 0 && isKind(token, "semicolon")) break;
  }
  return {
    kind: "sysml-construct-not-qualified",
    message:
      "Only package, part def empty-or-block, and part usage : Type forms are qualified.",
    span: mergeSpan(start, last),
  };
}

function consumeRemainder(
  cursor: TokenCursor,
): ArchitectureSysmlUnresolved | undefined {
  const first = cursor.peek();
  if (first === undefined) return undefined;
  const start = first.span;
  let last = first.span;
  while (!cursor.done) last = cursor.take()!.span;
  return {
    kind: "sysml-construct-not-qualified",
    message:
      "Only one closed-subset write form is qualified in a single architecture SysML source.",
    span: mergeSpan(start, last),
  };
}

class TokenCursor {
  #index = 0;

  constructor(readonly tokens: readonly ArchitectureSysmlToken[]) {}

  get done(): boolean {
    return this.#index >= this.tokens.length;
  }

  peek(): ArchitectureSysmlToken | undefined {
    return this.tokens[this.#index];
  }

  peekAt(offset: number): ArchitectureSysmlToken | undefined {
    return this.tokens[this.#index + offset];
  }

  take(): ArchitectureSysmlToken | undefined {
    const token = this.tokens[this.#index];
    if (token !== undefined) this.#index += 1;
    return token;
  }

  expectKeyword(text: string): ArchitectureSysmlToken {
    const token = this.peek();
    if (!isKeyword(token, text)) {
      throw new ArchitectureSysmlParseError(
        "unexpected_token",
        `Expected keyword ${text} in the architecture SysML closed subset.`,
        token?.span,
      );
    }
    return this.take()!;
  }

  expectIdentifier(label: string): ArchitectureSysmlToken {
    const token = this.peek();
    if (token?.kind !== "identifier") {
      throw new ArchitectureSysmlParseError(
        "unexpected_token",
        `Expected ${label} in the architecture SysML closed subset.`,
        token?.span,
      );
    }
    return this.take()!;
  }

  expectKind(
    kind: ArchitectureSysmlToken["kind"],
    label: string,
  ): ArchitectureSysmlToken {
    const token = this.peek();
    if (!isKind(token, kind)) {
      if (kind === "rbrace") {
        throw new ArchitectureSysmlParseError(
          "unclosed_block",
          `Unclosed ${label} in the architecture SysML closed subset.`,
          token?.span,
        );
      }
      throw new ArchitectureSysmlParseError(
        "unexpected_token",
        `Expected ${label} in the architecture SysML closed subset.`,
        token?.span,
      );
    }
    return this.take()!;
  }
}

function isKeyword(
  token: ArchitectureSysmlToken | undefined,
  text: string,
): boolean {
  return token?.kind === "keyword" && token.text === text;
}

function isKind(
  token: ArchitectureSysmlToken | undefined,
  kind: ArchitectureSysmlToken["kind"],
): boolean {
  return token?.kind === kind;
}

function mergeSpan(
  start: SourceAnalysisSpan,
  end: SourceAnalysisSpan,
): SourceAnalysisSpan {
  return { start: start.start, end: end.end };
}
