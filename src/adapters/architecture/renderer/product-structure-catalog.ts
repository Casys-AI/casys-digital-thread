/**
 * Generic product-structure catalog projector for any subject whose thread
 * carries an architecture artifact written by `model.write-architecture@1`.
 *
 * WHY GENERIC — this module must not name any specific product ("coffee",
 * "drone", …). The catalog is derived entirely from the architecture capture
 * whose URI starts with `ARCHITECTURE_CAPTURE_URI_PREFIX`. If a snapshot
 * carries no such artifact, the function returns `undefined`, which is the
 * caller's signal to fall through to a static catalog.
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
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../../domain/thread/thread-component-catalog.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";
import {
  type ExactArchitectureCapture,
  parseExactArchitectureCapture,
} from "./architecture-capture.ts";
import {
  requireCurrentArchitectureSourceAnalyses,
  type SysmlSourceAnalysisReader,
} from "./sysml-source-analysis-capture.ts";
import {
  enrichGenericProductCatalogWithGeometryBundle,
  type GenericGeometryCaptureReader,
} from "../../cad/canonical/geometry-bundle-product-catalog.ts";

class ArchitectureCaptureUnreadableError extends Error {}

// ── Narrow reader interface ───────────────────────────────────────────────────

/** Minimal surface needed by the projector. Satisfied by FileCaptureStore. */
export interface GenericArchitectureCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

// ── Internal capture shape ────────────────────────────────────────────────────

type GenericArchitectureCapture = ExactArchitectureCapture;

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
  geometryCaptures?: GenericGeometryCaptureReader,
  sysmlSourceAnalysis?: SysmlSourceAnalysisReader,
): Promise<ThreadComponentCatalog | undefined> {
  const verified = await reopenVerifiedArchitectureCapture(
    snapshot,
    captures,
    sysmlSourceAnalysis,
  );
  if (verified.kind === "absent") return undefined;
  if (verified.kind === "retired") {
    return unavailable(
      snapshot.subject.id,
      "The generic architecture current tip was explicitly archived; no current product structure is available.",
    );
  }
  if (verified.kind === "ambiguous") {
    return unavailable(
      snapshot.subject.id,
      "Generic architecture evidence has multiple current tips; manual lineage review is required.",
    );
  }
  if (verified.kind !== "one") {
    return unavailable(
      snapshot.subject.id,
      verified.kind === "unreadable"
        ? "The architecture capture is not readable for this snapshot revision."
        : "The architecture capture could not be verified for this snapshot revision.",
    );
  }
  const catalog = buildCatalog(
    snapshot.subject.id,
    verified.artifact.id,
    verified.capture,
  );
  return catalog && geometryCaptures
    ? await enrichGenericProductCatalogWithGeometryBundle(
      snapshot,
      catalog,
      geometryCaptures,
    )
    : catalog;
}

/**
 * Reopen the unique current architecture-capture/4.0 after the same lineage
 * checks as the product-structure catalog: artifact identity, seed,
 * predecessor and exact source analyses. Absent, retired, ambiguous or
 * unverified evidence yields undefined.
 */
export type VerifiedArchitectureCapture =
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "unverified" }
  | {
    readonly kind: "one";
    readonly artifact: ThreadArtifact;
    readonly capture: ExactArchitectureCapture;
  };

