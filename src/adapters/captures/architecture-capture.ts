/** Exact, shared parser for generic `model.write-architecture@1` captures. */

import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/engineering/architecture-proposal.ts";
import {
  type SysmlSourceAnalysisReference,
  validateSysmlSourceAnalysisReference,
} from "./sysml-source-analysis-capture.ts";

export const ARCHITECTURE_CAPTURE_SCHEMA = "architecture-capture/3.0" as const;
export const ARCHITECTURE_CAPTURE_SCHEMA_LEGACY = "architecture-capture/2.0" as const;

interface ExactArchitectureCaptureBase {
  readonly operation: typeof MODEL_WRITE_ARCHITECTURE_OPERATION;
  readonly trustedRunId: string;
  readonly packageName: string;
  readonly systemName: string;
  readonly package: { readonly id: string; readonly label: string };
  readonly seed: ArchitectureCaptureArtifactReference;
  readonly predecessor?: ArchitectureCaptureArtifactReference;
  readonly partDefinitions: readonly ArchitectureCapturePartDefinition[];
  readonly insertedAt: string;
}

export interface ArchitectureCaptureArtifactReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface ArchitectureCapturePartDefinition {
  readonly id: string;
  readonly kind: "PartDefinition";
  readonly label: string;
  readonly usages: readonly ArchitectureCapturePartUsage[];
}

export interface ArchitectureCapturePartUsage {
  readonly id: string;
  readonly kind: "PartUsage";
  readonly label: string;
  readonly targetId: string;
  readonly targetKind: "PartDefinition";
  readonly targetLabel: string;
}

export interface ExactArchitectureCaptureV2 extends ExactArchitectureCaptureBase {
  readonly schemaVersion: typeof ARCHITECTURE_CAPTURE_SCHEMA_LEGACY;
}

export interface ExactArchitectureCaptureV3 extends ExactArchitectureCaptureBase {
  readonly schemaVersion: typeof ARCHITECTURE_CAPTURE_SCHEMA;
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
}

export type ExactArchitectureCapture =
  | ExactArchitectureCaptureV2
  | ExactArchitectureCaptureV3;

/**
 * Parse both immutable historical v2 and current v3 records fail-closed.
 *
 * V3 source references are not opaque extras: their run, operation and package
 * selector are bound to the capture identity here, before any authoritative
 * reader is allowed to project the semantic graph.
 */
export function parseExactArchitectureCapture(
  value: unknown,
): ExactArchitectureCapture {
  const record = exactObject(value, "Architecture capture");
  const currentSchema = record.schemaVersion === ARCHITECTURE_CAPTURE_SCHEMA;
  exactKeys(
    record,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "packageName",
      "systemName",
      "package",
      "seed",
      ...(record.predecessor === undefined ? [] : ["predecessor"]),
      "partDefinitions",
      "insertedAt",
      ...(currentSchema ? ["sourceAnalyses"] : []),
    ],
    "Architecture capture",
  );
  const operation = exactObject(record.operation, "Architecture capture operation");
  exactKeys(operation, ["id", "version"], "Architecture capture operation");
  if (
    (record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA &&
      record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA_LEGACY) ||
    operation.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
    operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version
  ) {
    throw new Error("Architecture capture operation or schema is not exact.");
  }

  const trustedRunId = exactNonEmpty(record.trustedRunId, "trustedRunId");
  const packageName = exactNonEmpty(record.packageName, "packageName");
  const systemName = exactNonEmpty(record.systemName, "systemName");
  const insertedAt = exactCanonicalInstant(record.insertedAt, "insertedAt");
  const rawPackage = exactObject(record.package, "Architecture capture package");
  exactKeys(rawPackage, ["id", "label"], "Architecture capture package");
  const architecturePackage = {
    id: exactNonEmpty(rawPackage.id, "package.id"),
    label: exactNonEmpty(rawPackage.label, "package.label"),
  };
  if (architecturePackage.label !== packageName) {
    throw new Error("Architecture capture package label does not match packageName.");
  }

  const seed = parseArtifactReference(record.seed, "seed");
  const predecessor = record.predecessor === undefined
    ? undefined
    : parseArtifactReference(record.predecessor, "predecessor");
  const sourceAnalyses = currentSchema
    ? parseExactSysmlSourceAnalyses(
      record.sourceAnalyses,
      trustedRunId,
      packageName,
    )
    : undefined;

  if (!Array.isArray(record.partDefinitions)) {
    throw new Error("Architecture capture partDefinitions must be an array.");
  }
  const semanticIds = new Set<string>([architecturePackage.id]);
  const definitionLabels = new Set<string>();
  const partDefinitions = record.partDefinitions.map((rawPart, index) => {
    const part = exactObject(rawPart, `partDefinitions[${index}]`);
    exactKeys(part, ["id", "kind", "label", "usages"], `partDefinitions[${index}]`);
    const id = exactNonEmpty(part.id, `partDefinitions[${index}].id`);
    const label = exactNonEmpty(part.label, `partDefinitions[${index}].label`);
    if (
      part.kind !== "PartDefinition" || !Array.isArray(part.usages) ||
      semanticIds.has(id) || definitionLabels.has(label)
    ) {
      throw new Error(`Architecture capture PartDefinition ${index} is ambiguous.`);
    }
    semanticIds.add(id);
    definitionLabels.add(label);
    const usageLabels = new Set<string>();
    const usages = part.usages.map((rawUsage, usageIndex) => {
      const usage = exactObject(
        rawUsage,
        `partDefinitions[${index}].usages[${usageIndex}]`,
      );
      exactKeys(
        usage,
        ["id", "kind", "label", "targetId", "targetKind", "targetLabel"],
        `partDefinitions[${index}].usages[${usageIndex}]`,
      );
      const usageId = exactNonEmpty(
        usage.id,
        `partDefinitions[${index}].usages[${usageIndex}].id`,
      );
      const usageLabel = exactNonEmpty(
        usage.label,
        `partDefinitions[${index}].usages[${usageIndex}].label`,
      );
      if (
        usage.kind !== "PartUsage" || usage.targetKind !== "PartDefinition" ||
        semanticIds.has(usageId) || usageLabels.has(usageLabel)
      ) {
        throw new Error(
          `Architecture capture PartUsage ${index}/${usageIndex} is ambiguous.`,
        );
      }
      semanticIds.add(usageId);
      usageLabels.add(usageLabel);
      return {
        id: usageId,
        kind: "PartUsage" as const,
        label: usageLabel,
        targetId: exactNonEmpty(
          usage.targetId,
          `partDefinitions[${index}].usages[${usageIndex}].targetId`,
        ),
        targetKind: "PartDefinition" as const,
        targetLabel: exactNonEmpty(
          usage.targetLabel,
          `partDefinitions[${index}].usages[${usageIndex}].targetLabel`,
        ),
      };
    });
    return { id, kind: "PartDefinition" as const, label, usages };
  });

  const definitionsById = new Map(partDefinitions.map((part) => [part.id, part]));
  for (const part of partDefinitions) {
    for (const usage of part.usages) {
      if (definitionsById.get(usage.targetId)?.label !== usage.targetLabel) {
        throw new Error(
          `Architecture capture PartUsage "${usage.label}" has a non-exact target.`,
        );
      }
    }
  }
  if (!partDefinitions.some((part) => part.label === systemName)) {
    throw new Error("Architecture capture systemName is not a PartDefinition.");
  }

  const base = {
    operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
    trustedRunId,
    packageName,
    systemName,
    package: architecturePackage,
    seed,
    ...(predecessor ? { predecessor } : {}),
    partDefinitions,
    insertedAt,
  };
  return currentSchema
    ? {
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
      ...base,
      sourceAnalyses: sourceAnalyses!,
    }
    : { schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA_LEGACY, ...base };
}

