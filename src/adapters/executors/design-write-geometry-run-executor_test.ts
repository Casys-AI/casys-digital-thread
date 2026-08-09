/**
 * Tests for the generic `design.write-geometry@1` executor.
 *
 * Test coverage:
 *
 *   Unit-level (exported helpers — no project bootstrap required):
 *   - assertGeometryArtifactNotRemoved does not throw when basis carries a
 *     geometry artifact.
 *   - assertGeometryArtifactNotRemoved fires (cliquet) when an ancestor had a
 *     geometry artifact but the current basis does not.
 *   - requireArchitectureArtifact finds the artifact whose fingerprint matches.
 *   - requireArchitectureArtifact throws invalid_transition when no artifact
 *     matches the supplied fingerprint.
 *   - GeometryArtifactRemovedError carries the subject id in its message.
 *
 *   Integration-level (full project bootstrap → executor → refusal):
 *   - Refusal when the run has no human MRTR approval (agent-only proposal is
 *     not sufficient).
 *   - Refusal when the basis snapshot has no architecture artifact (D5 part 1)
 *     even with a valid human MRTR decision in place.
 *
 * Every published snapshot is validated through validateThreadSnapshot by the
 * executor before it is stored.  Unit-level tests use assertRejects to stay
 * focused on the invariant under test.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_CAPTURE_URI_PREFIX,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
} from "../captures/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { EngineeringThreadSnapshotRef } from "../../domain/project/engineering-project.ts";
import {
  assertGeometryArchitectureBasisMatchesRun,
  assertGeometryArtifactNotRemoved,
  assertMrtrArtifactHashesMatchDraft,
  assertMrtrManifestMatchesDraft,
  DESIGN_WRITE_GEOMETRY_OPERATION,
  DesignWriteGeometryRunExecutor,
  GeometryArtifactRemovedError,
  type GeometryCaptureStore,
  GeometryLineageReviewRequiredError,
  requireArchitectureArtifact,
  requireDraftAssemblyPaths,
  requireDraftPreviewProducer,
  requireGeometryBundlePredecessor,
} from "./design-write-geometry-run-executor.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import {
  captureGeometryBundleDraft,
  captureGeometryDraft,
  GEOMETRY_DRAFT_CAPTURE_SCHEMA,
  type GeometryBundleDraftCapture,
  geometryBundleManifestFromDraft,
  LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA,
} from "../captures/geometry-draft-capture.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/platform/architecture-proposal.ts";
import { ARCHITECTURE_CAPTURE_SCHEMA } from "./model-write-architecture-run-executor.ts";
import {
  type AnyGeometryManifest,
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryDecisionParameters,
  type GeometryManifest,
} from "../../domain/platform/geometry-proposal.ts";
import {
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  type GeometryBundleManifest,
} from "../../domain/platform/geometry-bundle.ts";
import { resolveGenericProductStructureCatalog } from "../projectors/product-structure-catalog.ts";
import { resolveThreadComponentCatalog } from "../../domain/thread/thread-component-catalog.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const HEX64 = "a".repeat(64);
const HEX64_B = "b".repeat(64);
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const AGENT = { kind: "agent" as const, actorId: "mcp:paired-chat@1" };
const HUMAN = {
  kind: "human" as const,
  actorId: "mcp-elicitation:paired-chat@1",
};
const PROJECT_ID = "project:geo-test-01";

// ── Unit: assertGeometryArtifactNotRemoved ────────────────────────────────────

/**
 * Build an in-memory ThreadSnapshotStore so unit tests do not go through
 * FileThreadSnapshotStore.save, which calls validateThreadSnapshot and rejects
 * snapshots whose modelArtifactId does not reference an artifact in the
 * artifact list. Unit tests care about the cliquet logic, not the store.
 */
function memoryStore(snapshots: ThreadSnapshot[]): {
  get(id: string): Promise<ThreadSnapshot | undefined>;
  save(_s: ThreadSnapshot): Promise<void>;
  latest(_subjectId: string): Promise<ThreadSnapshot | undefined>;
} {
  const map = new Map(snapshots.map((s) => [s.id, s]));
  return {
    get: (id) => Promise.resolve(map.get(id)),
    save: (_s) => Promise.resolve(),
    latest: (_subjectId) => Promise.resolve(undefined),
  };
}

Deno.test("assertGeometryArtifactNotRemoved does not throw when basis already carries a geometry artifact", async () => {
  const fp: ContentFingerprint = { algorithm: "sha256", digest: HEX64 };
  const basis = minimalSnapshotWithGeometry("snap-with-geo", 1, fp);
  const store = memoryStore([basis]);

  // Must not throw — basis already carries a geometry artifact.
  await assertGeometryArtifactNotRemoved(basis, store);
});

Deno.test("assertGeometryArtifactNotRemoved fires the cliquet when an ancestor had a geometry artifact but the current basis does not", async () => {
  const ancestorFp: ContentFingerprint = { algorithm: "sha256", digest: HEX64 };
  const ancestor = minimalSnapshotWithGeometry("snap-ancestor", 1, ancestorFp);

  // Successor has NO geometry artifact but links back to the ancestor.
  const successor = minimalSnapshotWithoutGeometry("snap-successor", 2, {
    snapshotId: "snap-ancestor",
    revision: 1,
  });
  const store = memoryStore([ancestor, successor]);

  await assertRejects(
    () => assertGeometryArtifactNotRemoved(successor, store),
    GeometryArtifactRemovedError,
  );
});

Deno.test("the geometry monotony ratchet refuses an unresolvable ancestor", async () => {
  const basis = minimalSnapshotWithoutGeometry("snap-successor", 2, {
    snapshotId: "snap-missing",
    revision: 1,
  });
  await assertRejects(
    () => assertGeometryArtifactNotRemoved(basis, memoryStore([basis])),
    GeometryLineageReviewRequiredError,
    "not resolvable",
  );
});

Deno.test("the geometry monotony ratchet refuses an incompatible lineage record", async () => {
  const ancestor = minimalSnapshotWithoutGeometry("snap-other", 1);
  const basis = minimalSnapshotWithoutGeometry("snap-successor", 2, {
    snapshotId: "snap-other",
    revision: 9,
  });
  await assertRejects(
    () => assertGeometryArtifactNotRemoved(basis, memoryStore([ancestor, basis])),
    GeometryLineageReviewRequiredError,
    "incompatible record",
  );
});

Deno.test("the geometry monotony ratchet refuses lineage beyond its review bound", async () => {
  const snapshots: ThreadSnapshot[] = [];
  for (let revision = 1; revision <= 52; revision++) {
    snapshots.push(minimalSnapshotWithoutGeometry(
      `snap-${revision}`,
      revision,
      revision === 1
        ? undefined
        : { snapshotId: `snap-${revision - 1}`, revision: revision - 1 },
    ));
  }
  await assertRejects(
    () => assertGeometryArtifactNotRemoved(snapshots.at(-1)!, memoryStore(snapshots)),
    GeometryLineageReviewRequiredError,
    "exceeded",
  );
});

// ── Unit: requireArchitectureArtifact ─────────────────────────────────────────

Deno.test("requireArchitectureArtifact returns the artifact when the fingerprint matches", () => {
  const fp: ContentFingerprint = { algorithm: "sha256", digest: HEX64 };
  const snapshot = minimalSnapshotWithArchitecture("snap-arch", 1, fp);

  const result = requireArchitectureArtifact(snapshot, fp);
  assertEquals(result.fingerprint.digest, HEX64);
  assertEquals(result.kind, "sysml-model");
});

Deno.test("requireArchitectureArtifact throws invalid_transition when no artifact matches the fingerprint", () => {
  // Snapshot carries an architecture artifact with digest B; we query for A.
  const storedFp: ContentFingerprint = { algorithm: "sha256", digest: HEX64_B };
  const queriedFp: ContentFingerprint = { algorithm: "sha256", digest: HEX64 };
  const snapshot = minimalSnapshotWithArchitecture("snap-arch", 1, storedFp);

  let caught: unknown;
  try {
    requireArchitectureArtifact(snapshot, queriedFp);
  } catch (error) {
    caught = error;
  }
  assertExists(caught);
  assertEquals((caught as EngineeringProjectCommandError).code, "invalid_transition");
});

Deno.test("requireArchitectureArtifact rejects a retained predecessor when a unique successor tip exists", () => {
  const predecessorFp: ContentFingerprint = {
    algorithm: "sha256",
    digest: HEX64,
  };
  const successorFp: ContentFingerprint = {
    algorithm: "sha256",
    digest: "c".repeat(64),
  };
  const snapshot = minimalSnapshotWithArchitecture(
    "snap-architecture-successor",
    2,
    predecessorFp,
  );
  const seed = snapshot.artifacts.find((artifact) =>
    artifact.producer.tool === "syson_model_create"
  );
  const predecessor = snapshot.artifacts.find((artifact) =>
    artifact.fingerprint.digest === predecessorFp.digest
  );
  assertExists(seed);
  assertExists(predecessor);
  snapshot.artifacts.push({
    ...predecessor,
    id: `architecture-${successorFp.digest}`,
    version: successorFp.digest,
    fingerprint: successorFp,
    uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${successorFp.digest}`,
    inputArtifactIds: [seed.id, predecessor.id],
  });

  assertThrows(
    () => requireArchitectureArtifact(snapshot, predecessorFp),
    EngineeringProjectCommandError,
    "not the unique active generic architecture tip",
  );
});

Deno.test("geometry sealing requires the signed architecture revision to equal the run basis", () => {
  assertGeometryArchitectureBasisMatchesRun(
    {
      snapshotId: "subject:r2:architecture",
      revision: 2,
      artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
    },
    {
      kind: "thread-snapshot",
      snapshotId: "subject:r2:architecture",
      revision: 2,
      subjectId: "subject",
    },
  );

  let caught: unknown;
  try {
    assertGeometryArchitectureBasisMatchesRun(
      {
        snapshotId: "subject:r2:architecture",
        revision: 2,
        artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
      },
      {
        kind: "thread-snapshot",
        snapshotId: "subject:r3:requirements",
        revision: 3,
        subjectId: "subject",
      },
    );
  } catch (error) {
    caught = error;
  }
  assertExists(caught);
  assertEquals((caught as EngineeringProjectCommandError).code, "invalid_transition");
});

Deno.test("GeometryArtifactRemovedError carries the subject ID in its message", () => {
  const error = new GeometryArtifactRemovedError("subject:drone-v4");
  assertEquals(error.name, "GeometryArtifactRemovedError");
  assertEquals(error.message.includes("subject:drone-v4"), true);
  assertEquals(error.message.includes("geometry_artifact_removed"), true);
});

Deno.test("geometry preview provenance keeps v1.0 readable without inventing a provider run", () => {
  assertEquals(
    requireDraftPreviewProducer({
      schemaVersion: LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA,
      producer: { serverId: "build123d", tool: "build123d_export" },
    }),
    undefined,
  );
  assertEquals(
    requireDraftPreviewProducer({
      schemaVersion: GEOMETRY_DRAFT_CAPTURE_SCHEMA,
      producer: {
        serverId: "build123d-sandbox",
        tool: "build123d_export",
        runId: "preview:exact-001",
      },
    }),
    {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "preview:exact-001",
    },
  );
  assertThrows(
    () =>
      requireDraftPreviewProducer({
        schemaVersion: GEOMETRY_DRAFT_CAPTURE_SCHEMA,
        producer: {
          serverId: "build123d",
          tool: "build123d_export",
          runId: "preview:wrong-instance",
        },
      }),
    EngineeringProjectCommandError,
    "build123d-sandbox/build123d_export",
  );
});

Deno.test("geometry seal revalidates legacy GLB paths before canonical writes", () => {
  requireDraftAssemblyPaths({
    schemaVersion: LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA,
    assemblyFiles: [{
      format: "gltf",
      containerPath: "/exports/geometry-preview-assembly.glb",
    }],
  });
  assertThrows(
    () =>
      requireDraftAssemblyPaths({
        schemaVersion: LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA,
        assemblyFiles: [{
          format: "gltf",
          containerPath: "/exports/geometry-preview-assembly.gltf",
        }],
      }),
    EngineeringProjectCommandError,
    'fixed basename "geometry-preview-assembly.glb"',
  );
});

// ── Unit: assertMrtrArtifactHashesMatchDraft ─────────────────────────────────

Deno.test(
  "assertMrtrArtifactHashesMatchDraft accepts matching assembly hashes (D1 == D1 scenario)",
  () => {
    // Happy path: the MRTR was built from the same draft the viewer showed.
    const fp = { fingerprint: { digest: HEX64 } };
    assertMrtrArtifactHashesMatchDraft([fp], [], [fp], []);
  },
);

const SIGNED_MANIFEST: GeometryManifest = {
  schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
  architectureBasis: {
    snapshotId: "architecture-r2",
    revision: 2,
    artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
  },
  components: [{ usageName: "frame", elementId: "usage-1", label: "Frame" }],
  unitSystem: "mm",
  exportFormats: ["gltf", "step"],
  scriptHash: { algorithm: "sha256", digest: HEX64_B },
  artifactHashes: {
    assemblyFiles: [{
      format: "gltf",
      name: "geometry-preview-assembly",
      fingerprint: { algorithm: "sha256", digest: HEX64 },
    }],
    partMeshes: [],
  },
};

function matchingDraft() {
  return {
    subject: SIGNED_MANIFEST.architectureBasis,
    scriptHash: SIGNED_MANIFEST.scriptHash!,
    exportFormats: SIGNED_MANIFEST.exportFormats,
    components: SIGNED_MANIFEST.components,
    assemblyFiles: SIGNED_MANIFEST.artifactHashes!.assemblyFiles,
    partMeshes: [],
  };
}

Deno.test("the signed geometry manifest exactly matches the reviewed draft manifest", () => {
  assertMrtrManifestMatchesDraft(SIGNED_MANIFEST, matchingDraft());
});

for (
  const [field, mutate] of [
    ["script", (draft: ReturnType<typeof matchingDraft>) => ({
      ...draft,
      scriptHash: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    })],
    ["architecture", (draft: ReturnType<typeof matchingDraft>) => ({
      ...draft,
      subject: { ...draft.subject, revision: 3 },
    })],
    ["components", (draft: ReturnType<typeof matchingDraft>) => ({
      ...draft,
      components: [],
    })],
    ["formats", (draft: ReturnType<typeof matchingDraft>) => ({
      ...draft,
      exportFormats: ["step" as const, "gltf" as const],
    })],
    ["filenames", (draft: ReturnType<typeof matchingDraft>) => ({
      ...draft,
      assemblyFiles: draft.assemblyFiles.map((file) => ({ ...file, name: "other" })),
    })],
  ] as const
) {
  Deno.test(`the signed geometry manifest refuses a ${field} divergence`, () => {
    let caught: unknown;
    try {
      assertMrtrManifestMatchesDraft(SIGNED_MANIFEST, mutate(matchingDraft()));
    } catch (error) {
      caught = error;
    }
    assertEquals((caught as EngineeringProjectCommandError).code, "invalid_transition");
  });
}

Deno.test(
  "assertMrtrArtifactHashesMatchDraft throws invalid_transition when the MRTR assembly hash differs from the draft (D1/D2 attack)",
  () => {
    // Attack: human reviews draft D1 (assembly hash HEX64) but the MRTR was
    // signed with D2's hash (HEX64_B).  The executor would seal D2 — bytes
    // the operator never saw.  The cross-check must catch this.
    const mrtrFile = { fingerprint: { digest: HEX64 } };
    const draftFile = { fingerprint: { digest: HEX64_B } };
    let caught: unknown;
    try {
      assertMrtrArtifactHashesMatchDraft([mrtrFile], [], [draftFile], []);
    } catch (e) {
      caught = e;
    }
    assertExists(caught);
    assertEquals((caught as EngineeringProjectCommandError).code, "invalid_transition");
  },
);

Deno.test(
  "assertMrtrArtifactHashesMatchDraft throws invalid_transition when the MRTR part mesh hash differs from the draft",
  () => {
    const mrtrMesh = { fingerprint: { digest: HEX64 } };
    const draftMesh = { fingerprint: { digest: HEX64_B } };
    let caught: unknown;
    try {
      assertMrtrArtifactHashesMatchDraft([], [mrtrMesh], [], [draftMesh]);
    } catch (e) {
      caught = e;
    }
    assertExists(caught);
    assertEquals((caught as EngineeringProjectCommandError).code, "invalid_transition");
  },
);

Deno.test(
  "assertMrtrArtifactHashesMatchDraft throws invalid_transition when MRTR has more part meshes than the draft",
  () => {
    const fp = { fingerprint: { digest: HEX64 } };
    let thrown: unknown;
    try {
      assertMrtrArtifactHashesMatchDraft([], [fp, fp], [], [fp]);
    } catch (error) {
      thrown = error;
    }
    assertExists(thrown, "part-mesh count mismatch must be refused");
  },
);

Deno.test(
  "assertMrtrArtifactHashesMatchDraft throws invalid_transition when MRTR has more assembly files than the draft",
  () => {
    const fp = { fingerprint: { digest: HEX64 } };
    let caught: unknown;
    try {
      assertMrtrArtifactHashesMatchDraft([fp, fp], [], [fp], []);
    } catch (e) {
      caught = e;
    }
    assertExists(caught);
    assertEquals((caught as EngineeringProjectCommandError).code, "invalid_transition");
  },
);

function bundlePredecessorParams(
  predecessor?: { artifactId: string; fingerprint: ContentFingerprint },
): GeometryDecisionParameters {
  return {
    draftDigest: HEX64,
    manifest: {
      schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: "architecture",
        revision: 1,
        artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
      },
      ...(predecessor ? { predecessor } : {}),
      components: [{ elementId: "usage:frame", usageName: "frame", label: "Frame" }],
      unitSystem: "mm",
      placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
      exportFormats: ["step"],
      partExportFormats: ["step"],
      scriptHash: { algorithm: "sha256", digest: HEX64 },
      artifactHashes: {
        assemblyFiles: [{
          format: "step",
          name: "assembly",
          fingerprint: { algorithm: "sha256", digest: HEX64 },
        }],
        partMeshes: [],
      },
      partDefinitions: [{
        elementId: "definition:frame",
        label: "Frame",
        scriptHash: { algorithm: "sha256", digest: HEX64_B },
        files: [{
          format: "step",
          name: "definition",
          fingerprint: { algorithm: "sha256", digest: HEX64_B },
        }],
      }],
      occurrences: [{
        usageElementId: "usage:frame",
        partDefinitionElementId: "definition:frame",
        placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      }],
    },
  };
}

type ArchitectureAttestationDefect =
  | "missing-canonical-consumption"
  | "duplicate-consumption"
  | "wrong-consumption-time"
  | "wrong-uses-id"
  | "wrong-uses-rationale"
  | "wrong-derived-id"
  | "wrong-derived-rationale"
  | "duplicate-derived";

/** Build a structurally valid snapshot whose geometry/architecture attestation
 * is not the exact graph emitted by buildExtension. */
function withArchitectureAttestationDefect(
  snapshot: ThreadSnapshot,
  defect: ArchitectureAttestationDefect,
): ThreadSnapshot {
  const mutated = structuredClone(snapshot);
  const primary = mutated.artifacts.find((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
  );
  assertExists(primary);
  const architectureId = primary.inputArtifactIds[0];
  assertExists(architectureId);
  const consumptionId = `consume-arch-${architectureId}-by-${primary.id}`;
  const consumption = mutated.consumptions.find((candidate) =>
    candidate.id === consumptionId
  );
  const uses = mutated.provenance.find((link) => link.id === `uses-${consumptionId}`);
  const derived = mutated.provenance.find((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === architectureId
  );
  assertExists(consumption);
  assertExists(uses);
  assertExists(derived);

  switch (defect) {
    case "missing-canonical-consumption": {
      const replacementId = `${consumptionId}-replacement`;
      consumption.id = replacementId;
      uses.id = `uses-${replacementId}`;
      uses.from = { kind: "consumption", id: replacementId };
      break;
    }
    case "duplicate-consumption": {
      const duplicateId = `${consumptionId}-duplicate`;
      mutated.consumptions.push({ ...consumption, id: duplicateId });
      mutated.provenance.push({
        ...uses,
        id: `uses-${duplicateId}`,
        from: { kind: "consumption", id: duplicateId },
      });
      break;
    }
    case "wrong-consumption-time":
      consumption.verifiedAt = "2026-08-08T12:10:01.000Z";
      break;
    case "wrong-uses-id":
      uses.id = `${uses.id}-wrong`;
      break;
    case "wrong-uses-rationale":
      uses.rationale = "Adversarial architecture consumption rationale.";
      break;
    case "wrong-derived-id":
      derived.id = `${derived.id}-wrong`;
      break;
    case "wrong-derived-rationale":
      derived.rationale = "Adversarial architecture derivation rationale.";
      break;
    case "duplicate-derived":
      mutated.provenance.push({
        ...derived,
        id: `${derived.id}-duplicate`,
      });
      break;
  }
  validateThreadSnapshot(mutated);
  return mutated;
}

type PriorGeometryLineageDefect =
  | "missing-supersedes"
  | "duplicate-derived"
  | "wrong-consumption-time"
  | "wrong-derived-id"
  | "wrong-derived-rationale"
  | "wrong-supersedes-id"
  | "wrong-supersedes-rationale"
  | "wrong-uses-id"
  | "wrong-uses-rationale";

function withPriorGeometryLineageDefect(
  snapshot: ThreadSnapshot,
  defect: PriorGeometryLineageDefect,
): ThreadSnapshot {
  const mutated = structuredClone(snapshot);
  const archivedArtifactIds = new Set(
    mutated.changeSet.changes.filter((change) =>
      change.kind === "archived" && change.target.kind === "artifact"
    ).map((change) => change.target.id),
  );
  const activeGeometry = mutated.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
    !archivedArtifactIds.has(artifact.id)
  );
  assertEquals(activeGeometry.length, 1);
  const primary = activeGeometry[0]!;
  const predecessorId = primary.inputArtifactIds[1];
  assertExists(predecessorId);
  const derived = mutated.provenance.find((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === predecessorId
  );
  const supersedes = mutated.provenance.find((link) =>
    link.relation === "supersedes" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === predecessorId
  );
  const consumption = mutated.consumptions.find((candidate) =>
    candidate.id === `consume-geometry-${predecessorId}-by-${primary.id}`
  );
  const uses = mutated.provenance.find((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === consumption?.id && link.to.kind === "artifact" &&
    link.to.id === predecessorId
  );
  assertExists(derived);
  assertExists(supersedes);
  assertExists(consumption);
  assertExists(uses);

  switch (defect) {
    case "missing-supersedes":
      mutated.provenance = mutated.provenance.filter((link) =>
        link.id !== supersedes.id
      );
      break;
    case "duplicate-derived":
      mutated.provenance.push({
        ...derived,
        id: `${derived.id}-duplicate`,
      });
      break;
    case "wrong-consumption-time":
      consumption.verifiedAt = "2026-08-08T12:10:01.000Z";
      break;
    case "wrong-derived-id":
      derived.id = `${derived.id}-wrong`;
      break;
    case "wrong-derived-rationale":
      derived.rationale = "Adversarial predecessor derivation rationale.";
      break;
    case "wrong-supersedes-id":
      supersedes.id = `${supersedes.id}-wrong`;
      break;
    case "wrong-supersedes-rationale":
      supersedes.rationale = "Adversarial predecessor supersession rationale.";
      break;
    case "wrong-uses-id":
      uses.id = `${uses.id}-wrong`;
      break;
    case "wrong-uses-rationale":
      uses.rationale = "Adversarial predecessor consumption rationale.";
      break;
  }
  validateThreadSnapshot(mutated);
  return mutated;
}

type PriorGeometryBinaryGraphDefect =
  | "wrong-uses-id"
  | "wrong-trace-id"
  | "wrong-uses-rationale"
  | "wrong-trace-rationale";

function withPriorGeometryBinaryGraphDefect(
  snapshot: ThreadSnapshot,
  defect: PriorGeometryBinaryGraphDefect,
): ThreadSnapshot {
  const mutated = structuredClone(snapshot);
  const archivedArtifactIds = new Set(
    mutated.changeSet.changes.filter((change) =>
      change.kind === "archived" && change.target.kind === "artifact"
    ).map((change) => change.target.id),
  );
  const primary = mutated.artifacts.find((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
    !archivedArtifactIds.has(artifact.id)
  );
  assertExists(primary);
  const trace = mutated.provenance.find((link) =>
    link.relation === "traces_to" && link.from.kind === "artifact" &&
    link.to.kind === "artifact" && link.to.id === primary.id
  );
  assertExists(trace);
  const consumptionId = `consume-${primary.id}-by-${trace.from.id}`;
  const uses = mutated.provenance.find((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === consumptionId && link.to.kind === "artifact" &&
    link.to.id === primary.id
  );
  assertExists(uses);

  switch (defect) {
    case "wrong-uses-id":
      uses.id = `${uses.id}-wrong`;
      break;
    case "wrong-trace-id":
      trace.id = `${trace.id}-wrong`;
      break;
    case "wrong-uses-rationale":
      uses.rationale = "Adversarial binary publication rationale.";
      break;
    case "wrong-trace-rationale":
      trace.rationale = "Adversarial binary trace rationale.";
      break;
  }
  validateThreadSnapshot(mutated);
  return mutated;
}

Deno.test("geometry bundle predecessor resolution refuses ambiguous active tips before capture read", async () => {
  const first = minimalSnapshotWithGeometry(
    "basis",
    2,
    { algorithm: "sha256", digest: HEX64 },
  );
  const secondDigest = "c".repeat(64);
  first.artifacts.push({
    ...first.artifacts[0]!,
    id: `geometry-${secondDigest}`,
    version: secondDigest,
    fingerprint: { algorithm: "sha256", digest: secondDigest },
    uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${secondDigest}`,
  });
  let reads = 0;
  await assertRejects(
    () =>
      requireGeometryBundlePredecessor(first, bundlePredecessorParams(), {
        read: () => {
          reads++;
          return Promise.resolve(undefined);
        },
        save: () => Promise.reject(new Error("unexpected")),
        uriFor: () => "unused",
      }),
    EngineeringProjectCommandError,
    "geometry_tip_ambiguous",
  );
  assertEquals(reads, 0);
});