export async function reopenVerifiedArchitectureCapture(
  snapshot: ThreadSnapshot,
  captures: GenericArchitectureCaptureReader,
  sysmlSourceAnalysis?: SysmlSourceAnalysisReader,
): Promise<VerifiedArchitectureCapture> {
  const architectures = genericArchitectureArtifacts(snapshot);
  const selected = findArchitectureTip(snapshot, architectures);
  if (selected.kind !== "one") return selected;
  try {
    const capture = await verifyArchitectureLineage(
      snapshot,
      captures,
      selected.artifact,
      architectures,
      sysmlSourceAnalysis,
    );
    return { kind: "one", artifact: selected.artifact, capture };
  } catch (error) {
    return {
      kind: error instanceof ArchitectureCaptureUnreadableError
        ? "unreadable"
        : "unverified",
    };
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
  const consumed = new Set(
    matches.flatMap((artifact) => artifact.inputArtifactIds),
  );
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
  sysmlSourceAnalysis: SysmlSourceAnalysisReader | undefined,
): Promise<ExactArchitectureCapture> {
  const byId = new Map(
    architectures.map((artifact) => [artifact.id, artifact]),
  );
  if (byId.size !== architectures.length) {
    throw new Error("Generic architecture artifact identities are ambiguous.");
  }

  const visited = new Set<string>();
  let current = tip;
  let tipCapture: ExactArchitectureCapture | undefined;

  while (true) {
    if (visited.has(current.id)) {
      throw new Error(
        "Generic architecture predecessor lineage contains a cycle.",
      );
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
    if (!sysmlSourceAnalysis) {
      throw new ArchitectureCaptureUnreadableError(
        "Current architecture source-analysis evidence has no configured read capability.",
      );
    }
    await requireCurrentArchitectureSourceAnalyses(
      capture.sourceAnalyses,
      sysmlSourceAnalysis,
      {
        runId: current.producer.runId,
        operation: capture.operation,
        packageName: capture.packageName,
      },
    );
    if (
      !artifactMatches(snapshot, capture.seed) ||
      !hasExactConsumption(snapshot, capture.seed, capture)
    ) {
      throw new Error(
        "A generic architecture capture has no exact seed evidence.",
      );
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
      throw new Error(
        "A generic architecture enrichment has non-exact inputs.",
      );
    }

    const predecessor = byId.get(capture.predecessor.artifactId);
    if (
      !predecessor ||
      !architectureEvidenceMatches(predecessor, capture.predecessor)
    ) {
      throw new Error(
        "A generic architecture predecessor is not exact evidence.",
      );
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

function sameInputs(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
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
  evidence: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  },
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
  const systemDecl = capture.partDefinitions.find((d) =>
    d.id === capture.semanticRoot.id
  );
  if (!systemDecl || systemDecl.kind !== "PartDefinition") {
    return unavailable(
      subjectId,
      "The architecture capture must seal a unique semanticRoot PartDefinition.",
    );
  }
  const systemId = `${subjectId}:system`;
  const systemAttributes = architectureAttributes(systemDecl);
  const systemComponent = {
    id: systemId,
    label: systemDecl.label,
    kind: "assembly" as const,
    quantity: 1,
    bindings: [
      {
        provider: "syson" as const,
        kind: "part-definition" as const,
        id: systemDecl.id,
        label: systemDecl.label,
        evidenceArtifactId,
      },
    ],
    ...(systemAttributes ? { attributes: systemAttributes } : {}),
  };
  if (systemDecl.usages.length === 0) {
    if (capture.partDefinitions.length !== 1) {
      return unavailable(
        subjectId,
        "A system-only architecture must contain exactly one PartDefinition.",
      );
    }
    return validateThreadComponentCatalog({
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId,
      rationale:
        "This Product Structure is derived at read time from the exact hashed " +
        "architecture capture produced by the generic model.write-architecture@1 run. " +
        "Zero PartUsages is a single-part system: the unique system PartDefinition is " +
        "the assembly. No ERP identity or provider binding is inferred.",
      systemViews: {},
      components: [systemComponent],
    });
  }

  const byId = new Map(
    capture.partDefinitions.map((
      partDefinition,
    ) => [partDefinition.id, partDefinition]),
  );
  const components: Array<Record<string, unknown>> = [];
  const reachableDefinitions = new Set<string>([systemDecl.id]);
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
      const attributes = architectureAttributes(target);
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
        ...(attributes ? { attributes } : {}),
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
        "No ERP identity or provider binding is inferred. Independent CAD bindings are added " +
        "only from an exact active geometry bundle capture.",
      systemViews: {},
      components: [
        systemComponent,
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

function architectureAttributes(
  declaration: GenericArchitectureCapture["partDefinitions"][number],
):
  | readonly { id: string; kind: "AttributeUsage"; label: string }[]
  | undefined {
  const attributes = declaration.attributes ?? [];
  if (attributes.length === 0) return undefined;
  return attributes.map((attribute) => ({
    id: attribute.id,
    kind: "AttributeUsage" as const,
    label: attribute.label,
  }));
}

function unavailable(
  subjectId: string,
  rationale: string,
): ThreadComponentCatalog {
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
): Promise<ReturnType<typeof parseExactArchitectureCapture>> {
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

  const exact = parseExactArchitectureCapture(record);
  if (deterministicJson(exact) !== text) {
    throw new Error("Architecture capture is not canonical JSON.");
  }
  return exact;
}
