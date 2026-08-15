/**
 * Pure parser for the locked Modelica closed subset v1.
 *
 * After the lexical guard it accepts exactly the LinearThermalRamp forms: one
 * root `model Name … end Name;`, optional description string, scalar
 * `parameter Real` / `output Real` declarations, and one `equation` section of
 * `der(id) = expr` or `id = expr`. Anything else that still tokenizes is
 * recorded as a typed unresolved construct. Unresolved is first-class and is
 * never omitted.
 *
 * Structural failures that cannot form a model (`missing_model_block`,
 * `end_mismatch`) throw. Unsupported-but-tokenizable forms do not throw.
 *
 * This module does no I/O. Bindings are later emitted as symbol ids by the
 * analyzer; this AST still carries names only as display facts.
 *
 * If the subset grows beyond about fifteen forms, migrate to
 * tree-sitter-modelica WASM rather than stretching this recursive-descent
 * parser.
 */

import type { SourceAnalysisSpan } from "../analysis/source-analysis.ts";
import { type ModelicaToken, tokenizeModelicaSubset } from "./modelica-lexical.ts";

export type ModelicaParseErrorCode =
  | "missing_model_block"
  | "end_mismatch"
  | "unexpected_token"
  | "unclosed_block";

export class ModelicaParseError extends Error {
  constructor(
    readonly code: ModelicaParseErrorCode,
    message: string,
    readonly span?: SourceAnalysisSpan,
  ) {
    super(message);
    this.name = "ModelicaParseError";
  }
}

export interface ModelicaUnresolved {
  readonly kind: string;
  readonly message: string;
  readonly span: SourceAnalysisSpan;
}

export interface ModelicaAttributeNode {
  readonly name: string;
  readonly referencedName?: string;
  readonly span: SourceAnalysisSpan;
}

export interface ModelicaParameterNode {
  readonly kind: "parameter";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly span: SourceAnalysisSpan;
  readonly attributes: readonly ModelicaAttributeNode[];
  readonly defaultReferencedName?: string;
}

export interface ModelicaVariableNode {
  readonly kind: "variable";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly span: SourceAnalysisSpan;
  readonly attributes: readonly ModelicaAttributeNode[];
}

export interface ModelicaEquationNode {
  readonly kind: "equation";
  readonly discriminator: "der" | "algebraic";
  readonly lhsName: string;
  readonly rhsNames: readonly string[];
  readonly span: SourceAnalysisSpan;
  readonly ordinal: number;
}

export interface ModelicaModelNode {
  readonly kind: "model";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly span: SourceAnalysisSpan;
  readonly parameters: readonly ModelicaParameterNode[];
  readonly variables: readonly ModelicaVariableNode[];
  readonly equations: readonly ModelicaEquationNode[];
}

export interface ModelicaParse {
  readonly model: ModelicaModelNode;
  readonly unresolved: readonly ModelicaUnresolved[];
}

const UNSUPPORTED_TOP_LEVEL = new Set([
  "import",
  "extends",
  "class",
  "block",
  "record",
  "function",
  "package",
  "type",
]);

const BLOCK_CLOSERS = new Set([
  "model",
  "class",
  "block",
  "record",
  "function",
  "package",
  "when",
  "if",
  "for",
  "while",
]);

const QUALIFIED_ATTRIBUTES = new Set([
  "unit",
  "start",
  "fixed",
  "displayUnit",
  "min",
  "max",
]);

const EMPTY_SPAN: SourceAnalysisSpan = {
  start: { line: 1, column: 0 },
  end: { line: 1, column: 0 },
};

/**
 * Parse one closed-subset Modelica source. The lexical guard runs first.
 * A source that cannot form a single `model` is rejected rather than reported
 * as an empty-unresolved success.
 */