Deno.test("geometry bundle predecessor resolution refuses an inexact producer before capture read", async () => {
  const basis = minimalSnapshotWithGeometry(
    "basis",
    2,
    { algorithm: "sha256", digest: HEX64 },
  );
  const artifact = basis.artifacts[0]!;
  let reads = 0;
  await assertRejects(
    () =>
      requireGeometryBundlePredecessor(
        basis,
        bundlePredecessorParams({
          artifactId: artifact.id,
          fingerprint: artifact.fingerprint,
        }),
        {
          read: () => {
            reads++;
            return Promise.resolve(undefined);
          },
          save: () => Promise.reject(new Error("unexpected")),
          uriFor: () => "unused",
        },
      ),
    EngineeringProjectCommandError,
    "identity is not canonical",
  );
  assertEquals(reads, 0);
});

Deno.test("geometry bundle predecessor resolution refuses a self-hashed capture with wrong trusted run", async () => {
  const predecessorManifest: GeometryManifest = {
    schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: "architecture",
      revision: 1,
      artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
    },
    components: [],
    unitSystem: "mm",
    exportFormats: ["step"],
    scriptHash: { algorithm: "sha256", digest: HEX64 },
    artifactHashes: {
      assemblyFiles: [{
        format: "step",
        name: "assembly",
        fingerprint: { algorithm: "sha256", digest: HEX64_B },
      }],
      partMeshes: [],
    },
  };
  const capture = {
    schemaVersion: "geometry-capture/1.1",
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: "run:wrong",
    draftDigest: HEX64,
    manifest: predecessorManifest,
    architectureBasis: {
      artifactId: "architecture-artifact",
      fingerprint: { algorithm: "sha256", digest: HEX64 },
      producerRunId: "run:architecture",
    },
    previewProducer: null,
    sealedAt: "2026-08-08T00:00:00.000Z",
  };
  const fingerprint = await sha256Fingerprint(capture);
  const artifact: ThreadArtifact = {
    id: `geometry-${fingerprint.digest}`,
    name: "Geometry",
    kind: "cad-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run:expected",
    },
    inputArtifactIds: [],
    freshness: SNAP_FRESHNESS,
  };
  const basis = { ...minimalSnapshotBase("basis", 2), artifacts: [artifact] };
  await assertRejects(
    () =>
      requireGeometryBundlePredecessor(
        basis,
        bundlePredecessorParams({ artifactId: artifact.id, fingerprint }),
        {
          read: () => Promise.resolve(deterministicJson(capture)),
          save: () => Promise.reject(new Error("unexpected")),
          uriFor: () => "unused",
        },
      ),
    EngineeringProjectCommandError,
    "trusted run",
  );
});

for (const schemaVersion of ["geometry-capture/1.1", "geometry-capture/2.0"] as const) {
  Deno.test(
    `geometry bundle predecessor resolution refuses a shallow self-hashed ${schemaVersion} capture with the correct run`,
    async () => {
      const capture = {
        schemaVersion,
        operation: DESIGN_WRITE_GEOMETRY_OPERATION,
        trustedRunId: "run:expected",
        manifest: {
          schemaVersion: schemaVersion === "geometry-capture/1.1"
            ? GEOMETRY_MANIFEST_SCHEMA
            : GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
        },
      };
      const fingerprint = await sha256Fingerprint(capture);
      const artifact: ThreadArtifact = {
        id: `geometry-${fingerprint.digest}`,
        name: "Geometry",
        kind: "cad-model",
        version: fingerprint.digest,
        fingerprint,
        uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "design.write-geometry@1",
          runId: "run:expected",
        },
        inputArtifactIds: [],
        freshness: SNAP_FRESHNESS,
      };
      const basis = { ...minimalSnapshotBase("basis", 2), artifacts: [artifact] };
      await assertRejects(
        () =>
          requireGeometryBundlePredecessor(
            basis,
            bundlePredecessorParams({ artifactId: artifact.id, fingerprint }),
            {
              read: () => Promise.resolve(deterministicJson(capture)),
              save: () => Promise.reject(new Error("unexpected")),
              uriFor: () => "unused",
            },
          ),
        EngineeringProjectCommandError,
        "missing or unexpected fields",
      );
    },
  );
}

// ── Integration fixture ───────────────────────────────────────────────────────

interface GeoFixture {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: FileThreadSnapshotStore;
  readonly archCaptures: FileCaptureStore<"architecture-capture">;
  readonly draftCaptures: FileCaptureStore<"geometry-draft">;
  readonly geoCaptures: FileCaptureStore<"geometry-capture">;
  readonly baselineRef: EngineeringThreadSnapshotRef;
  readonly draftAssetDirectory: string;
  readonly canonicalAssetDirectory: string;
  readonly queued: { revision: number; runId: string };
  readonly parallel?: { revision: number; runId: string };
}

/**
 * Build a minimal fixture that goes through:
 *  1. startProject → proposeBrief → approveBrief
 *  2. publishPlan (baseline work item only)
 *  3. queueRun + ApprovedBriefBaselineRunExecutor → r1 (baseline snapshot)
 *  4. appendChange with geometry work item
 *     - mode "no-mrtr": decisionIds: [] — queues immediately, executor refuses with
 *       "No exact human-approved geometry MRTR decision is bound to this run basis."
 *     - mode "with-mrtr": decisionIds: ["decision:geo-params"], human-approved decision.
 *       The basis is r1 (baseline), which has NO architecture artifact — D5 fails.
 *  5. queueRun for the geometry run
 *
 * Using decisionIds: [] for the "no-mrtr" mode is the canonical approach from
 * model-write-architecture-run-executor_test.ts: the command policy only allows
 * "human" origin to call decision.approve, so the test cannot force an agent
 * approval. Instead, a work item with no decisions exercises the same guard path.
 */
