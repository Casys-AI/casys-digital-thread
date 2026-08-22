/** Strict parser for the circuit-only SPICE closed subset v1. */

import {
  type SourceAnalysisSpan,
  SpiceLexicalError,
  spiceNumberValue,
  type SpiceToken,
  tokenizeSpiceCircuitSubset,
} from "./lexical.ts";

export type SpiceParseErrorCode =
  | "empty_circuit"
  | "unexpected_token"
  | "unsupported_directive"
  | "unsupported_element"
  | "unclosed_statement";

export class SpiceParseError extends Error {
  constructor(
    readonly code: SpiceParseErrorCode,
    message: string,
    readonly span?: SourceAnalysisSpan,
  ) {
    super(message);
    this.name = "SpiceParseError";
  }
}

export type SpiceElementType = "R" | "C" | "L" | "V" | "I" | "D" | "Q" | "M" | "K";
export type SpiceModelType = "D" | "NPN" | "PNP" | "NMOS" | "PMOS";

export interface SpiceNumberLiteral {
  readonly kind: "number";
  readonly spelling: string;
  readonly value: number;
  readonly span: SourceAnalysisSpan;
}

export interface SpiceParamRef {
  readonly kind: "param-ref";
  readonly name: string;
  readonly span: SourceAnalysisSpan;
}

export type SpiceValue = SpiceNumberLiteral | SpiceParamRef;

export interface SpiceNodeRef {
  readonly name: string;
  readonly span: SourceAnalysisSpan;
}

export interface SpiceNamedValue {
  readonly name: string;
  readonly value: SpiceValue;
  readonly span: SourceAnalysisSpan;
}

export interface SpiceElementNode {
  readonly kind: "element";
  readonly type: SpiceElementType;
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly nodes: readonly SpiceNodeRef[];
  readonly value?: SpiceValue;
  readonly modelName?: string;
  readonly modelNameSpan?: SourceAnalysisSpan;
  readonly namedValues: readonly SpiceNamedValue[];
  readonly inductorNames: readonly string[];
  readonly span: SourceAnalysisSpan;
}

export interface SpiceParamNode {
  readonly kind: "param";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly value: SpiceNumberLiteral;
  readonly span: SourceAnalysisSpan;
}

export interface SpiceModelParameter {
  readonly name: string;
  readonly value: SpiceNumberLiteral;
  readonly span: SourceAnalysisSpan;
}

export interface SpiceModelNode {
  readonly kind: "model";
  readonly name: string;
  readonly nameSpan: SourceAnalysisSpan;
  readonly type: SpiceModelType;
  readonly parameters: readonly SpiceModelParameter[];
  readonly span: SourceAnalysisSpan;
}

export interface SpiceCircuitNode {
  readonly kind: "circuit";
  readonly title?: string;
  readonly elements: readonly SpiceElementNode[];
  readonly parameters: readonly SpiceParamNode[];
  readonly models: readonly SpiceModelNode[];
}

export interface SpiceParse {
  readonly circuit: SpiceCircuitNode;
}

const ELEMENT_TYPES = new Set<string>([
  "R",
  "C",
  "L",
  "V",
  "I",
  "D",
  "Q",
  "M",
  "K",
]);
const MODEL_TYPES = new Map<string, SpiceModelType>([
  ["d", "D"],
  ["npn", "NPN"],
  ["pnp", "PNP"],
  ["nmos", "NMOS"],
  ["pmos", "PMOS"],
]);
const MOSFET_PARAMS = new Set(["l", "w"]);
const REJECTED_SOURCE_TOKENS = new Set([
  "ac",
  "am",
  "cur",
  "exp",
  "file",
  "laplace",
  "poly",
  "pulse",
  "pwl",
  "sffm",
  "sin",
  "table",
  "trnoise",
  "trrandom",
  "value",
  "vol",
]);