export function parseModelicaSubset(sourceText: string): ModelicaParse {
  const tokens = tokenizeModelicaSubset(sourceText);
  const cursor = new TokenCursor(tokens);
  const unresolved: ModelicaUnresolved[] = [];
  let model: ModelicaModelNode | undefined;

  while (!cursor.done) {
    const next = cursor.peek();
    if (next === undefined) break;
    if (isKeyword(next, "model")) {
      if (model === undefined) {
        model = parseModel(cursor, unresolved);
        continue;
      }
      const extra = consumeConstruct(cursor);
      if (extra !== undefined) {
        unresolved.push({
          kind: "modelica-multiple-model-blocks",
          message: "The Modelica closed subset qualifies exactly one root model block.",
          span: extra.span,
        });
      }
      continue;
    }
    const extra = consumeConstruct(cursor);
    if (extra === undefined) break;
    unresolved.push(classifyTopLevel(extra));
  }

  if (model === undefined) {
    throw new ModelicaParseError(
      "missing_model_block",
      "Modelica source does not contain a closed-subset model block.",
      cursor.tokens[0]?.span ?? EMPTY_SPAN,
    );
  }

  return Object.freeze({
    model,
    unresolved: Object.freeze([...unresolved]),
  });
}

function parseModel(
  cursor: TokenCursor,
  unresolved: ModelicaUnresolved[],
): ModelicaModelNode {
  const start = cursor.expectKeyword("model");
  const name = cursor.expectIdentifier("model name");
  if (isKind(cursor.peek(), "string")) cursor.take();

  const parameters: ModelicaParameterNode[] = [];
  const variables: ModelicaVariableNode[] = [];
  const equations: ModelicaEquationNode[] = [];
  let seenEquation = false;

  while (!cursor.done && !isKeyword(cursor.peek(), "end")) {
    if (isKeyword(cursor.peek(), "parameter")) {
      const declared = parseTypedDeclaration(cursor, "parameter", unresolved);
      if (declared?.kind === "parameter") parameters.push(declared);
      continue;
    }
    if (isKeyword(cursor.peek(), "output")) {
      const declared = parseTypedDeclaration(cursor, "output", unresolved);
      if (declared?.kind === "variable") variables.push(declared);
      continue;
    }
    if (isKeyword(cursor.peek(), "equation")) {
      if (seenEquation) {
        const extra = consumeSection(cursor);
        if (extra !== undefined) {
          unresolved.push({
            kind: "modelica-unsupported-section",
            message:
              "The Modelica closed subset qualifies exactly one equation section.",
            span: extra,
          });
        }
        continue;
      }
      seenEquation = true;
      parseEquationSection(cursor, equations, unresolved);
      continue;
    }
    if (isInitialSection(cursor) || isUnsupportedSectionStart(cursor.peek())) {
      const extra = consumeSection(cursor);
      if (extra !== undefined) {
        unresolved.push({
          kind: "modelica-unsupported-section",
          message:
            "initial equation, algorithm, protected, and public sections are not qualified.",
          span: extra,
        });
      }
      continue;
    }
    if (isUnsupportedTopLevelStart(cursor.peek())) {
      const extra = consumeConstruct(cursor);
      if (extra !== undefined) unresolved.push(classifyTopLevel(extra));
      continue;
    }
    if (isBareTypeDeclaration(cursor)) {
      const extra = consumeToSemicolon(cursor);
      if (extra !== undefined) {
        unresolved.push({
          kind: looksLikeArrayDeclaration(extra.text)
            ? "modelica-array-declaration"
            : "modelica-unsupported-variable-type",
          message: looksLikeArrayDeclaration(extra.text)
            ? "Array declarations are not qualified in the Modelica closed subset."
            : "Only parameter Real and output Real scalars are qualified.",
          span: extra.span,
        });
      }
      continue;
    }
    const extra = consumeConstruct(cursor);
    if (extra === undefined) break;
    unresolved.push({
      kind: "modelica-unsupported-section",
      message:
        "Only parameter, output, and one equation section are qualified in a model body.",
      span: extra.span,
    });
  }

  const endToken = cursor.expectKeyword("end");
  const endName = cursor.expectIdentifier("model end name");
  const close = cursor.expectKind("semicolon", "model close");
  if (endName.text !== name.text) {
    throw new ModelicaParseError(
      "end_mismatch",
      `Model end name ${endName.text} does not match model ${name.text}.`,
      mergeSpan(endToken.span, endName.span),
    );
  }

  return Object.freeze({
    kind: "model",
    name: name.text,
    nameSpan: name.span,
    span: mergeSpan(start.span, close.span),
    parameters: Object.freeze(parameters),
    variables: Object.freeze(variables),
    equations: Object.freeze(equations),
  });
}