async function buildGeoFixture(
  directory: string,
  opts: {
    mode: "no-mrtr" | "with-mrtr" | "happy";
    legacyDraftPath?: "glb" | "gltf";
    emptyComponents?: boolean;
    architectureCaptureDefect?:
      | "duplicate-id"
      | "package-definition-collision"
      | "usage-package-collision"
      | "wrong-trusted-run";
    architectureArtifactDefect?: "producer";
    includeParallelSibling?: boolean;
    bundleV2?: boolean;
    bundlePartGltf?: boolean;
    bundleCoverageDefect?: "omit-usage" | "omit-definition";
    bundleAssetDefect?: "empty" | "size-mismatch";
  },
): Promise<GeoFixture> {
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T12:00:00.000Z") + ++tick * 1_000).toISOString();

  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const briefCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/brief-captures`,
  });
  const archCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/arch-captures`,
  });
  const draftCaptures = new FileCaptureStore({
    ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
    directory: `${directory}/draft-captures`,
  });
  const geoCaptures = new FileCaptureStore({
    ...GEOMETRY_CAPTURE_DESCRIPTOR,
    directory: `${directory}/geo-captures`,
  });
  const draftAssetDirectory = `${directory}/draft-assets`;
  const canonicalAssetDirectory = `${directory}/canonical-assets`;

  // ── Step 1: brief lifecycle ────────────────────────────────────────────────

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-geo-project",
    projectId: PROJECT_ID,
    projectName: "Geometry write test",
    issuedAt: "2026-08-08T11:59:00.000Z",
    intent: "Integration test for design.write-geometry@1.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    commandId: "propose-brief",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T11:59:30.000Z",
    items: [
      {
        id: "objective",
        kind: "objective",
        statement: "Validate the geometry seal executor.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement: "Seal a build123d geometry draft into the evidence thread.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      },
      {
        id: "success",
        kind: "success-criterion",
        statement: "Geometry artifact appears in the ThreadSnapshot and validates.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      },
    ],
  });
  project = await briefs.approveBrief(HUMAN, {
    commandId: "approve-brief",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T11:59:45.000Z",
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved for integration test.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  // ── Step 2: publish plan with baseline only ────────────────────────────────

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, briefCaptures),
  );

  project = await commands.publishPlan(AGENT, {
    commandId: "publish-plan",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:00:00.000Z",
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Documentary baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "wi:baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });

  // ── Step 3: queue + execute baseline run ──────────────────────────────────

  project = await commands.queueRun(AGENT, {
    commandId: "queue-baseline",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:00:01.000Z",
    runId: "run:baseline",
    workItemId: "wi:baseline",
    summary: "Record the documentary baseline.",
    basis: project.plan!.basis,
  });

  const afterBaseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: briefCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-08T12:01:00.000Z",
  }).execute(AGENT, {
    commandId: "exec-baseline",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:01:00.000Z",
    runId: "run:baseline",
  });

  const r1 = afterBaseline.threadSnapshots[0]!;
  project = afterBaseline;

  // ── Step 4: append geometry work item (with or without a required decision) ─

  let geometryBasis = r1;
  let signedDraftDigest = HEX64;
  let signedManifest: AnyGeometryManifest | undefined;

  if (opts.mode === "happy") {
    project = await commands.appendChange(AGENT, {
      commandId: "append-architecture-change",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:01:10.000Z",
      baseSnapshot: r1,
      phases: [{
        id: "architecture",
        name: "Architecture",
        description: "Record the reviewed architecture basis.",
      }],
      workItems: [{
        id: "wi:architecture",
        phaseId: "architecture",
        owner: "agent",
        dependsOnWorkItemIds: ["wi:baseline"],
        decisionIds: [],
        operation: {
          ...MODEL_WRITE_ARCHITECTURE_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      }],
      requiredDecisions: [],
    });
    project = await commands.queueRun(AGENT, {
      commandId: "queue-architecture",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:01:20.000Z",
      runId: "run:architecture",
      workItemId: "wi:architecture",
      summary: "Record the reviewed architecture basis.",
      basis: { kind: "thread-snapshot", ...r1 },
    });
    const seedFingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: HEX64,
    };
    const seedArtifactId = `syson-model-seed-${seedFingerprint.digest}`;
    const seedArtifact: ThreadArtifact = {
      id: seedArtifactId,
      name: "SysON model seed",
      kind: "sysml-model",
      version: seedFingerprint.digest,
      fingerprint: seedFingerprint,
      uri: `casys://syson-model-seed-capture/sha256/${seedFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_model_create",
        runId: "run:seed-geometry-test",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: "2026-08-08T12:01:25.000Z",
        invalidatedByChangeIds: [],
      },
    };
    const architectureCapture = {
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
      operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
      trustedRunId: "run:architecture",
      packageName: "GeometryTestArchitecture",
      systemName: "GeometrySystem",
      package: { id: "package:geometry-test", label: "GeometryTestArchitecture" },
      seed: {
        artifactId: seedArtifact.id,
        fingerprint: seedFingerprint,
        producerRunId: "run:seed-geometry-test",
      },
      partDefinitions: [
        {
          id: "part-definition:system",
          kind: "PartDefinition",
          label: "GeometrySystem",
          usages: [
            {
              id: "usage:frame",
              kind: "PartUsage",
              label: "frame",
              targetId: "part-definition:frame",
              targetKind: "PartDefinition",
              targetLabel: "FrameDefinition",
            },
            ...(opts.bundleV2
              ? [{
                id: "usage:frame-secondary",
                kind: "PartUsage",
                label: "frameSecondary",
                targetId: opts.bundleCoverageDefect === "omit-definition"
                  ? "part-definition:shade"
                  : "part-definition:frame",
                targetKind: "PartDefinition",
                targetLabel: opts.bundleCoverageDefect === "omit-definition"
                  ? "ShadeDefinition"
                  : "FrameDefinition",
              }]
              : []),
          ],
        },
        {
          id: "part-definition:frame",
          kind: "PartDefinition",
          label: "FrameDefinition",
          usages: opts.bundleV2
            ? [{
              id: "usage:bolt",
              kind: "PartUsage",
              label: "bolt",
              targetId: "part-definition:bolt",
              targetKind: "PartDefinition",
              targetLabel: "BoltDefinition",
            }]
            : [],
        },
        ...(opts.bundleV2
          ? [{
            id: "part-definition:bolt",
            kind: "PartDefinition",
            label: "BoltDefinition",
            usages: [],
          }]
          : []),
        ...(opts.bundleCoverageDefect === "omit-definition"
          ? [{
            id: "part-definition:shade",
            kind: "PartDefinition",
            label: "ShadeDefinition",
            usages: [],
          }]
          : []),
      ],
      insertedAt: "2026-08-08T12:01:30.000Z",
    };
    if (opts.architectureCaptureDefect === "duplicate-id") {
      architectureCapture.partDefinitions[1]!.id = "part-definition:system";
    }
    if (opts.architectureCaptureDefect === "package-definition-collision") {
      architectureCapture.package.id = "part-definition:system";
    }
    if (opts.architectureCaptureDefect === "usage-package-collision") {
      architectureCapture.partDefinitions[0]!.usages[0]!.id =
        architectureCapture.package.id;
    }
    if (opts.architectureCaptureDefect === "wrong-trusted-run") {
      architectureCapture.trustedRunId = "run:unrelated-architecture";
    }
    const architectureFingerprint = await sha256Fingerprint(architectureCapture);
    await archCaptures.save(
      architectureFingerprint,
      deterministicJson(architectureCapture),
    );
    const architectureArtifactId = `architecture-${architectureFingerprint.digest}`;
    const architectureProducer = {
      serverId: opts.architectureArtifactDefect === "producer"
        ? "untrusted-syson"
        : "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:architecture",
    };
    const architectureConsumption: ThreadArtifactConsumption = {
      id: `consume-${seedArtifact.id}-by-${architectureArtifactId}`,
      artifactId: seedArtifact.id,
      consumer: architectureProducer,
      observedFingerprint: seedFingerprint,
      verifiedAt: architectureCapture.insertedAt,
      status: "verified",
    };
    const architectureProvenance: ThreadProvenanceLink[] = [{
      id: `derived-from-seed-${architectureFingerprint.digest}`,
      relation: "derived_from",
      from: { kind: "artifact", id: architectureArtifactId },
      to: { kind: "artifact", id: seedArtifact.id },
      rationale:
        "The architecture package was inserted into the SysON model container created by the seed run.",
    }, {
      id: `uses-${architectureConsumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: architectureConsumption.id },
      to: { kind: "artifact", id: seedArtifact.id },
      rationale:
        "The executor re-read the exact seed capture before inserting the architecture package.",
    }];
    const architectureExtension = {
      id: "architecture-test-basis",
      name: "Reviewed architecture basis",
      subjectId: r1.subjectId,
      capturedAt: "2026-08-08T12:01:30.000Z",
      artifacts: [seedArtifact, {
        id: architectureArtifactId,
        name: "Architecture: GeometryTestArchitecture",
        kind: "sysml-model" as const,
        version: architectureFingerprint.digest,
        fingerprint: architectureFingerprint,
        uri: archCaptures.uriFor(architectureFingerprint),
        mediaType: "application/json",
        producer: architectureProducer,
        inputArtifactIds: [seedArtifact.id],
        freshness: {
          status: "fresh" as const,
          changedAt: "2026-08-08T12:01:30.000Z",
          invalidatedByChangeIds: [],
        },
      }],
      consumptions: [architectureConsumption],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: architectureProvenance,
      proposedActions: [],
    };
    const baselineSnapshot = await snapshots.get(r1.snapshotId);
    assertExists(baselineSnapshot);
    const architectureSnapshot = applyThreadSnapshotExtensionIfNew(
      baselineSnapshot,
      architectureExtension,
      { appliedAt: architectureExtension.capturedAt },
    ).snapshot;
    validateThreadSnapshot(architectureSnapshot);
    await snapshots.save(architectureSnapshot);
    project = await commands.claimRun(AGENT, {
      commandId: "claim-architecture",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:01:31.000Z",
      runId: "run:architecture",
      summary: "Claim the reviewed architecture record.",
    });
    project = await commands.publishRun(AGENT, {
      commandId: "publish-architecture",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:01:32.000Z",
      runId: "run:architecture",
      summary: "Publish the reviewed architecture record.",
    });
    project = await commands.completeRun(AGENT, {
      commandId: "complete-architecture",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:01:33.000Z",
      runId: "run:architecture",
      summary: "Attach the reviewed architecture record.",
      resultSnapshot: {
        snapshotId: architectureSnapshot.id,
        revision: architectureSnapshot.revision,
        subjectId: architectureSnapshot.subject.id,
      },
      evidenceRefs: [{
        snapshotId: architectureSnapshot.id,
        snapshotRevision: architectureSnapshot.revision,
        kind: "artifact",
        id: architectureArtifactId,
      }],
    });
    geometryBasis = {
      snapshotId: architectureSnapshot.id,
      revision: architectureSnapshot.revision,
      subjectId: architectureSnapshot.subject.id,
    };

    if (opts.bundleV2) {
      const assemblyBytes = new TextEncoder().encode("reviewed assembly STEP\n");
      const definitionBytes = new TextEncoder().encode("reviewed frame STEP\n");
      const assemblyStlBytes = new TextEncoder().encode("reviewed assembly STL\n");
      const definitionStlBytes = new TextEncoder().encode("reviewed frame STL\n");
      const definitionGlbBytes = new TextEncoder().encode("reviewed frame GLB\n");
      const assemblyDigest = await sha256Bytes(assemblyBytes);
      const definitionDigest = await sha256Bytes(definitionBytes);
      const assemblyStlDigest = await sha256Bytes(assemblyStlBytes);
      const definitionStlDigest = await sha256Bytes(definitionStlBytes);
      const definitionGlbDigest = await sha256Bytes(definitionGlbBytes);
      const previewBytes = new Map([
        [assemblyDigest, assemblyBytes],
        [definitionDigest, definitionBytes],
        [assemblyStlDigest, assemblyStlBytes],
        [definitionStlDigest, definitionStlBytes],
        [definitionGlbDigest, definitionGlbBytes],
      ]);
      const draftManifest: GeometryBundleManifest = {
        schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
        architectureBasis: {
          snapshotId: architectureSnapshot.id,
          revision: architectureSnapshot.revision,
          artifactFingerprint: architectureFingerprint,
        },
        components: [
          {
            usageName: "frame",
            elementId: "usage:frame",
            label: "Frame",
          },
          ...(opts.bundleCoverageDefect === "omit-usage" ? [] : [{
            usageName: "frameSecondary",
            elementId: "usage:frame-secondary",
            label: "Frame secondary",
          }]),
          {
            usageName: "bolt",
            elementId: "usage:bolt",
            label: "Bolt",
          },
        ],
        unitSystem: "mm",
        placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
        exportFormats: ["step", "stl"],
        partExportFormats: opts.bundlePartGltf
          ? ["step", "stl", "gltf"]
          : ["step", "stl"],
        partDefinitions: [{
          elementId: "part-definition:frame",
          label: "FrameDefinition",
        }, {
          elementId: "part-definition:bolt",
          label: "BoltDefinition",
        }],
        occurrences: [
          {
            usageElementId: "usage:frame",
            partDefinitionElementId: "part-definition:frame",
            placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
          },
          ...(opts.bundleCoverageDefect === "omit-usage" ? [] : [{
            usageElementId: "usage:frame-secondary",
            partDefinitionElementId: "part-definition:frame",
            placement: {
              translationMm: [20, 0, 0] as const,
              rotationDeg: [0, 0, 0] as const,
            },
          }]),
          {
            usageElementId: "usage:bolt",
            partDefinitionElementId: "part-definition:bolt",
            placement: {
              translationMm: [0, 0, 0],
              rotationDeg: [0, 0, 0],
            },
          },
        ],
      };
      const draft = await captureGeometryBundleDraft(
        {
          callTool: (call) => {
            const args = call.arguments as Record<string, unknown>;
            const name = String(args.name);
            const isAssembly = name.endsWith("-assembly");
            const formats = args.formats as Array<"step" | "stl" | "gltf">;
            return Promise.resolve({
              structuredContent: {
                schemaVersion: "1.0",
                kind: "export",
                metrics: {},
                files: formats.map((format) => {
                  const digest = isAssembly
                    ? format === "step" ? assemblyDigest : assemblyStlDigest
                    : format === "step"
                    ? definitionDigest
                    : format === "stl"
                    ? definitionStlDigest
                    : definitionGlbDigest;
                  const bytes = previewBytes.get(digest)!;
                  const extension = format === "gltf" ? "glb" : format;
                  return {
                    format,
                    path: `/exports/${name}.${extension}`,
                    bytes: bytes.length,
                    sha256: digest,
                    ...(format === "gltf" ? { viewer: "model-viewer" } : {}),
                  };
                }),
              },
              text: "",
            });
          },
          callToolTextResult: () => Promise.reject(new Error("unexpected")),
        },
        {
          assemblyScript: "from build123d import Box\nresult = Box(10, 10, 10)\n",
          manifest: draftManifest,
          partDefinitionScripts: [{
            elementId: "part-definition:frame",
            script: "from build123d import Box\nresult = Box(8, 8, 8)\n",
          }, {
            elementId: "part-definition:bolt",
            script: "from build123d import Cylinder\nresult = Cylinder(2, 8)\n",
          }],
        },
        draftCaptures,
        {
          build123dService: "mcp-build123d-sandbox",
          previewRunId: "run:geometry-preview-v2",
          materializeAsset: async (digest) => {
            const bytes = previewBytes.get(digest);
            assertExists(bytes);
            await Deno.mkdir(draftAssetDirectory, { recursive: true });
            await Deno.writeFile(`${draftAssetDirectory}/${digest}`, bytes);
          },
        },
        () => "2026-08-08T12:01:45.000Z",
      );
      let reviewedDraft: GeometryBundleDraftCapture = draft;
      if (opts.bundleAssetDefect) {
        const altered = structuredClone(draft);
        const assemblyStep = altered.assembly.files[0] as {
          bytes: number;
          fingerprint: ContentFingerprint;
        };
        if (opts.bundleAssetDefect === "empty") {
          // Self-consistent empty-file digest plus a lying positive provider
          // count used to pass the seal because `bytes` was ignored there.
          assemblyStep.bytes = 1;
          assemblyStep.fingerprint = {
            algorithm: "sha256",
            digest: EMPTY_SHA256,
          };
          await Deno.writeFile(
            `${draftAssetDirectory}/${EMPTY_SHA256}`,
            new Uint8Array(),
          );
        } else {
          assemblyStep.bytes += 1;
        }
        const { fingerprint: _discarded, ...unsigned } = altered;
        const alteredFingerprint = await sha256Fingerprint(unsigned);
        await draftCaptures.save(
          alteredFingerprint,
          deterministicJson(unsigned),
        );
        reviewedDraft = { ...unsigned, fingerprint: alteredFingerprint };
      }
      signedDraftDigest = reviewedDraft.fingerprint.digest;
      signedManifest = geometryBundleManifestFromDraft(reviewedDraft);
    } else {
      const assetBytes = new TextEncoder().encode("reviewed geometry bytes\n");
      const assetDigest = await sha256Bytes(assetBytes);
      const draftManifest: GeometryManifest = {
        schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
        architectureBasis: {
          snapshotId: architectureSnapshot.id,
          revision: architectureSnapshot.revision,
          artifactFingerprint: architectureFingerprint,
        },
        components: opts.emptyComponents ? [] : [{
          usageName: "frame",
          elementId: "usage:frame",
          label: "Frame",
        }],
        unitSystem: "mm",
        exportFormats: ["gltf"],
      };
      const draft = await captureGeometryDraft(
        {
          callTool: () =>
            Promise.resolve({
              structuredContent: {
                schemaVersion: "1.0",
                kind: "export",
                metrics: {},
                files: [{
                  format: "gltf",
                  path: "/exports/geometry-preview-assembly.glb",
                  bytes: assetBytes.length,
                  sha256: assetDigest,
                  viewer: "model-viewer",
                }],
              },
              text: "",
            }),
          callToolTextResult: () => Promise.reject(new Error("unexpected")),
        },
        {
          script: "from build123d import Box\nresult = Box(10, 10, 10)\n",
          manifest: draftManifest,
        },
        draftCaptures,
        {
          build123dService: "mcp-build123d-sandbox",
          previewRunId: "run:geometry-preview",
          materializeAsset: async (digest) => {
            assertEquals(digest, assetDigest);
            await Deno.mkdir(draftAssetDirectory, { recursive: true });
            await Deno.writeFile(`${draftAssetDirectory}/${digest}`, assetBytes);
          },
        },
        () => "2026-08-08T12:01:45.000Z",
      );
      signedDraftDigest = draft.fingerprint.digest;
      if (opts.legacyDraftPath) {
        const legacyDraft = {
          schemaVersion: LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA,
          kind: draft.kind,
          capturedAt: draft.capturedAt,
          subject: draft.subject,
          producer: {
            serverId: "build123d" as const,
            tool: "build123d_export" as const,
          },
          script: draft.script,
          scriptHash: draft.scriptHash,
          exportFormats: draft.exportFormats,
          components: draft.components,
          assemblyFiles: draft.assemblyFiles.map((file) => ({
            ...file,
            containerPath: `/exports/geometry-preview-assembly.${opts.legacyDraftPath}`,
          })),
          partMeshes: draft.partMeshes,
        };
        const legacyFingerprint = await sha256Fingerprint(legacyDraft);
        await draftCaptures.save(
          legacyFingerprint,
          deterministicJson(legacyDraft),
        );
        signedDraftDigest = legacyFingerprint.digest;
      }
      signedManifest = {
        ...draftManifest,
        scriptHash: draft.scriptHash,
        artifactHashes: {
          assemblyFiles: draft.assemblyFiles.map((file) => ({
            format: file.format,
            name: file.name,
            fingerprint: file.fingerprint,
          })),
          partMeshes: [],
        },
      };
    }
  }

  if (opts.mode === "no-mrtr") {
    // Work item with NO decision bindings: queues immediately (no decisions to
    // approve) but the executor throws because requireMrtrApproval finds zero
    // human-approved decisions. This is the canonical test pattern from
    // model-write-architecture-run-executor_test.ts.
    project = await commands.appendChange(AGENT, {
      commandId: "append-geo-change",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:02:00.000Z",
      baseSnapshot: r1,
      phases: [{
        id: "geometry",
        name: "Geometry",
        description: "Seal the reviewed geometry.",
      }],
      workItems: [{
        id: "wi:geometry",
        phaseId: "geometry",
        owner: "agent",
        dependsOnWorkItemIds: ["wi:baseline"],
        decisionIds: [],
        operation: {
          ...DESIGN_WRITE_GEOMETRY_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      }],
      requiredDecisions: [],
    });
  } else {
    // Work item WITH a human-approved decision.  The basis r1 has NO architecture
    // artifact, so D5 will fail — which is what the "no arch artifact" test checks.
    const geoManifest: AnyGeometryManifest = signedManifest ?? {
      schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: r1.snapshotId,
        revision: r1.revision,
        // HEX64: fingerprint of an architecture artifact that does NOT exist in r1.
        artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
      },
      components: [],
      unitSystem: "mm",
      exportFormats: ["gltf"],
      scriptHash: { algorithm: "sha256", digest: HEX64 },
      artifactHashes: {
        assemblyFiles: [{
          format: "gltf",
          name: "geometry-preview-assembly",
          fingerprint: { algorithm: "sha256", digest: HEX64 },
        }],
        partMeshes: [],
      },
    };
    const geoDecisionParams = encodeGeometryDecisionParameters(
      signedDraftDigest,
      geoManifest,
    );

    project = await commands.appendChange(AGENT, {
      commandId: "append-geo-change",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:02:00.000Z",
      baseSnapshot: geometryBasis,
      phases: [{
        id: "geometry",
        name: "Geometry",
        description: "Seal the reviewed geometry.",
      }],
      workItems: [
        {
          id: "wi:geometry",
          phaseId: "geometry",
          owner: "agent",
          dependsOnWorkItemIds: ["wi:baseline"],
          decisionIds: ["decision:geo-params"],
          operation: {
            ...DESIGN_WRITE_GEOMETRY_OPERATION,
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        },
        ...(opts.includeParallelSibling
          ? [{
            id: "wi:geometry-parallel",
            phaseId: "geometry",
            owner: "agent" as const,
            dependsOnWorkItemIds: ["wi:baseline"],
            decisionIds: ["decision:geo-params-parallel"],
            operation: {
              ...DESIGN_WRITE_GEOMETRY_OPERATION,
              bindings: [{
                name: "approvedBrief",
                source: { kind: "approved-brief" as const },
              }],
            },
          }]
          : []),
      ],
      requiredDecisions: [
        {
          id: "decision:geo-params",
          phaseId: "geometry",
          title: "Geometry sealing parameters",
          question: "Which draft and manifest should be sealed into the thread?",
        },
        ...(opts.includeParallelSibling
          ? [{
            id: "decision:geo-params-parallel",
            phaseId: "geometry",
            title: "Parallel geometry sealing parameters",
            question: "Should the same-basis geometry draft be sealed in parallel?",
          }]
          : []),
      ],
    });

    project = await commands.proposeDecision(AGENT, {
      commandId: "propose-decision-geo",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:03:00.000Z",
      decisionId: "decision:geo-params",
      baseSnapshot: geometryBasis,
      proposal: {
        summary: "Seal the geometry preview assembly.",
        parameters: geoDecisionParams as Array<{
          key: string;
          label: string;
          value: string | number | boolean;
        }>,
      },
    });

    if (opts.includeParallelSibling) {
      project = await commands.proposeDecision(AGENT, {
        commandId: "propose-decision-geo-parallel",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-08T12:03:30.000Z",
        decisionId: "decision:geo-params-parallel",
        baseSnapshot: geometryBasis,
        proposal: {
          summary: "Seal the same geometry preview assembly in parallel.",
          parameters: geoDecisionParams as Array<{
            key: string;
            label: string;
            value: string | number | boolean;
          }>,
        },
      });
    }

    const approval = project.approvals.find(
      (a) => a.decisionId === "decision:geo-params",
    )!;
    project = await commands.approveDecision(HUMAN, {
      commandId: "approve-decision-geo",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:04:00.000Z",
      decisionId: "decision:geo-params",
      rationale: "The geometry manifest is correct.",
      inputFingerprint: approval.inputFingerprint!,
    });
    if (opts.includeParallelSibling) {
      const parallelApproval = project.approvals.find(
        (candidate) => candidate.decisionId === "decision:geo-params-parallel",
      )!;
      project = await commands.approveDecision(HUMAN, {
        commandId: "approve-decision-geo-parallel",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-08T12:04:30.000Z",
        decisionId: "decision:geo-params-parallel",
        rationale: "The parallel geometry manifest is exact.",
        inputFingerprint: parallelApproval.inputFingerprint!,
      });
    }
  }

  // ── Step 5: queue the geometry run ─────────────────────────────────────────

  project = await commands.queueRun(AGENT, {
    commandId: "queue-geo-run",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:05:00.000Z",
    runId: "run:geometry",
    workItemId: "wi:geometry",
    summary: "Seal the reviewed geometry draft into the thread.",
    basis: { kind: "thread-snapshot", ...geometryBasis },
  });
  let parallel: GeoFixture["parallel"];
  if (opts.includeParallelSibling) {
    project = await commands.queueRun(AGENT, {
      commandId: "queue-geo-run-parallel",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: "2026-08-08T12:05:30.000Z",
      runId: "run:geometry-parallel",
      workItemId: "wi:geometry-parallel",
      summary: "Attempt a parallel seal from the same immutable basis.",
      basis: { kind: "thread-snapshot", ...geometryBasis },
    });
    parallel = { revision: project.revision, runId: "run:geometry-parallel" };
  }

  return {
    projects,
    commands,
    snapshots,
    archCaptures,
    draftCaptures,
    geoCaptures,
    baselineRef: geometryBasis,
    draftAssetDirectory,
    canonicalAssetDirectory,
    queued: { revision: project.revision, runId: "run:geometry" },
    parallel,
  };
}