function parseArtifactReference(
  value: unknown,
  field: "seed" | "predecessor",
): ArchitectureCaptureArtifactReference {
  const record = exactObject(value, `Architecture capture ${field}`);
  exactKeys(
    record,
    ["artifactId", "fingerprint", "producerRunId"],
    `Architecture capture ${field}`,
  );
  return {
    artifactId: exactNonEmpty(record.artifactId, `${field}.artifactId`),
    fingerprint: exactFingerprint(record.fingerprint, `${field}.fingerprint`),
    producerRunId: exactNonEmpty(record.producerRunId, `${field}.producerRunId`),
  };
}

function parseExactSysmlSourceAnalyses(
  value: unknown,
  trustedRunId: string,
  packageName: string,
): readonly SysmlSourceAnalysisReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Current architecture capture must seal SysML source analyses.");
  }
  const references = value.map((rawReference, index) => {
    let reference: SysmlSourceAnalysisReference;
    try {
      reference = validateSysmlSourceAnalysisReference(rawReference);
    } catch (error) {
      throw new Error(
        `Architecture capture sourceAnalyses[${index}] is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (reference.runId !== trustedRunId) {
      throw new Error(
        `Architecture capture sourceAnalyses[${index}] names another run.`,
      );
    }
    if (
      reference.operation.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
      reference.operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version
    ) {
      throw new Error(
        `Architecture capture sourceAnalyses[${index}] names another operation.`,
      );
    }
    if (reference.selector.packageName !== packageName) {
      throw new Error(
        `Architecture capture sourceAnalyses[${index}] names another package.`,
      );
    }
    return reference;
  });
  const referenceKeys = references.map((reference) => deterministicJson(reference));
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new Error("Architecture capture repeats a SysML source reference.");
  }
  const selectorKeys = references.map((reference) =>
    deterministicJson(reference.selector)
  );
  if (new Set(selectorKeys).size !== selectorKeys.length) {
    throw new Error("Architecture capture repeats a SysML source selector.");
  }
  return Object.freeze(references);
}

function exactObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${path} has non-exact fields.`);
  }
}

function exactNonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function exactFingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactObject(value, path);
  exactKeys(record, ["algorithm", "digest"], path);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.digest)
  ) {
    throw new Error(`${path} must be an exact SHA-256 fingerprint.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function exactCanonicalInstant(value: unknown, path: string): string {
  if (
    typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${path} must be a canonical ISO instant.`);
  }
  return value;
}