function parseTypedDeclaration(
  cursor: TokenCursor,
  prefix: "parameter" | "output",
  unresolved: ModelicaUnresolved[],
): ModelicaParameterNode | ModelicaVariableNode | undefined {
  const start = cursor.expectKeyword(prefix);
  const typeToken = cursor.peek();
  if (!isKeyword(typeToken, "Real")) {
    const extra = consumeToSemicolon(cursor);
    const span = extra?.span ?? start.span;
    if (isKind(typeToken, "lbracket") || looksLikeArrayDeclaration(extra?.text ?? "")) {
      unresolved.push({
        kind: "modelica-array-declaration",
        message: "Array declarations are not qualified in the Modelica closed subset.",
        span,
      });
      return undefined;
    }
    unresolved.push({
      kind: "modelica-unsupported-variable-type",
      message: "Only the Real type is qualified in the Modelica closed subset.",
      span,
    });
    return undefined;
  }
  cursor.take();
  const name = cursor.expectIdentifier(`${prefix} name`);
  if (isKind(cursor.peek(), "lbracket")) {
    const extra = consumeToSemicolon(cursor);
    unresolved.push({
      kind: "modelica-array-declaration",
      message: "Array declarations are not qualified in the Modelica closed subset.",
      span: extra?.span ?? name.span,
    });
    return undefined;
  }

  const attributes = isKind(cursor.peek(), "lparen")
    ? parseAttributeList(cursor, unresolved)
    : [];

  let defaultReferencedName: string | undefined;
  if (isKind(cursor.peek(), "equal")) {
    cursor.take();
    const defaultValue = parseScalarOrName(cursor);
    if (defaultValue === undefined) {
      const extra = consumeToSemicolon(cursor);
      unresolved.push({
        kind: "modelica-expression-not-qualified",
        message: "A parameter default must be a scalar in the Modelica closed subset.",
        span: extra?.span ?? name.span,
      });
    } else if (defaultValue.kind === "identifier") {
      if (prefix === "parameter") defaultReferencedName = defaultValue.text;
      const close = cursor.expectKind("semicolon", `${prefix} close`);
      return freezeDeclaration(
        prefix,
        start.span,
        name,
        attributes,
        close.span,
        defaultReferencedName,
      );
    } else if (prefix === "output") {
      unresolved.push({
        kind: "modelica-expression-not-qualified",
        message:
          "An output declaration does not take a default in the Modelica closed subset.",
        span: defaultValue.span,
      });
    }
  } else if (prefix === "parameter") {
    const extra = consumeToSemicolon(cursor);
    unresolved.push({
      kind: "modelica-expression-not-qualified",
      message:
        "A parameter declaration must have a scalar default in the Modelica closed subset.",
      span: extra?.span ?? name.span,
    });
    return undefined;
  }

  const close = cursor.expectKind("semicolon", `${prefix} close`);
  return freezeDeclaration(
    prefix,
    start.span,
    name,
    attributes,
    close.span,
    defaultReferencedName,
  );
}

function freezeDeclaration(
  prefix: "parameter" | "output",
  start: SourceAnalysisSpan,
  name: ModelicaToken,
  attributes: readonly ModelicaAttributeNode[],
  close: SourceAnalysisSpan,
  defaultReferencedName: string | undefined,
): ModelicaParameterNode | ModelicaVariableNode {
  const span = mergeSpan(start, close);
  if (prefix === "parameter") {
    return Object.freeze({
      kind: "parameter",
      name: name.text,
      nameSpan: name.span,
      span,
      attributes: Object.freeze([...attributes]),
      ...(defaultReferencedName === undefined ? {} : { defaultReferencedName }),
    });
  }
  return Object.freeze({
    kind: "variable",
    name: name.text,
    nameSpan: name.span,
    span,
    attributes: Object.freeze([...attributes]),
  });
}

