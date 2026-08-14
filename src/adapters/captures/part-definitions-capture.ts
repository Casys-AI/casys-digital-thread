/** Exact, shared parser for generic `model.capture-part-definitions@1` captures. */

import {
  MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
  PART_DEFINITIONS_CAPTURE_STATEMENT,
} from "../../domain/engineering/part-definitions-capture.ts";
import type {
  ExistingPartDef,
} from "../../domain/engineering/architecture-proposal.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
  type ArchitectureCapturePartDefinition,
  parseArchitectureCapturePartDefinitions,
} from "./architecture-capture.ts";

export { PART_DEFINITIONS_CAPTURE_STATEMENT };

export const PART_DEFINITIONS_CAPTURE_SCHEMA = "part-definitions-capture/1.0" as const;
export const PART_DEFINITIONS_CAPTURE_URI_PREFIX =
  "casys://part-definitions-capture/" as const;
export const PART_DEFINITIONS_CAPTURE_KIND = "part-definitions" as const;
export const PART_DEFINITIONS_CAPTURE_SCOPE = "read-only-product-structure" as const;

export interface PartDefinitionsCaptureArchitectureReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly uri: string;
  readonly schemaVersion:
    | typeof ARCHITECTURE_CAPTURE_SCHEMA
    | typeof ARCHITECTURE_CAPTURE_SCHEMA_LEGACY;
  readonly packageName: string;
  readonly systemName: string;
  readonly package: { readonly id: string; readonly label: string };
}

export interface PartDefinitionsCaptureSeedReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly editingContextId: string;
  readonly rootPackageId: string;
}

export interface ExactPartDefinitionsCapture {
  readonly schemaVersion: typeof PART_DEFINITIONS_CAPTURE_SCHEMA;
  readonly kind: typeof PART_DEFINITIONS_CAPTURE_KIND;
  readonly scope: typeof PART_DEFINITIONS_CAPTURE_SCOPE;
  readonly statement: typeof PART_DEFINITIONS_CAPTURE_STATEMENT;
  readonly capturedAt: string;
  readonly trustedRunId: string;
  readonly operation: typeof MODEL_CAPTURE_PART_DEFINITIONS_OPERATION;
  readonly architecture: PartDefinitionsCaptureArchitectureReference;
  readonly seed: PartDefinitionsCaptureSeedReference;
  readonly partDefinitions: readonly ArchitectureCapturePartDefinition[];
}

export function parseExactPartDefinitionsCapture(
  value: unknown,
): ExactPartDefinitionsCapture {
  const record = exactObject(value, "PartDefinitions capture");
  exactKeys(
    record,
    [
      "architecture",
      "capturedAt",
      "kind",
      "operation",
      "partDefinitions",
      "schemaVersion",
      "scope",
      "seed",
      "statement",
      "trustedRunId",
    ],
    "PartDefinitions capture",
  );
  const operation = exactObject(record.operation, "PartDefinitions capture operation");
  exactKeys(operation, ["id", "version"], "PartDefinitions capture operation");
  if (
    record.schemaVersion !== PART_DEFINITIONS_CAPTURE_SCHEMA ||
    record.kind !== PART_DEFINITIONS_CAPTURE_KIND ||
    record.scope !== PART_DEFINITIONS_CAPTURE_SCOPE ||
    record.statement !== PART_DEFINITIONS_CAPTURE_STATEMENT ||
    operation.id !== MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.id ||
    operation.version !== MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.version
  ) {
    throw new Error("PartDefinitions capture operation or schema is not exact.");
  }

  const trustedRunId = exactNonEmpty(record.trustedRunId, "trustedRunId");
  const capturedAt = exactCanonicalInstant(record.capturedAt, "capturedAt");
  const architecture = parseArchitectureReference(record.architecture);
  if (architecture.package.label !== architecture.packageName) {
    throw new Error(
      "PartDefinitions capture package label does not match packageName.",
    );
  }
  const seed = parseSeedReference(record.seed);
  const partDefinitions = parseArchitectureCapturePartDefinitions(
    record.partDefinitions,
    "partDefinitions",
    [architecture.package.id],
  );
  if (!partDefinitions.some((part) => part.label === architecture.systemName)) {
    throw new Error("PartDefinitions capture systemName is not a PartDefinition.");
  }

  return {
    schemaVersion: PART_DEFINITIONS_CAPTURE_SCHEMA,
    kind: PART_DEFINITIONS_CAPTURE_KIND,
    scope: PART_DEFINITIONS_CAPTURE_SCOPE,
    statement: PART_DEFINITIONS_CAPTURE_STATEMENT,
    capturedAt,
    trustedRunId,
    operation: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
    architecture,
    seed,
    partDefinitions,
  };
}

