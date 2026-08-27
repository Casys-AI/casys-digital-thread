/**
 * Focused `design.write-geometry@1` module-family seal tests.
 *
 * The public operation stays the existing sealer. These cases prove exact
 * draft/child/output reopen, target-scoped succession, and failure atomicity.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  EngineeringProjectCommandError,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { IsolatedOutputPublicationReader } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  IsolatedCodeOutputReceiptRecord,
  IsolatedOutputPublicationRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  encodeGeometryModuleDecisionParameters,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleChild,
  type GeometryModuleDraftCapture,
  type GeometryModuleManifest,
  geometryModuleManifestFromDraft,
  parseGeometryModuleCapture,
  parseGeometryModuleDraftCapture,
  parseGeometryModuleManifest,
} from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_PART_MANIFEST_SCHEMA,
} from "../../../domain/cad/canonical/geometry-part-manifest.ts";
import { GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA } from "../../../domain/cad/canonical/geometry-draft-admission.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
  GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import { createGeometryModuleInputBundle } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
} from "../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  GEOMETRY_CAPTURE_URI_PREFIX,
  PART_DEFINITIONS_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";
import { GeometryModuleAssemblyOutputValidator } from "../module-assembly/geometry-module-assembly-output-validator.ts";
import { GeometrySourceAnalysisCaptureService } from "../source/geometry-source-analysis-capture.ts";
import { resolveGenericProductStructureCatalog } from "../../architecture/renderer/product-structure-catalog.ts";
import { enrichGenericProductCatalogWithGeometryBundle } from "./geometry-bundle-product-catalog.ts";
import {
  assertMrtrManifestMatchesDraft,
} from "./design-write-geometry-run-executor.ts";
import {
  AGENT,
  buildGeoFixture,
  executionCommand,
  type GeoFixture,
  HUMAN,
  makeExecutor,
  PROJECT_ID,
  queueGeometryPartSeal,
} from "./design-write-geometry-run-executor_test.ts";

const A = "a".repeat(64);
const E = "e".repeat(64);
const PLACEMENT = {
  schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  fingerprint: fp(A),
  byteCount: 64,
  casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${A}`,
};

Deno.test("module seal reopens exact child STEP, promotes isolated outputs, and parses the capture", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-seal-" });
  try {
    const world = await prepareModuleWorld(tmpDir);
    const completed = await world.executor.execute(AGENT, world.command);
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === world.fixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const snapshot = await world.fixture.snapshots.get(
      run.resultSnapshot.snapshotId,
    );
    assertExists(snapshot);
    validateThreadSnapshot(snapshot);
    const primary = snapshot.artifacts.find((artifact) =>
      artifact.kind === "cad-model" && artifact.producer.runId === run.id
    );
    assertExists(primary);
    const captureText = await world.fixture.geoCaptures.read(primary.fingerprint);
    assertExists(captureText);
    const capture = await parseGeometryModuleCapture(JSON.parse(captureText));
    assertEquals(capture.schemaVersion, GEOMETRY_MODULE_CAPTURE_SCHEMA);
    assertEquals(
      capture.inputBundle.fingerprint.digest,
      world.bundle.fingerprint.digest,
    );
    assertEquals(capture.inputBundle.byteCount, world.bundle.bytes.byteLength);
    const catalog = await resolveGenericProductStructureCatalog(
      snapshot,
      world.fixture.archCaptures,
      world.fixture.geoCaptures,
      world.fixture.sysmlSourceAnalysis,
    );
    assertExists(catalog);
    assertStringIncludes(catalog.rationale, "exact immediate child assembly");
    assertStringIncludes(
      catalog.rationale,
      "No module capture is extrapolated into complete-product CAD coverage",
    );
    assertEquals(
      catalog.rationale.includes(
        "no assembly, occurrence, placement, or complete-product CAD coverage is claimed",
      ),
      false,
    );
    await Deno.stat(
      `${world.fixture.canonicalAssetDirectory}/${world.assemblyStep.digest}.step`,
    );
    await Deno.stat(
      `${world.fixture.canonicalAssetDirectory}/${world.assemblyGlb.digest}.glb`,
    );
    const archived = archivedRefKeys(snapshot);
    for (const child of world.children) {
      const childId = child.childGeometry.artifactId;
      const childPrimary: ThreadArtifact | undefined = snapshot.artifacts.find(
        (artifact) => artifact.id === childId,
      );
      assertExists(childPrimary);
      assertEquals(archived.has(`artifact:${childPrimary.id}`), false);
    }
    assertEquals(archived.has(`artifact:${world.unrelatedChildId}`), false);
    assertEquals(archived.has(`artifact:${world.v1PrimaryId}`), false);
    await world.executor.execute(AGENT, world.command);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("current module CAD remains projected when an active leaf is bound to a foreign architecture", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-foreign-leaf-" });
  try {
    const world = await prepareModuleWorld(tmpDir);
    const completed = await world.executor.execute(AGENT, world.command);
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === world.fixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const snapshot = await world.fixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(snapshot);
    const currentArchitecture = snapshot.artifacts.find((artifact) =>
      artifact.id.startsWith("architecture-")
    );
    assertExists(currentArchitecture);

    const foreignDigest = "f".repeat(64);
    const foreignArchitecture: ThreadArtifact = {
      ...currentArchitecture,
      id: `architecture-${foreignDigest}`,
      version: foreignDigest,
      fingerprint: fp(foreignDigest),
    };
    const foreignLeaf = await materializeChildCapture(world.fixture, {
      basis: snapshot,
      architecture: foreignArchitecture,
      runId: "run:foreign-architecture-leaf",
      partDefinitionElementId: "part-definition:foreign",
      label: "ForeignDefinition",
      stepBytes: part21("FOREIGN"),
    });
    const withForeignLeaf: ThreadSnapshot = {
      ...snapshot,
      artifacts: [
        ...snapshot.artifacts,
        foreignArchitecture,
        ...foreignLeaf.artifacts,
      ],
      consumptions: [...snapshot.consumptions, ...foreignLeaf.consumptions],
      provenance: [...snapshot.provenance, ...foreignLeaf.provenance],
    };
    const architectureCatalog = await resolveGenericProductStructureCatalog(
      snapshot,
      world.fixture.archCaptures,
      undefined,
      world.fixture.sysmlSourceAnalysis,
    );
    assertExists(architectureCatalog);

    const catalog = await enrichGenericProductCatalogWithGeometryBundle(
      withForeignLeaf,
      architectureCatalog,
      world.fixture.geoCaptures,
    );
    const root = catalog.components.find((component) => component.kind === "assembly");
    assertExists(root);
    assertEquals(
      root.bindings.filter((binding) =>
        binding.provider === "digital-thread" && binding.kind === "artifact"
      ).length,
      1,
    );
    assertEquals(
      catalog.components.filter((component) => component.kind === "part")
        .every((component) =>
          component.bindings.filter((binding) =>
            binding.provider === "digital-thread" && binding.kind === "artifact"
          ).length === 1
        ),
      true,
    );
    assertStringIncludes(
      catalog.rationale,
      "different exact architecture capture and is not projected",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module seal refuses a signed manifest that is not the draft reconstruction", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-manifest-" });
  try {
    const honest = await prepareModuleWorld(tmpDir);
    assertMrtrManifestMatchesDraft(honest.manifest, honest.draft);
    assertThrows(
      () =>
        assertMrtrManifestMatchesDraft({
          ...honest.manifest,
          target: { ...honest.manifest.target, label: "Tampered" },
        }, honest.draft),
      EngineeringProjectCommandError,
      "geometry_module_manifest_mismatch",
    );
    const mismatchDir = await Deno.makeTempDir({
      prefix: "geo-module-manifest-exec-",
    });
    try {
      const mismatched = await prepareModuleWorld(mismatchDir, {
        tamperSignedLabel: true,
      });
      await assertRejects(
        () => mismatched.executor.execute(AGENT, mismatched.command),
        EngineeringProjectCommandError,
        "geometry_module_manifest_mismatch",
      );
      await assertQueued(mismatched.fixture);
    } finally {
      await Deno.remove(mismatchDir, { recursive: true });
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module seal refuses when rebuilt bundle identity does not match reopened child bytes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-bundle-" });
  try {
    const world = await prepareModuleWorld(tmpDir, { swapChildBytes: true });
    await assertRejects(
      () => world.executor.execute(AGENT, world.command),
      EngineeringProjectCommandError,
      "geometry_module_bundle_mismatch",
    );
    await assertQueued(world.fixture);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module seal refuses a missing, ambiguous, superseded, or shallow child capture", async () => {
  for (const defect of ["missing", "ambiguous", "superseded", "shallow"] as const) {
    const tmpDir = await Deno.makeTempDir({ prefix: `geo-module-child-${defect}-` });
    try {
      const world = await prepareModuleWorld(tmpDir, { childDefect: defect });
      await assertRejects(
        () => world.executor.execute(AGENT, world.command),
        EngineeringProjectCommandError,
        defect === "missing"
          ? "geometry_module_child_missing"
          : defect === "ambiguous"
          ? "geometry_module_child_ambiguous"
          : defect === "superseded"
          ? "geometry_module_child_superseded"
          : "target capture is incomplete or invalid",
      );
      await assertQueued(world.fixture);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  }
});

Deno.test("module seal refuses isolated assembly output digest mismatch", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-output-" });
  try {
    const world = await prepareModuleWorld(tmpDir, { outputDigestMismatch: true });
    await assertRejects(
      () => world.executor.execute(AGENT, world.command),
      EngineeringProjectCommandError,
      "geometry_module_output_digest_mismatch",
    );
    await assertQueued(world.fixture);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module seal refuses signed children that are a subset of immediate PartUsage", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-d5-subset-" });
  try {
    const world = await prepareModuleWorld(tmpDir, { omitSignedChild: true });
    await assertRejects(
      () => world.executor.execute(AGENT, world.command),
      EngineeringProjectCommandError,
      "complete set of immediate PartUsage",
    );
    await assertQueued(world.fixture);
    await assertRejects(() =>
      Deno.stat(
        `${world.fixture.canonicalAssetDirectory}/${world.assemblyStep.digest}.step`,
      )
    );
    await assertRejects(() =>
      Deno.stat(
        `${world.fixture.canonicalAssetDirectory}/${world.assemblyGlb.digest}.glb`,
      )
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module seal refuses a predecessor that names a different target", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-pred-" });
  try {
    const world = await prepareModuleWorld(tmpDir, { wrongPredecessor: true });
    await assertRejects(
      () => world.executor.execute(AGENT, world.command),
      EngineeringProjectCommandError,
      "geometry_target_predecessor_mismatch",
    );
    await assertQueued(world.fixture);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("parent module seal preserves child captures; successor archives only same-target module", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-coexist-" });
  try {
    const first = await prepareModuleWorld(tmpDir);
    const firstCompleted = await first.executor.execute(AGENT, first.command);
    const firstRun = firstCompleted.agentRuns.find((run) =>
      run.id === first.fixture.queued.runId
    );
    assertExists(firstRun?.resultSnapshot);
    const firstSnapshot = await first.fixture.snapshots.get(
      firstRun.resultSnapshot.snapshotId,
    );
    assertExists(firstSnapshot);
    const firstPrimary = firstSnapshot.artifacts.find((artifact) =>
      artifact.kind === "cad-model" && artifact.producer.runId === firstRun.id
    );
    assertExists(firstPrimary);
    const firstFamilyIds = firstSnapshot.artifacts.filter((artifact) =>
      artifact.id === firstPrimary.id ||
      artifact.id.startsWith(
        `cad-asset-${firstPrimary.fingerprint.digest}-module-`,
      )
    ).map((artifact) => artifact.id);
    assertEquals(firstFamilyIds.length, 3);
    for (const child of first.children) {
      assertEquals(
        archivedRefKeys(firstSnapshot).has(
          `artifact:${child.childGeometry.artifactId}`,
        ),
        false,
      );
    }
    assertEquals(
      archivedRefKeys(firstSnapshot).has(`artifact:${first.unrelatedChildId}`),
      false,
    );
    assertEquals(
      archivedRefKeys(firstSnapshot).has(`artifact:${first.v1PrimaryId}`),
      false,
    );

    const successor = await queueModuleSuccessor(first, firstCompleted, firstPrimary);
    const successorCompleted = await successor.executor.execute(
      AGENT,
      successor.command,
    );
    const successorRun = successorCompleted.agentRuns.find((run) =>
      run.id === successor.fixture.queued.runId
    );
    assertExists(successorRun?.resultSnapshot);
    const snapshot = await successor.fixture.snapshots.get(
      successorRun.resultSnapshot.snapshotId,
    );
    assertExists(snapshot);
    const archived = archivedRefKeys(snapshot);
    for (const familyId of firstFamilyIds) {
      assertEquals(archived.has(`artifact:${familyId}`), true);
    }
    for (const child of first.children) {
      assertEquals(archived.has(`artifact:${child.childGeometry.artifactId}`), false);
    }
    assertEquals(archived.has(`artifact:${first.unrelatedChildId}`), false);
    assertEquals(archived.has(`artifact:${first.v1PrimaryId}`), false);
    const successorPrimary = snapshot.artifacts.find((artifact) =>
      artifact.kind === "cad-model" && artifact.producer.runId === successorRun.id
    );
    assertExists(successorPrimary);
    assertEquals(archived.has(`artifact:${successorPrimary.id}`), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("leaf to module succession archives the complete leaf family", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-leaf-to-module-" });
  try {
    const world = await prepareModuleWorld(tmpDir, { leafPredecessor: true });
    assertExists(world.leafPredecessorId);
    const before = await world.fixture.snapshots.get(
      world.fixture.baselineRef.snapshotId,
    );
    assertExists(before);
    const leaf = before.artifacts.find((artifact) =>
      artifact.id === world.leafPredecessorId
    );
    assertExists(leaf);
    const leafFamilyIds = before.artifacts.filter((artifact) =>
      artifact.id === leaf.id ||
      artifact.id.startsWith(`cad-asset-${leaf.fingerprint.digest}-target-`)
    ).map((artifact) => artifact.id);
    assertEquals(leafFamilyIds.length, 2);

    const completed = await world.executor.execute(AGENT, world.command);
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === world.fixture.queued.runId
    );
    assertExists(run?.resultSnapshot);
    const snapshot = await world.fixture.snapshots.get(run.resultSnapshot.snapshotId);
    assertExists(snapshot);
    const archived = archivedRefKeys(snapshot);
    for (const id of leafFamilyIds) {
      assertEquals(archived.has(`artifact:${id}`), true);
    }
    const modulePrimary = snapshot.artifacts.find((artifact) =>
      artifact.producer.runId === run.id && artifact.kind === "cad-model"
    );
    assertExists(modulePrimary);
    assertEquals(archived.has(`artifact:${modulePrimary.id}`), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module to leaf succession archives the complete module family", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-to-leaf-" });
  try {
    const world = await prepareModuleWorld(tmpDir);
    const moduleCompleted = await world.executor.execute(AGENT, world.command);
    const moduleRun = moduleCompleted.agentRuns.find((candidate) =>
      candidate.id === world.fixture.queued.runId
    );
    assertExists(moduleRun?.resultSnapshot);
    const moduleSnapshot = await world.fixture.snapshots.get(
      moduleRun.resultSnapshot.snapshotId,
    );
    assertExists(moduleSnapshot);
    const modulePrimary = moduleSnapshot.artifacts.find((artifact) =>
      artifact.producer.runId === moduleRun.id && artifact.kind === "cad-model"
    );
    assertExists(modulePrimary);
    const moduleFamilyIds = moduleSnapshot.artifacts.filter((artifact) =>
      artifact.id === modulePrimary.id ||
      artifact.id.startsWith(
        `cad-asset-${modulePrimary.fingerprint.digest}-module-`,
      )
    ).map((artifact) => artifact.id);
    assertEquals(moduleFamilyIds.length, 3);

    const leaf = await queueGeometryPartSeal(world.fixture, moduleCompleted, {
      target: "system",
      suffix: "system-after-module",
    });
    const leafCompleted = await makeExecutor(leaf.fixture, tmpDir).execute(
      AGENT,
      {
        ...executionCommand(leaf.fixture),
        commandId: "exec-system-leaf-after-module",
      },
    );
    const leafRun = leafCompleted.agentRuns.find((candidate) =>
      candidate.id === leaf.fixture.queued.runId
    );
    assertExists(leafRun?.resultSnapshot);
    const snapshot = await leaf.fixture.snapshots.get(
      leafRun.resultSnapshot.snapshotId,
    );
    assertExists(snapshot);
    const archived = archivedRefKeys(snapshot);
    for (const id of moduleFamilyIds) {
      assertEquals(archived.has(`artifact:${id}`), true);
    }
    const leafPrimary = snapshot.artifacts.find((artifact) =>
      artifact.producer.runId === leafRun.id && artifact.kind === "cad-model"
    );
    assertExists(leafPrimary);
    assertEquals(archived.has(`artifact:${leafPrimary.id}`), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("replacing a child leaf cascades retirement through parent module assets", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-child-module-cascade-" });
  try {
    const world = await prepareModuleWorld(tmpDir);
    const moduleCompleted = await world.executor.execute(AGENT, world.command);
    const moduleRun = moduleCompleted.agentRuns.find((candidate) =>
      candidate.id === world.fixture.queued.runId
    );
    assertExists(moduleRun?.resultSnapshot);
    const moduleSnapshot = await world.fixture.snapshots.get(
      moduleRun.resultSnapshot.snapshotId,
    );
    assertExists(moduleSnapshot);
    const modulePrimary = moduleSnapshot.artifacts.find((artifact) =>
      artifact.producer.runId === moduleRun.id && artifact.kind === "cad-model"
    );
    assertExists(modulePrimary);
    const moduleFamilyIds = moduleSnapshot.artifacts.filter((artifact) =>
      artifact.id === modulePrimary.id ||
      artifact.id.startsWith(
        `cad-asset-${modulePrimary.fingerprint.digest}-module-`,
      )
    ).map((artifact) => artifact.id);

    const replacement = await queueGeometryPartSeal(world.fixture, moduleCompleted, {
      target: "frame",
      suffix: "frame-replacement-cascade",
    });
    const replaced = await makeExecutor(replacement.fixture, tmpDir).execute(
      AGENT,
      {
        ...executionCommand(replacement.fixture),
        commandId: "exec-frame-replacement-cascade",
      },
    );
    const replacementRun = replaced.agentRuns.find((candidate) =>
      candidate.id === replacement.fixture.queued.runId
    );
    assertExists(replacementRun?.resultSnapshot);
    const snapshot = await replacement.fixture.snapshots.get(
      replacementRun.resultSnapshot.snapshotId,
    );
    assertExists(snapshot);
    const archived = archivedRefKeys(snapshot);
    for (const id of moduleFamilyIds) {
      assertEquals(archived.has(`artifact:${id}`), true);
    }
    assertEquals(
      archived.has(`artifact:${world.children[0]!.childGeometry.artifactId}`),
      true,
    );
    assertEquals(archived.has(`artifact:${world.unrelatedChildId}`), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("module seal failure before snapshot commit leaves no promoted assets or Thread write", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "geo-module-atomic-" });
  try {
    const world = await prepareModuleWorld(tmpDir);
    const snapshots: ThreadSnapshotStore = {
      get: (id) => world.fixture.snapshots.get(id),
      latest: (subjectId) => world.fixture.snapshots.latest(subjectId),
      save: () => Promise.reject(new Error("forced snapshot failure")),
    };
    await assertRejects(
      () =>
        makeExecutor(
          world.fixture,
          world.directory,
          world.fixture.geoCaptures,
          snapshots,
          moduleExecutorExtras(world),
        ).execute(AGENT, {
          ...world.command,
          commandId: "exec-module-atomic",
        }),
      Error,
      "forced snapshot failure",
    );
    const project = await world.fixture.projects.get(PROJECT_ID);
    const run = project?.agentRuns.find((candidate) =>
      candidate.id === world.fixture.queued.runId
    );
    assertEquals(run?.status === "completed", false);
    assertEquals(run?.resultSnapshot, undefined);
    await assertRejects(() =>
      Deno.stat(
        `${world.fixture.canonicalAssetDirectory}/${world.assemblyStep.digest}.step`,
      )
    );
    await assertRejects(() =>
      Deno.stat(
        `${world.fixture.canonicalAssetDirectory}/${world.assemblyGlb.digest}.glb`,
      )
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

const MODULE_NOW = "2026-08-08T13:01:00.000Z";
const SUCCESSOR_NOW = "2026-08-08T13:11:00.000Z";

interface ModuleWorld {
  readonly directory: string;
  readonly fixture: GeoFixture;
  readonly executor: ReturnType<typeof makeExecutor>;
  readonly command: ReturnType<typeof executionCommand>;
  readonly manifest: GeometryModuleManifest;
  readonly draft: Omit<GeometryModuleDraftCapture, "fingerprint">;
  readonly bundle: Awaited<ReturnType<typeof createGeometryModuleInputBundle>>;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly publications: IsolatedOutputPublicationReader;
  readonly validator: GeometryModuleAssemblyOutputValidator;
  readonly assemblyStep: { readonly digest: string; readonly bytes: Uint8Array };
  readonly assemblyGlb: { readonly digest: string; readonly bytes: Uint8Array };
  readonly v1PrimaryId: string;
  readonly unrelatedChildId: string;
  readonly leafPredecessorId?: string;
}

async function prepareModuleWorld(
  directory: string,
  options: {
    readonly swapChildBytes?: boolean;
    readonly childDefect?: "missing" | "ambiguous" | "superseded" | "shallow";
    readonly outputDigestMismatch?: boolean;
    readonly wrongPredecessor?: boolean;
    readonly leafPredecessor?: boolean;
    readonly tamperSignedLabel?: boolean;
    readonly omitSignedChild?: boolean;
  } = {},
): Promise<ModuleWorld> {
  const initial = await buildGeoFixture(directory, {
    mode: "happy",
    multiPartArchitecture: true,
  });
  const v1 = await makeExecutor(initial, directory).execute(
    AGENT,
    executionCommand(initial),
  );
  const v1Run = v1.agentRuns.find((run) => run.id === initial.queued.runId);
  assertExists(v1Run?.resultSnapshot);
  const basis = await initial.snapshots.get(v1Run.resultSnapshot.snapshotId);
  assertExists(basis);
  const architecture = basis.artifacts.find((artifact) =>
    artifact.id.startsWith("architecture-")
  );
  assertExists(architecture);
  const v1Primary = basis.artifacts.find((artifact) =>
    artifact.kind === "cad-model" && artifact.producer.runId === v1Run.id
  );
  assertExists(v1Primary);

  const frameStep = part21("FRAME");
  const boltStep = part21("BOLT");
  const frame = await materializeChildCapture(initial, {
    basis,
    architecture,
    runId: "run:child-frame",
    partDefinitionElementId: "part-definition:frame",
    label: "FrameDefinition",
    stepBytes: frameStep,
    shallow: options.childDefect === "shallow",
  });
  const bolt = await materializeChildCapture(initial, {
    basis,
    architecture,
    runId: "run:child-bolt",
    partDefinitionElementId: "part-definition:bolt",
    label: "BoltDefinition",
    stepBytes: boltStep,
  });
  const systemLeaf = options.leafPredecessor
    ? await materializeChildCapture(initial, {
      basis,
      architecture,
      runId: "run:child-system-leaf",
      partDefinitionElementId: "part-definition:system",
      label: "GeometrySystem",
      stepBytes: part21("SYSTEM-LEAF"),
    })
    : undefined;
  const extras = options.childDefect === "ambiguous"
    ? [
      await materializeChildCapture(initial, {
        basis,
        architecture,
        runId: "run:child-frame-extra",
        partDefinitionElementId: "part-definition:frame",
        label: "FrameDefinition",
        stepBytes: part21("FRAME-EXTRA"),
      }),
    ]
    : [];
  const structure = await materializeStructureCapture(architecture);
  const installed = applyThreadSnapshotExtensionIfNew(basis, {
    id: `install-module-basis-${structure.artifact.fingerprint.digest}`,
    name: "Install module children and structure",
    subjectId: basis.subject.id,
    capturedAt: "2026-08-08T12:50:00.000Z",
    artifacts: [
      ...frame.artifacts,
      ...bolt.artifacts,
      ...(systemLeaf?.artifacts ?? []),
      ...extras.flatMap((child) => child.artifacts),
      structure.artifact,
    ],
    consumptions: [
      ...frame.consumptions,
      ...bolt.consumptions,
      ...(systemLeaf?.consumptions ?? []),
      ...extras.flatMap((child) => child.consumptions),
      ...structure.consumptions,
    ],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [
      ...frame.provenance,
      ...bolt.provenance,
      ...(systemLeaf?.provenance ?? []),
      ...extras.flatMap((child) => child.provenance),
      ...structure.provenance,
    ],
    ...(options.childDefect === "superseded"
      ? {
        archived: [{
          target: {
            kind: "artifact" as const,
            id: frame.child.childGeometry.artifactId,
          },
          summary: "Archived for superseded-child test.",
        }],
      }
      : {}),
  }, { appliedAt: "2026-08-08T12:50:00.000Z" });
  if (!installed.applied) throw new Error("module basis extension already present");
  validateThreadSnapshot(installed.snapshot);
  await initial.snapshots.save(installed.snapshot);
  const projectRevision = await attachInstalledSnapshot(
    initial,
    v1.revision,
    basis,
    installed.snapshot,
    structure.artifact.id,
  );
  if (options.swapChildBytes) {
    await Deno.writeFile(
      `${initial.canonicalAssetDirectory}/${frame.child.authoritativeStep.fingerprint.digest}.step`,
      part21("OTHER"),
    );
  }

  const frameDigest = frame.child.authoritativeStep.fingerprint;
  const allChildren: GeometryModuleChild[] = [
    {
      usageElementId: "usage:frame",
      partDefinitionElementId: "part-definition:frame",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      placementCapture: PLACEMENT.fingerprint,
      childGeometry: options.childDefect === "missing"
        ? {
          schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
          artifactId: `geometry-${"9".repeat(64)}`,
          fingerprint: fp("9".repeat(64)),
        }
        : frame.child.childGeometry,
      authoritativeStep: {
        fingerprint: frameDigest,
        bytes: frameStep.byteLength,
      },
    },
    {
      usageElementId: "usage:frame-secondary",
      partDefinitionElementId: "part-definition:frame",
      placement: { translationMm: [10, 0, 0], rotationDeg: [0, 90, 0] },
      placementCapture: PLACEMENT.fingerprint,
      childGeometry: frame.child.childGeometry,
      authoritativeStep: frame.child.authoritativeStep,
    },
  ];
  const children = options.omitSignedChild ? allChildren.slice(0, 1) : allChildren;
  const bundle = await createGeometryModuleInputBundle(
    children.map((child) => ({
      usageElementId: child.usageElementId,
      partDefinitionElementId: child.partDefinitionElementId,
      placement: child.placement,
      childCapture: child.childGeometry,
      stepBytes: frameStep,
    })),
  );
  const assemblyStep = part21("MODULE-ASSEMBLY");
  const assemblyGlb = structuralGlb();
  const isolation = await moduleIsolation(
    bundle.bytes.copy(),
    assemblyStep,
    assemblyGlb,
  );
  const draft = await parseGeometryModuleDraftCapture(unsignedDraft({
    architecture,
    snapshot: installed.snapshot,
    structure: structure.artifact,
    children,
    bundle,
    isolation,
    assemblyStep,
    assemblyGlb,
    predecessor: options.wrongPredecessor
      ? {
        schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
        artifactId: frame.child.childGeometry.artifactId,
        fingerprint: frame.child.childGeometry.fingerprint,
        partDefinitionElementId: "part-definition:system",
      }
      : systemLeaf
      ? {
        schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
        artifactId: systemLeaf.child.childGeometry.artifactId,
        fingerprint: systemLeaf.child.childGeometry.fingerprint,
        partDefinitionElementId: "part-definition:system",
      }
      : undefined,
  }));
  const reconstructed = geometryModuleManifestFromDraft(draft);
  const manifest = options.tamperSignedLabel
    ? parseGeometryModuleManifest({
      ...reconstructed,
      assembly: {
        ...reconstructed.assembly,
        step: { fingerprint: fp(E) },
      },
    }, { requireCompleted: true })
    : reconstructed;
  const draftFp = await sha256Fingerprint(draft);
  await initial.draftCaptures.save(draftFp, deterministicJson(draft));
  const publications = new FakeModulePublications(
    isolation.receipt.publication.ref,
    isolation.receipt.outputs,
    {
      step: options.outputDigestMismatch ? part21("WRONG-OUTPUT") : assemblyStep,
      glb: assemblyGlb,
    },
  );
  const validator = stubModuleValidator();
  const queued = await queueModuleSeal({
    fixture: initial,
    projectRevision,
    basis: installed.snapshot,
    draftFp,
    manifest,
    suffix: "module",
    dependsOnWorkItemIds: ["wi:install-module-children"],
  });
  return {
    directory,
    fixture: queued,
    executor: makeExecutor(
      queued,
      directory,
      queued.geoCaptures,
      queued.snapshots,
      moduleExecutorExtras({ publications, validator }),
    ),
    command: {
      ...executionCommand(queued),
      commandId: "exec-module-seal",
      issuedAt: MODULE_NOW,
    },
    manifest,
    draft,
    bundle,
    children,
    publications,
    validator,
    assemblyStep: { digest: isolation.stepDigest, bytes: assemblyStep },
    assemblyGlb: { digest: isolation.glbDigest, bytes: assemblyGlb },
    v1PrimaryId: v1Primary.id,
    unrelatedChildId: bolt.child.childGeometry.artifactId,
    ...(systemLeaf
      ? { leafPredecessorId: systemLeaf.child.childGeometry.artifactId }
      : {}),
  };
}

async function queueModuleSuccessor(
  first: ModuleWorld,
  completed: Awaited<ReturnType<ReturnType<typeof makeExecutor>["execute"]>>,
  predecessor: ThreadArtifact,
): Promise<ModuleWorld> {
  const run = completed.agentRuns.find((candidate) =>
    candidate.id === first.fixture.queued.runId
  );
  assertExists(run?.resultSnapshot);
  const snapshot = await first.fixture.snapshots.get(run.resultSnapshot.snapshotId);
  assertExists(snapshot);
  const architecture = snapshot.artifacts.find((artifact) =>
    artifact.id.startsWith("architecture-")
  );
  assertExists(architecture);
  const structure = snapshot.artifacts.find((artifact) =>
    artifact.id.startsWith("part-definitions-")
  );
  assertExists(structure);
  const assemblyStep = part21("MODULE-ASSEMBLY-2");
  const assemblyGlb = structuralGlb(2);
  const isolation = await moduleIsolation(
    first.bundle.bytes.copy(),
    assemblyStep,
    assemblyGlb,
  );
  const draft = await parseGeometryModuleDraftCapture(unsignedDraft({
    architecture,
    snapshot,
    structure,
    children: first.children,
    bundle: first.bundle,
    isolation,
    assemblyStep,
    assemblyGlb,
    predecessor: {
      schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
      artifactId: predecessor.id,
      fingerprint: predecessor.fingerprint,
      partDefinitionElementId: "part-definition:system",
    },
  }));
  const manifest = geometryModuleManifestFromDraft(draft);
  const draftFp = await sha256Fingerprint(draft);
  await first.fixture.draftCaptures.save(draftFp, deterministicJson(draft));
  const publications = new FakeModulePublications(
    isolation.receipt.publication.ref,
    isolation.receipt.outputs,
    { step: assemblyStep, glb: assemblyGlb },
  );
  const validator = stubModuleValidator();
  const queued = await queueModuleSeal({
    fixture: first.fixture,
    projectRevision: completed.revision,
    basis: snapshot,
    draftFp,
    manifest,
    suffix: "successor",
    dependsOnWorkItemIds: ["wi:geometry-module"],
    issuedAt: "2026-08-08T13:10:00.000Z",
  });
  return {
    ...first,
    fixture: queued,
    executor: makeExecutor(
      queued,
      first.directory,
      queued.geoCaptures,
      queued.snapshots,
      moduleExecutorExtras({ publications, validator }, SUCCESSOR_NOW),
    ),
    command: {
      ...executionCommand(queued),
      commandId: "exec-module-successor",
      issuedAt: SUCCESSOR_NOW,
    },
    manifest,
    draft,
    publications,
    validator,
    assemblyStep: { digest: isolation.stepDigest, bytes: assemblyStep },
    assemblyGlb: { digest: isolation.glbDigest, bytes: assemblyGlb },
  };
}

function moduleExecutorExtras(
  world: {
    readonly publications: IsolatedOutputPublicationReader;
    readonly validator: GeometryModuleAssemblyOutputValidator;
  },
  now = MODULE_NOW,
) {
  return {
    moduleAssemblyPublications: world.publications,
    moduleAssemblyOutputValidator: world.validator,
    now: () => now,
  };
}

function stubModuleValidator(): GeometryModuleAssemblyOutputValidator {
  return new GeometryModuleAssemblyOutputValidator(() => ({
    ReadStepFile() {
      return meaningfulGeometry();
    },
  }));
}

async function queueModuleSeal(options: {
  readonly fixture: GeoFixture;
  readonly projectRevision: number;
  readonly basis: ThreadSnapshot;
  readonly draftFp: ContentFingerprint;
  readonly manifest: GeometryModuleManifest;
  readonly suffix: string;
  readonly dependsOnWorkItemIds: readonly string[];
  readonly issuedAt?: string;
}): Promise<GeoFixture> {
  const { fixture, basis, draftFp, manifest, suffix } = options;
  const issuedAt = options.issuedAt ?? "2026-08-08T13:00:00.000Z";
  const tick = (seconds: number) =>
    new Date(Date.parse(issuedAt) + seconds * 1_000).toISOString();
  let project = await fixture.commands.appendChange(AGENT, {
    commandId: `append-geometry-${suffix}`,
    projectId: PROJECT_ID,
    expectedRevision: options.projectRevision,
    issuedAt,
    baseSnapshot: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    phases: [{
      id: `geometry-${suffix}`,
      name: "Geometry module",
      description: "Seal one reviewed geometry module.",
    }],
    workItems: [{
      id: `wi:geometry-${suffix}`,
      phaseId: `geometry-${suffix}`,
      owner: "agent",
      dependsOnWorkItemIds: [...options.dependsOnWorkItemIds],
      decisionIds: [`decision:geometry-${suffix}`],
      operation: {
        ...DESIGN_WRITE_GEOMETRY_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [{
      id: `decision:geometry-${suffix}`,
      phaseId: `geometry-${suffix}`,
      title: "Geometry module",
      question: "Seal this exact reviewed geometry-module draft?",
    }],
  });
  project = await fixture.commands.proposeDecision(AGENT, {
    commandId: `propose-geometry-${suffix}`,
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: tick(10),
    decisionId: `decision:geometry-${suffix}`,
    baseSnapshot: {
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    proposal: {
      summary: "Seal the exact reviewed geometry-module draft.",
      parameters: encodeGeometryModuleDecisionParameters(
        draftFp.digest,
        manifest,
      ) as Array<{ key: string; label: string; value: string | number | boolean }>,
    },
  });
  const approval = project.approvals.find((candidate) =>
    candidate.decisionId === `decision:geometry-${suffix}`
  );
  assertExists(approval?.inputFingerprint);
  project = await fixture.commands.approveDecision(HUMAN, {
    commandId: `approve-geometry-${suffix}`,
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: tick(20),
    decisionId: `decision:geometry-${suffix}`,
    rationale: "The module draft, children and isolated outputs were reviewed.",
    inputFingerprint: approval.inputFingerprint,
  });
  project = await fixture.commands.queueRun(AGENT, {
    commandId: `queue-geometry-${suffix}`,
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: tick(30),
    runId: `run:geometry-${suffix}`,
    workItemId: `wi:geometry-${suffix}`,
    summary: "Seal the reviewed geometry-module draft.",
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
    queued: { revision: project.revision, runId: `run:geometry-${suffix}` },
  };
}

async function attachInstalledSnapshot(
  fixture: GeoFixture,
  projectRevision: number,
  base: ThreadSnapshot,
  installed: ThreadSnapshot,
  evidenceId: string,
): Promise<number> {
  let project = await fixture.commands.appendChange(AGENT, {
    commandId: "append-install-module-children",
    projectId: PROJECT_ID,
    expectedRevision: projectRevision,
    issuedAt: "2026-08-08T12:50:10.000Z",
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    phases: [{
      id: "install-module-children",
      name: "Install module children",
      description: "Attach reopened child captures and the structure basis.",
    }],
    workItems: [{
      id: "wi:install-module-children",
      phaseId: "install-module-children",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:geometry"],
      decisionIds: [],
      operation: {
        ...MODEL_WRITE_ARCHITECTURE_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  project = await fixture.commands.queueRun(AGENT, {
    commandId: "queue-install-module-children",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:50:20.000Z",
    runId: "run:install-module-children",
    workItemId: "wi:install-module-children",
    summary: "Attach module children and structure.",
    basis: {
      kind: "thread-snapshot",
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
  });
  project = await fixture.commands.claimRun(AGENT, {
    commandId: "claim-install-module-children",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:50:30.000Z",
    runId: "run:install-module-children",
    summary: "Claim the module-child attachment.",
  });
  project = await fixture.commands.publishRun(AGENT, {
    commandId: "publish-install-module-children",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:50:40.000Z",
    runId: "run:install-module-children",
    summary: "Publish the module-child attachment.",
  });
  project = await fixture.commands.completeRun(AGENT, {
    commandId: "complete-install-module-children",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:50:50.000Z",
    runId: "run:install-module-children",
    summary: "Attach module children and structure.",
    resultSnapshot: {
      snapshotId: installed.id,
      revision: installed.revision,
      subjectId: installed.subject.id,
    },
    evidenceRefs: [{
      snapshotId: installed.id,
      snapshotRevision: installed.revision,
      kind: "artifact",
      id: evidenceId,
    }],
  });
  return project.revision;
}

async function materializeChildCapture(
  fixture: GeoFixture,
  options: {
    readonly basis: ThreadSnapshot;
    readonly architecture: ThreadArtifact;
    readonly runId: string;
    readonly partDefinitionElementId: string;
    readonly label: string;
    readonly stepBytes: Uint8Array;
    readonly shallow?: boolean;
  },
): Promise<{
  readonly artifacts: readonly ThreadArtifact[];
  readonly consumptions: ThreadSnapshot["consumptions"];
  readonly provenance: ThreadSnapshot["provenance"];
  readonly child: GeometryModuleChild;
}> {
  const stepDigest = await fingerprintResourceBytes(options.stepBytes);
  const script = [
    "from build123d import Box",
    `size = ${options.label === "FrameDefinition" ? 8 : 2}`,
    "result = Box(size, size, size)",
    "",
  ].join("\n");
  const scriptHash = fp(
    await fingerprintResourceBytes(new TextEncoder().encode(script)),
  );
  const sourceAnalysis = await new GeometrySourceAnalysisCaptureService(
    fixture.sourceAnalysis,
  ).capture({
    selector: {
      kind: "part-definition",
      elementId: options.partDefinitionElementId,
    },
    sourceText: script,
  });
  const sealedAt = "2026-08-08T12:50:00.000Z";
  const completeCapture = {
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: options.runId,
    draftDigest: A,
    manifest: {
      schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: options.basis.id,
        revision: options.basis.revision,
        artifactFingerprint: options.architecture.fingerprint,
      },
      target: {
        partDefinitionElementId: options.partDefinitionElementId,
        label: options.label,
        scriptHash,
        files: [{
          format: "step" as const,
          name: `${options.label}.step`,
          fingerprint: fp(stepDigest),
        }],
      },
      unitSystem: "mm" as const,
      exportFormats: ["step" as const],
    },
    architectureBasis: {
      artifactId: options.architecture.id,
      fingerprint: options.architecture.fingerprint,
      producerRunId: options.architecture.producer.runId,
    },
    previewProducer: {
      serverId: "build123d-sandbox" as const,
      tool: "build123d_export" as const,
      runId: `${options.runId}-preview`,
    },
    sourceScript: {
      partDefinitionElementId: options.partDefinitionElementId,
      label: options.label,
      script,
      scriptHash,
      admission: {
        schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
        artifactId: `technical-compilation-admission-${E}`,
        fingerprint: fp(E),
        sourceFingerprint: scriptHash,
        target: {
          partDefinitionElementId: options.partDefinitionElementId,
          label: options.label,
        },
      },
      authoritativeStep: {
        fileIndex: 0,
        fingerprint: fp(stepDigest),
        bytes: options.stepBytes.byteLength,
      },
    },
    sourceAnalysis,
    sealedAt,
  };
  const capture = options.shallow
    ? {
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      operation: DESIGN_WRITE_GEOMETRY_OPERATION,
      trustedRunId: options.runId,
      manifest: completeCapture.manifest,
    }
    : completeCapture;
  const captureFp = await sha256Fingerprint(capture);
  await fixture.geoCaptures.save(captureFp, deterministicJson(capture));
  await Deno.mkdir(fixture.canonicalAssetDirectory, { recursive: true });
  await Deno.writeFile(
    `${fixture.canonicalAssetDirectory}/${stepDigest}.step`,
    options.stepBytes,
  );
  const primary: ThreadArtifact = {
    id: `geometry-${captureFp.digest}`,
    name: `Canonical PartDefinition geometry: ${options.label}`,
    kind: "cad-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${captureFp.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: options.runId,
    },
    inputArtifactIds: [options.architecture.id],
    freshness: { status: "fresh", changedAt: sealedAt, invalidatedByChangeIds: [] },
  };
  const step: ThreadArtifact = {
    id: `cad-asset-${captureFp.digest}-target-0-${stepDigest}`,
    name: `Authoritative STEP: ${options.label}`,
    kind: "step",
    version: stepDigest,
    fingerprint: fp(stepDigest),
    uri: `/api/thread/assets/${stepDigest}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: `${options.runId}-preview`,
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: sealedAt, invalidatedByChangeIds: [] },
  };
  const binaryConsumptionId = `consume-${primary.id}-by-${step.id}`;
  const architectureConsumptionId =
    `consume-arch-${options.architecture.id}-by-${primary.id}`;
  return {
    artifacts: [primary, step],
    consumptions: [
      {
        id: architectureConsumptionId,
        artifactId: options.architecture.id,
        consumer: primary.producer,
        observedFingerprint: options.architecture.fingerprint,
        verifiedAt: sealedAt,
        status: "verified",
      },
      {
        id: binaryConsumptionId,
        artifactId: primary.id,
        consumer: primary.producer,
        observedFingerprint: primary.fingerprint,
        verifiedAt: sealedAt,
        status: "verified",
      },
    ],
    provenance: [{
      id: `derived-from-architecture-${primary.fingerprint.digest}`,
      relation: "derived_from",
      from: { kind: "artifact", id: primary.id },
      to: { kind: "artifact", id: options.architecture.id },
      rationale: GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
    }, {
      id: `uses-${architectureConsumptionId}`,
      relation: "uses",
      from: { kind: "consumption", id: architectureConsumptionId },
      to: { kind: "artifact", id: options.architecture.id },
      rationale: GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
    }, {
      id: `traces-${step.id}-from-${primary.id}`,
      relation: "traces_to",
      from: { kind: "artifact", id: step.id },
      to: { kind: "artifact", id: primary.id },
      rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
    }, {
      id: `uses-${binaryConsumptionId}`,
      relation: "uses",
      from: { kind: "consumption", id: binaryConsumptionId },
      to: { kind: "artifact", id: primary.id },
      rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
    }],
    child: {
      usageElementId: options.partDefinitionElementId === "part-definition:frame"
        ? "usage:frame"
        : "usage:bolt",
      partDefinitionElementId: options.partDefinitionElementId,
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      placementCapture: PLACEMENT.fingerprint,
      childGeometry: {
        schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
        artifactId: primary.id,
        fingerprint: primary.fingerprint,
      },
      authoritativeStep: {
        fingerprint: fp(stepDigest),
        bytes: options.stepBytes.byteLength,
      },
    },
  };
}

async function materializeStructureCapture(
  architecture: ThreadArtifact,
): Promise<{
  readonly artifact: ThreadArtifact;
  readonly consumptions: ThreadSnapshot["consumptions"];
  readonly provenance: ThreadSnapshot["provenance"];
}> {
  const record = {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    kind: "part-definitions",
    architectureId: architecture.id,
  };
  const fingerprint = await sha256Fingerprint(record);
  const sealedAt = "2026-08-08T12:50:00.000Z";
  const artifact: ThreadArtifact = {
    id: `part-definitions-${fingerprint.digest}`,
    name: "PartDefinition product structure",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_element_children", runId: "run:pd" },
    inputArtifactIds: [architecture.id],
    freshness: { status: "fresh", changedAt: sealedAt, invalidatedByChangeIds: [] },
  };
  return {
    artifact,
    consumptions: [{
      id: `consume-${architecture.id}-by-${artifact.id}`,
      artifactId: architecture.id,
      consumer: artifact.producer,
      observedFingerprint: architecture.fingerprint,
      verifiedAt: sealedAt,
      status: "verified",
    }],
    provenance: [{
      id: `link-${artifact.id}-derived-from-${architecture.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: architecture.id },
      rationale: "Structure capture re-read the architecture.",
    }, {
      id: `link-consume-${architecture.id}-by-${artifact.id}`,
      relation: "uses",
      from: { kind: "consumption", id: `consume-${architecture.id}-by-${artifact.id}` },
      to: { kind: "artifact", id: architecture.id },
      rationale: "Structure capture used the architecture.",
    }],
  };
}

function unsignedDraft(options: {
  readonly architecture: ThreadArtifact;
  readonly snapshot: ThreadSnapshot;
  readonly structure: ThreadArtifact;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly bundle: Awaited<ReturnType<typeof createGeometryModuleInputBundle>>;
  readonly isolation: Awaited<ReturnType<typeof moduleIsolation>>;
  readonly assemblyStep: Uint8Array;
  readonly assemblyGlb: Uint8Array;
  readonly predecessor?: GeometryModuleManifest["predecessor"];
}): Omit<GeometryModuleDraftCapture, "fingerprint"> {
  return {
    schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
    kind: GEOMETRY_MODULE_DRAFT_KIND,
    architectureBasis: {
      snapshotId: options.snapshot.id,
      revision: options.snapshot.revision,
      artifactFingerprint: options.architecture.fingerprint,
    },
    structureCapture: fixtureStructureCaptureIdentity(
      options.architecture,
      options.structure,
    ),
    target: {
      partDefinitionElementId: "part-definition:system",
      label: "GeometrySystem",
    },
    ...(options.predecessor ? { predecessor: options.predecessor } : {}),
    placementAnalysis: PLACEMENT,
    children: options.children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    inputBundle: {
      schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
      fingerprint: options.bundle.fingerprint,
      byteCount: options.bundle.bytes.byteLength,
      manifest: options.bundle.manifest,
    },
    receipt: options.isolation.receipt,
    assemblyStep: {
      fingerprint: fp(options.isolation.stepDigest),
      bytes: options.assemblyStep.byteLength,
    },
    assemblyGlb: {
      fingerprint: fp(options.isolation.glbDigest),
      bytes: options.assemblyGlb.byteLength,
    },
  };
}

function fixtureStructureCaptureIdentity(
  architecture: ThreadArtifact,
  structure: ThreadArtifact,
): GeometryModuleDraftCapture["structureCapture"] {
  const record = {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    kind: "part-definitions",
    architectureId: architecture.id,
  };
  return {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    artifactId: structure.id,
    fingerprint: structure.fingerprint,
    uri: `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${structure.fingerprint.digest}`,
    byteCount: new TextEncoder().encode(deterministicJson(record)).byteLength,
    architecture: {
      artifactId: architecture.id,
      fingerprint: architecture.fingerprint,
      uri:
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${architecture.fingerprint.digest}`,
    },
  };
}

async function moduleIsolation(
  bundleBytes: Uint8Array,
  stepBytes: Uint8Array,
  glbBytes: Uint8Array,
): Promise<{
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly stepDigest: string;
  readonly glbDigest: string;
}> {
  const bundleDigest = await fingerprintResourceBytes(bundleBytes);
  const stepDigest = await fingerprintResourceBytes(stepBytes);
  const glbDigest = await fingerprintResourceBytes(glbBytes);
  const runId = "run.geometry-module.assembly.1";
  const outputs = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.map((declaration) => ({
    ...declaration,
    bytes: declaration.role === "assembly.step" ? stepBytes : glbBytes,
    sha256: declaration.role === "assembly.step" ? stepDigest : glbDigest,
  }));
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration: 0,
    profile: {
      id: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id,
      version: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version,
    },
    source: { bytes: bundleBytes, sha256: bundleDigest },
    policy: {
      id: "isolation.geometry-module-assembly-v1",
      version: "1.0.0",
      fingerprint: fp(A),
    },
    outputs: outputs.map(({ role, basename, mediaType, format }) => ({
      role,
      basename,
      mediaType,
      format,
    })),
  });
  const publicationMembers = outputs.map((output) => ({
    role: output.role,
    basename: output.basename,
    mediaType: output.mediaType,
    format: output.format,
    byteCount: output.bytes.byteLength,
    sha256: output.sha256,
    casUri: `casys://isolated-output/sha256/${output.sha256}`,
  }));
  const receipt = isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: {
        isolationClass: "kernel-isolated",
        imageDigest: fp(A),
        requestedLimits: {
          maxWallTimeMs: 1_000,
          maxCpuTimeMs: 500,
          maxMemoryBytes: 64_000_000,
          maxProcesses: 4,
          maxStdoutBytes: 1_024,
          maxStderrBytes: 1_024,
          maxOutputFileBytes: 1_024,
          maxOutputTotalBytes: 2_048,
        },
        limitAssurance: {
          maxWallTimeMs: "backend-attested",
          maxCpuTimeMs: "unattested",
          maxMemoryBytes: "backend-attested",
          maxProcesses: "unattested",
          maxStdoutBytes: "broker-observed-cap",
          maxStderrBytes: "broker-observed-cap",
          maxOutputFileBytes: "broker-observed-cap",
          maxOutputTotalBytes: "broker-observed-cap",
        },
      },
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: publicationMembers.map((member, index) => ({
        ...member,
        validation: "accepted" as const,
        persistence: "staged-reread-atomic-commit" as const,
        bytes: outputs[index]!.bytes,
      })),
      destruction: {
        status: "proven",
        runId,
        proofFingerprint: fp(E),
      },
      publication: await createIsolatedOutputPublicationRef(
        runId,
        0,
        await fingerprintIsolatedOutputPublicationManifest(
          runId,
          0,
          publicationMembers,
        ),
      ),
    }),
  );
  return { receipt, stepDigest, glbDigest };
}

class FakeModulePublications implements IsolatedOutputPublicationReader {
  constructor(
    readonly publicationRef: IsolatedOutputPublicationRef,
    readonly members: readonly IsolatedCodeOutputReceiptRecord[],
    readonly bytes: { readonly step: Uint8Array; readonly glb: Uint8Array },
  ) {}

  resolvePublicationByRunId() {
    return Promise.resolve({
      status: "published" as const,
      runId: this.publicationRef.runId,
      producerGeneration: this.publicationRef.producerGeneration,
      ref: this.publicationRef,
      receipt: undefined as never,
    });
  }

  readReceipt() {
    return Promise.resolve(undefined);
  }

  readPublishedObject(
    ref: IsolatedOutputPublicationRef,
    member: IsolatedCodeOutputReceiptRecord,
  ) {
    if (deterministicJson(ref) !== deterministicJson(this.publicationRef)) {
      return Promise.resolve(undefined);
    }
    const known = this.members.find((candidate) =>
      candidate.role === member.role && candidate.sha256 === member.sha256
    );
    if (!known) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(
      Uint8Array.from(
        member.role === "assembly.step" ? this.bytes.step : this.bytes.glb,
      ),
    );
  }
}

async function assertQueued(fixture: GeoFixture): Promise<void> {
  const project = await fixture.projects.get(PROJECT_ID);
  assertEquals(
    project?.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
    "queued",
  );
}

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function part21(mark: string): Uint8Array {
  return new TextEncoder().encode(
    "ISO-10303-21;\nHEADER;\n" +
      `FILE_NAME('${mark}','',('casys'),('casys'),'','','');\n` +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\n" +
      "ENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
  );
}

function structuralGlb(seed = 1): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4 }],
    extras: { seed },
  }));
  const jsonPadded = pad4(json, 0x20);
  const bin = pad4(new Uint8Array([seed, 2, 3, 4]), 0x00);
  const bytes = new Uint8Array(12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonPadded.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonPadded, 20);
  const binHeader = 20 + jsonPadded.byteLength;
  view.setUint32(binHeader, bin.byteLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  bytes.set(bin, binHeader + 8);
  return bytes;
}

function pad4(data: Uint8Array, fill: number): Uint8Array {
  const length = (data.byteLength + 3) & ~3;
  if (length === data.byteLength) return data;
  const aligned = new Uint8Array(length);
  aligned.set(data);
  aligned.fill(fill, data.byteLength);
  return aligned;
}

function meaningfulGeometry() {
  return {
    success: true,
    root: { meshes: [0], children: [] },
    meshes: [{
      attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
      index: { array: [0, 1, 2] },
    }],
  };
}
