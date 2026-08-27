/** Exact, shared parser for generic `model.write-architecture@1` captures. */

import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type ExistingArchitectureStructure,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  type SysmlSourceAnalysisReference,
  validateSysmlSourceAnalysisReference,
} from "./sysml-source-analysis-capture.ts";

export const ARCHITECTURE_CAPTURE_SCHEMA = "architecture-capture/4.0" as const;

export interface ArchitectureCaptureArtifactReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface ArchitectureCaptureScopeRoot {
  readonly id: string;
  readonly kind: "Package";
  readonly label?: string;
}

export interface ArchitectureCaptureSemanticRoot {
  readonly id: string;
  readonly kind: "PartDefinition";
  readonly label?: string;
}

export interface ArchitectureCapturePartDefinition {
  readonly id: string;
  readonly kind: "PartDefinition";
  readonly label: string;
  readonly usages: readonly ArchitectureCapturePartUsage[];
  readonly attributes?: readonly ArchitectureCaptureAttribute[];
}

export interface ArchitectureCaptureAttribute {
  readonly id: string;
  readonly kind: "AttributeUsage";
  readonly label: string;
}

export interface ArchitectureCapturePartUsage {
  readonly id: string;
  readonly kind: "PartUsage";
  readonly label: string;
  readonly targetId: string;
  readonly targetKind: "PartDefinition";
  readonly targetLabel: string;
}

export interface ExactArchitectureCapture {
  readonly schemaVersion: typeof ARCHITECTURE_CAPTURE_SCHEMA;
  readonly operation: typeof MODEL_WRITE_ARCHITECTURE_OPERATION;
  readonly trustedRunId: string;
  readonly packageName: string;
  readonly systemName: string;
  readonly scopeRoot: ArchitectureCaptureScopeRoot;
  readonly semanticRoot: ArchitectureCaptureSemanticRoot;
  readonly seed: ArchitectureCaptureArtifactReference;
  readonly predecessor?: ArchitectureCaptureArtifactReference;
  readonly partDefinitions: readonly ArchitectureCapturePartDefinition[];
  readonly insertedAt: string;
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
}

export interface ExactArchitectureCaptureBuildInput {
  readonly trustedRunId: string;
  readonly packageName: string;
  readonly systemName: string;
  readonly scopeRoot: ArchitectureCaptureScopeRoot;
  readonly semanticRoot: ArchitectureCaptureSemanticRoot;
  readonly seed: ArchitectureCaptureArtifactReference;
  readonly predecessor?: ArchitectureCaptureArtifactReference;
  readonly live: ExistingArchitectureStructure;
  readonly insertedAt: string;
  readonly sourceAnalyses: readonly SysmlSourceAnalysisReference[];
}

/**
 * Deterministic architecture-capture construction. Source-analysis references
 * stay adapter-owned and keep caller order. Provider identities are copied,
 * never reconstructed or sorted. Roots are sealed by id; names are display.
 */
export function buildExactArchitectureCapture(
  input: ExactArchitectureCaptureBuildInput,
): ExactArchitectureCapture {
  const partDefinitions = input.live.partDefs.map((pd) => {
    const attributes = (pd.attributes ?? []).flatMap((attribute) =>
      attribute.id
        ? [{
          id: attribute.id,
          kind: "AttributeUsage" as const,
          label: attribute.label,
        }]
        : []
    );
    return {
      id: pd.id,
      kind: "PartDefinition" as const,
      label: pd.label,
      usages: pd.usages.map((usage) => ({
        id: usage.id as string,
        kind: "PartUsage" as const,
        label: usage.label,
        targetId: usage.targetId as string,
        targetKind: "PartDefinition" as const,
        targetLabel: usage.targetLabel,
      })),
      ...(attributes.length > 0 ? { attributes } : {}),
    };
  });
  const scopeRoot = sealedScopeRoot(input.scopeRoot, input.live.packageId);
  const semanticRoot = sealedSemanticRoot(
    input.semanticRoot,
    partDefinitions,
  );
  const base = {
    operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
    trustedRunId: input.trustedRunId,
    packageName: input.packageName,
    systemName: input.systemName,
    scopeRoot,
    semanticRoot,
    seed: input.seed,
    ...(input.predecessor ? { predecessor: input.predecessor } : {}),
    partDefinitions,
    insertedAt: input.insertedAt,
  };
  if (input.sourceAnalyses.length === 0) {
    throw new Error(
      "Current architecture capture must seal SysML source analyses.",
    );
  }
  return {
    schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
    ...base,
    sourceAnalyses: input.sourceAnalyses,
  };
}