/** Parse one entire circuit; there is no partial or best-effort v1 parse. */
export function parseSpiceCircuitSubset(sourceText: string): SpiceParse {
  const cursor = new Cursor(tokenizeSpiceCircuitSubset(sourceText));
  const elements: SpiceElementNode[] = [];
  const parameters: SpiceParamNode[] = [];
  const models: SpiceModelNode[] = [];
  let title: string | undefined;

  while (!cursor.done) {
    if (cursor.peek()?.kind === "eol") {
      cursor.take();
      continue;
    }
    const head = cursor.peek();
    if (head?.kind === "directive") {
      const directive = head.text.toLowerCase();
      if (directive === ".title") {
        if (title !== undefined) {
          throw error(
            "unexpected_token",
            "SPICE v1 permits at most one .title.",
            head,
          );
        }
        title = parseTitle(cursor);
        continue;
      }
      if (directive === ".param") {
        parameters.push(...parseParams(cursor));
        continue;
      }
      if (directive === ".model") {
        models.push(parseModel(cursor));
        continue;
      }
      throw error(
        "unsupported_directive",
        `SPICE v1 rejects ${head.text}; the circuit closed subset owns only .model, .param, and .title.`,
        head,
      );
    }
    if (head?.kind === "identifier") {
      elements.push(parseElement(cursor));
      continue;
    }
    throw error(
      "unexpected_token",
      "SPICE v1 expected a circuit element or an admitted directive.",
      head,
    );
  }

  if (elements.length === 0) {
    throw new SpiceParseError(
      "empty_circuit",
      "SPICE v1 requires at least one circuit element.",
    );
  }

  return Object.freeze({
    circuit: Object.freeze({
      kind: "circuit",
      ...(title === undefined ? {} : { title }),
      elements: Object.freeze(elements),
      parameters: Object.freeze(parameters),
      models: Object.freeze(models),
    }),
  });
}

function parseTitle(cursor: Cursor): string {
  const start = cursor.expectDirective(".title");
  const parts: string[] = [];
  while (!cursor.atStatementEnd()) {
    parts.push(cursor.take().text);
  }
  cursor.consumeEol();
  if (parts.length === 0) {
    throw error("unexpected_token", "SPICE .title requires a title.", start);
  }
  return parts.join(" ");
}

function parseParams(cursor: Cursor): SpiceParamNode[] {
  const start = cursor.expectDirective(".param");
  const params: SpiceParamNode[] = [];
  while (!cursor.atStatementEnd()) {
    const name = cursor.identifier("parameter name");
    cursor.expectKind("equal", "parameter equal");
    const value = parseNumber(cursor, "parameter value");
    params.push(Object.freeze({
      kind: "param",
      name: name.text,
      nameSpan: name.span,
      value,
      span: mergeSpan(name.span, value.span),
    }));
  }
  cursor.consumeEol();
  if (params.length === 0) {
    throw error("unexpected_token", "SPICE .param requires a name=value pair.", start);
  }
  return params;
}

function parseModel(cursor: Cursor): SpiceModelNode {
  const start = cursor.expectDirective(".model");
  const name = cursor.identifier("model name");
  const typeToken = cursor.identifier("model type");
  const type = MODEL_TYPES.get(typeToken.text.toLowerCase());
  if (type === undefined) {
    throw error(
      "unexpected_token",
      "SPICE v1 model types are D, NPN, PNP, NMOS, and PMOS.",
      typeToken,
    );
  }
  const wrapped = cursor.peek()?.kind === "lparen";
  if (wrapped) cursor.take();
  const parameters: SpiceModelParameter[] = [];
  while (!cursor.atStatementEnd()) {
    if (wrapped && cursor.peek()?.kind === "rparen") break;
    const paramName = cursor.identifier("model parameter");
    cursor.expectKind("equal", "model parameter equal");
    const value = parseNumber(cursor, "model parameter value");
    parameters.push(Object.freeze({
      name: paramName.text,
      value,
      span: mergeSpan(paramName.span, value.span),
    }));
  }
  let close = typeToken;
  if (wrapped) close = cursor.expectKind("rparen", "model close");
  cursor.consumeEol();
  return Object.freeze({
    kind: "model",
    name: name.text,
    nameSpan: name.span,
    type,
    parameters: Object.freeze(parameters),
    span: mergeSpan(start.span, close.span),
  });
}

function parseElement(cursor: Cursor): SpiceElementNode {
  const name = cursor.identifier("element name");
  rejectUnsafeToken(name);
  const typeLetter = name.text[0]!.toUpperCase();
  if (!ELEMENT_TYPES.has(typeLetter)) {
    throw error(
      "unsupported_element",
      "SPICE v1 circuit elements are R, C, L, V, I, D, Q, M, and K only.",
      name,
    );
  }
  const type = typeLetter as SpiceElementType;
  if (type === "K") return parseCoupling(cursor, name);
  if (type === "D") return parseDiode(cursor, name);
  if (type === "Q") return parseBjt(cursor, name);
  if (type === "M") return parseMosfet(cursor, name);

  const nodes = [parseNode(cursor), parseNode(cursor)];
  if (type === "V" || type === "I") {
    if (cursor.peek()?.kind === "identifier") {
      const qualifier = cursor.peek()!;
      if (qualifier.text.toLowerCase() === "dc") cursor.take();
      else rejectUnsafeToken(qualifier);
    }
  }
  const value = parseValue(cursor, `${type} value`);
  return finishElement(cursor, {
    type,
    name,
    nodes,
    value,
    namedValues: [],
    inductorNames: [],
  });
}