function parseAttributeList(
  cursor: TokenCursor,
  unresolved: ModelicaUnresolved[],
): ModelicaAttributeNode[] {
  cursor.expectKind("lparen", "attribute list");
  const attributes: ModelicaAttributeNode[] = [];
  if (isKind(cursor.peek(), "rparen")) {
    cursor.take();
    return attributes;
  }
  while (!cursor.done && !isKind(cursor.peek(), "rparen")) {
    const name = cursor.peek();
    if (name?.kind !== "identifier" && name?.kind !== "keyword") {
      const extra = consumeToDelimiter(cursor, "rparen");
      if (extra !== undefined) {
        unresolved.push({
          kind: "modelica-unsupported-attribute",
          message: "Attribute names must be identifiers in the Modelica closed subset.",
          span: extra.span,
        });
      }
      break;
    }
    cursor.take();
    if (!isKind(cursor.peek(), "equal")) {
      unresolved.push({
        kind: "modelica-unsupported-attribute",
        message:
          "Attributes must have the form name = value in the Modelica closed subset.",
        span: name.span,
      });
      if (isKind(cursor.peek(), "comma")) {
        cursor.take();
        continue;
      }
      break;
    }
    cursor.take();
    const value = parseScalarOrName(cursor);
    if (value === undefined) {
      const extra = consumeToCommaOrParen(cursor);
      unresolved.push({
        kind: "modelica-expression-not-qualified",
        message: "Attribute values must be a scalar, string, boolean, or name.",
        span: extra?.span ?? name.span,
      });
    } else if (!QUALIFIED_ATTRIBUTES.has(name.text)) {
      unresolved.push({
        kind: "modelica-unsupported-attribute",
        message:
          "Only unit, start, fixed, displayUnit, min, and max are qualified attributes.",
        span: mergeSpan(name.span, value.span),
      });
    } else {
      attributes.push(Object.freeze({
        name: name.text,
        ...(value.kind === "identifier" ? { referencedName: value.text } : {}),
        span: mergeSpan(name.span, value.span),
      }));
    }
    if (isKind(cursor.peek(), "comma")) {
      cursor.take();
      continue;
    }
    break;
  }
  cursor.expectKind("rparen", "attribute list close");
  return attributes;
}

function parseEquationSection(
  cursor: TokenCursor,
  equations: ModelicaEquationNode[],
  unresolved: ModelicaUnresolved[],
): void {
  cursor.expectKeyword("equation");
  while (!cursor.done && !isEquationSectionEnd(cursor)) {
    const next = cursor.peek();
    if (next === undefined) break;
    if (isUnsupportedEquationStart(next)) {
      const extra = consumeConstruct(cursor);
      if (extra !== undefined) {
        unresolved.push({
          kind: "modelica-unsupported-equation-form",
          message: "when, if, for, while, and connect equations are not qualified.",
          span: extra.span,
        });
      }
      continue;
    }
    if (isKeyword(next, "der")) {
      const equation = tryParseDerEquation(cursor, equations.length);
      if (equation === undefined) {
        const extra = consumeToSemicolon(cursor);
        if (extra !== undefined) {
          unresolved.push({
            kind: "modelica-expression-not-qualified",
            message:
              "A der equation must have the form der(name) = qualified-expression.",
            span: extra.span,
          });
        }
        continue;
      }
      equations.push(equation);
      continue;
    }
    if (next.kind === "identifier") {
      const equation = tryParseAlgebraicEquation(cursor, equations.length);
      if (equation === undefined) {
        const extra = consumeToSemicolon(cursor);
        if (extra !== undefined) {
          unresolved.push({
            kind: "modelica-expression-not-qualified",
            message:
              "An algebraic equation must have the form name = qualified-expression.",
            span: extra.span,
          });
        }
        continue;
      }
      equations.push(equation);
      continue;
    }
    const extra = consumeConstruct(cursor);
    if (extra !== undefined) {
      unresolved.push({
        kind: "modelica-unsupported-equation-form",
        message: "Only der(name) = expr and name = expr are qualified equations.",
        span: extra.span,
      });
    }
  }
}

