/**
 * Pure extraction of unique canonical part STEP and parametric CAD definition
 * from a geometry capture already reopened by the server.
 */

import { sha256Hex } from "../../kernel/deterministic-json.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../../cad/canonical/geometry-part-manifest.ts";

export const FEA_PROOF_GEOMETRY_CAPTURE_SCHEMAS = [
  "geometry-capture/2.1",
  GEOMETRY_PART_CAPTURE_SCHEMA,
] as const;

export type FeaProofCadLineageDiagnosticCode =
  | "cad-lineage-unavailable"
  | "cad-lineage-ambiguous"
  | "cad-lineage-invalid";

export type FeaProofCadLineage =
  | {
    readonly status: "ok";
    readonly stepDigest: string;
    readonly definition: {
      readonly sha256: string;
      readonly bytes: number;
    };
  }
  | {
    readonly status: "unresolved";
    readonly code: FeaProofCadLineageDiagnosticCode;
    readonly message: string;
  };

/** Extract unique part STEP digest and unique CAD script identity for one target. */
export async function extractParametricCadProvenanceFromGeometryCapture(
  capture: unknown,
  targetModelElementId: string,
): Promise<FeaProofCadLineage> {
  if (capture === null || typeof capture !== "object" || Array.isArray(capture)) {
    return unavailable("Geometry capture is not a JSON object.");
  }
  const record = capture as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (
    schemaVersion !== "geometry-capture/2.1" &&
    schemaVersion !== GEOMETRY_PART_CAPTURE_SCHEMA
  ) {
    return invalid(
      `FEA proof CAD lineage requires a canonical geometry bundle or target capture; got schemaVersion="${
        String(schemaVersion)
      }".`,
    );
  }
  if (schemaVersion === GEOMETRY_PART_CAPTURE_SCHEMA) {
    return await extractTargeted(record, targetModelElementId);
  }
  return await extractBundle(record, targetModelElementId);
}

async function extractBundle(
  record: Record<string, unknown>,
  targetModelElementId: string,
): Promise<FeaProofCadLineage> {
  const manifest = asRecord(record.manifest);
  if (!manifest || !Array.isArray(manifest.partDefinitions)) {
    return invalid("Geometry capture manifest.partDefinitions is missing.");
  }
  const matchingDefs = manifest.partDefinitions.filter((item) =>
    asRecord(item)?.elementId === targetModelElementId
  );
  if (matchingDefs.length === 0) {
    return unavailable(
      `Target modelElementId "${targetModelElementId}" is not among partDefinitions[].elementId.`,
    );
  }
  if (matchingDefs.length > 1) {
    return ambiguous(
      `Several partDefinitions declare modelElementId "${targetModelElementId}".`,
    );
  }
  const stepDigest = uniqueStepDigest(asRecord(matchingDefs[0])?.files);
  if (stepDigest.status !== "ok") return stepDigest;

  const scripts = asRecord(record.sourceScripts);
  if (!scripts || !Array.isArray(scripts.partDefinitions)) {
    return unavailable(
      "Geometry capture has no unique part source script for the proof target.",
    );
  }
  const matchingScripts = scripts.partDefinitions.filter((item) =>
    asRecord(item)?.elementId === targetModelElementId
  );
  if (matchingScripts.length === 0) {
    return unavailable(
      "Geometry capture has no unique part source script for the proof target.",
    );
  }
  if (matchingScripts.length > 1) {
    return ambiguous(
      `Several part source scripts declare modelElementId "${targetModelElementId}".`,
    );
  }
  const definition = await uniqueScriptDefinition(asRecord(matchingScripts[0]));
  if (definition.status !== "ok") return definition;
  return {
    status: "ok",
    stepDigest: stepDigest.digest,
    definition: definition.definition,
  };
}

async function extractTargeted(
  record: Record<string, unknown>,
  targetModelElementId: string,
): Promise<FeaProofCadLineage> {
  const manifest = asRecord(record.manifest);
  const target = asRecord(manifest?.target);
  if (target?.partDefinitionElementId !== targetModelElementId) {
    return unavailable(
      `Target modelElementId "${targetModelElementId}" does not equal the canonical PartDefinition elementId.`,
    );
  }
  const files = Array.isArray(target.files) ? target.files : undefined;
  const stepDigest = uniqueStepDigest(files);
  if (stepDigest.status !== "ok") return stepDigest;
  const sourceScript = asRecord(record.sourceScript);
  const definition = await uniqueScriptDefinition(sourceScript);
  if (definition.status !== "ok") return definition;
  return {
    status: "ok",
    stepDigest: stepDigest.digest,
    definition: definition.definition,
  };
}

function uniqueStepDigest(
  files: unknown,
):
  | { readonly status: "ok"; readonly digest: string }
  | {
    readonly status: "unresolved";
    readonly code: FeaProofCadLineageDiagnosticCode;
    readonly message: string;
  } {
  if (!Array.isArray(files)) {
    return {
      status: "unresolved",
      code: "cad-lineage-unavailable",
      message: "The targeted PartDefinition has no STEP file.",
    };
  }
  const steps = files.flatMap((item) => {
    const file = asRecord(item);
    if (file?.format !== "step") return [];
    const fingerprint = asRecord(file.fingerprint);
    if (
      fingerprint?.algorithm !== "sha256" ||
      typeof fingerprint.digest !== "string"
    ) return [];
    return [fingerprint.digest];
  });
  if (steps.length === 0) {
    return {
      status: "unresolved",
      code: "cad-lineage-unavailable",
      message: "The targeted PartDefinition has no STEP file.",
    };
  }
  if (steps.length > 1) {
    return {
      status: "unresolved",
      code: "cad-lineage-ambiguous",
      message: "The targeted PartDefinition has several STEP files.",
    };
  }
  return { status: "ok", digest: steps[0]! };
}

async function uniqueScriptDefinition(
  source: Record<string, unknown> | undefined,
): Promise<
  | { readonly status: "ok"; readonly definition: { sha256: string; bytes: number } }
  | FeaProofCadLineage
> {
  if (!source || typeof source.script !== "string" || source.script.length === 0) {
    return unavailable(
      "Geometry capture has no unique part source script for the proof target.",
    );
  }
  const bytes = new TextEncoder().encode(source.script);
  const sha256 = await sha256Hex(bytes);
  const declared = asRecord(source.scriptHash);
  if (
    declared &&
    (declared.algorithm !== "sha256" || declared.digest !== sha256)
  ) {
    return invalid(
      "Geometry capture part source script hash does not match the script bytes.",
    );
  }
  return {
    status: "ok",
    definition: { sha256, bytes: bytes.byteLength },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function unavailable(message: string): FeaProofCadLineage {
  return { status: "unresolved", code: "cad-lineage-unavailable", message };
}

function ambiguous(message: string): FeaProofCadLineage {
  return { status: "unresolved", code: "cad-lineage-ambiguous", message };
}

function invalid(message: string): FeaProofCadLineage {
  return { status: "unresolved", code: "cad-lineage-invalid", message };
}
