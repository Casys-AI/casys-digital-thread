/**
 * Format checks for the module-assembler output pair.
 *
 * STEP is one complete Part 21 file plus an injected OCCT import. GLB is a
 * binary glTF container. Neither check claims collision freedom or fitness.
 */

import type { IsolatedCodeOutputDeclaration } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { isolatedCodeOutputManifestsEqual } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST } from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
import { validatePart21 } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import type {
  OcctStepReader,
  OcctStepReaderFactory,
} from "../isolated/occt-step-output-validator.ts";
import { loadOcctStepReader } from "../isolated/occt-step-output-validator.ts";

export type GeometryModuleAssemblyOutputValidationErrorCode =
  | "unsupported_output_contract"
  | "empty_output"
  | "invalid_step"
  | "parser_unavailable"
  | "parse_rejected"
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
  readonly #readerFactory: OcctStepReaderFactory;

  constructor(readerFactory: OcctStepReaderFactory = loadOcctStepReader) {
    if (typeof readerFactory !== "function") {
      throw new TypeError("A STEP reader factory is required.");
    }
    this.#readerFactory = readerFactory;
  }

  readonly validateOutput = async (
    declaration: IsolatedCodeOutputDeclaration,
    observedBytes: Uint8Array,
  ): Promise<void> => {
    const expected = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.find((entry) =>
      entry.role === declaration.role
    );
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
        validatePart21(bytes, "assembly.step");
      } catch {
        throw validationError("invalid_step");
      }
      let reader: OcctStepReader;
      try {
        reader = await this.#readerFactory();
      } catch {
        throw validationError("parser_unavailable");
      }
      try {
        const parsed = reader.ReadStepFile(bytes, { linearUnit: "millimeter" });
        if (
          parsed === null || typeof parsed !== "object" ||
          Reflect.get(parsed, "success") === false
        ) {
          throw validationError("parse_rejected");
        }
      } catch (error) {
        if (error instanceof GeometryModuleAssemblyOutputValidationError) {
          throw error;
        }
        throw validationError("parse_rejected");
      }
      return;
    }
    validateGlb(bytes);
  };
}

export function validateGeometryModuleAssemblyOutputManifest(
  value: readonly IsolatedCodeOutputDeclaration[],
): void {
  if (
    !isolatedCodeOutputManifestsEqual(
      value,
      GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError(
      "The geometry-module assembly output manifest is not registered.",
    );
  }
}

function validateGlb(bytes: Uint8Array): void {
  if (bytes.byteLength < 12) throw validationError("invalid_glb");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw validationError("invalid_glb");
  }
}

function validationError(
  code: GeometryModuleAssemblyOutputValidationErrorCode,
): GeometryModuleAssemblyOutputValidationError {
  return new GeometryModuleAssemblyOutputValidationError(
    code,
    `geometry-module assembly output failed ${code}.`,
  );
}