function parseDiode(cursor: Cursor, name: SpiceToken): SpiceElementNode {
  const nodes = [parseNode(cursor), parseNode(cursor)];
  const model = cursor.identifier("diode model");
  rejectUnsafeToken(model);
  return finishElement(cursor, {
    type: "D",
    name,
    nodes,
    model,
    namedValues: [],
    inductorNames: [],
  });
}

function parseBjt(cursor: Cursor, name: SpiceToken): SpiceElementNode {
  const nodes = [parseNode(cursor), parseNode(cursor), parseNode(cursor)];
  const fourth = cursor.peek();
  if (fourth?.kind === "identifier") {
    cursor.take();
    rejectUnsafeToken(fourth);
    if (cursor.peek()?.kind === "identifier") {
      nodes.push({ name: fourth.text, span: fourth.span });
      const model = cursor.identifier("BJT model");
      rejectUnsafeToken(model);
      return finishElement(cursor, {
        type: "Q",
        name,
        nodes,
        model,
        namedValues: [],
        inductorNames: [],
      });
    }
    return finishElement(cursor, {
      type: "Q",
      name,
      nodes,
      model: fourth,
      namedValues: [],
      inductorNames: [],
    });
  }
  throw error("unexpected_token", "SPICE Q requires a model name.", fourth ?? name);
}

function parseMosfet(cursor: Cursor, name: SpiceToken): SpiceElementNode {
  const nodes = [
    parseNode(cursor),
    parseNode(cursor),
    parseNode(cursor),
    parseNode(cursor),
  ];
  const model = cursor.identifier("MOSFET model");
  rejectUnsafeToken(model);
  const namedValues: SpiceNamedValue[] = [];
  while (!cursor.atStatementEnd()) {
    const param = cursor.identifier("MOSFET parameter");
    const key = param.text.toLowerCase();
    if (!MOSFET_PARAMS.has(key)) {
      throw error(
        "unexpected_token",
        "SPICE v1 MOSFET parameters are L and W only.",
        param,
      );
    }
    if (namedValues.some((item) => item.name.toLowerCase() === key)) {
      throw error(
        "unexpected_token",
        "SPICE v1 MOSFET L and W may appear at most once.",
        param,
      );
    }
    cursor.expectKind("equal", "MOSFET parameter equal");
    const paramValue = parseValue(cursor, "MOSFET parameter value");
    namedValues.push(Object.freeze({
      name: param.text,
      value: paramValue,
      span: mergeSpan(param.span, paramValue.span),
    }));
  }
  return finishElement(cursor, {
    type: "M",
    name,
    nodes,
    model,
    namedValues,
    inductorNames: [],
  });
}

function finishElement(
  cursor: Cursor,
  input: {
    readonly type: SpiceElementType;
    readonly name: SpiceToken;
    readonly nodes: readonly SpiceNodeRef[];
    readonly value?: SpiceValue;
    readonly model?: SpiceToken;
    readonly namedValues: readonly SpiceNamedValue[];
    readonly inductorNames: readonly string[];
  },
): SpiceElementNode {
  if (!cursor.atStatementEnd()) {
    rejectUnsafeToken(cursor.peek() ?? input.name);
    throw error(
      "unexpected_token",
      `SPICE ${input.type} has trailing tokens outside the closed subset.`,
      cursor.peek() ?? input.name,
    );
  }
  const close = cursor.consumeEol() ?? input.name;
  return Object.freeze({
    kind: "element",
    type: input.type,
    name: input.name.text,
    nameSpan: input.name.span,
    nodes: Object.freeze([...input.nodes]),
    ...(input.value === undefined ? {} : { value: input.value }),
    ...(input.model === undefined ? {} : {
      modelName: input.model.text,
      modelNameSpan: input.model.span,
    }),
    namedValues: Object.freeze([...input.namedValues]),
    inductorNames: Object.freeze([...input.inductorNames]),
    span: mergeSpan(input.name.span, close.span),
  });
}

