/** Strict parser for the executable generic Modelica closed subset v2. */

import {
  type ModelicaToken,
  type SourceAnalysisSpan,
  tokenizeModelicaSubset,
} from "./lexical.ts";

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

/** V2 rejects unsupported constructs instead of emitting a partial success. */
export interface ModelicaUnresolved {
  readonly kind: string;
  readonly message: string;
  readonly span: SourceAnalysisSpan;
}

export interface ModelicaAttributeNode {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly referencedName?: string;
  readonly span: SourceAnalysisSpan;
}
export interface ModelicaParameterNode {
  readonly kind: "parameter";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly span: SourceAnalysisSpan;
  readonly attributes: readonly ModelicaAttributeNode[];
  readonly defaultValue: number;
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
export interface ModelicaExperimentNode {
  readonly startTime: number;
  readonly stopTime: number;
  readonly interval: number;
  readonly tolerance: number;
  readonly span: SourceAnalysisSpan;
}
export interface ModelicaModelNode {
  readonly kind: "model";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly span: SourceAnalysisSpan;
  readonly parameters: readonly ModelicaParameterNode[];
  readonly variables: readonly ModelicaVariableNode[];
  readonly equations: readonly ModelicaEquationNode[];
  readonly experiment: ModelicaExperimentNode;
}
export interface ModelicaParse {
  readonly model: ModelicaModelNode;
  readonly unresolved: readonly ModelicaUnresolved[];
}

/** Parse one entire source; there is no partial or best-effort v2 parse. */
export function parseModelicaSubset(sourceText: string): ModelicaParse {
  const cursor = new Cursor(tokenizeModelicaSubset(sourceText));
  const start = cursor.expectText("model");
  const name = cursor.identifier("model name");
  if (cursor.peek()?.kind === "string") cursor.take();
  const parameters: ModelicaParameterNode[] = [];
  const variables: ModelicaVariableNode[] = [];
  while (cursor.peek()?.text === "parameter" || cursor.peek()?.text === "output") {
    if (cursor.peek()!.text === "parameter") parameters.push(parseParameter(cursor));
    else variables.push(parseOutput(cursor));
  }
  cursor.expectText("equation");
  const equations: ModelicaEquationNode[] = [];
  while (cursor.peek()?.text !== "annotation") {
    if (cursor.peek()?.text === "end") {
      throw error(
        "unexpected_token",
        "Modelica v2 requires one experiment annotation.",
        cursor.peek(),
      );
    }
    equations.push(parseEquation(cursor, equations.length));
  }
  const experiment = parseExperiment(cursor);
  const end = cursor.expectText("end");
  const endName = cursor.identifier("model end name");
  const close = cursor.expectKind("semicolon", "model close");
  if (name.text !== endName.text) {
    throw new ModelicaParseError(
      "end_mismatch",
      `Model end name ${endName.text} does not match model ${name.text}.`,
      mergeSpan(end.span, endName.span),
    );
  }
  if (!cursor.done) {
    throw error(
      "unexpected_token",
      "Modelica v2 permits exactly one root model.",
      cursor.peek(),
    );
  }
  return Object.freeze({
    model: Object.freeze({
      kind: "model",
      name: name.text,
      nameSpan: name.span,
      span: mergeSpan(start.span, close.span),
      parameters: Object.freeze(parameters),
      variables: Object.freeze(variables),
      equations: Object.freeze(equations),
      experiment,
    }),
    unresolved: Object.freeze([]),
  });
}

function parseParameter(cursor: Cursor): ModelicaParameterNode {
  const start = cursor.expectText("parameter");
  cursor.expectText("Real");
  const name = cursor.identifier("parameter name");
  const attributes = parseAttributes(cursor);
  cursor.expectKind("equal", "parameter default");
  const defaultValue = signedNumber(cursor, "parameter default");
  const close = cursor.expectKind("semicolon", "parameter close");
  return Object.freeze({
    kind: "parameter",
    name: name.text,
    nameSpan: name.span,
    span: mergeSpan(start.span, close.span),
    attributes,
    defaultValue: defaultValue.value,
  });
}

function parseOutput(cursor: Cursor): ModelicaVariableNode {
  const start = cursor.expectText("output");
  cursor.expectText("Real");
  const name = cursor.identifier("output name");
  const attributes = parseAttributes(cursor);
  const close = cursor.expectKind("semicolon", "output close");
  return Object.freeze({
    kind: "variable",
    name: name.text,
    nameSpan: name.span,
    span: mergeSpan(start.span, close.span),
    attributes,
  });
}

function parseAttributes(cursor: Cursor): readonly ModelicaAttributeNode[] {
  cursor.expectKind("lparen", "attribute open");
  const attributes: ModelicaAttributeNode[] = [];
  while (cursor.peek()?.kind !== "rparen") {
    const name = cursor.identifier("attribute name");
    cursor.expectKind("equal", "attribute value");
    const value = attributeValue(cursor);
    attributes.push(Object.freeze({
      name: name.text,
      value: value.value,
      ...(value.referencedName === undefined
        ? {}
        : { referencedName: value.referencedName }),
      span: mergeSpan(name.span, value.span),
    }));
    if (cursor.peek()?.kind === "comma") cursor.take();
    else if (cursor.peek()?.kind !== "rparen") {
      throw error(
        "unexpected_token",
        "Modelica attribute list is not closed.",
        cursor.peek(),
      );
    }
  }
  cursor.expectKind("rparen", "attribute close");
  return Object.freeze(attributes);
}

function attributeValue(cursor: Cursor): {
  value: string | number | boolean;
  referencedName?: string;
  span: SourceAnalysisSpan;
} {
  if (cursor.peek()?.kind === "minus") {
    const sign = cursor.take();
    const token = cursor.take();
    if (token.kind !== "number") {
      throw error(
        "unexpected_token",
        "Modelica attribute value must be scalar.",
        token,
      );
    }
    return { value: -finite(token), span: mergeSpan(sign.span, token.span) };
  }
  const token = cursor.take();
  if (token.kind === "string") {
    return { value: JSON.parse(token.text) as string, span: token.span };
  }
  if (token.kind === "number") return { value: finite(token), span: token.span };
  if (token.text === "true") return { value: true, span: token.span };
  if (token.text === "false") return { value: false, span: token.span };
  if (token.kind === "identifier") {
    return { value: token.text, referencedName: token.text, span: token.span };
  }
  throw error("unexpected_token", "Modelica attribute value must be scalar.", token);
}

function parseEquation(cursor: Cursor, ordinal: number): ModelicaEquationNode {
  const start = cursor.peek() ?? missing("equation");
  let discriminator: "der" | "algebraic";
  let lhs: ModelicaToken;
  if (cursor.peek()?.text === "der") {
    discriminator = "der";
    cursor.take();
    cursor.expectKind("lparen", "derivative lhs");
    lhs = cursor.identifier("derivative output");
    cursor.expectKind("rparen", "derivative lhs");
  } else {
    discriminator = "algebraic";
    lhs = cursor.identifier("equation lhs");
  }
  cursor.expectKind("equal", "equation equal");
  const rhsNames = new Set<string>();
  expression(cursor, rhsNames);
  const close = cursor.expectKind("semicolon", "equation close");
  return Object.freeze({
    kind: "equation",
    discriminator,
    lhsName: lhs.text,
    rhsNames: Object.freeze([...rhsNames]),
    span: mergeSpan(start.span, close.span),
    ordinal,
  });
}

function expression(cursor: Cursor, names: Set<string>): void {
  term(cursor, names);
  while (cursor.peek()?.kind === "plus" || cursor.peek()?.kind === "minus") {
    cursor.take();
    term(cursor, names);
  }
}
function term(cursor: Cursor, names: Set<string>): void {
  primary(cursor, names);
  while (cursor.peek()?.kind === "star" || cursor.peek()?.kind === "slash") {
    cursor.take();
    primary(cursor, names);
  }
}
function primary(cursor: Cursor, names: Set<string>): void {
  if (cursor.peek()?.kind === "plus" || cursor.peek()?.kind === "minus") cursor.take();
  const token = cursor.take();
  if (token.kind === "number") {
    finite(token);
    return;
  }
  if (token.kind === "identifier") {
    names.add(token.text);
    return;
  }
  if (token.kind === "lparen") {
    expression(cursor, names);
    cursor.expectKind("rparen", "expression close");
    return;
  }
  throw error(
    "unexpected_token",
    "Modelica RHS expression is not closed-subset v2.",
    token,
  );
}

function parseExperiment(cursor: Cursor): ModelicaExperimentNode {
  const start = cursor.expectText("annotation");
  cursor.expectKind("lparen", "annotation open");
  cursor.expectText("experiment");
  cursor.expectKind("lparen", "experiment open");
  const fields = new Map<string, { value: number; span: SourceAnalysisSpan }>();
  while (cursor.peek()?.kind !== "rparen") {
    const name = cursor.identifier("experiment field");
    cursor.expectKind("equal", "experiment value");
    const value = signedNumber(cursor, `experiment ${name.text}`);
    if (fields.has(name.text)) {
      throw error(
        "unexpected_token",
        "Modelica experiment fields must be singular.",
        name,
      );
    }
    fields.set(name.text, value);
    if (cursor.peek()?.kind === "comma") cursor.take();
    else if (cursor.peek()?.kind !== "rparen") {
      throw error(
        "unexpected_token",
        "Modelica experiment list is not closed.",
        cursor.peek(),
      );
    }
  }
  cursor.expectKind("rparen", "experiment close");
  cursor.expectKind("rparen", "annotation close");
  const close = cursor.expectKind("semicolon", "annotation close");
  const expected = ["StartTime", "StopTime", "Interval", "Tolerance"];
  if (fields.size !== expected.length || expected.some((name) => !fields.has(name))) {
    throw error("unexpected_token", "Modelica experiment fields must be exact.", start);
  }
  return Object.freeze({
    startTime: fields.get("StartTime")!.value,
    stopTime: fields.get("StopTime")!.value,
    interval: fields.get("Interval")!.value,
    tolerance: fields.get("Tolerance")!.value,
    span: mergeSpan(start.span, close.span),
  });
}

function signedNumber(
  cursor: Cursor,
  label: string,
): { value: number; span: SourceAnalysisSpan } {
  const sign = cursor.peek()?.kind === "minus" ? (cursor.take(), -1) : 1;
  const token = cursor.take();
  if (token.kind !== "number") {
    throw error("unexpected_token", `Modelica ${label} must be finite.`, token);
  }
  return { value: sign * finite(token), span: token.span };
}
function finite(token: ModelicaToken): number {
  const value = Number(token.text);
  if (!Number.isFinite(value)) {
    throw error("unexpected_token", "Modelica scalar must be finite.", token);
  }
  return value;
}

class Cursor {
  #index = 0;
  constructor(readonly tokens: readonly ModelicaToken[]) {}
  get done(): boolean {
    return this.#index === this.tokens.length;
  }
  peek(): ModelicaToken | undefined {
    return this.tokens[this.#index];
  }
  take(): ModelicaToken {
    const token = this.peek();
    if (token === undefined) return missing("token");
    this.#index += 1;
    return token;
  }
  expectText(text: string): ModelicaToken {
    const token = this.take();
    if (token.text !== text) {
      throw error("unexpected_token", `Modelica expected ${text}.`, token);
    }
    return token;
  }
  expectKind(kind: ModelicaToken["kind"], label: string): ModelicaToken {
    const token = this.take();
    if (token.kind !== kind) {
      throw error("unexpected_token", `Modelica expected ${label}.`, token);
    }
    return token;
  }
  identifier(label: string): ModelicaToken {
    const token = this.take();
    if (token.kind !== "identifier") {
      throw error("unexpected_token", `Modelica expected ${label}.`, token);
    }
    return token;
  }
}
function error(
  code: ModelicaParseErrorCode,
  message: string,
  token?: ModelicaToken,
): ModelicaParseError {
  return new ModelicaParseError(code, message, token?.span);
}
function missing(label: string): never {
  throw new ModelicaParseError(
    "unclosed_block",
    `Modelica source ended while reading ${label}.`,
  );
}
function mergeSpan(
  start: SourceAnalysisSpan,
  end: SourceAnalysisSpan,
): SourceAnalysisSpan {
  return { start: start.start, end: end.end };
}
