import initializeOcct from "occt-import-js";
import type { IsolatedCodeOutputDeclaration } from "../../../domain/compile/isolation/isolated-code-execution.ts";
export { OCCT_STEP_OUTPUT_VALIDATOR_REF } from "./occt-step-output-validator-contract.ts";

const STEP_HEADER_SCAN_LIMIT_BYTES = 65_536;
const MAXIMUM_ROOT_NODES = 100_000;
const STEP_DECODER = new TextDecoder("utf-8", { fatal: true });

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const INTRINSIC_TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)!.get!;
const INTRINSIC_TYPED_ARRAY_TAG = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)!.get!;

export type OcctStepOutputValidationErrorCode =
  | "unsupported_output_contract"
  | "empty_output"
  | "invalid_step_header"
  | "unsupported_step_schema"
  | "parser_unavailable"
  | "parse_rejected"
  | "invalid_geometry";

export class OcctStepOutputValidationError extends Error {
  readonly code: OcctStepOutputValidationErrorCode;

  constructor(code: OcctStepOutputValidationErrorCode, message: string) {
    super(message);
    this.name = "OcctStepOutputValidationError";
    this.code = code;
  }
}

export interface OcctStepReader {
  ReadStepFile(
    bytes: Uint8Array,
    parameters: Readonly<{ readonly linearUnit: "millimeter" }>,
  ): unknown;
}

export type OcctStepReaderFactory = () => OcctStepReader | Promise<OcctStepReader>;

let sharedOcctReader: Promise<OcctStepReader> | undefined;

/**
 * Loads the reviewed npm package once per process. `occt-import-js@0.0.23` is
 * LGPL-2.1 and embeds Open CASCADE notices; a distributor must retain the
 * upstream notices and separately review the LGPL/WASM relinking obligations.
 */
export function loadOcctStepReader(): Promise<OcctStepReader> {
  if (sharedOcctReader === undefined) {
    sharedOcctReader = Promise.resolve(initializeOcct({
      // Native parser diagnostics are deliberately not copied to host logs.
      print: () => undefined,
      printErr: () => undefined,
    })).then(
      (value) => exactOcctReader(value),
      () => {
        sharedOcctReader = undefined;
        throw validationError("parser_unavailable");
      },
    );
  }
  return sharedOcctReader;
}

/**
 * Parser-backed validator for the exact Build123d V1 geometry output contract.
 *
 * The bounded Part 21 header check proves the declared AP214 serialization;
 * the OCCT import must independently succeed and expose referenced,
 * non-degenerate triangulated geometry. A plausible header alone is never an
 * accepted engineering output.
 */
export class OcctStepOutputValidator {
  readonly #readerFactory: OcctStepReaderFactory;

  constructor(readerFactory: OcctStepReaderFactory = loadOcctStepReader) {
    if (typeof readerFactory !== "function") {
      throw new TypeError("An OCCT STEP reader factory is required.");
    }
    this.#readerFactory = readerFactory;
  }

