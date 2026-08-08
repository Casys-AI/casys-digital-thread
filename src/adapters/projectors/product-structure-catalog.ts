/**
 * Generic product-structure catalog projector for any subject whose thread
 * carries an architecture artifact written by `model.write-architecture@1`.
 *
 * WHY GENERIC — this module must not name any specific product ("coffee",
 * "drone", …). The catalog is derived entirely from the architecture capture
 * whose URI starts with `ARCHITECTURE_CAPTURE_URI_PREFIX`. If a snapshot
 * carries no such artifact, the function returns `undefined`, which is the
 * caller's signal to try another projector (e.g., the CM-01 bounded one).
 *
 * Output contract:
 *  - System PartDef → one `assembly` component (id = `<subjectId>:system`).
 *  - Every PartUsage occurrence → one `part` component (id =
 *    `<subjectId>:usage:<usage-id path>`). Repeated use of one PartDefinition
 *    is therefore preserved rather than collapsed into a label-derived id.
 *  - Duplicate PartDefinition labels or ambiguous PartUsage occurrences are
 *    rejected → `unavailable`.
 *  - Unreadable / tampered captures → `unavailable`, never throws.
 *
 * The projector is read-only: it never writes, never calls MCP, and never
 * advances a revision.
 */

import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../domain/thread/thread-component-catalog.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";

// ── Capture schema ────────────────────────────────────────────────────────────

const ARCHITECTURE_CAPTURE_SCHEMA = "architecture-capture/2.0" as const;

class ArchitectureCaptureUnreadableError extends Error {}

// ── Narrow reader interface ───────────────────────────────────────────────────

/** Minimal surface needed by the projector. Satisfied by FileCaptureStore. */
export interface GenericArchitectureCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

// ── Internal capture shape ────────────────────────────────────────────────────