function tryParseDerEquation(
  cursor: TokenCursor,
  ordinal: number,
): ModelicaEquationNode | undefined {
  const marked = cursor.mark();
  const start = cursor.peek();
  if (
    !isKeyword(start, "der") ||
    !isKind(cursor.peekAt(1), "lparen") ||
    cursor.peekAt(2)?.kind !== "identifier" ||
    !isKind(cursor.peekAt(3), "rparen") ||
    !isKind(cursor.peekAt(4), "equal")
  ) {
    return undefined;
  }
  cursor.take();
  cursor.take();
  const lhs = cursor.take()!;
  cursor.take();
  cursor.take();
  const rhs = parseQualifiedExpression(cursor);
  if (rhs === undefined || !isKind(cursor.peek(), "semicolon")) {
    cursor.reset(marked);
    return undefined;
  }
  const close = cursor.take()!;
  return Object.freeze({
    kind: "equation",
    discriminator: "der",
    lhsName: lhs.text,
    rhsNames: Object.freeze([...rhs.names]),
    span: mergeSpan(start!.span, close.span),
    ordinal,
  });
}

function tryParseAlgebraicEquation(
  cursor: TokenCursor,
  ordinal: number,
): ModelicaEquationNode | undefined {
  const marked = cursor.mark();
  const lhs = cursor.peek();
  if (lhs?.kind !== "identifier" || !isKind(cursor.peekAt(1), "equal")) {
    return undefined;
  }
  cursor.take();
  cursor.take();
  const rhs = parseQualifiedExpression(cursor);
  if (rhs === undefined || !isKind(cursor.peek(), "semicolon")) {
    cursor.reset(marked);
    return undefined;
  }
  const close = cursor.take()!;
  return Object.freeze({
    kind: "equation",
    discriminator: "algebraic",
    lhsName: lhs.text,
    rhsNames: Object.freeze([...rhs.names]),
    span: mergeSpan(lhs.span, close.span),
    ordinal,
  });
}

interface QualifiedExpression {
  readonly names: readonly string[];
  readonly span: SourceAnalysisSpan;
}

interface ScalarOrName {
  readonly kind: "number" | "string" | "boolean" | "identifier";
  readonly text: string;
  readonly span: SourceAnalysisSpan;
}

function parseScalarOrName(cursor: TokenCursor): ScalarOrName | undefined {
  const token = cursor.peek();
  if (token === undefined) return undefined;
  if (isKind(token, "minus") && cursor.peekAt(1)?.kind === "number") {
    const minus = cursor.take()!;
    const number = cursor.take()!;
    return {
      kind: "number",
      text: `-${number.text}`,
      span: mergeSpan(minus.span, number.span),
    };
  }
  if (token.kind === "number") {
    cursor.take();
    return { kind: "number", text: token.text, span: token.span };
  }
  if (token.kind === "string") {
    cursor.take();
    return { kind: "string", text: token.text, span: token.span };
  }
  if (isKeyword(token, "true") || isKeyword(token, "false")) {
    cursor.take();
    return { kind: "boolean", text: token.text, span: token.span };
  }
  if (token.kind === "identifier") {
    cursor.take();
    return { kind: "identifier", text: token.text, span: token.span };
  }
  return undefined;
}

function parseQualifiedExpression(
  cursor: TokenCursor,
): QualifiedExpression | undefined {
  return parseSum(cursor);
}