  readonly validateOutput = async (
    declaration: IsolatedCodeOutputDeclaration,
    observedBytes: Uint8Array,
  ): Promise<void> => {
    assertBuild123dStepContract(declaration);
    const bytes = copyObservedBytes(observedBytes);
    if (bytes.byteLength === 0) {
      throw validationError("empty_output");
    }
    assertAp214Header(bytes);

    let reader: OcctStepReader;
    try {
      reader = exactOcctReader(await this.#readerFactory());
    } catch (error) {
      if (
        error instanceof OcctStepOutputValidationError &&
        error.code === "parser_unavailable"
      ) {
        throw error;
      }
      throw validationError("parser_unavailable");
    }

    let parsed: unknown;
    try {
      parsed = reader.ReadStepFile(bytes, { linearUnit: "millimeter" });
    } catch {
      throw validationError("parse_rejected");
    }
    assertMeaningfulParsedGeometry(parsed);
  };
}

function assertBuild123dStepContract(
  declaration: IsolatedCodeOutputDeclaration,
): void {
  if (
    declaration?.role !== "geometry" ||
    declaration.basename !== "geometry.step" ||
    declaration.mediaType !== "model/step" ||
    declaration.format !== "step-ap214"
  ) {
    throw validationError("unsupported_output_contract");
  }
}

function copyObservedBytes(value: Uint8Array): Uint8Array {
  try {
    if (
      typeof value !== "object" || value === null ||
      INTRINSIC_TYPED_ARRAY_TAG.call(value) !== "Uint8Array"
    ) {
      throw new TypeError();
    }
    const byteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH.call(value) as number;
    const copy = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(copy, value);
    return copy;
  } catch {
    throw validationError("invalid_step_header");
  }
}

function assertAp214Header(bytes: Uint8Array): void {
  let header: string;
  try {
    header = STEP_DECODER.decode(
      bytes.subarray(0, Math.min(bytes.byteLength, STEP_HEADER_SCAN_LIMIT_BYTES)),
    );
  } catch {
    throw validationError("invalid_step_header");
  }
  if (header.includes("\0") || !/^\s*ISO-10303-21\s*;/i.test(header)) {
    throw validationError("invalid_step_header");
  }
  const prologue = /^\s*ISO-10303-21\s*;/i.exec(header)!;
  let cursor = skipStepIgnorable(header, prologue[0].length);
  cursor = expectStepKeyword(header, cursor, "HEADER");
  cursor = expectStepPunctuation(header, cursor, ";");
  const headerEnd = findStepKeyword(header, cursor, "ENDSEC");
  if (headerEnd < 0) throw validationError("invalid_step_header");
  expectStepPunctuation(header, headerEnd + "ENDSEC".length, ";");

  const schemaStart = findStepKeyword(header, cursor, "FILE_SCHEMA", headerEnd);
  if (schemaStart < 0) throw validationError("invalid_step_header");
  const parsed = parseFileSchema(header, schemaStart, headerEnd);
  if (
    findStepKeyword(header, parsed.cursor, "FILE_SCHEMA", headerEnd) >= 0
  ) {
    throw validationError("invalid_step_header");
  }
  const schemas = parsed.schemas;
  if (!schemas.every(isAp214Schema)) {
    throw validationError("unsupported_step_schema");
  }
}

function parseFileSchema(
  source: string,
  start: number,
  limit: number,
): { readonly schemas: readonly string[]; readonly cursor: number } {
  let cursor = expectStepKeyword(source, start, "FILE_SCHEMA");
  cursor = expectStepPunctuation(source, cursor, "(");
  cursor = expectStepPunctuation(source, cursor, "(");
  const schemas: string[] = [];
  while (true) {
    cursor = skipStepIgnorable(source, cursor, limit);
    const parsed = readStepString(source, cursor, limit);
    schemas.push(parsed.value);
    cursor = skipStepIgnorable(source, parsed.cursor, limit);
    if (source[cursor] !== ",") break;
    cursor += 1;
  }
  if (schemas.length === 0) throw validationError("invalid_step_header");
  cursor = expectStepPunctuation(source, cursor, ")", limit);
  cursor = expectStepPunctuation(source, cursor, ")", limit);
  cursor = expectStepPunctuation(source, cursor, ";", limit);
  return { schemas: Object.freeze(schemas), cursor };
}

function findStepKeyword(
  source: string,
  start: number,
  keyword: string,
  limit = source.length,
): number {
  let cursor = start;
  while (cursor < limit) {
    cursor = skipStepIgnorable(source, cursor, limit);
    if (cursor >= limit) return -1;
    if (source[cursor] === "'") {
      cursor = readStepString(source, cursor, limit).cursor;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(cursor, limit));
    if (identifier !== null) {
      if (identifier[0].toUpperCase() === keyword) return cursor;
      cursor += identifier[0].length;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

function expectStepKeyword(
  source: string,
  start: number,
  keyword: string,
): number {
  const cursor = skipStepIgnorable(source, start);
  const observed = source.slice(cursor, cursor + keyword.length);
  const next = source[cursor + keyword.length];
  if (
    observed.toUpperCase() !== keyword ||
    (next !== undefined && /[A-Za-z0-9_]/.test(next))
  ) {
    throw validationError("invalid_step_header");
  }
  return cursor + keyword.length;
}

function expectStepPunctuation(
  source: string,
  start: number,
  punctuation: string,
  limit = source.length,
): number {
  const cursor = skipStepIgnorable(source, start, limit);
  if (cursor >= limit || source[cursor] !== punctuation) {
    throw validationError("invalid_step_header");
  }
  return cursor + 1;
}

function skipStepIgnorable(
  source: string,
  start: number,
  limit = source.length,
): number {
  let cursor = start;
  while (cursor < limit) {
    if (/\s/.test(source[cursor]!)) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      const commentEnd = source.indexOf("*/", cursor + 2);
      if (commentEnd < 0 || commentEnd + 2 > limit) {
        throw validationError("invalid_step_header");
      }
      cursor = commentEnd + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function readStepString(
  source: string,
  start: number,
  limit: number,
): { readonly value: string; readonly cursor: number } {
  if (source[start] !== "'") throw validationError("invalid_step_header");
  let value = "";
  let cursor = start + 1;
  while (cursor < limit) {
    const character = source[cursor]!;
    if (character !== "'") {
      value += character;
      cursor += 1;
      continue;
    }
    if (source[cursor + 1] === "'") {
      value += "'";
      cursor += 2;
      continue;
    }
    return { value, cursor: cursor + 1 };
  }
  throw validationError("invalid_step_header");
}

function isAp214Schema(value: string): boolean {
  const normalized = value.trim().toUpperCase().replaceAll(/\s+/g, " ");
  if (normalized === "AUTOMOTIVE_DESIGN_CC2") return true;
  return /^AUTOMOTIVE_DESIGN(?:\s*\{\s*1\s+0\s+10303\s+214(?:\s+[0-9]+)+\s*\})?$/
    .test(normalized);
}

function exactOcctReader(value: unknown): OcctStepReader {
  try {
    if (
      typeof value !== "object" || value === null ||
      typeof Reflect.get(value, "ReadStepFile") !== "function"
    ) {
      throw new TypeError();
    }
    return value as OcctStepReader;
  } catch {
    throw validationError("parser_unavailable");
  }
}

function assertMeaningfulParsedGeometry(value: unknown): void {
  let success: unknown;
  let root: unknown;
  let meshes: unknown;
  try {
    if (typeof value !== "object" || value === null) {
      throw validationError("parse_rejected");
    }
    success = Reflect.get(value, "success");
    root = Reflect.get(value, "root");
    meshes = Reflect.get(value, "meshes");
  } catch (error) {
    if (error instanceof OcctStepOutputValidationError) throw error;
    throw validationError("parse_rejected");
  }
  if (success !== true) throw validationError("parse_rejected");

  try {
    if (!Array.isArray(meshes) || meshes.length === 0 || !isRecord(root)) {
      throw validationError("invalid_geometry");
    }
    const referenced = referencedMeshIndices(root, meshes.length);
    if (
      ![...referenced].some((index) => isMeaningfulTriangulatedMesh(meshes[index]))
    ) {
      throw validationError("invalid_geometry");
    }
  } catch (error) {
    if (error instanceof OcctStepOutputValidationError) throw error;
    throw validationError("invalid_geometry");
  }
}

function referencedMeshIndices(root: Record<string, unknown>, meshCount: number) {
  const referenced = new Set<number>();
  const queue: unknown[] = [root];
  const visited = new WeakSet<object>();
  let cursor = 0;
  while (cursor < queue.length) {
    if (cursor >= MAXIMUM_ROOT_NODES) {
      throw validationError("invalid_geometry");
    }
    const nodeValue = queue[cursor++];
    if (!isRecord(nodeValue) || visited.has(nodeValue)) {
      throw validationError("invalid_geometry");
    }
    visited.add(nodeValue);
    const nodeMeshes = nodeValue.meshes;
    const children = nodeValue.children;
    if (!Array.isArray(nodeMeshes) || !Array.isArray(children)) {
      throw validationError("invalid_geometry");
    }
    for (const index of nodeMeshes) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= meshCount) {
        throw validationError("invalid_geometry");
      }
      referenced.add(index);
    }
    queue.push(...children);
  }
  return referenced;
}

function isMeaningfulTriangulatedMesh(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.attributes)) return false;
  const position = value.attributes.position;
  const index = value.index;
  if (!isRecord(position) || !isRecord(index)) return false;
  const positions = position.array;
  const indices = index.array;
  if (
    !Array.isArray(positions) || positions.length < 9 || positions.length % 3 !== 0 ||
    !Array.isArray(indices) || indices.length < 3 || indices.length % 3 !== 0
  ) {
    return false;
  }
  const vertexCount = positions.length / 3;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    if (
      !Number.isSafeInteger(a) || !Number.isSafeInteger(b) ||
      !Number.isSafeInteger(c) || a < 0 || b < 0 || c < 0 ||
      a >= vertexCount || b >= vertexCount || c >= vertexCount ||
      a === b || b === c || a === c
    ) {
      continue;
    }
    if (triangleHasArea(positions, a, b, c)) return true;
  }
  return false;
}

function triangleHasArea(
  positions: unknown[],
  first: number,
  second: number,
  third: number,
): boolean {
  const ax = positions[first * 3];
  const ay = positions[first * 3 + 1];
  const az = positions[first * 3 + 2];
  const bx = positions[second * 3];
  const by = positions[second * 3 + 1];
  const bz = positions[second * 3 + 2];
  const cx = positions[third * 3];
  const cy = positions[third * 3 + 1];
  const cz = positions[third * 3 + 2];
  if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return false;
  const abx = (bx as number) - (ax as number);
  const aby = (by as number) - (ay as number);
  const abz = (bz as number) - (az as number);
  const acx = (cx as number) - (ax as number);
  const acy = (cy as number) - (ay as number);
  const acz = (cz as number) - (az as number);
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  return Number.isFinite(crossX) && Number.isFinite(crossY) &&
    Number.isFinite(crossZ) && crossX * crossX + crossY * crossY + crossZ * crossZ > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(
  code: OcctStepOutputValidationErrorCode,
): OcctStepOutputValidationError {
  const messages: Record<OcctStepOutputValidationErrorCode, string> = {
    unsupported_output_contract:
      "The isolated output declaration is not the registered Build123d STEP contract.",
    empty_output: "The observed STEP output is empty.",
    invalid_step_header: "The observed output has no canonical STEP Part 21 header.",
    unsupported_step_schema: "The observed STEP output is not declared as AP214.",
    parser_unavailable: "The code-owned STEP parser is unavailable.",
    parse_rejected: "The code-owned STEP parser rejected the observed output.",
    invalid_geometry:
      "The parsed STEP output contains no referenced non-degenerate geometry.",
  };
  return new OcctStepOutputValidationError(code, messages[code]);
}