function makeExecutor(
  fixture: GeoFixture,
  directory: string,
  geometryCaptures: GeometryCaptureStore = fixture.geoCaptures,
  snapshots: ThreadSnapshotStore = fixture.snapshots,
): DesignWriteGeometryRunExecutor {
  return new DesignWriteGeometryRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots,
    architectureCaptures: fixture.archCaptures,
    geometryDraftCaptures: fixture.draftCaptures,
    geometryCaptures,
    lease: new FileEngineeringProjectRunLease(`${directory}/geo-leases`),
    draftAssetDirectory: fixture.draftAssetDirectory,
    canonicalAssetDirectory: fixture.canonicalAssetDirectory,
    now: () => "2026-08-08T12:10:00.000Z",
  });
}

function withPersistedProjectMutation(
  fixture: GeoFixture,
  mutate: (
    project: NonNullable<Awaited<ReturnType<GeoFixture["projects"]["get"]>>>,
  ) => void,
): GeoFixture {
  const projects = {
    async get(projectId: string) {
      const project = await fixture.projects.get(projectId);
      if (!project) return undefined;
      const altered = structuredClone(project);
      mutate(altered);
      return altered;
    },
    getRevision(projectId: string, revision: number) {
      return fixture.projects.getRevision(projectId, revision);
    },
    createInitial(snapshot: Parameters<typeof fixture.projects.createInitial>[0]) {
      return fixture.projects.createInitial(snapshot);
    },
    commit(
      snapshot: Parameters<typeof fixture.projects.commit>[0],
      expectedRevision: number,
    ) {
      return fixture.projects.commit(snapshot, expectedRevision);
    },
  } as unknown as FileEngineeringProjectRevisionStore;
  return { ...fixture, projects };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function executionCommand(
  fixture: Pick<GeoFixture, "queued">,
): {
  commandId: string;
  projectId: string;
  expectedRevision: number;
  issuedAt: string;
  runId: string;
} {
  return {
    commandId: "exec-geometry",
    projectId: PROJECT_ID,
    expectedRevision: fixture.queued.revision,
    issuedAt: "2026-08-08T12:10:00.000Z",
    runId: fixture.queued.runId,
  };
}

async function queueSuccessiveGeometrySeal(
  fixture: GeoFixture,
  completed: Awaited<ReturnType<DesignWriteGeometryRunExecutor["execute"]>>,
): Promise<GeoFixture> {
  const firstRun = completed.agentRuns.find((run) => run.id === fixture.queued.runId);
  assertExists(firstRun?.resultSnapshot);
  const basis = await fixture.snapshots.get(firstRun.resultSnapshot.snapshotId);
  assertExists(basis);
  const architecture = basis.artifacts.find((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
  );
  assertExists(architecture);
  const existingBinary = basis.artifacts.find((artifact) =>
    artifact.id.startsWith("cad-asset-") && artifact.uri?.endsWith(".glb")
  );
  assertExists(existingBinary);

  const manifest: GeometryManifest = {
    schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: basis.id,
      revision: basis.revision,
      artifactFingerprint: architecture.fingerprint,
    },
    components: [{
      usageName: "frame",
      elementId: "usage:frame",
      label: "Frame",
    }],
    unitSystem: "mm",
    exportFormats: ["gltf"],
  };
  const assetBytes = await Deno.readFile(
    `${fixture.draftAssetDirectory}/${existingBinary.fingerprint.digest}`,
  );
  const secondDraft = await captureGeometryDraft(
    {
      callTool: () =>
        Promise.resolve({
          structuredContent: {
            schemaVersion: "1.0",
            kind: "export",
            metrics: {},
            files: [{
              format: "gltf",
              path: "/exports/geometry-preview-assembly.glb",
              bytes: assetBytes.length,
              sha256: existingBinary.fingerprint.digest,
              viewer: "model-viewer",
            }],
          },
          text: "",
        }),
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    },
    {
      script: "from build123d import Box\nresult = Box(10, 10, 10)\n",
      manifest,
    },
    fixture.draftCaptures,
    {
      build123dService: "mcp-build123d-sandbox",
      previewRunId: "run:geometry-preview-second",
      materializeAsset: (digest) => {
        assertEquals(digest, existingBinary.fingerprint.digest);
        return Promise.resolve();
      },
    },
    () => "2026-08-08T12:11:00.000Z",
  );
  const signedManifest: GeometryManifest = {
    ...manifest,
    scriptHash: secondDraft.scriptHash,
    artifactHashes: {
      assemblyFiles: secondDraft.assemblyFiles.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: file.fingerprint,
      })),
      partMeshes: [],
    },
  };

  let project = await fixture.commands.appendChange(AGENT, {
    commandId: "append-second-geo-change",
    projectId: PROJECT_ID,
    expectedRevision: completed.revision,
    issuedAt: "2026-08-08T12:11:10.000Z",
    baseSnapshot: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    phases: [{
      id: "geometry-second",
      name: "Geometry second context",
      description: "Seal the same binary bytes from a new reviewed draft context.",
    }],
    workItems: [{
      id: "wi:geometry-second",
      phaseId: "geometry-second",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:geometry"],
      decisionIds: ["decision:geo-params-second"],
      operation: {
        ...DESIGN_WRITE_GEOMETRY_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "decision:geo-params-second",
      phaseId: "geometry-second",
      title: "Second geometry sealing parameters",
      question: "Should the new draft context seal the reviewed binary again?",
    }],
  });
  project = await fixture.commands.proposeDecision(AGENT, {
    commandId: "propose-second-geo-decision",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:11:20.000Z",
    decisionId: "decision:geo-params-second",
    baseSnapshot: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    proposal: {
      summary: "Seal the same bytes from the successor draft context.",
      parameters: encodeGeometryDecisionParameters(
        secondDraft.fingerprint.digest,
        signedManifest,
      ) as Array<{
        key: string;
        label: string;
        value: string | number | boolean;
      }>,
    },
  });
  const approval = project.approvals.find((candidate) =>
    candidate.decisionId === "decision:geo-params-second"
  );
  assertExists(approval?.inputFingerprint);
  project = await fixture.commands.approveDecision(HUMAN, {
    commandId: "approve-second-geo-decision",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:11:30.000Z",
    decisionId: "decision:geo-params-second",
    rationale: "The successor context and reused binary digest were reviewed.",
    inputFingerprint: approval.inputFingerprint,
  });
  project = await fixture.commands.queueRun(AGENT, {
    commandId: "queue-second-geo-run",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:11:40.000Z",
    runId: "run:geometry-second",
    workItemId: "wi:geometry-second",
    summary: "Seal the reviewed successor geometry draft.",
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
  });

  return {
    ...fixture,
    baselineRef: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    queued: { revision: project.revision, runId: "run:geometry-second" },
  };
}