function parseSum(cursor: TokenCursor): QualifiedExpression | undefined {
  const first = parseTerm(cursor);
  if (first === undefined) return undefined;
  const names = [...first.names];
  let span = first.span;
  while (isKind(cursor.peek(), "plus") || isKind(cursor.peek(), "minus")) {
    cursor.take();
    const next = parseTerm(cursor);
    if (next === undefined) return undefined;
    names.push(...next.names);
    span = mergeSpan(span, next.span);
  }
  return { names, span };
}

function parseTerm(cursor: TokenCursor): QualifiedExpression | undefined {
  const first = parseFactor(cursor);
  if (first === undefined) return undefined;
  const names = [...first.names];
  let span = first.span;
  while (isKind(cursor.peek(), "star") || isKind(cursor.peek(), "slash")) {
    cursor.take();
    const next = parseFactor(cursor);
    if (next === undefined) return undefined;
    names.push(...next.names);
    span = mergeSpan(span, next.span);
  }
  return { names, span };
}

function parseFactor(cursor: TokenCursor): QualifiedExpression | undefined {
  const token = cursor.peek();
  if (token === undefined) return undefined;
  if (isKind(token, "minus")) {
    cursor.take();
    const inner = parseFactor(cursor);
    if (inner === undefined) return undefined;
    return { names: inner.names, span: mergeSpan(token.span, inner.span) };
  }
  if (isKind(token, "lparen")) {
    cursor.take();
    const inner = parseSum(cursor);
    if (inner === undefined || !isKind(cursor.peek(), "rparen")) return undefined;
    const close = cursor.take()!;
    return { names: inner.names, span: mergeSpan(token.span, close.span) };
  }
  if (isKeyword(token, "der") && isKind(cursor.peekAt(1), "lparen")) {
    cursor.take();
    cursor.take();
    const name = cursor.peek();
    if (name?.kind !== "identifier" || !isKind(cursor.peekAt(1), "rparen")) {
      return undefined;
    }
    cursor.take();
    const close = cursor.take()!;
    return { names: [name.text], span: mergeSpan(token.span, close.span) };
  }
  if (token.kind === "number") {
    cursor.take();
    return { names: [], span: token.span };
  }
  if (token.kind === "identifier") {
    if (
      isKind(cursor.peekAt(1), "lparen") ||
      isKind(cursor.peekAt(1), "dot") ||
      isKind(cursor.peekAt(1), "lbracket")
    ) {
      return undefined;
    }
    cursor.take();
    return { names: [token.text], span: token.span };
  }
  return undefined;
}

function classifyTopLevel(
  extra: { readonly text: string; readonly span: SourceAnalysisSpan },
): ModelicaUnresolved {
  const head = extra.text.trim().split(/\s+/, 1)[0] ?? "";
  if (UNSUPPORTED_TOP_LEVEL.has(head)) {
    return {
      kind: "modelica-unsupported-top-level-form",
      message:
        "import, extends, class, block, record, function, package, and type are not qualified.",
      span: extra.span,
    };
  }
  return {
    kind: "modelica-unsupported-top-level-form",
    message: "Only a single root model block is qualified at the top level.",
    span: extra.span,
  };
}

function isUnsupportedTopLevelStart(token: ModelicaToken | undefined): boolean {
  return token !== undefined &&
    (token.kind === "identifier" || token.kind === "keyword") &&
    UNSUPPORTED_TOP_LEVEL.has(token.text);
}

function isUnsupportedSectionStart(token: ModelicaToken | undefined): boolean {
  return token?.kind === "identifier" &&
    (token.text === "algorithm" || token.text === "protected" ||
      token.text === "public");
}

function isUnsupportedEquationStart(token: ModelicaToken): boolean {
  if (token.kind !== "identifier") return false;
  return token.text === "when" || token.text === "if" || token.text === "for" ||
    token.text === "while" || token.text === "connect";
}

function isInitialSection(cursor: TokenCursor): boolean {
  const token = cursor.peek();
  return token?.kind === "identifier" && token.text === "initial" &&
    (isKeyword(cursor.peekAt(1), "equation") ||
      (cursor.peekAt(1)?.kind === "identifier" &&
        cursor.peekAt(1)?.text === "algorithm"));
}