function parseCoupling(
  cursor: Cursor,
  name: SpiceToken,
): SpiceElementNode {
  const first = cursor.identifier("coupled inductor");
  const second = cursor.identifier("coupled inductor");
  const value = parseValue(cursor, "coupling value");
  if (!cursor.atStatementEnd()) {
    throw error(
      "unexpected_token",
      "SPICE K has trailing tokens outside the closed subset.",
      cursor.peek() ?? name,
    );
  }
  const close = cursor.consumeEol() ?? name;
  return Object.freeze({
    kind: "element",
    type: "K" as const,
    name: name.text,
    nameSpan: name.span,
    nodes: Object.freeze([] as SpiceNodeRef[]),
    value,
    namedValues: Object.freeze([] as SpiceNamedValue[]),
    inductorNames: Object.freeze([first.text, second.text]),
    span: mergeSpan(name.span, close.span),
  });
}

function parseNode(cursor: Cursor): SpiceNodeRef {
  const token = cursor.peek();
  if (token?.kind === "identifier") {
    rejectUnsafeToken(token);
    cursor.take();
    return { name: token.text, span: token.span };
  }
  if (token?.kind === "number" && integerNodeName(token.text) !== undefined) {
    cursor.take();
    return { name: integerNodeName(token.text)!, span: token.span };
  }
  throw error("unexpected_token", "SPICE nodes are identifiers or integers.", token);
}

function parseValue(cursor: Cursor, label: string): SpiceValue {
  const token = cursor.peek();
  if (token?.kind === "lbrace") {
    cursor.take();
    const name = cursor.identifier("parameter reference");
    const close = cursor.expectKind("rbrace", "parameter reference close");
    return Object.freeze({
      kind: "param-ref",
      name: name.text,
      span: mergeSpan(token.span, close.span),
    });
  }
  return parseNumber(cursor, label);
}

function parseNumber(cursor: Cursor, label: string): SpiceNumberLiteral {
  const token = cursor.expectKind("number", label);
  try {
    return Object.freeze({
      kind: "number",
      spelling: token.text,
      value: spiceNumberValue(token.text),
      span: token.span,
    });
  } catch (caught) {
    if (caught instanceof SpiceLexicalError) {
      throw error("unexpected_token", caught.message, token);
    }
    throw caught;
  }
}

function integerNodeName(spelling: string): string | undefined {
  if (!/^[+-]?\d+$/.test(spelling)) return undefined;
  const value = Number(spelling);
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return String(value);
}

function rejectUnsafeToken(token: SpiceToken): void {
  if (
    token.kind === "identifier" && REJECTED_SOURCE_TOKENS.has(token.text.toLowerCase())
  ) {
    throw error(
      "unsupported_element",
      "SPICE v1 rejects behavioral, file, and analysis source forms.",
      token,
    );
  }
}

function mergeSpan(
  start: SourceAnalysisSpan,
  end: SourceAnalysisSpan,
): SourceAnalysisSpan {
  return { start: start.start, end: end.end };
}

function error(
  code: SpiceParseErrorCode,
  message: string,
  token: SpiceToken | undefined,
): SpiceParseError {
  return new SpiceParseError(code, message, token?.span);
}

class Cursor {
  readonly #tokens: readonly SpiceToken[];
  #index = 0;

  constructor(tokens: readonly SpiceToken[]) {
    this.#tokens = tokens;
  }

  get done(): boolean {
    return this.#index >= this.#tokens.length;
  }

  peek(): SpiceToken | undefined {
    return this.#tokens[this.#index];
  }

  take(): SpiceToken {
    const token = this.peek();
    if (token === undefined) {
      throw new SpiceParseError(
        "unclosed_statement",
        "SPICE v1 statement is not closed.",
      );
    }
    this.#index += 1;
    return token;
  }

  atStatementEnd(): boolean {
    const token = this.peek();
    return token === undefined || token.kind === "eol";
  }

  consumeEol(): SpiceToken | undefined {
    if (this.peek()?.kind === "eol") return this.take();
    return undefined;
  }

  expectDirective(text: string): SpiceToken {
    const token = this.take();
    if (token.kind !== "directive" || token.text.toLowerCase() !== text) {
      throw error("unexpected_token", `SPICE expected ${text}.`, token);
    }
    return token;
  }

  expectKind(kind: SpiceToken["kind"], label: string): SpiceToken {
    const token = this.take();
    if (token.kind !== kind) {
      throw error("unexpected_token", `SPICE expected ${label}.`, token);
    }
    return token;
  }

  identifier(label: string): SpiceToken {
    return this.expectKind("identifier", label);
  }
}