async function queueGeometryBundleUpgrade(
  fixture: GeoFixture,
  completed: Awaited<ReturnType<DesignWriteGeometryRunExecutor["execute"]>>,
  options: { readonly omitPredecessor?: boolean } = {},
): Promise<GeoFixture> {
  const firstRun = completed.agentRuns.find((run) => run.id === fixture.queued.runId);
  assertExists(firstRun?.resultSnapshot);
  const basis = await fixture.snapshots.get(firstRun.resultSnapshot.snapshotId);
  assertExists(basis);
  const architecture = basis.artifacts.find((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
  );
  const predecessor = basis.artifacts.find((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
  );
  assertExists(architecture);
  assertExists(predecessor);

  const manifest: GeometryBundleManifest = {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: basis.id,
      revision: basis.revision,
      artifactFingerprint: architecture.fingerprint,
    },
    ...(options.omitPredecessor ? {} : {
      predecessor: {
        artifactId: predecessor.id,
        fingerprint: predecessor.fingerprint,
      },
    }),
    components: [{ usageName: "frame", elementId: "usage:frame", label: "Frame" }],
    unitSystem: "mm",
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats: ["step"],
    partExportFormats: ["step", "gltf"],
    partDefinitions: [{
      elementId: "part-definition:frame",
      label: "FrameDefinition",
    }],
    occurrences: [{
      usageElementId: "usage:frame",
      partDefinitionElementId: "part-definition:frame",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    }],
  };
  const bytesBySuffix = new Map<string, Uint8Array>([
    ["-assembly.step", new TextEncoder().encode("bundle assembly step\n")],
    ["-definition-000.step", new TextEncoder().encode("frame definition step\n")],
    ["-definition-000.glb", new TextEncoder().encode("frame definition glb\n")],
  ]);
  const digestBySuffix = new Map<string, string>();
  for (const [suffix, bytes] of bytesBySuffix) {
    digestBySuffix.set(suffix, await sha256Bytes(bytes));
  }
  const bundleDraft = await captureGeometryBundleDraft(
    {
      callTool: (call) => {
        const args = call.arguments as Record<string, unknown>;
        const name = String(args.name);
        const formats = args.formats as Array<"step" | "gltf">;
        return Promise.resolve({
          structuredContent: {
            schemaVersion: "1.0",
            kind: "export",
            metrics: {},
            files: formats.map((format) => {
              const extension = format === "gltf" ? "glb" : format;
              const suffix = name.endsWith("-assembly")
                ? `-assembly.${extension}`
                : `-definition-000.${extension}`;
              const bytes = bytesBySuffix.get(suffix)!;
              return {
                format,
                path: `/exports/${name}.${extension}`,
                bytes: bytes.length,
                sha256: digestBySuffix.get(suffix)!,
                ...(format === "gltf" ? { viewer: "model-viewer" } : {}),
              };
            }),
          },
          text: "",
        });
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    },
    {
      assemblyScript: "from build123d import Box\nresult = Box(12, 12, 12)\n",
      manifest,
      partDefinitionScripts: [{
        elementId: "part-definition:frame",
        script: "from build123d import Box\nresult = Box(8, 8, 8)\n",
      }],
    },
    fixture.draftCaptures,
    {
      build123dService: "mcp-build123d-sandbox",
      previewRunId: "run:geometry-preview-upgrade-v2",
      materializeAsset: async (digest) => {
        const suffix = [...digestBySuffix].find(([, value]) => value === digest)?.[0];
        assertExists(suffix);
        await Deno.mkdir(fixture.draftAssetDirectory, { recursive: true });
        await Deno.writeFile(
          `${fixture.draftAssetDirectory}/${digest}`,
          bytesBySuffix.get(suffix)!,
        );
      },
    },
    () => "2026-08-08T12:11:00.000Z",
  );
  const signedManifest = geometryBundleManifestFromDraft(bundleDraft);

  let project = await fixture.commands.appendChange(AGENT, {
    commandId: "append-bundle-upgrade",
    projectId: PROJECT_ID,
    expectedRevision: completed.revision,
    issuedAt: "2026-08-08T12:11:10.000Z",
    baseSnapshot: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    phases: [{
      id: "geometry-bundle-upgrade",
      name: "Geometry bundle upgrade",
      description: "Replace assembly-only geometry with a reviewed v2 bundle.",
    }],
    workItems: [{
      id: "wi:geometry-bundle-upgrade",
      phaseId: "geometry-bundle-upgrade",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:geometry"],
      decisionIds: ["decision:geometry-bundle-upgrade"],
      operation: {
        ...DESIGN_WRITE_GEOMETRY_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "decision:geometry-bundle-upgrade",
      phaseId: "geometry-bundle-upgrade",
      title: "Geometry bundle v2",
      question: "Replace the exact legacy geometry tip with this bundle?",
    }],
  });
  project = await fixture.commands.proposeDecision(AGENT, {
    commandId: "propose-bundle-upgrade",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:11:20.000Z",
    decisionId: "decision:geometry-bundle-upgrade",
    baseSnapshot: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    proposal: {
      summary:
        "Seal independent definition geometry and supersede the exact legacy tip.",
      parameters: encodeGeometryDecisionParameters(
        bundleDraft.fingerprint.digest,
        signedManifest,
      ) as Array<{ key: string; label: string; value: string | number | boolean }>,
    },
  });
  const approval = project.approvals.find((candidate) =>
    candidate.decisionId === "decision:geometry-bundle-upgrade"
  );
  assertExists(approval?.inputFingerprint);
  project = await fixture.commands.approveDecision(HUMAN, {
    commandId: "approve-bundle-upgrade",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:11:30.000Z",
    decisionId: "decision:geometry-bundle-upgrade",
    rationale:
      "The exact predecessor, sources, definitions and placements were reviewed.",
    inputFingerprint: approval.inputFingerprint,
  });
  project = await fixture.commands.queueRun(AGENT, {
    commandId: "queue-bundle-upgrade",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:11:40.000Z",
    runId: "run:geometry-bundle-upgrade",
    workItemId: "wi:geometry-bundle-upgrade",
    summary: "Seal the reviewed geometry bundle upgrade.",
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
  });
  return {
    ...fixture,
    baselineRef: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    queued: { revision: project.revision, runId: "run:geometry-bundle-upgrade" },
  };
}

async function assertGeometrySealRejectedBeforeCanonicalWrites(
  fixture: GeoFixture,
  directory: string,
  expectedMessage: string,
): Promise<void> {
  let captureWrites = 0;
  const noCanonicalWriteStore: GeometryCaptureStore = {
    uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
    read: (fingerprint) => fixture.geoCaptures.read(fingerprint),
    save: () => {
      captureWrites++;
      return Promise.reject(new Error("unexpected canonical capture write"));
    },
  };
  const before = await fixture.projects.get(PROJECT_ID);
  assertExists(before);
  const beforeThreadHead = before.threadSnapshots.at(-1);
  assertExists(beforeThreadHead);

  await assertRejects(
    () =>
      makeExecutor(fixture, directory, noCanonicalWriteStore).execute(
        AGENT,
        executionCommand(fixture),
      ),
    EngineeringProjectCommandError,
    expectedMessage,
  );

  assertEquals(captureWrites, 0);
  const after = await fixture.projects.get(PROJECT_ID);
  assertEquals(after?.revision, before.revision);
  assertEquals(
    after?.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
    "queued",
  );
  assertEquals(after?.threadSnapshots.at(-1), beforeThreadHead);
  await assertRejects(
    () => Deno.stat(fixture.canonicalAssetDirectory),
    Deno.errors.NotFound,
  );
}

// ── Integration: executor refusal paths ──────────────────────────────────────

Deno.test(
  "design-write-geometry rejects persisted MRTR summary or parameter mutation before promotion",
  async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-mrtr-seal-" });
    try {
      const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
      const before = await fixture.projects.get(PROJECT_ID);
      assertExists(before);
      const mutations: ReadonlyArray<[
        string,
        (decision: Record<string, unknown>) => void,
      ]> = [
        ["summary", (decision) => {
          const proposal = decision.proposal as Record<string, unknown>;
          proposal.summary = "Persisted geometry summary changed after approval";
        }],
        ["parameters", (decision) => {
          const proposal = decision.proposal as Record<string, unknown>;
          const parameters = proposal.parameters as Array<Record<string, unknown>>;
          const draftDigest = parameters.find((parameter) =>
            parameter.key === "geometry.draft.digest"
          );
          assertExists(draftDigest);
          draftDigest.value = "f".repeat(64);
        }],
      ];

      for (const [name, mutate] of mutations) {
        const altered = withPersistedProjectMutation(fixture, (project) => {
          const decision = project.decisions.find((candidate) =>
            candidate.id === "decision:geo-params"
          );
          assertExists(decision);
          mutate(decision as unknown as Record<string, unknown>);
        });
        let captureWrites = 0;
        const captures: GeometryCaptureStore = {
          uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
          read: (fingerprint) => fixture.geoCaptures.read(fingerprint),
          save: async (fingerprint, text) => {
            captureWrites += 1;
            return await fixture.geoCaptures.save(fingerprint, text);
          },
        };
        await assertRejects(
          () =>
            makeExecutor(altered, tmpDir, captures).execute(
              AGENT,
              executionCommand(fixture),
            ),
          EngineeringProjectCommandError,
          "decision input fingerprint no longer seals",
        );
        assertEquals(captureWrites, 0, name);
        const unchanged = await fixture.projects.get(PROJECT_ID);
        assertEquals(unchanged?.revision, before.revision, name);
        assertEquals(
          unchanged?.agentRuns.find((run) => run.id === fixture.queued.runId)
            ?.status,
          "queued",
          name,
        );
      }
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "design-write-geometry rejects added or substituted operation bindings before promotion",
  async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-shape-bindings-" });
    try {
      const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
      const before = await fixture.projects.get(PROJECT_ID);
      assertExists(before);
      const mutations: ReadonlyArray<[
        string,
        (bindings: Array<Record<string, unknown>>) => void,
      ]> = [
        ["added binding", (bindings) => {
          bindings.push({
            name: "unreviewedInput",
            source: { kind: "approved-brief" },
          });
        }],
        ["substituted binding", (bindings) => {
          bindings[0] = {
            name: "approvedBrief",
            source: { kind: "thread-snapshot", snapshotId: "foreign" },
          };
        }],
      ];

      for (const [name, mutate] of mutations) {
        const altered = withPersistedProjectMutation(fixture, (project) => {
          const workItem = project.workItems.find((candidate) =>
            candidate.id === "wi:geometry"
          );
          assertExists(workItem?.operation);
          mutate(
            workItem.operation.bindings as unknown as Array<
              Record<string, unknown>
            >,
          );
        });
        let captureWrites = 0;
        const captures: GeometryCaptureStore = {
          uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
          read: (fingerprint) => fixture.geoCaptures.read(fingerprint),
          save: async (fingerprint, text) => {
            captureWrites += 1;
            return await fixture.geoCaptures.save(fingerprint, text);
          },
        };
        await assertRejects(
          () =>
            makeExecutor(altered, tmpDir, captures).execute(
              AGENT,
              executionCommand(fixture),
            ),
          EngineeringProjectCommandError,
          "not bound to design.write-geometry@1",
        );
        assertEquals(captureWrites, 0, name);
        const unchanged = await fixture.projects.get(PROJECT_ID);
        assertEquals(unchanged?.revision, before.revision, name);
        assertEquals(
          unchanged?.agentRuns.find((run) => run.id === fixture.queued.runId)
            ?.status,
          "queued",
          name,
        );
      }
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test("a reviewed geometry draft becomes valid canonical thread evidence bound to its architecture", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-happy-path-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const productionOrder: string[] = [];
    const observedCaptureReads: ContentFingerprint[] = [];
    const trackingCaptureStore: GeometryCaptureStore = {
      uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
      read: async (fingerprint) => {
        observedCaptureReads.push(fingerprint);
        productionOrder.push("capture-read");
        return await fixture.geoCaptures.read(fingerprint);
      },
      save: async (fingerprint, text) => {
        const capture = JSON.parse(text);
        const assetDigest =
          capture.manifest.artifactHashes.assemblyFiles[0].fingerprint.digest;
        await assertRejects(
          () =>
            Deno.stat(
              `${fixture.canonicalAssetDirectory}/${assetDigest}.glb`,
            ),
          Deno.errors.NotFound,
        );
        productionOrder.push("capture-save-before-binary");
        return await fixture.geoCaptures.save(fingerprint, text);
      },
    };
    const completed = await makeExecutor(fixture, tmpDir, trackingCaptureStore).execute(
      AGENT,
      executionCommand(fixture),
    );

    const run = completed.agentRuns.find((candidate) =>
      candidate.id === fixture.queued.runId
    );
    assertExists(run);
    assertEquals(run.status, "completed");
    assertExists(run.resultSnapshot);

    const published = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(published);
    validateThreadSnapshot(published);

    const geometry = published.artifacts.find((artifact) =>
      artifact.producer.runId === fixture.queued.runId &&
      artifact.kind === "cad-model" &&
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
    );
    assertExists(geometry);
    assertEquals(geometry.producer, {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: fixture.queued.runId,
    });
    assertEquals(geometry.uri?.startsWith("casys://geometry-draft-capture/"), false);
    assertEquals(geometry.inputArtifactIds.length, 1);

    const architecture = published.artifacts.find((artifact) =>
      artifact.id === geometry.inputArtifactIds[0]
    );
    assertExists(architecture);
    assertEquals(architecture.kind, "sysml-model");
    assertEquals(
      published.previous,
      {
        snapshotId: fixture.baselineRef.snapshotId,
        revision: fixture.baselineRef.revision,
      },
    );

    const captureText = await fixture.geoCaptures.read(geometry.fingerprint);
    assertExists(captureText);
    const capture = JSON.parse(captureText);
    const actualCaptureFingerprint = await sha256Fingerprint(capture);
    assertEquals(capture.architectureBasis.artifactId, architecture.id);
    assertEquals(capture.architectureBasis.fingerprint, architecture.fingerprint);
    assertEquals(capture.previewProducer, {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "run:geometry-preview",
    });

    const asset = published.artifacts.find((artifact) =>
      artifact.id.startsWith("cad-asset-")
    );
    assertExists(asset);
    assertEquals(
      asset.id,
      `cad-asset-${geometry.fingerprint.digest}-${asset.fingerprint.digest}`,
    );
    assertEquals(
      asset.fingerprint.digest,
      capture.manifest.artifactHashes.assemblyFiles[0].fingerprint.digest,
    );
    assertEquals(asset.uri, `/api/thread/assets/${asset.fingerprint.digest}.glb`);
    assertEquals(asset.mediaType, "model/gltf-binary");
    assertEquals(asset.producer, capture.previewProducer);
    assertEquals(asset.inputArtifactIds, []);
    assertEquals(
      await Deno.readFile(
        `${fixture.canonicalAssetDirectory}/${asset.fingerprint.digest}.glb`,
      ),
      await Deno.readFile(`${fixture.draftAssetDirectory}/${asset.fingerprint.digest}`),
    );
    productionOrder.push("binary-observed");
    assertEquals(productionOrder[0], "capture-save-before-binary");
    assertEquals(
      productionOrder.indexOf("capture-read") <
        productionOrder.indexOf("binary-observed"),
      true,
    );
    assertEquals(
      observedCaptureReads.some((fingerprint) =>
        fingerprint.digest === actualCaptureFingerprint.digest
      ),
      true,
    );
    const binaryConsumption = published.consumptions.find((consumption) =>
      consumption.consumer.runId === fixture.queued.runId &&
      consumption.artifactId === geometry.id &&
      consumption.observedFingerprint.digest === actualCaptureFingerprint.digest
    );
    assertExists(binaryConsumption);
    assertEquals(binaryConsumption.consumer, geometry.producer);
    assertEquals(binaryConsumption.status, "verified");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry bundle v2 seals independent PartDefinition STEP and raw sources, then replays exactly", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-v2-e2e-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      bundleV2: true,
      bundlePartGltf: true,
    });
    const executor = makeExecutor(fixture, tmpDir);
    const command = executionCommand(fixture);
    const completed = await executor.execute(AGENT, command);
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === fixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const published = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(published);
    validateThreadSnapshot(published);

    const geometry = published.artifacts.find((artifact) =>
      artifact.producer.runId === fixture.queued.runId &&
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
    );
    assertExists(geometry);
    const captureText = await fixture.geoCaptures.read(geometry.fingerprint);
    assertExists(captureText);
    const capture = JSON.parse(captureText);
    assertEquals(capture.schemaVersion, "geometry-capture/2.0");
    assertEquals(capture.manifest.schemaVersion, "geometry-manifest/2.0");
    assertEquals(capture.sourceScripts.partDefinitions.length, 2);
    assertEquals(
      capture.sourceScripts.partDefinitions[0].elementId,
      "part-definition:frame",
    );
    assertEquals(
      capture.manifest.occurrences[0],
      {
        usageElementId: "usage:frame",
        partDefinitionElementId: "part-definition:frame",
        placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      },
    );

    const assemblyStep = published.artifacts.find((artifact) =>
      artifact.id.startsWith(`cad-asset-${geometry.fingerprint.digest}-assembly-`)
    );
    const definitionStep = published.artifacts.find((artifact) =>
      artifact.id.startsWith(
        `cad-asset-${geometry.fingerprint.digest}-definition-0-0-`,
      )
    );
    const boltStep = published.artifacts.find((artifact) =>
      artifact.id.startsWith(
        `cad-asset-${geometry.fingerprint.digest}-definition-1-0-`,
      )
    );
    const assemblyStl = published.artifacts.find((artifact) =>
      artifact.id.startsWith(
        `cad-asset-${geometry.fingerprint.digest}-assembly-1-`,
      )
    );
    const definitionStl = published.artifacts.find((artifact) =>
      artifact.id.startsWith(
        `cad-asset-${geometry.fingerprint.digest}-definition-0-1-`,
      )
    );
    const definitionGlb = published.artifacts.find((artifact) =>
      artifact.id.startsWith(
        `cad-asset-${geometry.fingerprint.digest}-definition-0-2-`,
      )
    );
    const boltGlb = published.artifacts.find((artifact) =>
      artifact.id.startsWith(
        `cad-asset-${geometry.fingerprint.digest}-definition-1-2-`,
      )
    );
    assertExists(assemblyStep);
    assertExists(definitionStep);
    assertExists(boltStep);
    assertExists(assemblyStl);
    assertExists(definitionStl);
    assertExists(definitionGlb);
    assertExists(boltGlb);
    assertEquals(assemblyStep.kind, "step");
    assertEquals(definitionStep.kind, "step");
    assertEquals(assemblyStl.kind, "cad-model");
    assertEquals(definitionStl.kind, "mesh");
    assertEquals(definitionGlb.kind, "cad-model");
    assertEquals(definitionGlb.mediaType, "model/gltf-binary");
    assertEquals(definitionStep.name, "Authoritative STEP: FrameDefinition");
    assertEquals(
      assemblyStep.fingerprint.digest === definitionStep.fingerprint.digest,
      false,
    );
    assertEquals(
      await Deno.readFile(
        `${fixture.canonicalAssetDirectory}/${definitionStep.fingerprint.digest}.step`,
      ),
      await Deno.readFile(
        `${fixture.draftAssetDirectory}/${definitionStep.fingerprint.digest}`,
      ),
    );

    const catalog = await resolveGenericProductStructureCatalog(
      published,
      fixture.archCaptures,
      fixture.geoCaptures,
    );
    assertExists(catalog);
    const occurrences = catalog.components.filter((component) =>
      component.kind === "part"
    );
    assertEquals(occurrences.length, 4);
    const projected = occurrences.map((component) => {
      const bindings = component.bindings.filter((binding) =>
        binding.provider === "digital-thread" && binding.kind === "artifact"
      );
      const definition = component.bindings.find((binding) =>
        binding.provider === "syson" && binding.kind === "part-definition"
      );
      assertExists(definition);
      assertEquals(bindings.length, 1);
      assertEquals(bindings[0]!.evidenceArtifactId, geometry.id);
      return { definitionId: definition.id, cadId: bindings[0]!.id };
    });
    assertEquals(
      projected.filter((item) => item.definitionId === "part-definition:frame"),
      [{
        definitionId: "part-definition:frame",
        cadId: definitionStep.id,
      }, {
        definitionId: "part-definition:frame",
        cadId: definitionStep.id,
      }],
    );
    assertEquals(
      projected.filter((item) => item.definitionId === "part-definition:bolt"),
      [{
        definitionId: "part-definition:bolt",
        cadId: boltStep.id,
      }, {
        definitionId: "part-definition:bolt",
        cadId: boltStep.id,
      }],
    );
    const projectedPreviews = occurrences.map((component) => ({
      definitionId: component.bindings.find((binding) =>
        binding.provider === "syson" && binding.kind === "part-definition"
      )!.id,
      preview: component.preview,
    }));
    assertEquals(
      projectedPreviews.filter((item) =>
        item.definitionId === "part-definition:frame"
      ).map((item) => item.preview),
      Array.from({ length: 2 }, () => ({
        provider: "build123d" as const,
        artifactId: definitionGlb.id,
        mediaType: "model/gltf-binary" as const,
        url: definitionGlb.uri!,
        sha256: definitionGlb.fingerprint.digest,
      })),
    );
    assertEquals(
      projectedPreviews.filter((item) => item.definitionId === "part-definition:bolt")
        .map((item) => item.preview),
      Array.from({ length: 2 }, () => ({
        provider: "build123d" as const,
        artifactId: boltGlb.id,
        mediaType: "model/gltf-binary" as const,
        url: boltGlb.uri!,
        sha256: boltGlb.fingerprint.digest,
      })),
    );
    const resolvedCatalog = resolveThreadComponentCatalog(published, catalog);
    assertEquals(
      resolvedCatalog.components.flatMap((component) =>
        component.bindings.filter((binding) =>
          binding.provider === "digital-thread" && binding.kind === "artifact"
        ).map((binding) => binding.status)
      ),
      ["verified", "verified", "verified", "verified", "verified"],
    );

    const assertNoProjectedCad = async (
      candidate: ThreadSnapshot,
      expectedReason: string,
    ) => {
      const unavailable = await resolveGenericProductStructureCatalog(
        candidate,
        fixture.archCaptures,
        fixture.geoCaptures,
      );
      assertExists(unavailable);
      assertEquals(
        unavailable.components.flatMap((component) =>
          component.bindings.filter((binding) => binding.provider === "digital-thread")
        ).length,
        0,
      );
      assertStringIncludes(unavailable.rationale, expectedReason);
    };

    const extraFamilyArtifact = structuredClone(published);
    extraFamilyArtifact.artifacts.push({
      ...definitionStep,
      id:
        `cad-asset-${geometry.fingerprint.digest}-definition-99-0-${definitionStep.fingerprint.digest}`,
    });
    await assertNoProjectedCad(extraFamilyArtifact, "unreviewed extra artifact");

    const extraLegacyMeshFamilyArtifact = structuredClone(published);
    extraLegacyMeshFamilyArtifact.artifacts.push({
      ...definitionStl,
      id: `mesh-${geometry.fingerprint.digest}-${definitionStl.fingerprint.digest}`,
    });
    await assertNoProjectedCad(
      extraLegacyMeshFamilyArtifact,
      "unreviewed extra artifact",
    );

    const archivedDefinitionStep = structuredClone(published);
    archivedDefinitionStep.changeSet.changes.push({
      id: `archive-test-${definitionStep.id}`,
      kind: "archived",
      target: { kind: "artifact", id: definitionStep.id },
      summary: "Adversarially archive one required PartDefinition STEP.",
      beforeFingerprint: definitionStep.fingerprint,
    });
    await assertNoProjectedCad(archivedDefinitionStep, "incomplete");

    const publicationConsumptionId = `consume-${geometry.id}-by-${definitionStep.id}`;
    const missingPublicationConsumption = structuredClone(published);
    missingPublicationConsumption.consumptions = missingPublicationConsumption
      .consumptions.filter((consumption) =>
        consumption.id !== publicationConsumptionId
      );
    await assertNoProjectedCad(
      missingPublicationConsumption,
      "publication consumption is not exact",
    );

    const missingPublicationUses = structuredClone(published);
    missingPublicationUses.provenance = missingPublicationUses.provenance.filter(
      (link) =>
        !(link.relation === "uses" && link.from.kind === "consumption" &&
          link.from.id === publicationConsumptionId),
    );
    await assertNoProjectedCad(
      missingPublicationUses,
      "publication consumption is not exact",
    );

    const publicationUses = published.provenance.find((link) =>
      link.relation === "uses" && link.from.kind === "consumption" &&
      link.from.id === publicationConsumptionId
    );
    assertExists(publicationUses);
    const wrongPublicationUsesId = structuredClone(published);
    const wrongUsesIdLink = wrongPublicationUsesId.provenance.find((link) =>
      link.id === publicationUses.id
    );
    assertExists(wrongUsesIdLink);
    wrongUsesIdLink.id = `${wrongUsesIdLink.id}-wrong`;
    await assertNoProjectedCad(
      wrongPublicationUsesId,
      "publication consumption is not exact",
    );

    const binaryTrace = published.provenance.find((link) =>
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.from.id === definitionStep.id && link.to.kind === "artifact" &&
      link.to.id === geometry.id
    );
    assertExists(binaryTrace);
    const wrongBinaryTraceId = structuredClone(published);
    const wrongTraceIdLink = wrongBinaryTraceId.provenance.find((link) =>
      link.id === binaryTrace.id
    );
    assertExists(wrongTraceIdLink);
    wrongTraceIdLink.id = `${wrongTraceIdLink.id}-wrong`;
    await assertNoProjectedCad(
      wrongBinaryTraceId,
      "no unique trace to its capture",
    );

    for (
      const [source, id, reason] of [
        [published, publicationUses.id, "publication consumption is not exact"],
        [published, binaryTrace.id, "no unique trace to its capture"],
      ] as const
    ) {
      const wrongRationale = structuredClone(source);
      const link = wrongRationale.provenance.find((candidate) => candidate.id === id);
      assertExists(link);
      link.rationale = "Structurally valid but unverified adversarial rationale.";
      await assertNoProjectedCad(wrongRationale, reason);
    }

    for (
      const [defect, reason] of [
        ["missing-canonical-consumption", "consumption metadata is not exact"],
        ["duplicate-consumption", "consumption is missing or ambiguous"],
        ["wrong-consumption-time", "consumption metadata is not exact"],
        ["wrong-uses-id", "uses attestation is not exact"],
        ["wrong-uses-rationale", "uses attestation is not exact"],
        ["wrong-derived-id", "architecture derivation is not exact"],
        ["wrong-derived-rationale", "architecture derivation is not exact"],
        ["duplicate-derived", "architecture derivation is not exact"],
      ] as const
    ) {
      await assertNoProjectedCad(
        withArchitectureAttestationDefect(published, defect),
        reason,
      );
    }

    const missingCaptureCatalog = await resolveGenericProductStructureCatalog(
      published,
      fixture.archCaptures,
      { read: () => Promise.resolve(undefined) },
    );
    assertExists(missingCaptureCatalog);
    assertEquals(missingCaptureCatalog.components.length, catalog.components.length);
    assertEquals(
      missingCaptureCatalog.components.flatMap((component) =>
        component.bindings.filter((binding) => binding.provider === "digital-thread")
      ).length,
      0,
    );
    assertStringIncludes(missingCaptureCatalog.rationale, "not durably readable");

    const ambiguous = structuredClone(published);
    ambiguous.artifacts.push({
      ...geometry,
      id: `geometry-${"f".repeat(64)}`,
      version: "f".repeat(64),
      fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${"f".repeat(64)}`,
    });
    const ambiguousCatalog = await resolveGenericProductStructureCatalog(
      ambiguous,
      fixture.archCaptures,
      fixture.geoCaptures,
    );
    assertExists(ambiguousCatalog);
    assertEquals(ambiguousCatalog.components.length, catalog.components.length);
    assertEquals(
      ambiguousCatalog.components.flatMap((component) =>
        component.bindings.filter((binding) => binding.provider === "digital-thread")
      ).length,
      0,
    );
    assertStringIncludes(ambiguousCatalog.rationale, "multiple active capture tips");

    const revisionBeforeReplay = completed.revision;
    const replayed = await executor.execute(AGENT, command);
    assertEquals(replayed.revision, revisionBeforeReplay);
    assertEquals(replayed.threadSnapshots.at(-1), completed.threadSnapshots.at(-1));
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry bundle v2 keeps STEP-only PartDefinitions viewer-free", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-v2-step-only-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      bundleV2: true,
    });
    const completed = await makeExecutor(fixture, tmpDir).execute(
      AGENT,
      executionCommand(fixture),
    );
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === fixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const published = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(published);
    const catalog = await resolveGenericProductStructureCatalog(
      published,
      fixture.archCaptures,
      fixture.geoCaptures,
    );
    assertExists(catalog);
    const parts = catalog.components.filter((component) => component.kind === "part");
    assertEquals(parts.length, 4);
    assertEquals(
      parts.every((component) =>
        component.preview === undefined &&
        component.bindings.some((binding) =>
          binding.provider === "digital-thread" && binding.kind === "artifact"
        )
      ),
      true,
    );
    assertStringIncludes(
      catalog.rationale,
      "No PartDefinition presentation asset is claimed",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test(
  "completed geometry replay fails closed when its canonical capture is absent without rewriting evidence",
  async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-completed-replay-capture-" });
    try {
      const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, tmpDir).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.resultSnapshot);
      const result = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
      assertExists(result);
      const binary = result.artifacts.find((artifact) =>
        artifact.id.startsWith("cad-asset-")
      );
      assertExists(binary);
      const binaryPath =
        `${fixture.canonicalAssetDirectory}/${binary.fingerprint.digest}.glb`;
      const before = await Deno.readFile(binaryPath);
      let saves = 0;
      const absentCaptureStore: GeometryCaptureStore = {
        uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
        read: () => Promise.resolve(undefined),
        save: (fingerprint, text) => {
          saves += 1;
          return fixture.geoCaptures.save(fingerprint, text);
        },
      };

      await assertRejects(
        () =>
          makeExecutor(fixture, tmpDir, absentCaptureStore).execute(AGENT, {
            ...command,
            expectedRevision: completed.revision,
          }),
        EngineeringProjectCommandError,
        "primary geometry capture is not durably readable",
      );
      assertEquals(saves, 0);
      assertEquals(await Deno.readFile(binaryPath), before);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "completed geometry replay rejects mutated primary artifact metadata without snapshot or asset writes",
  async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-completed-replay-artifact-" });
    try {
      const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, tmpDir).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.resultSnapshot);
      let snapshotWrites = 0;
      const mutatedSnapshots: ThreadSnapshotStore = {
        async get(id) {
          const snapshot = await fixture.snapshots.get(id);
          if (!snapshot || id !== run.resultSnapshot!.snapshotId) return snapshot;
          const mutated = structuredClone(snapshot);
          const primary = mutated.artifacts.find((artifact) =>
            artifact.kind === "cad-model" &&
            artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
            artifact.producer.runId === run.id
          );
          assertExists(primary);
          primary.producer.serverId = "untrusted-digital-thread";
          return mutated;
        },
        latest(subjectId) {
          return fixture.snapshots.latest(subjectId);
        },
        save(snapshot) {
          snapshotWrites += 1;
          return fixture.snapshots.save(snapshot);
        },
      };

      await assertRejects(
        () =>
          makeExecutor(
            fixture,
            tmpDir,
            fixture.geoCaptures,
            mutatedSnapshots,
          ).execute(AGENT, {
            ...command,
            expectedRevision: completed.revision,
          }),
        EngineeringProjectCommandError,
        "Completed geometry evidence integrity failure",
      );
      assertEquals(snapshotWrites, 0);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "completed geometry replay rejects a rewritten historical basis artifact",
  async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-completed-replay-history-" });
    try {
      const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, tmpDir).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.resultSnapshot);
      let snapshotWrites = 0;
      const mutatedSnapshots: ThreadSnapshotStore = {
        async get(id) {
          const snapshot = await fixture.snapshots.get(id);
          if (!snapshot || id !== run.resultSnapshot!.snapshotId) return snapshot;
          const mutated = structuredClone(snapshot);
          const historical = mutated.artifacts.find((artifact) =>
            artifact.kind === "sysml-model" &&
            artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
          );
          assertExists(historical);
          historical.name = "Rewritten historical architecture";
          return mutated;
        },
        latest(subjectId) {
          return fixture.snapshots.latest(subjectId);
        },
        save(snapshot) {
          snapshotWrites += 1;
          return fixture.snapshots.save(snapshot);
        },
      };

      await assertRejects(
        () =>
          makeExecutor(
            fixture,
            tmpDir,
            fixture.geoCaptures,
            mutatedSnapshots,
          ).execute(AGENT, {
            ...command,
            expectedRevision: completed.revision,
          }),
        EngineeringProjectCommandError,
        "exact sealed extension",
      );
      assertEquals(snapshotWrites, 0);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "same-basis geometry siblings serialize and only one may seal durable evidence",
  async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "geo-same-basis-siblings-" });
    try {
      const fixture = await buildGeoFixture(tmpDir, {
        mode: "happy",
        includeParallelSibling: true,
      });
      assertExists(fixture.parallel);
      let captureWrites = 0;
      let snapshotWrites = 0;
      const captures: GeometryCaptureStore = {
        uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
        read: (fingerprint) => fixture.geoCaptures.read(fingerprint),
        save: async (fingerprint, text) => {
          captureWrites += 1;
          return await fixture.geoCaptures.save(fingerprint, text);
        },
      };
      const snapshots: ThreadSnapshotStore = {
        get: (id) => fixture.snapshots.get(id),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        async save(snapshot) {
          snapshotWrites += 1;
          await fixture.snapshots.save(snapshot);
        },
      };
      const firstCommand = executionCommand(fixture);
      const parallelCommand = {
        commandId: "exec-geometry-parallel",
        projectId: PROJECT_ID,
        expectedRevision: fixture.parallel.revision,
        issuedAt: "2026-08-08T12:10:00.000Z",
        runId: fixture.parallel.runId,
      };
      const outcomes = await Promise.allSettled([
        makeExecutor(fixture, tmpDir, captures, snapshots).execute(
          AGENT,
          firstCommand,
        ),
        makeExecutor(fixture, tmpDir, captures, snapshots).execute(
          AGENT,
          parallelCommand,
        ),
      ]);

      assertEquals(
        outcomes.filter((outcome) => outcome.status === "fulfilled").length,
        1,
      );
      assertEquals(
        outcomes.filter((outcome) => outcome.status === "rejected").length,
        1,
      );
      assertEquals(captureWrites, 1);
      assertEquals(snapshotWrites, 1);
      const project = await fixture.projects.get(PROJECT_ID);
      assertExists(project);
      const geometryRuns = project.agentRuns.filter((candidate) =>
        candidate.id === fixture.queued.runId ||
        candidate.id === fixture.parallel!.runId
      );
      assertEquals(
        geometryRuns.filter((candidate) => candidate.status === "completed").length,
        1,
      );
      assertEquals(
        geometryRuns.filter((candidate) => candidate.status === "queued").length,
        1,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test("successive geometry seals may reuse identical binary bytes under distinct capture contexts", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-reused-binary-" });
  try {
    const firstFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const firstCompleted = await makeExecutor(firstFixture, tmpDir).execute(
      AGENT,
      executionCommand(firstFixture),
    );
    const firstRun = firstCompleted.agentRuns.find((run) =>
      run.id === firstFixture.queued.runId
    );
    assertExists(firstRun?.resultSnapshot);
    const firstSnapshot = await firstFixture.snapshots.get(
      firstRun.resultSnapshot.snapshotId,
    );
    assertExists(firstSnapshot);
    const firstCapture = firstSnapshot.artifacts.find((artifact) =>
      artifact.kind === "cad-model" &&
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
      artifact.producer.runId === "run:geometry"
    );
    const firstBinary = firstSnapshot.artifacts.find((artifact) =>
      artifact.id.startsWith("cad-asset-")
    );
    assertExists(firstCapture);
    assertExists(firstBinary);

    const secondFixture = await queueSuccessiveGeometrySeal(
      firstFixture,
      firstCompleted,
    );
    const secondCompleted = await makeExecutor(secondFixture, tmpDir).execute(
      AGENT,
      {
        ...executionCommand(secondFixture),
        commandId: "exec-geometry-second",
        issuedAt: "2026-08-08T12:12:00.000Z",
      },
    );
    const secondRun = secondCompleted.agentRuns.find((run) =>
      run.id === secondFixture.queued.runId
    );
    assertExists(secondRun?.resultSnapshot);
    const secondSnapshot = await secondFixture.snapshots.get(
      secondRun.resultSnapshot.snapshotId,
    );
    assertExists(secondSnapshot);
    validateThreadSnapshot(secondSnapshot);

    const secondCapture = secondSnapshot.artifacts.find((artifact) =>
      artifact.kind === "cad-model" &&
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
      artifact.producer.runId === "run:geometry-second"
    );
    assertExists(secondCapture);
    const reusedBinaries = secondSnapshot.artifacts.filter((artifact) =>
      artifact.id.startsWith("cad-asset-") &&
      artifact.fingerprint.digest === firstBinary.fingerprint.digest
    );
    assertEquals(reusedBinaries.length, 2);
    assertEquals(
      new Set(reusedBinaries.map((artifact) => artifact.id)).size,
      2,
    );
    assertEquals(
      reusedBinaries.some((artifact) =>
        artifact.id ===
          `cad-asset-${firstCapture.fingerprint.digest}-${firstBinary.fingerprint.digest}`
      ),
      true,
    );
    assertEquals(
      reusedBinaries.some((artifact) =>
        artifact.id ===
          `cad-asset-${secondCapture.fingerprint.digest}-${firstBinary.fingerprint.digest}`
      ),
      true,
    );
    assertEquals(
      await Deno.readFile(
        `${secondFixture.canonicalAssetDirectory}/${firstBinary.fingerprint.digest}.glb`,
      ),
      await Deno.readFile(
        `${secondFixture.draftAssetDirectory}/${firstBinary.fingerprint.digest}`,
      ),
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry bundle v2 supersedes and archives the exact legacy geometry family", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-upgrade-" });
  try {
    const legacyFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const legacyCompleted = await makeExecutor(legacyFixture, tmpDir).execute(
      AGENT,
      executionCommand(legacyFixture),
    );
    const legacyRun = legacyCompleted.agentRuns.find((run) =>
      run.id === legacyFixture.queued.runId
    );
    assertExists(legacyRun?.resultSnapshot);
    const legacySnapshot = await legacyFixture.snapshots.get(
      legacyRun.resultSnapshot.snapshotId,
    );
    assertExists(legacySnapshot);
    const legacyPrimary = legacySnapshot.artifacts.find((artifact) =>
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
      artifact.producer.runId === legacyRun.id
    );
    const legacyBinaries = legacySnapshot.artifacts.filter((artifact) =>
      artifact.id.startsWith(`cad-asset-${legacyPrimary?.fingerprint.digest}-`) ||
      artifact.id.startsWith(`mesh-${legacyPrimary?.fingerprint.digest}-`)
    );
    assertExists(legacyPrimary);
    assertEquals(legacyBinaries.length > 0, true);

    const upgradeFixture = await queueGeometryBundleUpgrade(
      legacyFixture,
      legacyCompleted,
    );
    const command = {
      ...executionCommand(upgradeFixture),
      commandId: "exec-bundle-upgrade",
      issuedAt: "2026-08-08T12:12:00.000Z",
    };
    const executor = makeExecutor(upgradeFixture, tmpDir);
    const upgraded = await executor.execute(AGENT, command);
    const run = upgraded.agentRuns.find((candidate) =>
      candidate.id === upgradeFixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const snapshot = await upgradeFixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(snapshot);
    validateThreadSnapshot(snapshot);
    const newPrimary = snapshot.artifacts.find((artifact) =>
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
      artifact.producer.runId === run.id
    );
    assertExists(newPrimary);
    assertEquals(newPrimary.inputArtifactIds.includes(legacyPrimary.id), true);
    assertEquals(
      snapshot.provenance.some((link) =>
        link.relation === "supersedes" && link.from.id === newPrimary.id &&
        link.to.id === legacyPrimary.id
      ),
      true,
    );
    const archived = new Set(
      snapshot.changeSet.changes.filter((change) => change.kind === "archived")
        .map((change) => `${change.target.kind}:${change.target.id}`),
    );
    assertEquals(archived.has(`artifact:${legacyPrimary.id}`), true);
    for (const binary of legacyBinaries) {
      assertEquals(archived.has(`artifact:${binary.id}`), true);
    }
    const activeGeometry = snapshot.artifacts.filter((artifact) =>
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
      !archived.has(`artifact:${artifact.id}`)
    );
    assertEquals(activeGeometry.map((artifact) => artifact.id), [newPrimary.id]);

    const upgradedCatalog = await resolveGenericProductStructureCatalog(
      snapshot,
      upgradeFixture.archCaptures,
      upgradeFixture.geoCaptures,
    );
    assertExists(upgradedCatalog);
    assertEquals(
      upgradedCatalog.components.some((component) =>
        component.bindings.some((binding) => binding.provider === "digital-thread")
      ),
      true,
    );
    const assertNoUpgradedCad = async (
      candidate: ThreadSnapshot,
      expectedReason: string,
    ) => {
      const unavailable = await resolveGenericProductStructureCatalog(
        candidate,
        upgradeFixture.archCaptures,
        upgradeFixture.geoCaptures,
      );
      assertExists(unavailable);
      assertEquals(
        unavailable.components.some((component) =>
          component.bindings.some((binding) => binding.provider === "digital-thread")
        ),
        false,
      );
      assertStringIncludes(unavailable.rationale, expectedReason);
    };

    const reactivatedLegacyBinary = structuredClone(snapshot);
    const legacyBinary = legacyBinaries[0]!;
    reactivatedLegacyBinary.changeSet.changes = reactivatedLegacyBinary.changeSet
      .changes.filter((change) =>
        !(change.kind === "archived" && change.target.kind === "artifact" &&
          change.target.id === legacyBinary.id)
      );
    await assertNoUpgradedCad(
      reactivatedLegacyBinary,
      "predecessor binary family is not fully archived",
    );

    const duplicateSupersedes = structuredClone(snapshot);
    const supersedes = duplicateSupersedes.provenance.find((link) =>
      link.relation === "supersedes" && link.from.id === newPrimary.id &&
      link.to.id === legacyPrimary.id
    );
    assertExists(supersedes);
    duplicateSupersedes.provenance.push({
      ...supersedes,
      id: `${supersedes.id}-duplicate`,
    });
    await assertNoUpgradedCad(duplicateSupersedes, "unique supersedes");

    const missingDerivedFrom = structuredClone(snapshot);
    missingDerivedFrom.provenance = missingDerivedFrom.provenance.filter((link) =>
      !(link.relation === "derived_from" && link.from.id === newPrimary.id &&
        link.to.id === legacyPrimary.id)
    );
    await assertNoUpgradedCad(missingDerivedFrom, "unique derived_from");

    const predecessorConsumptionId =
      `consume-geometry-${legacyPrimary.id}-by-${newPrimary.id}`;
    const missingPredecessorUses = structuredClone(snapshot);
    missingPredecessorUses.provenance = missingPredecessorUses.provenance.filter(
      (link) =>
        !(link.relation === "uses" && link.from.kind === "consumption" &&
          link.from.id === predecessorConsumptionId),
    );
    await assertNoUpgradedCad(
      missingPredecessorUses,
      "predecessor consumption is not exact",
    );

    const predecessorDerived = snapshot.provenance.find((link) =>
      link.relation === "derived_from" && link.from.id === newPrimary.id &&
      link.to.id === legacyPrimary.id
    );
    const predecessorUses = snapshot.provenance.find((link) =>
      link.relation === "uses" && link.from.kind === "consumption" &&
      link.from.id === predecessorConsumptionId
    );
    assertExists(predecessorDerived);
    assertExists(predecessorUses);
    for (
      const [linkId, reason] of [
        [supersedes.id, "unique supersedes"],
        [predecessorDerived.id, "unique derived_from"],
        [predecessorUses.id, "predecessor consumption is not exact"],
      ] as const
    ) {
      const wrongId: ThreadSnapshot = structuredClone(snapshot);
      const wrongIdLink: ThreadProvenanceLink | undefined = wrongId.provenance.find(
        (link: ThreadProvenanceLink) => link.id === linkId,
      );
      assertExists(wrongIdLink);
      wrongIdLink.id = `${wrongIdLink.id}-wrong`;
      await assertNoUpgradedCad(wrongId, reason);

      const wrongRationale: ThreadSnapshot = structuredClone(snapshot);
      const wrongRationaleLink: ThreadProvenanceLink | undefined = wrongRationale
        .provenance.find((link: ThreadProvenanceLink) => link.id === linkId);
      assertExists(wrongRationaleLink);
      wrongRationaleLink.rationale =
        "Structurally valid but unverified predecessor rationale.";
      await assertNoUpgradedCad(wrongRationale, reason);
    }

    const replayed = await executor.execute(AGENT, command);
    assertEquals(replayed.revision, upgraded.revision);
    assertEquals(replayed.threadSnapshots.at(-1), upgraded.threadSnapshots.at(-1));
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("a third geometry generation refuses a v2 predecessor with broken own lineage", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-transitive-lineage-" });
  try {
    const legacyFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const legacyCompleted = await makeExecutor(legacyFixture, tmpDir).execute(
      AGENT,
      executionCommand(legacyFixture),
    );
    const upgradeFixture = await queueGeometryBundleUpgrade(
      legacyFixture,
      legacyCompleted,
    );
    const upgraded = await makeExecutor(upgradeFixture, tmpDir).execute(
      AGENT,
      {
        ...executionCommand(upgradeFixture),
        commandId: "exec-bundle-upgrade-for-transitive-lineage",
        issuedAt: "2026-08-08T12:12:00.000Z",
      },
    );
    const upgradedRun = upgraded.agentRuns.find((candidate) =>
      candidate.id === upgradeFixture.queued.runId
    );
    assertExists(upgradedRun?.resultSnapshot);
    const exactBasis = await upgradeFixture.snapshots.get(
      upgradedRun.resultSnapshot.snapshotId,
    );
    assertExists(exactBasis);
    const activeGeometry = exactBasis.artifacts.find((artifact) =>
      artifact.kind === "cad-model" &&
      artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
      artifact.producer.runId === upgradedRun.id
    );
    assertExists(activeGeometry);
    const nextParams = bundlePredecessorParams({
      artifactId: activeGeometry.id,
      fingerprint: activeGeometry.fingerprint,
    });

    const cases: ReadonlyArray<{
      defect: PriorGeometryLineageDefect;
      message: string;
    }> = [{
      defect: "missing-supersedes",
      message: "its own predecessor supersedes lineage is not exact",
    }, {
      defect: "duplicate-derived",
      message: "its own predecessor derived_from lineage is not exact",
    }, {
      defect: "wrong-consumption-time",
      message: "its own predecessor consumption metadata is not exact",
    }, {
      defect: "wrong-derived-id",
      message: "its own predecessor derived_from lineage is not exact",
    }, {
      defect: "wrong-derived-rationale",
      message: "its own predecessor derived_from lineage is not exact",
    }, {
      defect: "wrong-supersedes-id",
      message: "its own predecessor supersedes lineage is not exact",
    }, {
      defect: "wrong-supersedes-rationale",
      message: "its own predecessor supersedes lineage is not exact",
    }, {
      defect: "wrong-uses-id",
      message: "its own predecessor uses attestation is not exact",
    }, {
      defect: "wrong-uses-rationale",
      message: "its own predecessor uses attestation is not exact",
    }];
    for (const testCase of cases) {
      const brokenBasis = withPriorGeometryLineageDefect(
        exactBasis,
        testCase.defect,
      );
      await assertRejects(
        () =>
          requireGeometryBundlePredecessor(
            brokenBasis,
            nextParams,
            upgradeFixture.geoCaptures,
          ),
        EngineeringProjectCommandError,
        testCase.message,
      );
    }
    for (
      const [defect, message] of [
        ["wrong-uses-id", "publication consumption is not exact"],
        ["wrong-trace-id", "has no exact capture trace"],
        ["wrong-uses-rationale", "publication consumption is not exact"],
        ["wrong-trace-rationale", "has no exact capture trace"],
      ] as const
    ) {
      await assertRejects(
        () =>
          requireGeometryBundlePredecessor(
            withPriorGeometryBinaryGraphDefect(exactBasis, defect),
            nextParams,
            upgradeFixture.geoCaptures,
          ),
        EngineeringProjectCommandError,
        message,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry bundle v2 refuses an active legacy tip when predecessor is omitted", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-missing-predecessor-" });
  try {
    const legacyFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const legacyCompleted = await makeExecutor(legacyFixture, tmpDir).execute(
      AGENT,
      executionCommand(legacyFixture),
    );
    const upgradeFixture = await queueGeometryBundleUpgrade(
      legacyFixture,
      legacyCompleted,
      { omitPredecessor: true },
    );
    let captureWrites = 0;
    const trackingCaptureStore: GeometryCaptureStore = {
      uriFor: (fingerprint) => upgradeFixture.geoCaptures.uriFor(fingerprint),
      read: (fingerprint) => upgradeFixture.geoCaptures.read(fingerprint),
      save: () => {
        captureWrites++;
        return Promise.reject(new Error("unexpected write"));
      },
    };
    await assertRejects(
      () =>
        makeExecutor(upgradeFixture, tmpDir, trackingCaptureStore).execute(AGENT, {
          ...executionCommand(upgradeFixture),
          commandId: "exec-bundle-missing-predecessor",
        }),
      EngineeringProjectCommandError,
      "must name active geometry tip",
    );
    assertEquals(captureWrites, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry bundle v2 refuses an arbitrary active artifact traced to the predecessor family", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-rogue-family-" });
  try {
    const legacyFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const legacyCompleted = await makeExecutor(legacyFixture, tmpDir).execute(
      AGENT,
      executionCommand(legacyFixture),
    );
    const upgradeFixture = await queueGeometryBundleUpgrade(
      legacyFixture,
      legacyCompleted,
    );
    const basisId = upgradeFixture.baselineRef.snapshotId;
    let snapshotWrites = 0;
    const mutatedSnapshots: ThreadSnapshotStore = {
      async get(id) {
        const stored = await upgradeFixture.snapshots.get(id);
        if (!stored || id !== basisId) return stored;
        const mutated = structuredClone(stored);
        const predecessor = mutated.artifacts.find((artifact) =>
          artifact.kind === "cad-model" &&
          artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
        );
        assertExists(predecessor);
        const rogueDigest = "d".repeat(64);
        mutated.artifacts.push({
          id: "rogue-active-geometry-child",
          name: "Unreviewed geometry child",
          kind: "other",
          version: rogueDigest,
          fingerprint: { algorithm: "sha256", digest: rogueDigest },
          uri: "casys://rogue-active-geometry-child",
          mediaType: "application/octet-stream",
          producer: {
            serverId: "untrusted-provider",
            tool: "rogue_export",
            runId: "run:rogue",
          },
          inputArtifactIds: [],
          freshness: {
            status: "fresh",
            changedAt: "2026-08-08T12:09:00.000Z",
            invalidatedByChangeIds: [],
          },
        });
        mutated.provenance.push({
          id: "trace-rogue-active-geometry-child",
          relation: "traces_to",
          from: { kind: "artifact", id: "rogue-active-geometry-child" },
          to: { kind: "artifact", id: predecessor.id },
          rationale: "Adversarial extra family member.",
        });
        return mutated;
      },
      latest(subjectId) {
        return upgradeFixture.snapshots.latest(subjectId);
      },
      save(snapshot) {
        snapshotWrites += 1;
        return upgradeFixture.snapshots.save(snapshot);
      },
    };
    let captureWrites = 0;
    const trackingCaptureStore: GeometryCaptureStore = {
      uriFor: (fingerprint) => upgradeFixture.geoCaptures.uriFor(fingerprint),
      read: (fingerprint) => upgradeFixture.geoCaptures.read(fingerprint),
      save: () => {
        captureWrites += 1;
        return Promise.reject(new Error("unexpected write"));
      },
    };

    await assertRejects(
      () =>
        makeExecutor(
          upgradeFixture,
          tmpDir,
          trackingCaptureStore,
          mutatedSnapshots,
        ).execute(AGENT, {
          ...executionCommand(upgradeFixture),
          commandId: "exec-bundle-rogue-family",
        }),
      EngineeringProjectCommandError,
      "binary family is incomplete or contains extra assets",
    );
    assertEquals(captureWrites, 0);
    assertEquals(snapshotWrites, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry bundle v2 refuses non-canonical predecessor binary trace and uses evidence before publication", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-bundle-predecessor-binary-" });
  try {
    const legacyFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
    const legacyCompleted = await makeExecutor(legacyFixture, tmpDir).execute(
      AGENT,
      executionCommand(legacyFixture),
    );
    const upgradeFixture = await queueGeometryBundleUpgrade(
      legacyFixture,
      legacyCompleted,
    );
    const basisId = upgradeFixture.baselineRef.snapshotId;

    for (
      const [defect, expectedMessage] of [
        ["wrong-uses-id", "publication consumption is not exact"],
        ["wrong-trace-id", "has no exact capture trace"],
        ["wrong-uses-rationale", "publication consumption is not exact"],
        ["wrong-trace-rationale", "has no exact capture trace"],
      ] as const
    ) {
      let snapshotWrites = 0;
      const mutatedSnapshots: ThreadSnapshotStore = {
        async get(id) {
          const stored = await upgradeFixture.snapshots.get(id);
          if (!stored || id !== basisId) return stored;
          return withPriorGeometryBinaryGraphDefect(stored, defect);
        },
        latest(subjectId) {
          return upgradeFixture.snapshots.latest(subjectId);
        },
        save(snapshot) {
          snapshotWrites += 1;
          return upgradeFixture.snapshots.save(snapshot);
        },
      };
      let captureWrites = 0;
      const captures: GeometryCaptureStore = {
        uriFor: (fingerprint) => upgradeFixture.geoCaptures.uriFor(fingerprint),
        read: (fingerprint) => upgradeFixture.geoCaptures.read(fingerprint),
        save: () => {
          captureWrites += 1;
          return Promise.reject(new Error("unexpected canonical capture write"));
        },
      };

      await assertRejects(
        () =>
          makeExecutor(
            upgradeFixture,
            tmpDir,
            captures,
            mutatedSnapshots,
          ).execute(AGENT, {
            ...executionCommand(upgradeFixture),
            commandId: `exec-bundle-predecessor-binary-${defect}`,
          }),
        EngineeringProjectCommandError,
        expectedMessage,
      );
      assertEquals(captureWrites, 0, defect);
      assertEquals(snapshotWrites, 0, defect);
      const unchanged = await upgradeFixture.projects.get(PROJECT_ID);
      assertEquals(
        unchanged?.agentRuns.find((run) => run.id === upgradeFixture.queued.runId)
          ?.status,
        "queued",
        defect,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

for (
  const [defect, expectedMessage] of [
    [
      "missing-canonical-consumption",
      "architecture consumption metadata is not exact",
    ],
    [
      "duplicate-consumption",
      "architecture consumption is missing or ambiguous",
    ],
    ["wrong-consumption-time", "architecture consumption metadata is not exact"],
    ["wrong-uses-id", "architecture uses attestation is not exact"],
    ["wrong-uses-rationale", "architecture uses attestation is not exact"],
    ["wrong-derived-id", "architecture derivation is not exact"],
    ["wrong-derived-rationale", "architecture derivation is not exact"],
    ["duplicate-derived", "architecture derivation is not exact"],
  ] as const
) {
  Deno.test(
    `geometry bundle v2 refuses predecessor architecture attestation defect ${defect}`,
    async () => {
      const tmpDir = await Deno.makeTempDir({
        prefix: `geo-bundle-predecessor-${defect}-`,
      });
      try {
        const legacyFixture = await buildGeoFixture(tmpDir, { mode: "happy" });
        const legacyCompleted = await makeExecutor(legacyFixture, tmpDir).execute(
          AGENT,
          executionCommand(legacyFixture),
        );
        const upgradeFixture = await queueGeometryBundleUpgrade(
          legacyFixture,
          legacyCompleted,
        );
        const basisId = upgradeFixture.baselineRef.snapshotId;
        let snapshotWrites = 0;
        const mutatedSnapshots: ThreadSnapshotStore = {
          async get(id) {
            const stored = await upgradeFixture.snapshots.get(id);
            if (!stored || id !== basisId) return stored;
            return withArchitectureAttestationDefect(stored, defect);
          },
          latest(subjectId) {
            return upgradeFixture.snapshots.latest(subjectId);
          },
          save(snapshot) {
            snapshotWrites += 1;
            return upgradeFixture.snapshots.save(snapshot);
          },
        };
        let captureWrites = 0;
        const trackingCaptureStore: GeometryCaptureStore = {
          uriFor: (fingerprint) => upgradeFixture.geoCaptures.uriFor(fingerprint),
          read: (fingerprint) => upgradeFixture.geoCaptures.read(fingerprint),
          save: () => {
            captureWrites += 1;
            return Promise.reject(new Error("unexpected write"));
          },
        };

        await assertRejects(
          () =>
            makeExecutor(
              upgradeFixture,
              tmpDir,
              trackingCaptureStore,
              mutatedSnapshots,
            ).execute(AGENT, {
              ...executionCommand(upgradeFixture),
              commandId: `exec-bundle-predecessor-${defect}`,
            }),
          EngineeringProjectCommandError,
          expectedMessage,
        );
        assertEquals(captureWrites, 0);
        assertEquals(snapshotWrites, 0);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    },
  );
}

for (
  const [defect, message] of [
    ["omit-usage", "PartUsage identities must exactly cover every PartUsage"],
    [
      "omit-definition",
      "PartDefinition identities must exactly cover the definitions targeted",
    ],
  ] as const
) {
  Deno.test(
    `geometry bundle v2 rejects architecture coverage defect ${defect} before canonical writes`,
    async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: `geo-bundle-${defect}-` });
      try {
        const fixture = await buildGeoFixture(tmpDir, {
          mode: "happy",
          bundleV2: true,
          bundleCoverageDefect: defect,
        });
        await assertGeometrySealRejectedBeforeCanonicalWrites(
          fixture,
          tmpDir,
          message,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    },
  );
}

for (
  const [defect, message] of [
    ["empty", "empty-file SHA-256 is not a geometry asset"],
    ["size-mismatch", "Geometry draft asset byte count mismatch"],
  ] as const
) {
  Deno.test(
    `geometry bundle v2 rejects ${defect} reviewed draft bytes before claim or canonical writes`,
    async () => {
      const tmpDir = await Deno.makeTempDir({
        prefix: `geo-bundle-asset-${defect}-`,
      });
      try {
        const fixture = await buildGeoFixture(tmpDir, {
          mode: "happy",
          bundleV2: true,
          bundleAssetDefect: defect,
        });
        await assertGeometrySealRejectedBeforeCanonicalWrites(
          fixture,
          tmpDir,
          message,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    },
  );
}

Deno.test("geometry sealing reads and rehashes the architecture capture even with no component bindings", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-empty-components-corrupt-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      emptyComponents: true,
    });
    const basis = await fixture.snapshots.get(fixture.baselineRef.snapshotId);
    assertExists(basis);
    const architecture = basis.artifacts.find((artifact) =>
      artifact.kind === "sysml-model" &&
      artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
    );
    assertExists(architecture);
    const capturePath = fixture.archCaptures.pathFor(architecture.fingerprint);
    const capture = JSON.parse(await Deno.readTextFile(capturePath));
    capture.packageName = "TamperedAfterReview";
    await Deno.writeTextFile(capturePath, deterministicJson(capture));

    await assertGeometrySealRejectedBeforeCanonicalWrites(
      fixture,
      tmpDir,
      "content-addressed capture failed verification",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry sealing rejects duplicate architecture graph identities before canonical writes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-duplicate-architecture-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      architectureCaptureDefect: "duplicate-id",
    });
    await assertGeometrySealRejectedBeforeCanonicalWrites(
      fixture,
      tmpDir,
      "Package and PartDefinition ids",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry sealing rejects Package to PartDefinition identity collisions before canonical writes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-package-collision-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      architectureCaptureDefect: "package-definition-collision",
    });
    await assertGeometrySealRejectedBeforeCanonicalWrites(
      fixture,
      tmpDir,
      "Package and PartDefinition ids",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry sealing rejects Package to PartUsage identity collisions before canonical writes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-package-usage-collision-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      architectureCaptureDefect: "usage-package-collision",
    });
    await assertGeometrySealRejectedBeforeCanonicalWrites(
      fixture,
      tmpDir,
      "PartUsage ids must be globally unique",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry sealing binds an empty-component architecture capture to its producer run", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-architecture-provenance-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      emptyComponents: true,
      architectureCaptureDefect: "wrong-trusted-run",
    });
    await assertGeometrySealRejectedBeforeCanonicalWrites(
      fixture,
      tmpDir,
      "trustedRunId does not match",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("geometry sealing rejects an inexact architecture artifact producer before canonical writes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-architecture-producer-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      architectureArtifactDefect: "producer",
    });
    await assertGeometrySealRejectedBeforeCanonicalWrites(
      fixture,
      tmpDir,
      "artifact identity, URI, media type, or producer is not exact",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test(
  "geometry sealing rejects absent seed, empty inputs, or predecessor mismatch before canonical writes",
  async () => {
    const mutations: ReadonlyArray<[
      string,
      (snapshot: ThreadSnapshot) => void,
    ]> = [
      ["foreign subject", (snapshot) => {
        snapshot.subject.id = "subject:foreign-geometry";
      }],
      ["manifest pins retained architecture predecessor", (snapshot) => {
        const seed = snapshot.artifacts.find((artifact) =>
          artifact.producer.tool === "syson_model_create"
        );
        const predecessor = snapshot.artifacts.find((artifact) =>
          artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
        );
        assertExists(seed);
        assertExists(predecessor);
        const digest = "e".repeat(64);
        const id = `architecture-${digest}`;
        const producer = {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: "run:architecture-successor",
        };
        snapshot.artifacts.push({
          id,
          name: "New active architecture tip",
          kind: "sysml-model",
          version: digest,
          fingerprint: { algorithm: "sha256", digest },
          uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digest}`,
          mediaType: "application/json",
          producer,
          inputArtifactIds: [seed.id, predecessor.id],
          freshness: predecessor.freshness,
        });
        for (const input of [seed, predecessor]) {
          const consumptionId = `consume-${input.id}-by-${id}`;
          snapshot.consumptions.push({
            id: consumptionId,
            artifactId: input.id,
            consumer: producer,
            observedFingerprint: input.fingerprint,
            verifiedAt: predecessor.freshness.changedAt,
            status: "verified",
          });
          snapshot.provenance.push({
            id: `uses-${consumptionId}`,
            relation: "uses",
            from: { kind: "consumption", id: consumptionId },
            to: { kind: "artifact", id: input.id },
            rationale: "Exact retained input for the successor fixture.",
          });
        }
        snapshot.provenance.push({
          id: `derived-from-seed-${digest}`,
          relation: "derived_from",
          from: { kind: "artifact", id },
          to: { kind: "artifact", id: seed.id },
          rationale: "Successor fixture seed lineage.",
        }, {
          id: `derived-from-architecture-${digest}`,
          relation: "derived_from",
          from: { kind: "artifact", id },
          to: { kind: "artifact", id: predecessor.id },
          rationale: "Successor fixture architecture lineage.",
        });
      }],
      ["absent seed", (snapshot) => {
        snapshot.artifacts = snapshot.artifacts.filter((artifact) =>
          artifact.producer.tool !== "syson_model_create"
        );
      }],
      ["empty architecture inputs", (snapshot) => {
        const architecture = snapshot.artifacts.find((artifact) =>
          artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
        );
        assertExists(architecture);
        architecture.inputArtifactIds = [];
      }],
      ["undeclared predecessor", (snapshot) => {
        const seed = snapshot.artifacts.find((artifact) =>
          artifact.producer.tool === "syson_model_create"
        );
        const architecture = snapshot.artifacts.find((artifact) =>
          artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
        );
        assertExists(seed);
        assertExists(architecture);
        const predecessorDigest = "d".repeat(64);
        const predecessorId = `architecture-${predecessorDigest}`;
        snapshot.artifacts.push({
          id: predecessorId,
          name: "Retained predecessor architecture",
          kind: "sysml-model",
          version: predecessorDigest,
          fingerprint: { algorithm: "sha256", digest: predecessorDigest },
          uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${predecessorDigest}`,
          mediaType: "application/json",
          producer: {
            serverId: "syson",
            tool: "syson_element_insert_sysml",
            runId: "run:architecture-predecessor",
          },
          inputArtifactIds: [seed.id],
          freshness: architecture.freshness,
        });
        architecture.inputArtifactIds = [seed.id, predecessorId];
      }],
    ];

    for (const [name, mutate] of mutations) {
      const tmpDir = await Deno.makeTempDir({
        prefix: "geo-architecture-lineage-",
      });
      try {
        const fixture = await buildGeoFixture(tmpDir, { mode: "happy" });
        const before = await fixture.projects.get(PROJECT_ID);
        assertExists(before);
        let captureWrites = 0;
        let snapshotWrites = 0;
        const geometryCaptures: GeometryCaptureStore = {
          uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
          read: (fingerprint) => fixture.geoCaptures.read(fingerprint),
          save: async (fingerprint, text) => {
            captureWrites += 1;
            return await fixture.geoCaptures.save(fingerprint, text);
          },
        };
        const snapshots: ThreadSnapshotStore = {
          async get(id) {
            const snapshot = await fixture.snapshots.get(id);
            if (!snapshot || id !== fixture.baselineRef.snapshotId) return snapshot;
            const altered = structuredClone(snapshot);
            mutate(altered);
            return altered;
          },
          latest(subjectId) {
            return fixture.snapshots.latest(subjectId);
          },
          async save(snapshot) {
            snapshotWrites += 1;
            await fixture.snapshots.save(snapshot);
          },
        };
        await assertRejects(
          () =>
            makeExecutor(
              fixture,
              tmpDir,
              geometryCaptures,
              snapshots,
            ).execute(AGENT, executionCommand(fixture)),
          EngineeringProjectCommandError,
        );
        assertEquals(captureWrites, 0, name);
        assertEquals(snapshotWrites, 0, name);
        const unchanged = await fixture.projects.get(PROJECT_ID);
        assertEquals(unchanged?.revision, before.revision, name);
        assertEquals(
          unchanged?.agentRuns.find((run) => run.id === fixture.queued.runId)
            ?.status,
          "queued",
          name,
        );
        await assertRejects(
          () => Deno.stat(fixture.canonicalAssetDirectory),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    }
  },
);

Deno.test("the full executor accepts a legacy v1.0 GLB draft", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-legacy-glb-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      legacyDraftPath: "glb",
    });
    const completed = await makeExecutor(fixture, tmpDir).execute(
      AGENT,
      executionCommand(fixture),
    );
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === fixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const published = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(published);
    const binary = published.artifacts.find((artifact) =>
      artifact.id.startsWith("cad-asset-")
    );
    assertExists(binary);
    assertEquals(binary.uri?.endsWith(".glb"), true);
    assertEquals(binary.mediaType, "model/gltf-binary");
    assertEquals(binary.producer, {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: fixture.queued.runId,
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("the full executor rejects a legacy v1.0 .gltf path before canonical writes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-legacy-gltf-" });
  try {
    const fixture = await buildGeoFixture(tmpDir, {
      mode: "happy",
      legacyDraftPath: "gltf",
    });
    let captureWrites = 0;
    const noCanonicalWriteStore: GeometryCaptureStore = {
      uriFor: (fingerprint) => fixture.geoCaptures.uriFor(fingerprint),
      read: (fingerprint) => fixture.geoCaptures.read(fingerprint),
      save: () => {
        captureWrites++;
        return Promise.reject(new Error("unexpected canonical capture write"));
      },
    };
    const before = await fixture.projects.get(PROJECT_ID);
    assertExists(before);
    const beforeThreadHead = before.threadSnapshots.at(-1);
    assertExists(beforeThreadHead);

    await assertRejects(
      () =>
        makeExecutor(fixture, tmpDir, noCanonicalWriteStore).execute(
          AGENT,
          executionCommand(fixture),
        ),
      EngineeringProjectCommandError,
      'fixed basename "geometry-preview-assembly.glb"',
    );

    assertEquals(captureWrites, 0);
    const after = await fixture.projects.get(PROJECT_ID);
    assertEquals(after?.revision, before.revision);
    assertEquals(after?.threadSnapshots.at(-1), beforeThreadHead);
    assertEquals(
      after?.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
      "queued",
    );
    await assertRejects(
      () => Deno.stat(fixture.canonicalAssetDirectory),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("design-write-geometry executor refuses when the run has no human MRTR approval", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-no-human-" });
  try {
    // No decision binding at all — the work item is immediately "ready" but the
    // executor finds no human-approved MRTR candidate.
    const fixture = await buildGeoFixture(tmpDir, { mode: "no-mrtr" });
    const executor = makeExecutor(fixture, tmpDir);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture)),
      EngineeringProjectCommandError,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("design-write-geometry executor refuses when the basis snapshot carries no architecture artifact (D5 part 1)", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-no-arch-" });
  try {
    // Human MRTR approved, but r1 (the basis) has no architecture artifact.
    const fixture = await buildGeoFixture(tmpDir, { mode: "with-mrtr" });
    const executor = makeExecutor(fixture, tmpDir);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture)),
      EngineeringProjectCommandError,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ── Snapshot fixtures for unit tests ─────────────────────────────────────────

// ── Minimal snapshot construction helpers ─────────────────────────────────────

const SNAP_AT = "2026-08-08T00:00:00.000Z";

const SNAP_FRESHNESS = {
  status: "fresh" as const,
  changedAt: SNAP_AT,
  invalidatedByChangeIds: [] as string[],
};

const SNAP_CHANGE_SET = {
  id: "cs-1",
  name: "Base",
  status: "applied" as const,
  createdAt: SNAP_AT,
  appliedAt: SNAP_AT,
  changes: [] as never[],
};

function minimalSubject() {
  return {
    id: "subj-001",
    name: "TestSubject",
    kind: "system" as const,
    version: "1",
    modelArtifactId: "ma-001",
  };
}

function minimalSnapshotBase(
  id: string,
  revision: number,
  previous?: { snapshotId: string; revision: number },
): Omit<ThreadSnapshot, "artifacts"> {
  // `previous` must be omitted (not set to undefined) — validateThreadSnapshot
  // rejects an explicit undefined in this field.
  const base: Omit<ThreadSnapshot, "artifacts"> = {
    schemaVersion: "1.0",
    id,
    revision,
    generatedAt: SNAP_AT,
    subject: minimalSubject(),
    freshness: SNAP_FRESHNESS,
    changeSet: SNAP_CHANGE_SET,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  if (previous) {
    return { ...base, previous };
  }
  return base;
}

function minimalSnapshotWithGeometry(
  id: string,
  revision: number,
  fp: ContentFingerprint,
  previous?: { snapshotId: string; revision: number },
): ThreadSnapshot {
  return {
    ...minimalSnapshotBase(id, revision, previous),
    artifacts: [{
      id: `geometry-${fp.digest}`,
      name: "Geometry artifact",
      kind: "cad-model",
      version: fp.digest,
      fingerprint: fp,
      uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${fp.digest}`,
      producer: { serverId: "build123d", tool: "build123d_export", runId: "run-001" },
      inputArtifactIds: [],
      freshness: SNAP_FRESHNESS,
    }],
  };
}

function minimalSnapshotWithoutGeometry(
  id: string,
  revision: number,
  previous?: { snapshotId: string; revision: number },
): ThreadSnapshot {
  return { ...minimalSnapshotBase(id, revision, previous), artifacts: [] };
}

function minimalSnapshotWithArchitecture(
  id: string,
  revision: number,
  fp: ContentFingerprint,
): ThreadSnapshot {
  const seedFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: HEX64_B,
  };
  const seedId = `syson-model-seed-${seedFingerprint.digest}`;
  return {
    ...minimalSnapshotBase(id, revision),
    artifacts: [{
      id: seedId,
      name: "Seed",
      kind: "sysml-model",
      version: seedFingerprint.digest,
      fingerprint: seedFingerprint,
      uri: `casys://syson-model-seed-capture/sha256/${seedFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_model_create",
        runId: "run-seed",
      },
      inputArtifactIds: [],
      freshness: SNAP_FRESHNESS,
    }, {
      id: `architecture-${fp.digest}`,
      name: "Architecture",
      kind: "sysml-model",
      version: fp.digest,
      fingerprint: fp,
      uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${fp.digest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run-arch",
      },
      inputArtifactIds: [seedId],
      freshness: SNAP_FRESHNESS,
    }],
  };
}