function isBareTypeDeclaration(cursor: TokenCursor): boolean {
  const token = cursor.peek();
  if (token === undefined) return false;
  if (isKeyword(token, "Real")) return true;
  if (token.kind !== "identifier") return false;
  const next = cursor.peekAt(1);
  return next?.kind === "identifier" || isKind(next, "lbracket");
}

function isEquationSectionEnd(cursor: TokenCursor): boolean {
  const token = cursor.peek();
  if (token === undefined || isKeyword(token, "end")) return true;
  if (
    isKeyword(token, "equation") || isKeyword(token, "parameter") ||
    isKeyword(token, "output")
  ) {
    return true;
  }
  return isInitialSection(cursor) || isUnsupportedSectionStart(token);
}

function looksLikeArrayDeclaration(text: string): boolean {
  return text.includes("[");
}

function consumeSection(cursor: TokenCursor): SourceAnalysisSpan | undefined {
  const first = cursor.peek();
  if (first === undefined) return undefined;
  cursor.take();
  if (isInitialSectionHeader(first, cursor.peek())) cursor.take();
  const start = first.span;
  let last = first.span;
  while (!cursor.done && !isEquationSectionEnd(cursor)) {
    const next = cursor.take();
    if (next === undefined) break;
    last = next.span;
  }
  return mergeSpan(start, last);
}

function isInitialSectionHeader(
  first: ModelicaToken,
  second: ModelicaToken | undefined,
): boolean {
  return first.kind === "identifier" && first.text === "initial" &&
    (isKeyword(second, "equation") ||
      (second?.kind === "identifier" && second.text === "algorithm"));
}

function consumeConstruct(
  cursor: TokenCursor,
): { readonly text: string; readonly span: SourceAnalysisSpan } | undefined {
  const first = cursor.peek();
  if (first === undefined) return undefined;
  if (
    (first.kind === "identifier" || first.kind === "keyword") &&
    BLOCK_CLOSERS.has(first.text)
  ) {
    return consumeBlock(cursor, first.text);
  }
  return consumeToSemicolon(cursor);
}

function consumeBlock(
  cursor: TokenCursor,
  _opener: string,
): { readonly text: string; readonly span: SourceAnalysisSpan } | undefined {
  const first = cursor.take();
  if (first === undefined) return undefined;
  const parts = [first.text];
  const start = first.span;
  let last = first.span;
  let depth = 1;
  while (!cursor.done && depth > 0) {
    const token = cursor.peek()!;
    parts.push(token.text);
    last = token.span;
    if (
      (token.kind === "identifier" || token.kind === "keyword") &&
      BLOCK_CLOSERS.has(token.text)
    ) {
      cursor.take();
      depth += 1;
      continue;
    }
    if (isKeyword(token, "end")) {
      cursor.take();
      const closer = cursor.peek();
      if (
        closer !== undefined &&
        (closer.kind === "identifier" || closer.kind === "keyword")
      ) {
        parts.push(closer.text);
        last = closer.span;
        cursor.take();
        depth -= 1;
      } else {
        depth -= 1;
      }
      if (isKind(cursor.peek(), "semicolon")) {
        const semi = cursor.take()!;
        parts.push(semi.text);
        last = semi.span;
      }
      continue;
    }
    cursor.take();
  }
  return { text: parts.join(" "), span: mergeSpan(start, last) };
}

function consumeToSemicolon(
  cursor: TokenCursor,
): { readonly text: string; readonly span: SourceAnalysisSpan } | undefined {
  const first = cursor.peek();
  if (first === undefined) return undefined;
  const parts = [first.text];
  const start = first.span;
  let last = first.span;
  let depth = 0;
  while (!cursor.done) {
    const token = cursor.take()!;
    if (token !== first) parts.push(token.text);
    last = token.span;
    if (isKind(token, "lparen") || isKind(token, "lbracket")) {
      depth += 1;
      continue;
    }
    if (isKind(token, "rparen") || isKind(token, "rbracket")) {
      depth -= 1;
      continue;
    }
    if (depth <= 0 && isKind(token, "semicolon")) break;
    if (depth <= 0 && isKeyword(token, "end") && token !== first) {
      break;
    }
  }
  return { text: parts.join(" "), span: mergeSpan(start, last) };
}