interface GenericArchitectureCapture {
  readonly operation: { readonly id: string; readonly version: string };
  readonly trustedRunId: string;
  readonly insertedAt: string;
  readonly packageName: string;
  readonly systemName: string;
  readonly package: { readonly id: string; readonly label: string };
  readonly seed: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly predecessor?: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly partDefinitions: readonly {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly usages: readonly {
      readonly id: string;
      readonly kind: string;
      readonly label: string;
      readonly targetId: string;
      readonly targetKind: string;
      readonly targetLabel: string;
    }[];
  }[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the generic product-structure catalog from a ThreadSnapshot that
 * carries an architecture artifact written by `model.write-architecture@1`.
 *
 * Returns `undefined` if the snapshot has no architecture artifact — the
 * caller must chain to another projector.
 *
 * Returns an `unavailable` catalog (empty components, explicit rationale) when
 * the capture is present but unreadable, tampered, or structurally invalid.
 *
 * Never throws.
 */
export async function resolveGenericProductStructureCatalog(
  snapshot: ThreadSnapshot,
  captures: GenericArchitectureCaptureReader,
): Promise<ThreadComponentCatalog | undefined> {
  const architectures = genericArchitectureArtifacts(snapshot);
  const selected = findArchitectureTip(snapshot, architectures);
  if (selected.kind === "absent") return undefined;
  if (selected.kind === "retired") {
    return unavailable(
      snapshot.subject.id,
      "The generic architecture current tip was explicitly archived; no current product structure is available.",
    );
  }
  if (selected.kind === "ambiguous") {
    return unavailable(
      snapshot.subject.id,
      "Generic architecture evidence has multiple current tips; manual lineage review is required.",
    );
  }
  try {
    const capture = await verifyArchitectureLineage(
      snapshot,
      captures,
      selected.artifact,
      architectures,
    );
    return buildCatalog(snapshot.subject.id, selected.artifact.id, capture);
  } catch (error) {
    return unavailable(
      snapshot.subject.id,
      error instanceof ArchitectureCaptureUnreadableError
        ? "The architecture capture is not readable for this snapshot revision."
        : "The architecture capture could not be verified for this snapshot revision.",
    );
  }
}

// ── Private: artifact finder ──────────────────────────────────────────────────

function genericArchitectureArtifacts(
  snapshot: ThreadSnapshot,
): readonly ThreadArtifact[] {
  return snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" &&
    typeof artifact.uri === "string" &&
    artifact.uri.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
  );
}

function findArchitectureTip(
  snapshot: ThreadSnapshot,
  matches: readonly ThreadArtifact[],
):
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "one"; readonly artifact: ThreadArtifact } {
  if (matches.length === 0) return { kind: "absent" };
  const consumed = new Set(matches.flatMap((artifact) => artifact.inputArtifactIds));
  const tips = matches.filter((artifact) => !consumed.has(artifact.id));
  if (tips.length === 0) return { kind: "ambiguous" };
  const archived = archivedRefKeys(snapshot);
  const activeTips = tips.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`)
  );
  if (activeTips.length === 0) return { kind: "retired" };
  return activeTips.length === 1
    ? { kind: "one", artifact: activeTips[0]! }
    : { kind: "ambiguous" };
}

/**
 * Re-read every capture from the selected current tip to its root.  A generic
 * architecture catalog is an attested lineage, not merely a trustworthy last
 * record: every generic artifact in the snapshot must occur exactly once in
 * this linear chain.  This is deliberately iterative so hostile evidence
 * cannot exhaust the stack.
 */
async function verifyArchitectureLineage(
  snapshot: ThreadSnapshot,
  captures: GenericArchitectureCaptureReader,
  tip: ThreadArtifact,
  architectures: readonly ThreadArtifact[],
): Promise<GenericArchitectureCapture> {
  const byId = new Map(architectures.map((artifact) => [artifact.id, artifact]));
  if (byId.size !== architectures.length) {
    throw new Error("Generic architecture artifact identities are ambiguous.");
  }

  const visited = new Set<string>();
  let current = tip;
  let tipCapture: GenericArchitectureCapture | undefined;

  while (true) {
    if (visited.has(current.id)) {
      throw new Error("Generic architecture predecessor lineage contains a cycle.");
    }
    visited.add(current.id);

    const text = await captures.read(current.fingerprint);
    if (!text) {
      throw new ArchitectureCaptureUnreadableError(
        "A generic architecture capture is not durably readable.",
      );
    }
    const capture = await parseAndVerifyCapture(text, current.fingerprint);
    if (!tipCapture) tipCapture = capture;

    if (!isExactArchitectureArtifact(current, capture)) {
      throw new Error(
        "A generic architecture artifact metadata is not exactly bound to its capture.",
      );
    }
    if (
      !artifactMatches(snapshot, capture.seed) ||
      !hasExactConsumption(snapshot, capture.seed, capture)
    ) {
      throw new Error("A generic architecture capture has no exact seed evidence.");
    }

    if (!capture.predecessor) {
      if (!sameInputs(current.inputArtifactIds, [capture.seed.artifactId])) {
        throw new Error("The generic architecture root has non-exact inputs.");
      }
      break;
    }

    if (
      !sameInputs(current.inputArtifactIds, [
        capture.seed.artifactId,
        capture.predecessor.artifactId,
      ]) ||
      !hasExactConsumption(snapshot, capture.predecessor, capture)
    ) {
      throw new Error("A generic architecture enrichment has non-exact inputs.");
    }

    const predecessor = byId.get(capture.predecessor.artifactId);
    if (
      !predecessor ||
      !architectureEvidenceMatches(predecessor, capture.predecessor)
    ) {
      throw new Error("A generic architecture predecessor is not exact evidence.");
    }
    current = predecessor;
  }

  if (visited.size !== architectures.length) {
    throw new Error(
      "Generic architecture evidence does not form one complete linear lineage.",
    );
  }
  return tipCapture!;
}

function sameInputs(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((id, index) => id === expected[index]);
}

function artifactMatches(
  snapshot: ThreadSnapshot,
  evidence: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  },
): boolean {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id === evidence.artifactId
  );
  return artifact !== undefined &&
    fingerprintsEqual(artifact.fingerprint, evidence.fingerprint) &&
    artifact.producer.runId === evidence.producerRunId;
}

function architectureEvidenceMatches(
  artifact: ThreadArtifact,
  evidence: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  },
): boolean {
  return artifact.id === evidence.artifactId &&
    fingerprintsEqual(artifact.fingerprint, evidence.fingerprint) &&
    artifact.producer.runId === evidence.producerRunId;
}

function isExactArchitectureArtifact(
  artifact: ThreadArtifact,
  capture: GenericArchitectureCapture,
): boolean {
  return artifact.id === `architecture-${artifact.fingerprint.digest}` &&
    artifact.name === `Architecture: ${capture.packageName}` &&
    artifact.kind === "sysml-model" &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.uri ===
      `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${artifact.fingerprint.digest}` &&
    artifact.mediaType === "application/json" &&
    artifact.producer.serverId === "syson" &&
    artifact.producer.tool === "syson_element_insert_sysml" &&
    artifact.producer.runId === capture.trustedRunId &&
    artifact.freshness.status === "fresh" &&
    artifact.freshness.changedAt === capture.insertedAt &&
    artifact.freshness.invalidatedByChangeIds.length === 0;
}

function hasExactConsumption(
  snapshot: ThreadSnapshot,
  evidence: { readonly artifactId: string; readonly fingerprint: ContentFingerprint },
  capture: GenericArchitectureCapture,
): boolean {
  return snapshot.consumptions.filter((consumption) =>
    consumption.artifactId === evidence.artifactId &&
    fingerprintsEqual(consumption.observedFingerprint, evidence.fingerprint) &&
    consumption.status === "verified" &&
    consumption.verifiedAt === capture.insertedAt &&
    consumption.consumer.serverId === "syson" &&
    consumption.consumer.tool === "syson_element_insert_sysml" &&
    consumption.consumer.runId === capture.trustedRunId
  ).length === 1;
}

// ── Private: catalog builder ──────────────────────────────────────────────────

function buildCatalog(
  subjectId: string,
  evidenceArtifactId: string,
  capture: GenericArchitectureCapture,
): ThreadComponentCatalog | undefined {
  const systemDeclarations = capture.partDefinitions.filter((d) =>
    d.label === capture.systemName
  );
  if (systemDeclarations.length !== 1) {
    return unavailable(
      subjectId,
      `The architecture capture must have exactly one system PartDefinition named "${capture.systemName}".`,
    );
  }
  const systemDecl = systemDeclarations[0]!;
  if (systemDecl.usages.length === 0) {
    return unavailable(
      subjectId,
      "The architecture capture has no component declarations beyond the system itself.",
    );
  }

  const byId = new Map(
    capture.partDefinitions.map((
      partDefinition,
    ) => [partDefinition.id, partDefinition]),
  );
  const components: Array<Record<string, unknown>> = [];
  const reachableDefinitions = new Set<string>([systemDecl.id]);
  const systemId = `${subjectId}:system`;
  const visit = (
    parent: typeof systemDecl,
    parentId: string,
    path: readonly string[],
    ancestors: ReadonlySet<string>,
  ): void => {
    if (ancestors.has(parent.id)) {
      throw new Error("Architecture capture has a PartDefinition cycle.");
    }
    const nextAncestors = new Set(ancestors).add(parent.id);
    for (const usage of parent.usages) {
      const target = byId.get(usage.targetId);
      if (!target || target.label !== usage.targetLabel) {
        throw new Error("Architecture capture usage target is not exact.");
      }
      if (nextAncestors.has(target.id)) {
        throw new Error("Architecture capture has a PartDefinition cycle.");
      }
      reachableDefinitions.add(target.id);
      // A component models a PartUsage occurrence.  The path keeps repeated use
      // of the same PartDefinition distinct (and parents it by that occurrence).
      const occurrencePath = [...path, usage.id];
      const id = `${subjectId}:usage:${occurrencePath.join("/")}`;
      components.push({
        id,
        label: target.label,
        kind: "part",
        quantity: 1,
        parentId,
        bindings: [
          {
            provider: "syson",
            kind: "part-definition",
            id: target.id,
            label: target.label,
            evidenceArtifactId,
          },
          {
            provider: "syson",
            kind: "part-usage",
            id: usage.id,
            label: usage.label,
            evidenceArtifactId,
          },
        ],
      });
      visit(target, id, occurrencePath, nextAncestors);
    }
  };
  try {
    visit(systemDecl, systemId, [], new Set());
    if (reachableDefinitions.size !== capture.partDefinitions.length) {
      throw new Error(
        "Architecture capture contains a PartDefinition outside the attested system graph.",
      );
    }
    return validateThreadComponentCatalog({
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId,
      rationale:
        "This Product Structure is derived at read time from the exact hashed " +
        "architecture capture produced by the generic model.write-architecture@1 run. " +
        "The system PartDef is the assembly root; each PartUsage occurrence is a distinct part. " +
        "No ERP identity, no CAD child path, and no inferred binding is included.",
      systemViews: {},
      components: [
        {
          id: systemId,
          label: systemDecl.label,
          kind: "assembly",
          quantity: 1,
          bindings: [
            {
              provider: "syson",
              kind: "part-definition",
              id: systemDecl.id,
              label: systemDecl.label,
              evidenceArtifactId,
            },
          ],
        },
        ...components,
      ],
    });
  } catch {
    return unavailable(
      subjectId,
      "The catalog derived from the architecture capture failed validation.",
    );
  }
}

// ── Private: unavailable catalog ──────────────────────────────────────────────

function unavailable(subjectId: string, rationale: string): ThreadComponentCatalog {
  return {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId,
    rationale,
    systemViews: {},
    components: [],
  };
}

// ── Private: capture parser ───────────────────────────────────────────────────

/**
 * Parse and verify an architecture capture.
 *
 * FAIL-CLOSED — any unexpected shape, tampered fingerprint, or unsupported
 * schema version throws. The caller wraps all exceptions in `unavailable`.
 */
async function parseAndVerifyCapture(
  text: string,
  expectedFingerprint: ContentFingerprint,
): Promise<GenericArchitectureCapture> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Architecture capture is not valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Architecture capture is not a JSON object.");
  }
  const record = value as Record<string, unknown>;

  if (record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA) {
    throw new Error(
      `Architecture capture has unsupported schema version: ${
        String(record.schemaVersion)
      }`,
    );
  }

  // Verify the fingerprint against the deterministic JSON representation.
  // sha256Fingerprint accepts a JSON-safe value and sorts keys deterministically.
  const actualFp = await sha256Fingerprint(record);
  if (
    actualFp.algorithm !== expectedFingerprint.algorithm ||
    actualFp.digest !== expectedFingerprint.digest
  ) {
    throw new Error(
      "Architecture capture fingerprint does not match the artifact evidence.",
    );
  }

  const operation = record.operation as Record<string, unknown>;
  if (operation?.id !== "model.write-architecture" || operation.version !== "1") {
    throw new Error(
      "Architecture capture operation is not model.write-architecture@1.",
    );
  }
  const trustedRunId = nonEmptyString(record.trustedRunId, "trustedRunId");
  const insertedAt = canonicalInstant(record.insertedAt, "insertedAt");
  const packageName = nonEmptyString(record.packageName, "packageName");
  const systemName = nonEmptyString(record.systemName, "systemName");
  assertOnlyKeys(record, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "packageName",
    "systemName",
    "package",
    "seed",
    "predecessor",
    "partDefinitions",
    "insertedAt",
  ]);
  const packageRecord = objectRecord(record.package, "package");
  const seedRecord = objectRecord(record.seed, "seed");
  if (!packageRecord || !seedRecord || !Array.isArray(record.partDefinitions)) {
    throw new Error(
      "Architecture capture does not contain its exact package, seed, and PartDefinition graph.",
    );
  }
  assertOnlyKeys(packageRecord, ["id", "label"]);
  assertOnlyKeys(seedRecord, ["artifactId", "fingerprint", "producerRunId"]);
  const packageValue = {
    id: nonEmptyString(packageRecord.id, "package.id"),
    label: nonEmptyString(packageRecord.label, "package.label"),
  };
  const seed = {
    artifactId: nonEmptyString(seedRecord.artifactId, "seed.artifactId"),
    fingerprint: fingerprintRecord(seedRecord.fingerprint, "seed.fingerprint"),
    producerRunId: nonEmptyString(seedRecord.producerRunId, "seed.producerRunId"),
  };
  const predecessor = record.predecessor === undefined ? undefined : (() => {
    const predecessorRecord = objectRecord(record.predecessor, "predecessor");
    assertOnlyKeys(predecessorRecord, ["artifactId", "fingerprint", "producerRunId"]);
    return {
      artifactId: nonEmptyString(
        predecessorRecord.artifactId,
        "predecessor.artifactId",
      ),
      fingerprint: fingerprintRecord(
        predecessorRecord.fingerprint,
        "predecessor.fingerprint",
      ),
      producerRunId: nonEmptyString(
        predecessorRecord.producerRunId,
        "predecessor.producerRunId",
      ),
    };
  })();
  const partDefinitions = record.partDefinitions.map((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Architecture capture declaration[${i}] is not an object.`);
    }
    const decl = raw as Record<string, unknown>;
    assertOnlyKeys(decl, ["id", "kind", "label", "usages"]);
    if (decl.kind !== "PartDefinition") {
      throw new Error(
        `Architecture capture declaration[${i}] is not a PartDefinition.`,
      );
    }
    return {
      id: nonEmptyString(decl.id, `declaration[${i}].id`),
      kind: nonEmptyString(decl.kind, `declaration[${i}].kind`),
      label: nonEmptyString(decl.label, `declaration[${i}].label`),
      usages: Array.isArray(decl.usages)
        ? decl.usages.map((rawUsage, usageIndex) => {
          const usage = rawUsage as Record<string, unknown>;
          assertOnlyKeys(usage, [
            "id",
            "kind",
            "label",
            "targetId",
            "targetKind",
            "targetLabel",
          ]);
          if (usage.kind !== "PartUsage" || usage.targetKind !== "PartDefinition") {
            throw new Error(
              `Architecture capture usage ${i}/${usageIndex} has an invalid SysON kind.`,
            );
          }
          return {
            id: nonEmptyString(
              usage?.id,
              `partDefinitions[${i}].usages[${usageIndex}].id`,
            ),
            kind: nonEmptyString(
              usage?.kind,
              `partDefinitions[${i}].usages[${usageIndex}].kind`,
            ),
            label: nonEmptyString(
              usage?.label,
              `partDefinitions[${i}].usages[${usageIndex}].label`,
            ),
            targetId: nonEmptyString(
              usage?.targetId,
              `partDefinitions[${i}].usages[${usageIndex}].targetId`,
            ),
            targetKind: nonEmptyString(
              usage?.targetKind,
              `partDefinitions[${i}].usages[${usageIndex}].targetKind`,
            ),
            targetLabel: nonEmptyString(
              usage?.targetLabel,
              `partDefinitions[${i}].usages[${usageIndex}].targetLabel`,
            ),
          };
        })
        : (() => {
          throw new Error(
            `Architecture capture declaration[${i}] has no usages array.`,
          );
        })(),
    };
  });

  // Duplicate IDs are a tamper/corruption indicator.
  const ids = new Set(partDefinitions.map((d) => d.id));
  const labels = new Set(partDefinitions.map((d) => d.label));
  const usageIds = partDefinitions.flatMap((def) =>
    def.usages.map((usage) => usage.id)
  );
  if (
    ids.size !== partDefinitions.length || labels.size !== partDefinitions.length ||
    new Set(usageIds).size !== usageIds.length ||
    partDefinitions.some((def) => {
      const occurrences = new Set<string>();
      return def.usages.some((usage) => {
        const occurrence = `${usage.label}\u0000${usage.targetId}`;
        if (occurrences.has(occurrence)) return true;
        occurrences.add(occurrence);
        return !ids.has(usage.targetId);
      });
    })
  ) {
    throw new Error(
      "Architecture capture has duplicate or ambiguous declaration identities.",
    );
  }

  return {
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId,
    insertedAt,
    packageName,
    systemName,
    package: packageValue,
    seed,
    ...(predecessor ? { predecessor } : {}),
    partDefinitions,
  };
}

function objectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Architecture capture ${name} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("Architecture capture contains unsupported fields.");
  }
}

function fingerprintRecord(value: unknown, name: string): ContentFingerprint {
  const record = objectRecord(value, name);
  assertOnlyKeys(record, ["algorithm", "digest"]);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new Error(`Architecture capture ${name} is not a SHA-256 fingerprint.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function canonicalInstant(value: unknown, name: string): string {
  if (
    typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`Architecture capture ${name} is not a canonical ISO instant.`);
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Architecture capture field "${field}" must be a non-empty string.`,
    );
  }
  return value;
}
