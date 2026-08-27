/** Exact, shared parser for generic `model.capture-part-definitions@1` captures. */

import {
  MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
  PART_DEFINITIONS_CAPTURE_STATEMENT,
} from "../../../domain/architecture/part-definitions/part-definitions-capture.ts";
import type {
  ExistingPartDef,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  type ArchitectureCapturePartDefinition,
  type ArchitectureCaptureScopeRoot,
  type ArchitectureCaptureSemanticRoot,
  parseArchitectureCapturePartDefinitions,
  parseArchitectureCaptureScopeRoot,
  parseArchitectureCaptureSemanticRoot,
  requireSealedSemanticRoot,
} from "../renderer/architecture-capture.ts";

export { PART_DEFINITIONS_CAPTURE_STATEMENT };

export const PART_DEFINITIONS_CAPTURE_SCHEMA = "part-definitions-capture/1.0" as const;
export const PART_DEFINITIONS_CAPTURE_KIND = "part-definitions" as const;
export const PART_DEFINITIONS_CAPTURE_SCOPE = "sealed-architecture-subgraph" as const;

export interface PartDefinitionsCaptureArchitectureReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly uri: string;
  readonly schemaVersion: typeof ARCHITECTURE_CAPTURE_SCHEMA;
  readonly packageName: string;
  readonly systemName: string;
  readonly scopeRoot: ArchitectureCaptureScopeRoot;
  readonly semanticRoot: ArchitectureCaptureSemanticRoot;
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
  const operation = exactObject(
    record.operation,
    "PartDefinitions capture operation",
  );
  exactKeys(operation, ["id", "version"], "PartDefinitions capture operation");
  if (
    record.schemaVersion !== PART_DEFINITIONS_CAPTURE_SCHEMA ||
    record.kind !== PART_DEFINITIONS_CAPTURE_KIND ||
    record.scope !== PART_DEFINITIONS_CAPTURE_SCOPE ||
    record.statement !== PART_DEFINITIONS_CAPTURE_STATEMENT ||
    operation.id !== MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.id ||
    operation.version !== MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.version
  ) {
    throw new Error(
      "PartDefinitions capture operation or schema is not exact.",
    );
  }

  const trustedRunId = exactNonEmpty(record.trustedRunId, "trustedRunId");
  const capturedAt = exactCanonicalInstant(record.capturedAt, "capturedAt");
  const architecture = parseArchitectureReference(record.architecture);
  const seed = parseSeedReference(record.seed);
  const partDefinitions = parseArchitectureCapturePartDefinitions(
    record.partDefinitions,
    "partDefinitions",
    [architecture.scopeRoot.id],
  );
  requireSealedSemanticRoot(architecture.semanticRoot, partDefinitions);

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
 * The live label (from `syson_element_get`) is transmitted so a rename is
 * visible to `deterministicJson`. Capture kinds stay `PartDefinition` /
 * `PartUsage`, the same vocabulary `model.write-architecture@1` seals.
 */
export function toArchitectureCapturePartDefinitions(
  partDefs: readonly ExistingPartDef[],
): readonly ArchitectureCapturePartDefinition[] {
  return partDefs.map((part, index) => {
    if (!part.id || !part.label) {
      throw new Error(
        `Live PartDefinition ${index} is missing a sealed identity.`,
      );
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
      ...((part.attributes ?? []).length > 0
        ? {
          attributes: (part.attributes ?? []).map(
            (attribute, attributeIndex) => {
              if (!attribute.id || !attribute.label) {
                throw new Error(
                  `Live AttributeUsage ${index}/${attributeIndex} is missing a sealed identity.`,
                );
              }
              return {
                id: attribute.id,
                kind: "AttributeUsage" as const,
                label: attribute.label,
              };
            },
          ),
        }
        : {}),
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
      "packageName",
      "producerRunId",
      "schemaVersion",
      "scopeRoot",
      "semanticRoot",
      "systemName",
      "uri",
    ],
    "architecture",
  );
  if (record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA) {
    throw new Error(
      "PartDefinitions capture architecture schema is not exact.",
    );
  }
  return {
    artifactId: exactNonEmpty(record.artifactId, "architecture.artifactId"),
    fingerprint: exactFingerprint(
      record.fingerprint,
      "architecture.fingerprint",
    ),
    producerRunId: exactNonEmpty(
      record.producerRunId,
      "architecture.producerRunId",
    ),
    uri: exactNonEmpty(record.uri, "architecture.uri"),
    schemaVersion: record.schemaVersion,
    packageName: exactNonEmpty(record.packageName, "architecture.packageName"),
    systemName: exactNonEmpty(record.systemName, "architecture.systemName"),
    scopeRoot: parseArchitectureCaptureScopeRoot(record.scopeRoot),
    semanticRoot: parseArchitectureCaptureSemanticRoot(record.semanticRoot),
  };
}

function parseSeedReference(
  value: unknown,
): PartDefinitionsCaptureSeedReference {
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
    editingContextId: exactNonEmpty(
      record.editingContextId,
      "seed.editingContextId",
    ),
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