function consumeToDelimiter(
  cursor: TokenCursor,
  delimiter: "rparen",
): { readonly text: string; readonly span: SourceAnalysisSpan } | undefined {
  const first = cursor.peek();
  if (first === undefined) return undefined;
  const parts: string[] = [];
  const start = first.span;
  let last = first.span;
  let depth = 0;
  while (!cursor.done) {
    const token = cursor.peek()!;
    if (depth === 0 && isKind(token, delimiter)) break;
    cursor.take();
    parts.push(token.text);
    last = token.span;
    if (isKind(token, "lparen")) depth += 1;
    if (isKind(token, "rparen")) depth -= 1;
  }
  if (parts.length === 0) return undefined;
  return { text: parts.join(" "), span: mergeSpan(start, last) };
}

function consumeToCommaOrParen(
  cursor: TokenCursor,
): { readonly text: string; readonly span: SourceAnalysisSpan } | undefined {
  const first = cursor.peek();
  if (first === undefined) return undefined;
  const parts: string[] = [];
  const start = first.span;
  let last = first.span;
  let depth = 0;
  while (!cursor.done) {
    const token = cursor.peek()!;
    if (depth === 0 && (isKind(token, "comma") || isKind(token, "rparen"))) {
      break;
    }
    cursor.take();
    parts.push(token.text);
    last = token.span;
    if (isKind(token, "lparen")) depth += 1;
    if (isKind(token, "rparen")) depth -= 1;
  }
  if (parts.length === 0) return undefined;
  return { text: parts.join(" "), span: mergeSpan(start, last) };
}

class TokenCursor {
  #index = 0;

  constructor(readonly tokens: readonly ModelicaToken[]) {}

  get done(): boolean {
    return this.#index >= this.tokens.length;
  }

  peek(): ModelicaToken | undefined {
    return this.tokens[this.#index];
  }

  peekAt(offset: number): ModelicaToken | undefined {
    return this.tokens[this.#index + offset];
  }

  take(): ModelicaToken | undefined {
    const token = this.tokens[this.#index];
    if (token !== undefined) this.#index += 1;
    return token;
  }

  mark(): number {
    return this.#index;
  }

  reset(index: number): void {
    this.#index = index;
  }

  expectKeyword(text: string): ModelicaToken {
    const token = this.peek();
    if (!isKeyword(token, text)) {
      throw new ModelicaParseError(
        text === "end" ? "unclosed_block" : "unexpected_token",
        `Expected keyword ${text} in the Modelica closed subset.`,
        token?.span,
      );
    }
    return this.take()!;
  }

  expectIdentifier(label: string): ModelicaToken {
    const token = this.peek();
    if (token?.kind !== "identifier") {
      throw new ModelicaParseError(
        "unexpected_token",
        `Expected ${label} in the Modelica closed subset.`,
        token?.span,
      );
    }
    return this.take()!;
  }

  expectKind(
    kind: ModelicaToken["kind"],
    label: string,
  ): ModelicaToken {
    const token = this.peek();
    if (!isKind(token, kind)) {
      throw new ModelicaParseError(
        kind === "semicolon" && this.done ? "unclosed_block" : "unexpected_token",
        `Expected ${label} in the Modelica closed subset.`,
        token?.span,
      );
    }
    return this.take()!;
  }
}

function isKeyword(
  token: ModelicaToken | undefined,
  text: string,
): boolean {
  return token?.kind === "keyword" && token.text === text;
}

function isKind(
  token: ModelicaToken | undefined,
  kind: ModelicaToken["kind"],
): boolean {
  return token?.kind === kind;
}

function mergeSpan(
  start: SourceAnalysisSpan,
  end: SourceAnalysisSpan,
): SourceAnalysisSpan {
  return { start: start.start, end: end.end };
}