/**
 * Project a live SysON PartDefinition graph onto the sealed capture shape.
 * Live semantic kinds stay on the extractor; the capture hard-codes
 * `PartDefinition` / `PartUsage` the same way `model.write-architecture@1` does.
 */
export function toArchitectureCapturePartDefinitions(
  partDefs: readonly ExistingPartDef[],
): readonly ArchitectureCapturePartDefinition[] {
  return partDefs.map((part, index) => {
    if (!part.id || !part.label) {
      throw new Error(`Live PartDefinition ${index} is missing a sealed identity.`);
    }
    return {
      id: part.id,
      kind: "PartDefinition" as const,
      label: part.label,
      usages: part.usages.map((usage, usageIndex) => {
        if (!usage.id || !usage.targetId || !usage.targetLabel) {
          throw new Error(
            `Live PartUsage ${index}/${usageIndex} is missing a sealed identity.`,
          );
        }
        return {
          id: usage.id,
          kind: "PartUsage" as const,
          label: usage.label,
          targetId: usage.targetId,
          targetKind: "PartDefinition" as const,
          targetLabel: usage.targetLabel,
        };
      }),
    };
  });
}

function parseArchitectureReference(
  value: unknown,
): PartDefinitionsCaptureArchitectureReference {
  const record = exactObject(value, "architecture");
  exactKeys(
    record,
    [
      "artifactId",
      "fingerprint",
      "package",
      "packageName",
      "producerRunId",
      "schemaVersion",
      "systemName",
      "uri",
    ],
    "architecture",
  );
  if (
    record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA &&
    record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA_LEGACY
  ) {
    throw new Error("PartDefinitions capture architecture schema is not exact.");
  }
  const rawPackage = exactObject(record.package, "architecture.package");
  exactKeys(rawPackage, ["id", "label"], "architecture.package");
  return {
    artifactId: exactNonEmpty(record.artifactId, "architecture.artifactId"),
    fingerprint: exactFingerprint(record.fingerprint, "architecture.fingerprint"),
    producerRunId: exactNonEmpty(record.producerRunId, "architecture.producerRunId"),
    uri: exactNonEmpty(record.uri, "architecture.uri"),
    schemaVersion: record.schemaVersion,
    packageName: exactNonEmpty(record.packageName, "architecture.packageName"),
    systemName: exactNonEmpty(record.systemName, "architecture.systemName"),
    package: {
      id: exactNonEmpty(rawPackage.id, "architecture.package.id"),
      label: exactNonEmpty(rawPackage.label, "architecture.package.label"),
    },
  };
}

function parseSeedReference(value: unknown): PartDefinitionsCaptureSeedReference {
  const record = exactObject(value, "seed");
  exactKeys(
    record,
    [
      "artifactId",
      "editingContextId",
      "fingerprint",
      "producerRunId",
      "rootPackageId",
    ],
    "seed",
  );
  return {
    artifactId: exactNonEmpty(record.artifactId, "seed.artifactId"),
    fingerprint: exactFingerprint(record.fingerprint, "seed.fingerprint"),
    producerRunId: exactNonEmpty(record.producerRunId, "seed.producerRunId"),
    editingContextId: exactNonEmpty(record.editingContextId, "seed.editingContextId"),
    rootPackageId: exactNonEmpty(record.rootPackageId, "seed.rootPackageId"),
  };
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
