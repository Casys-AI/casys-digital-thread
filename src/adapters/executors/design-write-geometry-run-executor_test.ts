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

import { assertEquals, assertExists, assertRejects } from "@std/assert";
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
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { EngineeringThreadSnapshotRef } from "../../domain/project/engineering-project.ts";
import {
  assertGeometryArtifactNotRemoved,
  assertMrtrArtifactHashesMatchDraft,
  assertMrtrManifestMatchesDraft,
  DESIGN_WRITE_GEOMETRY_OPERATION,
  DesignWriteGeometryRunExecutor,
  GeometryArtifactRemovedError,
  type GeometryCaptureStore,
  GeometryLineageReviewRequiredError,
  requireArchitectureArtifact,
} from "./design-write-geometry-run-executor.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { captureGeometryDraft } from "../captures/geometry-draft-capture.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/platform/architecture-proposal.ts";
import {
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryManifest,
} from "../../domain/platform/geometry-proposal.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const HEX64 = "a".repeat(64);
const HEX64_B = "b".repeat(64);
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
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

Deno.test("GeometryArtifactRemovedError carries the subject ID in its message", () => {
  const error = new GeometryArtifactRemovedError("subject:drone-v4");
  assertEquals(error.name, "GeometryArtifactRemovedError");
  assertEquals(error.message.includes("subject:drone-v4"), true);
  assertEquals(error.message.includes("geometry_artifact_removed"), true);
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
  opts: { mode: "no-mrtr" | "with-mrtr" | "happy" },
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
  let signedManifest: GeometryManifest | undefined;

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
    const architectureCapture = {
      schemaVersion: "architecture-capture/1.0",
      partDefinitions: [{
        id: "part-definition:frame",
        label: "FrameDefinition",
        usages: [{ id: "usage:frame", label: "frame" }],
      }],
    };
    const architectureFingerprint = await sha256Fingerprint(architectureCapture);
    await archCaptures.save(
      architectureFingerprint,
      deterministicJson(architectureCapture),
    );
    const architectureArtifactId = `architecture-${architectureFingerprint.digest}`;
    const architectureExtension = {
      id: "architecture-test-basis",
      name: "Reviewed architecture basis",
      subjectId: r1.subjectId,
      capturedAt: "2026-08-08T12:01:30.000Z",
      artifacts: [{
        id: architectureArtifactId,
        name: "Reviewed architecture",
        kind: "sysml-model" as const,
        version: architectureFingerprint.digest,
        fingerprint: architectureFingerprint,
        uri: archCaptures.uriFor(architectureFingerprint),
        producer: {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: "run:architecture",
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh" as const,
          changedAt: "2026-08-08T12:01:30.000Z",
          invalidatedByChangeIds: [],
        },
      }],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
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

    const assetBytes = new TextEncoder().encode("reviewed geometry bytes\n");
    const assetDigest = await sha256Bytes(assetBytes);
    const draftManifest: GeometryManifest = {
      schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: architectureSnapshot.id,
        revision: architectureSnapshot.revision,
        artifactFingerprint: architectureFingerprint,
      },
      components: [{
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
        build123dService: "mcp-build123d",
        materializeAsset: async (digest) => {
          assertEquals(digest, assetDigest);
          await Deno.mkdir(draftAssetDirectory, { recursive: true });
          await Deno.writeFile(`${draftAssetDirectory}/${digest}`, assetBytes);
        },
      },
      () => "2026-08-08T12:01:45.000Z",
    );
    signedDraftDigest = draft.fingerprint.digest;
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
    const geoManifest: GeometryManifest = signedManifest ?? {
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
      workItems: [{
        id: "wi:geometry",
        phaseId: "geometry",
        owner: "agent",
        dependsOnWorkItemIds: ["wi:baseline"],
        decisionIds: ["decision:geo-params"],
        operation: {
          ...DESIGN_WRITE_GEOMETRY_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      }],
      requiredDecisions: [{
        id: "decision:geo-params",
        phaseId: "geometry",
        title: "Geometry sealing parameters",
        question: "Which draft and manifest should be sealed into the thread?",
      }],
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
  };
}

function makeExecutor(
  fixture: GeoFixture,
  directory: string,
  geometryCaptures: GeometryCaptureStore = fixture.geoCaptures,
): DesignWriteGeometryRunExecutor {
  return new DesignWriteGeometryRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    architectureCaptures: fixture.archCaptures,
    geometryDraftCaptures: fixture.draftCaptures,
    geometryCaptures,
    lease: new FileEngineeringProjectRunLease(`${directory}/geo-leases`),
    draftAssetDirectory: fixture.draftAssetDirectory,
    canonicalAssetDirectory: fixture.canonicalAssetDirectory,
    now: () => "2026-08-08T12:10:00.000Z",
  });
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

// ── Integration: executor refusal paths ──────────────────────────────────────

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
              `${fixture.canonicalAssetDirectory}/${assetDigest}.gltf`,
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

    const asset = published.artifacts.find((artifact) =>
      artifact.id.startsWith("cad-asset-")
    );
    assertExists(asset);
    assertEquals(
      asset.fingerprint.digest,
      capture.manifest.artifactHashes.assemblyFiles[0].fingerprint.digest,
    );
    assertEquals(asset.uri, `/api/thread/assets/${asset.fingerprint.digest}.gltf`);
    assertEquals(
      await Deno.readFile(
        `${fixture.canonicalAssetDirectory}/${asset.fingerprint.digest}.gltf`,
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
    assertEquals(binaryConsumption.status, "verified");
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
  return {
    ...minimalSnapshotBase(id, revision),
    artifacts: [{
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
      inputArtifactIds: [],
      freshness: SNAP_FRESHNESS,
    }],
  };
}