/**
 * Project a parsed capture onto the domain-owned live/predecessor graph.
 * Source-analysis references stay on the capture and are not part of this
 * PartDefinition / PartUsage / AttributeUsage projection.
 */
export function architectureGraphFromCapture(
  capture: ExactArchitectureCapture,
): ExistingArchitectureStructure {
  return {
    packageId: capture.scopeRoot.id,
    packageLabel: capture.scopeRoot.label ?? capture.packageName,
    partDefs: capture.partDefinitions.map((part) => ({
      id: part.id,
      kind: part.kind,
      label: part.label,
      usages: part.usages.map((usage) => ({
        id: usage.id,
        kind: usage.kind,
        label: usage.label,
        targetId: usage.targetId,
        targetKind: usage.targetKind,
        targetLabel: usage.targetLabel,
      })),
      attributes: (part.attributes ?? []).map((attribute) => ({
        id: attribute.id,
        kind: attribute.kind,
        label: attribute.label,
      })),
    })),
  };
}

/**
 * Parse a current architecture-capture/4.0 record fail-closed.
 *
 * Roots are sealed ids. packageName/systemName are write/display context and
 * are not used to choose a Package or PartDefinition. Older schemas are
 * rejected. There is no dual parser, alias, or label/topology fallback.
 */
export function parseExactArchitectureCapture(
  value: unknown,
): ExactArchitectureCapture {
  const record = exactObject(value, "Architecture capture");
  exactKeys(
    record,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "packageName",
      "systemName",
      "scopeRoot",
      "semanticRoot",
      "seed",
      ...(record.predecessor === undefined ? [] : ["predecessor"]),
      "partDefinitions",
      "insertedAt",
      "sourceAnalyses",
    ],
    "Architecture capture",
  );
  const operation = exactObject(
    record.operation,
    "Architecture capture operation",
  );
  exactKeys(operation, ["id", "version"], "Architecture capture operation");
  if (
    record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA ||
    operation.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
    operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version
  ) {
    throw new Error("Architecture capture operation or schema is not exact.");
  }

  const trustedRunId = exactNonEmpty(record.trustedRunId, "trustedRunId");
  const packageName = exactNonEmpty(record.packageName, "packageName");
  const systemName = exactNonEmpty(record.systemName, "systemName");
  const insertedAt = exactCanonicalInstant(record.insertedAt, "insertedAt");
  const scopeRoot = parseArchitectureCaptureScopeRoot(record.scopeRoot);
  const semanticRoot = parseArchitectureCaptureSemanticRoot(
    record.semanticRoot,
  );

  const seed = parseArtifactReference(record.seed, "seed");
  const predecessor = record.predecessor === undefined
    ? undefined
    : parseArtifactReference(record.predecessor, "predecessor");
  const sourceAnalyses = parseExactSysmlSourceAnalyses(
    record.sourceAnalyses,
    trustedRunId,
    packageName,
  );

  const partDefinitions = parseArchitectureCapturePartDefinitions(
    record.partDefinitions,
    "partDefinitions",
    [scopeRoot.id],
  );
  requireSealedSemanticRoot(semanticRoot, partDefinitions);

  const base = {
    operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
    trustedRunId,
    packageName,
    systemName,
    scopeRoot,
    semanticRoot,
    seed,
    ...(predecessor ? { predecessor } : {}),
    partDefinitions,
    insertedAt,
  };
  return {
    schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
    ...base,
    sourceAnalyses,
  };
}

