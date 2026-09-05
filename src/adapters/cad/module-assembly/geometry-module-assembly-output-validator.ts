/**
 * Format checks for the module-assembler output pair.
 *
 * STEP is one complete Part 21 file plus an injected OCCT import. GLB is a
 * self-contained GLB 2.0 container with one embedded BIN. Neither check
 * claims mesh fitness, collision freedom, or physical geometry validity.
 */

import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { IsolatedCodeOutputDeclaration } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_ASSETS,
} from "../../../domain/cad/module-assembly/geometry-module-assembly-receipt.ts";
import {
  loadOcctStepReader,
  OcctStepOutputValidationError,
  OcctStepOutputValidator,
  type OcctStepReaderFactory,
} from "../isolated/occt-step-output-validator.ts";

export type GeometryModuleAssemblyOutputValidationErrorCode =
  | "unsupported_output_contract"
  | "empty_output"
  | "invalid_step"
  | "parser_unavailable"
  | "parse_rejected"
  | "invalid_geometry"
  | "invalid_glb";

export class GeometryModuleAssemblyOutputValidationError extends Error {
  readonly code: GeometryModuleAssemblyOutputValidationErrorCode;

  constructor(
    code: GeometryModuleAssemblyOutputValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometryModuleAssemblyOutputValidationError";
    this.code = code;
  }
}

export class GeometryModuleAssemblyOutputValidator {
  readonly #stepValidator: OcctStepOutputValidator;

  constructor(readerFactory: OcctStepReaderFactory = loadOcctStepReader) {
    this.#stepValidator = new OcctStepOutputValidator(readerFactory);
  }

  readonly validateOutput = async (
    declaration: IsolatedCodeOutputDeclaration,
    observedBytes: Uint8Array,
  ): Promise<void> => {
    const expected = declaration.role === "assembly.step"
      ? GEOMETRY_MODULE_ASSEMBLY_ASSETS.step
      : declaration.role === "assembly.glb"
      ? GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb
      : undefined;
    if (
      !expected ||
      deterministicJson(expected) !== deterministicJson(declaration)
    ) {
      throw validationError("unsupported_output_contract");
    }
    if (!(observedBytes instanceof Uint8Array) || observedBytes.byteLength === 0) {
      throw validationError("empty_output");
    }
    const bytes = Uint8Array.from(observedBytes);
    if (declaration.role === "assembly.step") {
      try {
        await this.#stepValidator.validateOutput({
          role: "geometry",
          basename: "geometry.step",
          mediaType: "model/step",
          format: "step-ap214",
        }, bytes);
      } catch (error) {
        if (error instanceof OcctStepOutputValidationError) {
          if (error.code === "parser_unavailable") {
            throw validationError("parser_unavailable");
          }
          if (error.code === "parse_rejected") {
            throw validationError("parse_rejected");
          }
          if (error.code === "invalid_geometry") {
            throw validationError("invalid_geometry");
          }
        }
        throw validationError("invalid_step");
      }
      return;
    }
    validateGlb(bytes);
  };
}

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const GLB_JSON_DECODER = new TextDecoder("utf-8", { fatal: true });

interface GlbChunk {
  readonly type: number;
  readonly data: Uint8Array;
}

function validateGlb(bytes: Uint8Array): void {
  if (bytes.byteLength < GLB_HEADER_BYTES) throw validationError("invalid_glb");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== GLB_VERSION ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw validationError("invalid_glb");
  }
  const chunks = readGlbChunks(bytes, view);
  if (chunks.length === 0 || chunks[0]!.type !== GLB_JSON_CHUNK) {
    throw validationError("invalid_glb");
  }
  let jsonCount = 0;
  let binCount = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    if (chunk.type === GLB_JSON_CHUNK) {
      jsonCount += 1;
      if (index !== 0 || jsonCount !== 1) throw validationError("invalid_glb");
      continue;
    }
    if (chunk.type === GLB_BIN_CHUNK) {
      binCount += 1;
      if (index !== 1 || binCount !== 1) throw validationError("invalid_glb");
      continue;
    }
    throw validationError("invalid_glb");
  }
  if (binCount !== 1) throw validationError("invalid_glb");
  validateGlbBinRelationship(
    parseGlbJson(chunks[0]!.data),
    chunks[1]!.data,
  );
}

function readGlbChunks(bytes: Uint8Array, view: DataView): GlbChunk[] {
  const chunks: GlbChunk[] = [];
  let offset = GLB_HEADER_BYTES;
  while (offset < bytes.byteLength) {
    if (
      offset % 4 !== 0 ||
      offset + GLB_CHUNK_HEADER_BYTES > bytes.byteLength
    ) {
      throw validationError("invalid_glb");
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + GLB_CHUNK_HEADER_BYTES;
    const dataEnd = dataStart + chunkLength;
    if (chunkLength % 4 !== 0 || dataEnd > bytes.byteLength) {
      throw validationError("invalid_glb");
    }
    chunks.push({
      type: chunkType,
      data: bytes.subarray(dataStart, dataEnd),
    });
    offset = dataEnd;
  }
  if (offset !== bytes.byteLength) throw validationError("invalid_glb");
  return chunks;
}

function parseGlbJson(data: Uint8Array): Record<string, unknown> {
  let text: string;
  try {
    text = GLB_JSON_DECODER.decode(data);
  } catch {
    throw validationError("invalid_glb");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw validationError("invalid_glb");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError("invalid_glb");
  }
  const asset = Reflect.get(parsed, "asset");
  if (
    asset === null ||
    typeof asset !== "object" ||
    Array.isArray(asset) ||
    Reflect.get(asset, "version") !== "2.0"
  ) {
    throw validationError("invalid_glb");
  }
  return parsed as Record<string, unknown>;
}

function validateGlbBinRelationship(
  document: Record<string, unknown>,
  bin: Uint8Array,
): void {
  const declared = declaredBinBuffer(Reflect.get(document, "buffers"));
  const byteLength = Reflect.get(declared, "byteLength");
  if (
    typeof byteLength !== "number" ||
    !Number.isInteger(byteLength) ||
    byteLength < 1
  ) {
    throw validationError("invalid_glb");
  }
  const paddedLength = Math.ceil(byteLength / 4) * 4;
  if (bin.byteLength !== paddedLength) throw validationError("invalid_glb");
}

function declaredBinBuffer(buffers: unknown): object {
  if (!Array.isArray(buffers) || buffers.length !== 1) {
    throw validationError("invalid_glb");
  }
  const first = buffers[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw validationError("invalid_glb");
  }
  if (Object.hasOwn(first, "uri")) throw validationError("invalid_glb");
  return first;
}

function validationError(
  code: GeometryModuleAssemblyOutputValidationErrorCode,
): GeometryModuleAssemblyOutputValidationError {
  return new GeometryModuleAssemblyOutputValidationError(
    code,
    `geometry-module assembly output failed ${code}.`,
  );
}