export function parseArchitectureCaptureScopeRoot(
  value: unknown,
): ArchitectureCaptureScopeRoot {
  return parseCaptureRoot(value, "scopeRoot", "Package");
}

export function parseArchitectureCaptureSemanticRoot(
  value: unknown,
): ArchitectureCaptureSemanticRoot {
  return parseCaptureRoot(value, "semanticRoot", "PartDefinition");
}

/**
 * Typed projection of the sealed parent→usage→target graph. This is not a
 * parser: the capture must already have been read by
 * `parseExactArchitectureCapture`.
 */
export function extractPartDefinitionsFromCapture(
  capture: ExactArchitectureCapture,
): readonly ArchitectureCapturePartDefinition[] {
  return capture.partDefinitions;
}

/**
 * Sole reader of the sealed PartDefinition graph keys (`id`/`kind`/`label`/
 * `usages` and the inbound-target invariant). Architecture captures and
 * part-definitions captures both call this helper.
 */
export function parseArchitectureCapturePartDefinitions(
  raw: unknown,
  path: string,
  reservedIds: readonly string[],
): readonly ArchitectureCapturePartDefinition[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${path} must be an array.`);
  }
  const semanticIds = new Set<string>(reservedIds);
  const definitionLabels = new Set<string>();
  const partDefinitions = raw.map((rawPart, index) => {
    const part = exactObject(rawPart, `${path}[${index}]`);
    const hasAttributes = Object.hasOwn(part, "attributes");
    exactKeys(
      part,
      hasAttributes
        ? ["id", "kind", "label", "usages", "attributes"]
        : ["id", "kind", "label", "usages"],
      `${path}[${index}]`,
    );
    const id = exactNonEmpty(part.id, `${path}[${index}].id`);
    const label = exactNonEmpty(part.label, `${path}[${index}].label`);
    if (
      part.kind !== "PartDefinition" || !Array.isArray(part.usages) ||
      semanticIds.has(id) || definitionLabels.has(label)
    ) {
      throw new Error(
        `Architecture capture PartDefinition ${index} is ambiguous.`,
      );
    }
    semanticIds.add(id);
    definitionLabels.add(label);
    const usageLabels = new Set<string>();
    const usages = part.usages.map((rawUsage, usageIndex) => {
      const usage = exactObject(
        rawUsage,
        `${path}[${index}].usages[${usageIndex}]`,
      );
      exactKeys(
        usage,
        ["id", "kind", "label", "targetId", "targetKind", "targetLabel"],
        `${path}[${index}].usages[${usageIndex}]`,
      );
      const usageId = exactNonEmpty(
        usage.id,
        `${path}[${index}].usages[${usageIndex}].id`,
      );
      const usageLabel = exactNonEmpty(
        usage.label,
        `${path}[${index}].usages[${usageIndex}].label`,
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
          `${path}[${index}].usages[${usageIndex}].targetId`,
        ),
        targetKind: "PartDefinition" as const,
        targetLabel: exactNonEmpty(
          usage.targetLabel,
          `${path}[${index}].usages[${usageIndex}].targetLabel`,
        ),
      };
    });
    const attributeLabels = new Set<string>();
    if (hasAttributes && !Array.isArray(part.attributes)) {
      throw new Error(`${path}[${index}].attributes must be an array.`);
    }
    const attributes = hasAttributes
      ? (part.attributes as unknown[]).map((rawAttribute, attributeIndex) => {
        const attribute = exactObject(
          rawAttribute,
          `${path}[${index}].attributes[${attributeIndex}]`,
        );
        exactKeys(
          attribute,
          ["id", "kind", "label"],
          `${path}[${index}].attributes[${attributeIndex}]`,
        );
        const attributeId = exactNonEmpty(
          attribute.id,
          `${path}[${index}].attributes[${attributeIndex}].id`,
        );
        const attributeLabel = exactNonEmpty(
          attribute.label,
          `${path}[${index}].attributes[${attributeIndex}].label`,
        );
        if (
          attribute.kind !== "AttributeUsage" || semanticIds.has(attributeId) ||
          attributeLabels.has(attributeLabel)
        ) {
          throw new Error(
            `Architecture capture AttributeUsage ${index}/${attributeIndex} is ambiguous.`,
          );
        }
        semanticIds.add(attributeId);
        attributeLabels.add(attributeLabel);
        return {
          id: attributeId,
          kind: "AttributeUsage" as const,
          label: attributeLabel,
        };
      })
      : [];
    return {
      id,
      kind: "PartDefinition" as const,
      label,
      usages,
      ...(attributes.length > 0 ? { attributes } : {}),
    };
  });

  const definitionsById = new Map(
    partDefinitions.map((part) => [part.id, part]),
  );
  for (const part of partDefinitions) {
    for (const usage of part.usages) {
      if (definitionsById.get(usage.targetId)?.label !== usage.targetLabel) {
        throw new Error(
          `Architecture capture PartUsage "${usage.label}" has a non-exact target.`,
        );
      }
    }
  }
  return partDefinitions;
}

export function requireSealedSemanticRoot(
  semanticRoot: ArchitectureCaptureSemanticRoot,
  partDefinitions: readonly ArchitectureCapturePartDefinition[],
): ArchitectureCapturePartDefinition {
  const matches = partDefinitions.filter((part) => part.id === semanticRoot.id);
  if (matches.length !== 1 || matches[0]?.kind !== "PartDefinition") {
    throw new Error(
      "Architecture capture semanticRoot is not present exactly once as a PartDefinition.",
    );
  }
  const match = matches[0];
  if (semanticRoot.label !== undefined && semanticRoot.label !== match.label) {
    throw new Error(
      "Architecture capture semanticRoot label does not match the sealed PartDefinition.",
    );
  }
  return match;
}

function sealedScopeRoot(
  scopeRoot: ArchitectureCaptureScopeRoot,
  attestedPackageId: string,
): ArchitectureCaptureScopeRoot {
  if (
    scopeRoot.kind !== "Package" || !scopeRoot.id ||
    scopeRoot.id !== attestedPackageId
  ) {
    throw new Error(
      "Architecture capture scopeRoot does not match the attested Package.",
    );
  }
  return scopeRoot.label === undefined
    ? { id: scopeRoot.id, kind: "Package" }
    : { id: scopeRoot.id, kind: "Package", label: scopeRoot.label };
}

function sealedSemanticRoot(
  semanticRoot: ArchitectureCaptureSemanticRoot,
  partDefinitions: readonly ArchitectureCapturePartDefinition[],
): ArchitectureCaptureSemanticRoot {
  requireSealedSemanticRoot(semanticRoot, partDefinitions);
  return semanticRoot.label === undefined
    ? { id: semanticRoot.id, kind: "PartDefinition" }
    : {
      id: semanticRoot.id,
      kind: "PartDefinition",
      label: semanticRoot.label,
    };
}

function parseCaptureRoot<Kind extends "Package" | "PartDefinition">(
  value: unknown,
  path: string,
  kind: Kind,
): { readonly id: string; readonly kind: Kind; readonly label?: string } {
  const record = exactObject(value, path);
  const hasLabel = Object.hasOwn(record, "label");
  exactKeys(
    record,
    hasLabel ? ["id", "kind", "label"] : ["id", "kind"],
    path,
  );
  if (record.kind !== kind) {
    throw new Error(`${path}.kind must be ${kind}.`);
  }
  const id = exactNonEmpty(record.id, `${path}.id`);
  if (!hasLabel) return { id, kind };
  return {
    id,
    kind,
    label: exactNonEmpty(record.label, `${path}.label`),
  };
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
    producerRunId: exactNonEmpty(
      record.producerRunId,
      `${field}.producerRunId`,
    ),
  };
}

function parseExactSysmlSourceAnalyses(
  value: unknown,
  trustedRunId: string,
  packageName: string,
): readonly SysmlSourceAnalysisReference[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "Current architecture capture must seal SysML source analyses.",
    );
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
