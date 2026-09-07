import { assertEquals, assertExists } from "@std/assert";
import {
  GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
  GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../domain/cad/canonical/geometry-bundle.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_ASSETS,
  GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
  GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleCapture,
  type GeometryModuleChild,
  parseGeometryModuleCapture,
} from "../../domain/cad/canonical/geometry-module-evidence.ts";
import { GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../domain/cad/canonical/geometry-module-identities.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_PART_MANIFEST_SCHEMA,
} from "../../domain/cad/canonical/geometry-part-manifest.ts";
import { GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA } from "../../domain/cad/canonical/geometry-draft-admission.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/cad/canonical/geometry-proposal.ts";
import { validateGeometryModuleInputBundleManifest } from "../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
} from "../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadChange,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  GEOMETRY_CAPTURE_URI_PREFIX,
  PART_DEFINITIONS_CAPTURE_URI_PREFIX,
} from "../shared/cas/file-capture-store.ts";
import type { GenericArchitectureCaptureReader } from "../architecture/renderer/product-structure-catalog.ts";
import { resolveGenericProductStructureCatalog } from "../architecture/renderer/product-structure-catalog.ts";
import type {
  SysmlSourceAnalysisReader,
  VerifiedSysmlSourceAnalysis,
} from "../architecture/renderer/sysml-source-analysis-capture.ts";
import type { GenericGeometryCaptureReader } from "../cad/canonical/geometry-bundle-product-catalog.ts";
import {
  GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
  GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE,
  GEOMETRY_MODULE_CHILD_USE_RATIONALE,
  geometryModuleAssemblyArtifacts,
  geometryModuleAssemblyGlbArtifactId,
  geometryModuleAssemblyStepArtifactId,
  geometryModuleBinaryProducer,
  geometryModulePrimaryInputIds,
  geometryModuleStructureAttestation,
} from "../cad/canonical/design-write-geometry-module-seal.ts";
import type { ThreadViewerSession } from "../../presentation/workbench/thread/viewer-sessions.ts";
import { projectThreadViewerHierarchy } from "./thread-viewer-hierarchy.ts";

const AT = "2026-08-08T00:00:00.000Z";
const SUBJECT_ID = "project:airframe-hierarchy";
const SNAPSHOT_ID = `${SUBJECT_ID}:r1`;

Deno.test("viewer hierarchy navigates root plus current and historical children as assembled", async () => {
  const world = await composeWorld();
  const catalog = await resolveGenericProductStructureCatalog(
    world.snapshot,
    world.captures,
    world.captures,
    world.sysml,
  );
  assertExists(catalog);
  assertEquals(
    catalog.components.some((component) =>
      component.id === world.ids.wingLeftNode &&
      component.bindings.some((binding) =>
        binding.provider === "digital-thread" && binding.kind === "artifact"
      )
    ),
    false,
    "historical children stay omitted from current-architecture CAD",
  );

  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });

  assertEquals(projection.status, "available");
  assertEquals(projection.rootIds, [`${SUBJECT_ID}:system`]);
  const byId = Object.fromEntries(projection.nodes.map((node) => [node.id, node]));
  assertEquals(byId[`${SUBJECT_ID}:system`]?.label, "Airframe");
  assertEquals(byId[`${SUBJECT_ID}:system`]?.geometryArtifactId, world.ids.root);
  assertEquals(byId[`${SUBJECT_ID}:system`]?.sessionIds, [world.sessionIds.root]);
  assertEquals(byId[world.ids.wingLeftNode]?.parentId, `${SUBJECT_ID}:system`);
  assertEquals(byId[world.ids.wingRightNode]?.parentId, `${SUBJECT_ID}:system`);
  assertEquals(byId[world.ids.wingLeftNode]?.geometryArtifactId, world.ids.wing);
  assertEquals(byId[world.ids.wingRightNode]?.geometryArtifactId, world.ids.wing);
  assertEquals(byId[world.ids.wingLeftNode]?.sessionIds, [world.sessionIds.wing]);
  assertEquals(byId[world.ids.wingRightNode]?.sessionIds, [world.sessionIds.wing]);
  assertEquals(byId[world.ids.fuselageNode]?.geometryArtifactId, world.ids.fuselage);
  assertEquals(byId[world.ids.payloadNode]?.geometryArtifactId, world.ids.payload);
  assertEquals(byId[world.ids.skinNode]?.sessionIds, []);
  assertEquals(byId[world.ids.ribLeftNode]?.geometryArtifactId, world.ids.rib);
  assertEquals(byId[world.ids.ribRightNode]?.geometryArtifactId, world.ids.rib);
  assertEquals(
    projection.nodes.map((node) => node.id),
    [
      `${SUBJECT_ID}:system`,
      world.ids.fuselageNode,
      world.ids.skinNode,
      world.ids.payloadNode,
      world.ids.wingLeftNode,
      world.ids.ribLeftNode,
      world.ids.wingRightNode,
      world.ids.ribRightNode,
    ],
  );
});

Deno.test("viewer hierarchy preserves repeated PartUsage paths and ignores shuffled labels", async () => {
  const world = await composeWorld({
    labels: {
      airframe: "RenamedAirframe",
      wing: "RenamedWing",
    },
  });
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  const left = projection.nodes.find((node) => node.id === world.ids.wingLeftNode);
  const right = projection.nodes.find((node) => node.id === world.ids.wingRightNode);
  assertEquals(left?.label, "RenamedWing");
  assertEquals(right?.label, "RenamedWing");
  assertEquals(left?.usageId, "wing-left-use");
  assertEquals(right?.usageId, "wing-right-use");
  assertEquals(left?.usageLabel, "wingLeft");
  assertEquals(right?.usageLabel, "wingRight");
  assertEquals(left?.partDefinitionElementId, "wing-def");
  assertEquals(right?.partDefinitionElementId, "wing-def");
  assertEquals(left?.geometryArtifactId, world.ids.wing);
  assertEquals(right?.geometryArtifactId, world.ids.wing);
  assertEquals(left?.id === right?.id, false);
});

Deno.test("viewer hierarchy does not join a mismatched usage or typed definition", async () => {
  const world = await composeWorld({
    mispairWing: true,
  });
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  const left = projection.nodes.find((node) => node.id === world.ids.wingLeftNode);
  assertEquals(left?.geometryArtifactId, undefined);
  assertEquals(left?.sessionIds, []);
  const root = projection.nodes.find((node) => node.id === `${SUBJECT_ID}:system`);
  assertEquals(root?.geometryArtifactId, world.ids.root);
});

Deno.test("viewer hierarchy keeps the catalog tree when a capture is tampered", async () => {
  const world = await composeWorld();
  const tampered = new Map(world.store);
  tampered.set(
    world.snapshot.artifacts.find((artifact) => artifact.id === world.ids.root)!
      .fingerprint.digest,
    '{"tampered":true}',
  );
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: mapReader(world.store),
    geometryCaptures: mapReader(tampered),
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(projection.status, "available");
  assertEquals(
    projection.nodes.every((node) => node.geometryArtifactId === undefined),
    true,
  );
  assertEquals(
    projection.nodes.some((node) => node.id === world.ids.wingLeftNode),
    true,
  );
});

Deno.test("viewer hierarchy does not associate an assembled child whose exact capture cannot reopen", async () => {
  const world = await composeWorld();
  const missing = new Map(world.store);
  missing.delete(
    world.snapshot.artifacts.find((a) => a.id === world.ids.wing)!.fingerprint.digest,
  );
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: mapReader(missing),
    sysmlSourceAnalysis: world.sysml,
  });
  const child = projection.nodes.find((n) => n.id === world.ids.wingLeftNode);
  assertExists(child);
  assertEquals(child.geometryArtifactId, undefined);
  assertEquals(child.sessionIds, []);
});

Deno.test("viewer hierarchy preserves structure and safely closes CAD anchors for an upstream-invalid child family", async () => {
  for (
    const variant of ["archived", "wrong-fingerprint", "wrong-attestation"] as const
  ) {
    const world = await composeWorld({ childFault: variant });
    const projection = await projectThreadViewerHierarchy({
      snapshot: world.snapshot,
      basis: world.basis,
      sessions: world.sessions,
      architectureCaptures: world.captures,
      geometryCaptures: world.captures,
      sysmlSourceAnalysis: world.sysml,
    });
    const left = projection.nodes.find((node) => node.id === world.ids.wingLeftNode);
    assertEquals(left?.geometryArtifactId, undefined, variant);
    assertEquals(left?.sessionIds, [], variant);
    const root = projection.nodes.find((node) => node.id === `${SUBJECT_ID}:system`);
    assertExists(root, variant);
    if (variant === "wrong-fingerprint") {
      // This primary remains active enough to enter the generic catalog's
      // family selection, but cannot re-open. The catalog consequently closes
      // all CAD bindings before hierarchy composition; structure remains.
      assertEquals(root.geometryArtifactId, undefined, variant);
    } else {
      assertEquals(root.geometryArtifactId, world.ids.root, variant);
    }
  }
});

Deno.test("viewer hierarchy does not invent a grandchild association at the parent", async () => {
  const world = await composeWorld({ nonImmediateRibOnFuselage: true });
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  const fuselage = projection.nodes.find((node) => node.id === world.ids.fuselageNode);
  const skin = projection.nodes.find((node) => node.id === world.ids.skinNode);
  assertEquals(fuselage?.geometryArtifactId, world.ids.fuselage);
  assertEquals(skin?.geometryArtifactId, world.ids.skin);
  assertEquals(
    projection.nodes.filter((node) => node.parentId === world.ids.fuselageNode)
      .map((node) => node.usageId),
    ["skin-use"],
  );
});

Deno.test("viewer hierarchy omits Apps when sessions are missing or revoked", async () => {
  const world = await composeWorld();
  const withoutWing = world.sessions.filter((session) =>
    session.anchor.kind !== "artifact" || session.anchor.id !== world.ids.wing
  );
  const missing = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: withoutWing,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  const left = missing.nodes.find((node) => node.id === world.ids.wingLeftNode);
  assertEquals(left?.geometryArtifactId, world.ids.wing);
  assertEquals(left?.sessionIds, []);

  const revoked = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: [
      await cadSession("geometry-not-a-primary", "revoked"),
    ],
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(
    revoked.nodes.every((node) => node.sessionIds.length === 0),
    true,
  );
});

Deno.test("viewer hierarchy stays available without Apps when architecture is present and geometry is absent", async () => {
  const world = await composeWorld({ omitGeometry: true });
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: [],
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(projection.status, "available");
  assertEquals(projection.nodes.length > 0, true);
  assertEquals(projection.nodes.every((node) => node.sessionIds.length === 0), true);
});

Deno.test("viewer hierarchy copies SysON usage labels and the unique current architecture id", async () => {
  const world = await composeWorld();
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(projection.status, "available");
  assertEquals(projection.architectureArtifactId, world.ids.architecture);
  const root = projection.nodes.find((node) => node.id === `${SUBJECT_ID}:system`);
  const fuselage = projection.nodes.find((node) => node.id === world.ids.fuselageNode);
  assertEquals(root?.usageId, undefined);
  assertEquals(root?.usageLabel, undefined);
  assertEquals(fuselage?.usageId, "fuselage-use");
  assertEquals(fuselage?.usageLabel, "fuselage");
  assertEquals(
    projection.nodes.map((node) => node.sessionIds),
    [
      [world.sessionIds.root],
      [world.sessionIds.fuselage],
      [],
      [world.sessionIds.payload],
      [world.sessionIds.wing],
      [],
      [world.sessionIds.wing],
      [],
    ],
  );
});

Deno.test("viewer hierarchy selects the current architecture across a predecessor chain", async () => {
  const world = await composeWorld({ architecturePredecessor: true });
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(projection.status, "available");
  assertEquals(projection.architectureArtifactId, world.ids.architecture);
  assertEquals(
    projection.architectureArtifactId === world.ids.predecessorArchitecture,
    false,
  );
  assertEquals(
    world.snapshot.artifacts.some((artifact) =>
      artifact.id === world.ids.predecessorArchitecture &&
      artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
    ),
    true,
  );
});

Deno.test("viewer hierarchy includes exact module and leaf exports without inventing Apps", async () => {
  const world = await composeWorld();
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  const fuselage = projection.nodes.find((node) => node.id === world.ids.fuselageNode);
  const skin = projection.nodes.find((node) => node.id === world.ids.skinNode);
  const fuselageAssets = moduleAssetIds(world.snapshot, world.ids.fuselage);
  assertEquals(fuselage?.geometryArtifactId, world.ids.fuselage);
  assertEquals(fuselage?.artifactIds, [world.ids.fuselage, ...fuselageAssets]);
  assertEquals(fuselage?.artifactIds?.includes(world.ids.skin), false);
  assertEquals(fuselage?.sessionIds, [world.sessionIds.fuselage]);
  assertEquals(skin?.geometryArtifactId, world.ids.skin);
  assertEquals(skin?.artifactIds, [world.ids.skin, world.ids.skinStep]);
  assertEquals(skin?.sessionIds, []);
  assertEquals(world.sessions.length, 4);
});

Deno.test("viewer hierarchy keeps structure but closes CAD anchors when an active family loses a signed binary", async () => {
  const archivedWorld = await composeWorld({ archiveModuleAsset: true });
  const archived = await projectThreadViewerHierarchy({
    snapshot: archivedWorld.snapshot,
    basis: archivedWorld.basis,
    sessions: archivedWorld.sessions,
    architectureCaptures: archivedWorld.captures,
    geometryCaptures: archivedWorld.captures,
    sysmlSourceAnalysis: archivedWorld.sysml,
  });
  const archivedWing = archived.nodes.find((node) =>
    node.id === archivedWorld.ids.wingLeftNode
  );
  assertEquals(archived.status, "available");
  assertExists(archivedWing);
  assertEquals(archivedWing.geometryArtifactId, undefined);
  assertEquals(archivedWing.artifactIds, undefined);
  assertEquals(archivedWing.sessionIds, []);

  const foreignWorld = await composeWorld({ foreignLeafTrace: true });
  const foreign = await projectThreadViewerHierarchy({
    snapshot: foreignWorld.snapshot,
    basis: foreignWorld.basis,
    sessions: foreignWorld.sessions,
    architectureCaptures: foreignWorld.captures,
    geometryCaptures: foreignWorld.captures,
    sysmlSourceAnalysis: foreignWorld.sysml,
  });
  const fuselage = foreign.nodes.find((node) =>
    node.id === foreignWorld.ids.fuselageNode
  );
  assertEquals(fuselage?.artifactIds?.includes(foreignWorld.ids.payload), false);
  assertEquals(fuselage?.artifactIds?.includes(foreignWorld.ids.skin), false);
  assertEquals(
    fuselage?.artifactIds,
    [
      foreignWorld.ids.fuselage,
      ...moduleAssetIds(foreignWorld.snapshot, foreignWorld.ids.fuselage),
    ],
  );
});

Deno.test("viewer hierarchy excludes a foreign artifact that copies binary provenance topology", async () => {
  const world = await composeWorld();
  const primary = world.snapshot.artifacts.find((artifact) =>
    artifact.id === world.ids.fuselage
  );
  assertExists(primary);
  const rogue: ThreadArtifact = {
    id: "rogue-navigation-anchor",
    name: "Unrelated record",
    kind: "sysml-model",
    version: "f".repeat(64),
    fingerprint: fp("f"),
    uri: "casys://unrelated/sha256/" + "f".repeat(64),
    mediaType: "application/json",
    producer: primary.producer,
    inputArtifactIds: [primary.id],
    freshness: fresh(),
  };
  const consumptionId = `consume-${primary.id}-by-${rogue.id}`;
  const snapshot = {
    ...world.snapshot,
    artifacts: [...world.snapshot.artifacts, rogue],
    consumptions: [...world.snapshot.consumptions, {
      id: consumptionId,
      artifactId: primary.id,
      consumer: rogue.producer,
      observedFingerprint: primary.fingerprint,
      verifiedAt: AT,
      status: "verified" as const,
    }],
    provenance: [...world.snapshot.provenance, {
      id: `traces-${rogue.id}-from-${primary.id}`,
      relation: "traces_to" as const,
      from: { kind: "artifact" as const, id: rogue.id },
      to: { kind: "artifact" as const, id: primary.id },
      rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
    }, {
      id: `uses-${consumptionId}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumptionId },
      to: { kind: "artifact" as const, id: primary.id },
      rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
    }, {
      id: `derived-from-module-primary-${rogue.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: rogue.id },
      to: { kind: "artifact" as const, id: primary.id },
      rationale: GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
    }],
  } as ThreadSnapshot;
  const projection = await projectThreadViewerHierarchy({
    snapshot,
    basis: world.basis,
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(
    projection.nodes.some((node) => node.artifactIds?.includes(rogue.id)),
    false,
  );
});

Deno.test("viewer hierarchy rejects binary navigation anchors with mutated canonical metadata", async () => {
  const world = await composeWorld();
  const asset = world.snapshot.artifacts.find((artifact) =>
    artifact.kind === "step" && artifact.inputArtifactIds.length === 1 &&
    artifact.inputArtifactIds[0] === world.ids.fuselage
  );
  assertExists(asset);
  const mutations: ReadonlyArray<Readonly<Partial<ThreadArtifact>>> = [{
    uri: "/api/thread/assets/wrong.step",
  }, {
    kind: "cad-model",
  }, {
    fingerprint: await sha256Fingerprint({ replacement: asset.id }),
  }, {
    freshness: {
      ...asset.freshness,
      changedAt: "2026-08-09T00:00:00.000Z",
    },
  }];
  for (const mutation of mutations) {
    const snapshot = {
      ...world.snapshot,
      artifacts: world.snapshot.artifacts.map((candidate) =>
        candidate.id === asset.id ? { ...candidate, ...mutation } : candidate
      ),
    } as ThreadSnapshot;
    const projection = await projectThreadViewerHierarchy({
      snapshot,
      basis: world.basis,
      sessions: world.sessions,
      architectureCaptures: world.captures,
      geometryCaptures: world.captures,
      sysmlSourceAnalysis: world.sysml,
    });
    assertEquals(
      projection.nodes.some((node) => node.artifactIds?.includes(asset.id)),
      false,
    );
  }
});

Deno.test("viewer hierarchy is unavailable when the Thread basis does not recross", async () => {
  const world = await composeWorld();
  const projection = await projectThreadViewerHierarchy({
    snapshot: world.snapshot,
    basis: { ...world.basis, thread: { id: SNAPSHOT_ID, revision: 9 } },
    sessions: world.sessions,
    architectureCaptures: world.captures,
    geometryCaptures: world.captures,
    sysmlSourceAnalysis: world.sysml,
  });
  assertEquals(projection.status, "unavailable");
  assertEquals(projection.nodes, []);
});

interface ComposeOptions {
  readonly labels?: { readonly airframe?: string; readonly wing?: string };
  readonly mispairWing?: boolean;
  readonly childFault?: "archived" | "wrong-fingerprint" | "wrong-attestation";
  readonly nonImmediateRibOnFuselage?: boolean;
  readonly omitGeometry?: boolean;
  readonly architecturePredecessor?: boolean;
  readonly archiveModuleAsset?: boolean;
  readonly foreignLeafTrace?: boolean;
}

interface World {
  readonly snapshot: ThreadSnapshot;
  readonly store: Map<string, string>;
  readonly captures: GenericArchitectureCaptureReader & GenericGeometryCaptureReader;
  readonly sysml: SysmlSourceAnalysisReader;
  readonly basis: {
    readonly projectId: string;
    readonly projectRevision: number;
    readonly subjectId: string;
    readonly thread: { readonly id: string; readonly revision: number };
  };
  readonly sessions: readonly ThreadViewerSession[];
  readonly sessionIds: {
    readonly root: string;
    readonly fuselage: string;
    readonly wing: string;
    readonly payload: string;
  };
  readonly ids: {
    readonly root: string;
    readonly fuselage: string;
    readonly wing: string;
    readonly payload: string;
    readonly rib: string;
    readonly skin: string;
    readonly architecture: string;
    readonly predecessorArchitecture: string;
    readonly fuselageNode: string;
    readonly payloadNode: string;
    readonly wingLeftNode: string;
    readonly wingRightNode: string;
    readonly skinNode: string;
    readonly ribLeftNode: string;
    readonly ribRightNode: string;
    readonly fuselageStep: string;
    readonly fuselageGlb: string;
    readonly wingStep: string;
    readonly wingGlb: string;
    readonly skinStep: string;
  };
}

async function composeWorld(options: ComposeOptions = {}): Promise<World> {
  const airframeLabel = options.labels?.airframe ?? "Airframe";
  const wingLabel = options.labels?.wing ?? "WingModule";
  const predecessor = options.architecturePredecessor
    ? await predecessorArchitecture()
    : undefined;
  const archRecord = architectureRecord({
    airframeLabel,
    wingLabel,
    predecessor: predecessor
      ? {
        artifactId: predecessor.artifact.id,
        fingerprint: predecessor.artifact.fingerprint,
        producerRunId: predecessor.artifact.producer.runId,
      }
      : undefined,
  });
  const archFp = await sha256Fingerprint(archRecord);
  const store = new Map<string, string>([[
    archFp.digest,
    deterministicJson(archRecord),
  ]]);
  if (predecessor) {
    store.set(predecessor.artifact.fingerprint.digest, predecessor.text);
  }
  const currentArch = architectureArtifact(archFp, {
    inputArtifactIds: predecessor
      ? ["seed-artifact", predecessor.artifact.id]
      : ["seed-artifact"],
  });
  const artifacts: ThreadArtifact[] = [
    seedArtifact(),
    currentArch,
    ...(predecessor ? [predecessor.artifact] : []),
  ];
  const consumptions: ThreadArtifactConsumption[] = [
    seedConsumption(),
    ...(predecessor
      ? [
        predecessor.seedConsumption,
        {
          id: "consume-predecessor-arch",
          artifactId: predecessor.artifact.id,
          consumer: currentArch.producer,
          observedFingerprint: predecessor.artifact.fingerprint,
          verifiedAt: AT,
          status: "verified" as const,
        },
      ]
      : []),
  ];
  const provenance: ThreadProvenanceLink[] = [
    {
      id: "change-to-arch",
      relation: "changes",
      from: { kind: "change", id: "change-r1" },
      to: { kind: "artifact", id: currentArch.id },
      rationale: "The architecture fixture change records the initial evidence.",
    },
    {
      id: "uses-seed",
      relation: "uses",
      from: { kind: "consumption", id: "consume-seed" },
      to: { kind: "artifact", id: "seed-artifact" },
      rationale: "The architecture fixture verifies its exact seed.",
    },
    {
      id: "derived-from-seed",
      relation: "derived_from",
      from: { kind: "artifact", id: currentArch.id },
      to: { kind: "artifact", id: "seed-artifact" },
      rationale: "The architecture fixture derives from its exact seed.",
    },
    ...(predecessor
      ? [
        {
          id: "change-to-predecessor-arch",
          relation: "changes" as const,
          from: { kind: "change" as const, id: "change-r0" },
          to: { kind: "artifact" as const, id: predecessor.artifact.id },
          rationale: "The architecture fixture records its predecessor capture.",
        },
        {
          id: "uses-seed-predecessor",
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: predecessor.seedConsumption.id },
          to: { kind: "artifact" as const, id: "seed-artifact" },
          rationale: "The predecessor architecture verifies its exact seed.",
        },
        {
          id: "derived-from-seed-predecessor",
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: predecessor.artifact.id },
          to: { kind: "artifact" as const, id: "seed-artifact" },
          rationale: "The predecessor architecture derives from its exact seed.",
        },
        {
          id: "uses-predecessor-arch",
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: "consume-predecessor-arch" },
          to: { kind: "artifact" as const, id: predecessor.artifact.id },
          rationale: "The current architecture verifies its exact predecessor.",
        },
        {
          id: "derived-from-predecessor-arch",
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: currentArch.id },
          to: { kind: "artifact" as const, id: predecessor.artifact.id },
          rationale: "The current architecture succeeds its exact predecessor.",
        },
      ]
      : []),
  ];
  const changes: ThreadChange[] = [
    ...(predecessor
      ? [{
        id: "change-r0",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: predecessor.artifact.id },
        summary: "Recorded predecessor architecture.",
        afterFingerprint: predecessor.artifact.fingerprint,
      }]
      : []),
    {
      id: "change-r1",
      kind: "created",
      target: { kind: "artifact", id: currentArch.id },
      summary: "Recorded initial architecture.",
      afterFingerprint: archFp,
    },
  ];

  if (options.omitGeometry) {
    const snapshot = finishSnapshot(
      artifacts,
      consumptions,
      provenance,
      changes,
      archFp,
    );
    return {
      snapshot,
      store,
      captures: mapReader(store),
      sysml: passingSourceAnalysis(),
      basis: basis(),
      sessions: [],
      sessionIds: {
        root: "",
        fuselage: "",
        wing: "",
        payload: "",
      },
      ids: {
        root: "geometry-missing",
        fuselage: "geometry-missing",
        wing: "geometry-missing",
        payload: "geometry-missing",
        rib: "geometry-missing",
        skin: "geometry-missing",
        architecture: currentArch.id,
        predecessorArchitecture: predecessor?.artifact.id ?? "",
        fuselageStep: "",
        fuselageGlb: "",
        wingStep: "",
        wingGlb: "",
        skinStep: "",
        ...nodeIds(),
      },
    };
  }

  const currentStructure = await structureArtifact(currentArch, "current");
  artifacts.push(currentStructure);
  const foreignArch = await historicalArchitectureArtifact();
  artifacts.push(foreignArch);
  const foreignStructure = await structureArtifact(foreignArch, "foreign");
  artifacts.push(foreignStructure);

  const skin = await sealLeaf({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: currentArch,
    target: { partDefinitionElementId: "skin-def", label: "SkinPiece" },
    runId: "run.geo.leaf.skin",
  });
  const rib = await sealLeaf({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: foreignArch,
    target: { partDefinitionElementId: "rib-def", label: "RibPiece" },
    runId: "run.geo.leaf.rib",
  });
  const payloadLeaf = await sealLeaf({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: foreignArch,
    target: { partDefinitionElementId: "payload-leaf-def", label: "PayloadLeaf" },
    runId: "run.geo.leaf.payload",
  });

  const fuselageChildren = [
    leafChild("skin-use", "skin-def", skin),
    ...(options.nonImmediateRibOnFuselage
      ? [leafChild("rib-use", "rib-def", rib)]
      : []),
  ];
  const fuselage = await sealModule({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: currentArch,
    structure: currentStructure,
    target: { partDefinitionElementId: "fuselage-def", label: "FuselageModule" },
    children: fuselageChildren,
    runId: "run.geo.fuselage",
    exactChildAttestations: true,
    publishUri: true,
  });

  const payload = await sealModule({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: foreignArch,
    structure: foreignStructure,
    target: { partDefinitionElementId: "payload-def", label: "PayloadModule" },
    children: [leafChild("payload-leaf-use", "payload-leaf-def", payloadLeaf)],
    runId: "run.geo.payload",
    exactChildAttestations: true,
    publishUri: true,
  });
  const wing = await sealModule({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: foreignArch,
    structure: foreignStructure,
    target: { partDefinitionElementId: "wing-def", label: wingLabel },
    children: [leafChild("rib-use", "rib-def", rib)],
    runId: "run.geo.wing",
    exactChildAttestations: true,
    publishUri: true,
  });

  const wingChild = options.mispairWing
    ? moduleChild("wing-left-use", "payload-def", wing.primary)
    : moduleChild("wing-left-use", "wing-def", wing.primary);
  const rootChildren: GeometryModuleChild[] = [
    moduleChild("fuselage-use", "fuselage-def", fuselage.primary),
    moduleChild("payload-use", "payload-def", payload.primary),
    wingChild,
    moduleChild("wing-right-use", "wing-def", wing.primary),
  ].toSorted((left, right) =>
    left.usageElementId < right.usageElementId
      ? -1
      : left.usageElementId > right.usageElementId
      ? 1
      : 0
  );

  const root = await sealModule({
    artifacts,
    consumptions,
    provenance,
    store,
    architecture: currentArch,
    structure: currentStructure,
    target: { partDefinitionElementId: "airframe-def", label: airframeLabel },
    children: rootChildren,
    runId: "run.geo.root",
    exactChildAttestations: options.childFault !== "wrong-attestation",
    publishUri: true,
  });

  if (options.childFault === "archived") {
    changes.push({
      id: "change-archive-wing",
      kind: "archived",
      target: { kind: "artifact", id: wing.primary.id },
      summary: "Archived historical wing capture.",
    });
    provenance.push({
      id: "change-archives-wing",
      relation: "changes",
      from: { kind: "change", id: "change-archive-wing" },
      to: { kind: "artifact", id: wing.primary.id },
      rationale: "The fixture archives the historical wing capture.",
    });
  }
  if (options.childFault === "wrong-fingerprint") {
    const index = artifacts.findIndex((artifact) => artifact.id === wing.primary.id);
    const mutated = await sha256Fingerprint({ wrong: wing.primary.id });
    artifacts[index] = {
      ...wing.primary,
      fingerprint: mutated,
      version: mutated.digest,
    };
    for (let i = 0; i < consumptions.length; i += 1) {
      const consumption = consumptions[i]!;
      if (consumption.artifactId === wing.primary.id) {
        consumptions[i] = { ...consumption, observedFingerprint: mutated };
      }
    }
  }

  const fuselageStepId = geometryModuleAssemblyStepArtifactId(
    fuselage.primary.fingerprint.digest,
    fuselage.capture.assemblyStep.fingerprint.digest,
  );
  const fuselageGlbId = geometryModuleAssemblyGlbArtifactId(
    fuselage.primary.fingerprint.digest,
    fuselage.capture.assemblyGlb.fingerprint.digest,
  );
  const wingStepId = geometryModuleAssemblyStepArtifactId(
    wing.primary.fingerprint.digest,
    wing.capture.assemblyStep.fingerprint.digest,
  );
  const wingGlbId = geometryModuleAssemblyGlbArtifactId(
    wing.primary.fingerprint.digest,
    wing.capture.assemblyGlb.fingerprint.digest,
  );
  const skinStepId = skin.step.id;
  if (options.archiveModuleAsset) {
    changes.push({
      id: "change-archive-wing-glb",
      kind: "archived",
      target: { kind: "artifact", id: wingGlbId },
      summary: "Archived one historical module assembly asset.",
    });
    provenance.push({
      id: "change-archives-wing-glb",
      relation: "changes",
      from: { kind: "change", id: "change-archive-wing-glb" },
      to: { kind: "artifact", id: wingGlbId },
      rationale: "The fixture archives one historical module assembly asset.",
    });
  }
  if (options.foreignLeafTrace) {
    provenance.push({
      id: `traces-${skin.primary.id}-from-${fuselage.primary.id}`,
      relation: "traces_to",
      from: { kind: "artifact", id: skin.primary.id },
      to: { kind: "artifact", id: fuselage.primary.id },
      rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
    }, {
      id: `traces-${payload.primary.id}-from-${fuselage.primary.id}-unrelated`,
      relation: "traces_to",
      from: { kind: "artifact", id: payload.primary.id },
      to: { kind: "artifact", id: fuselage.primary.id },
      rationale: "An unrelated trace is not a recorded geometry binary.",
    });
  }

  const snapshot = finishSnapshot(artifacts, consumptions, provenance, changes, archFp);
  const storedRoot = store.get(root.primary.fingerprint.digest);
  assertExists(storedRoot);
  await parseGeometryModuleCapture(JSON.parse(storedRoot));

  const sessions = {
    root: await cadSession(root.primary.id, "root"),
    fuselage: await cadSession(fuselage.primary.id, "fuselage"),
    wing: await cadSession(wing.primary.id, "wing"),
    payload: await cadSession(payload.primary.id, "payload"),
  };
  return {
    snapshot,
    store,
    captures: mapReader(store),
    sysml: passingSourceAnalysis(),
    basis: basis(),
    sessions: [sessions.root, sessions.fuselage, sessions.wing, sessions.payload],
    sessionIds: {
      root: sessions.root.id,
      fuselage: sessions.fuselage.id,
      wing: sessions.wing.id,
      payload: sessions.payload.id,
    },
    ids: {
      root: root.primary.id,
      fuselage: fuselage.primary.id,
      wing: wing.primary.id,
      payload: payload.primary.id,
      rib: rib.primary.id,
      skin: skin.primary.id,
      architecture: currentArch.id,
      predecessorArchitecture: predecessor?.artifact.id ?? "",
      fuselageStep: fuselageStepId,
      fuselageGlb: fuselageGlbId,
      wingStep: wingStepId,
      wingGlb: wingGlbId,
      skinStep: skinStepId,
      ...nodeIds(),
    },
  };
}

function nodeIds() {
  return {
    fuselageNode: `${SUBJECT_ID}:usage:fuselage-use`,
    payloadNode: `${SUBJECT_ID}:usage:payload-use`,
    wingLeftNode: `${SUBJECT_ID}:usage:wing-left-use`,
    wingRightNode: `${SUBJECT_ID}:usage:wing-right-use`,
    skinNode: `${SUBJECT_ID}:usage:fuselage-use/skin-use`,
    ribLeftNode: `${SUBJECT_ID}:usage:wing-left-use/rib-use`,
    ribRightNode: `${SUBJECT_ID}:usage:wing-right-use/rib-use`,
  };
}

function basis() {
  return {
    projectId: "project-airframe",
    projectRevision: 12,
    subjectId: SUBJECT_ID,
    thread: { id: SNAPSHOT_ID, revision: 1 },
  };
}

function mapReader(
  store: Map<string, string>,
): GenericArchitectureCaptureReader & GenericGeometryCaptureReader {
  return {
    read: (fingerprint) => Promise.resolve(store.get(fingerprint.digest)),
  };
}

function passingSourceAnalysis(): SysmlSourceAnalysisReader {
  return {
    reopen(value) {
      return Promise.resolve(
        { reference: structuredClone(value) } as unknown as VerifiedSysmlSourceAnalysis,
      );
    },
  };
}

function architectureRecord(labels: {
  readonly airframeLabel: string;
  readonly wingLabel: string;
  readonly trustedRunId?: string;
  readonly packageName?: string;
  readonly insertedAt?: string;
  readonly predecessor?: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
}): Record<string, unknown> {
  return {
    schemaVersion: "architecture-capture/4.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: labels.trustedRunId ?? "run:arch",
    packageName: labels.packageName ?? "SystemV1",
    systemName: labels.airframeLabel,
    scopeRoot: { id: "pkg-001", kind: "Package", label: "SystemV1" },
    semanticRoot: {
      id: "airframe-def",
      kind: "PartDefinition",
      label: labels.airframeLabel,
    },
    seed: {
      artifactId: "seed-artifact",
      fingerprint: fp("1"),
      producerRunId: "run:seed",
    },
    partDefinitions: [
      {
        id: "airframe-def",
        kind: "PartDefinition",
        label: labels.airframeLabel,
        usages: [
          usage("fuselage-use", "fuselage", "fuselage-def", "FuselageModule"),
          usage("payload-use", "payload", "payload-def", "PayloadModule"),
          usage("wing-left-use", "wingLeft", "wing-def", labels.wingLabel),
          usage("wing-right-use", "wingRight", "wing-def", labels.wingLabel),
        ],
      },
      {
        id: "fuselage-def",
        kind: "PartDefinition",
        label: "FuselageModule",
        usages: [usage("skin-use", "skin", "skin-def", "SkinPiece")],
      },
      { id: "payload-def", kind: "PartDefinition", label: "PayloadModule", usages: [] },
      {
        id: "wing-def",
        kind: "PartDefinition",
        label: labels.wingLabel,
        usages: [usage("rib-use", "rib", "rib-def", "RibPiece")],
      },
      { id: "skin-def", kind: "PartDefinition", label: "SkinPiece", usages: [] },
      { id: "rib-def", kind: "PartDefinition", label: "RibPiece", usages: [] },
    ],
    insertedAt: labels.insertedAt ?? AT,
    ...(labels.predecessor ? { predecessor: labels.predecessor } : {}),
    sourceAnalyses: [{
      sourceId: "sysml-source:system-v1",
      selector: { kind: "full-package", packageName: labels.packageName ?? "SystemV1" },
      runId: labels.trustedRunId ?? "run:arch",
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: fp("a"),
      sourceCaptureFingerprint: fp("b"),
      analysisFingerprint: fp("c"),
    }],
  };
}

function usage(
  id: string,
  label: string,
  targetId: string,
  targetLabel: string,
) {
  return {
    id,
    kind: "PartUsage",
    label,
    targetId,
    targetKind: "PartDefinition",
    targetLabel,
  };
}

function seedArtifact(): ThreadArtifact {
  return {
    id: "seed-artifact",
    name: "Seed",
    kind: "sysml-model",
    version: "1".repeat(64),
    fingerprint: fp("1"),
    uri: "casys://syson-model-seed-capture/sha256/" + "1".repeat(64),
    producer: { serverId: "syson", tool: "syson_model_create", runId: "run:seed" },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function architectureArtifact(
  captureFp: ContentFingerprint,
  options: {
    readonly name?: string;
    readonly runId?: string;
    readonly insertedAt?: string;
    readonly inputArtifactIds?: readonly string[];
  } = {},
): ThreadArtifact {
  const insertedAt = options.insertedAt ?? AT;
  return {
    id: `architecture-${captureFp.digest}`,
    name: options.name ?? "Architecture: SystemV1",
    kind: "sysml-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${captureFp.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: options.runId ?? "run:arch",
    },
    inputArtifactIds: [...(options.inputArtifactIds ?? ["seed-artifact"])],
    freshness: {
      status: "fresh",
      changedAt: insertedAt,
      invalidatedByChangeIds: [],
    },
  };
}

async function predecessorArchitecture(): Promise<{
  readonly artifact: ThreadArtifact;
  readonly text: string;
  readonly seedConsumption: ThreadArtifactConsumption;
}> {
  const insertedAt = "2026-08-09T00:00:00.000Z";
  const record = architectureRecord({
    airframeLabel: "LegacyAirframe",
    wingLabel: "LegacyWing",
    trustedRunId: "run:arch-pred",
    insertedAt,
  });
  const fingerprint = await sha256Fingerprint(record);
  const artifact = architectureArtifact(fingerprint, {
    runId: "run:arch-pred",
    insertedAt,
  });
  return {
    artifact,
    text: deterministicJson(record),
    seedConsumption: {
      id: "consume-seed-predecessor",
      artifactId: "seed-artifact",
      consumer: artifact.producer,
      observedFingerprint: fp("1"),
      verifiedAt: insertedAt,
      status: "verified",
    },
  };
}

function moduleAssetIds(
  snapshot: ThreadSnapshot,
  primaryId: string,
): string[] {
  return snapshot.provenance
    .filter((link) =>
      link.relation === "derived_from" &&
      link.rationale === GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE &&
      link.from.kind === "artifact" &&
      link.to.kind === "artifact" &&
      link.to.id === primaryId
    )
    .map((link) => link.from.id)
    .toSorted((left, right) => left.localeCompare(right));
}

function seedConsumption(): ThreadArtifactConsumption {
  return {
    id: "consume-seed",
    artifactId: "seed-artifact",
    consumer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:arch",
    },
    observedFingerprint: fp("1"),
    verifiedAt: AT,
    status: "verified",
  };
}

async function historicalArchitectureArtifact(): Promise<ThreadArtifact> {
  const fingerprint = await sha256Fingerprint({ kind: "foreign-architecture" });
  return {
    id: `architecture-${fingerprint.digest}`,
    name: "Historical architecture",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://historical-architecture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:foreign-arch",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

async function structureArtifact(
  architecture: ThreadArtifact,
  salt: string,
): Promise<ThreadArtifact> {
  const fingerprint = await sha256Fingerprint({
    kind: "structure",
    salt,
    architecture: architecture.fingerprint.digest,
  });
  return {
    id: `part-definitions-${fingerprint.digest}`,
    name: "Part definitions",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: `run:structure-${salt}`,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

async function sealLeaf(options: {
  readonly artifacts: ThreadArtifact[];
  readonly consumptions: ThreadArtifactConsumption[];
  readonly provenance: ThreadProvenanceLink[];
  readonly store: Map<string, string>;
  readonly architecture: ThreadArtifact;
  readonly target: { readonly partDefinitionElementId: string; readonly label: string };
  readonly runId: string;
}): Promise<{ readonly primary: ThreadArtifact; readonly step: ThreadArtifact }> {
  const script = [
    "from build123d import Box",
    "side = 2",
    "result = Box(side, side, side)",
    "",
  ].join("\n");
  const scriptHash = await textFingerprint(script);
  const stepFingerprint = await sha256Fingerprint({ step: options.runId });
  const draftDigest = (await sha256Fingerprint({ draft: options.runId })).digest;
  const previewProducer = {
    serverId: "build123d-sandbox" as const,
    tool: "build123d_export" as const,
    runId: `${options.runId}.preview`,
  };
  const capture = {
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: options.runId,
    draftDigest,
    manifest: {
      schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: SNAPSHOT_ID,
        revision: 1,
        artifactFingerprint: options.architecture.fingerprint,
      },
      target: {
        partDefinitionElementId: options.target.partDefinitionElementId,
        label: options.target.label,
        scriptHash,
        files: [{
          format: "step" as const,
          name: `${options.target.label}.step`,
          fingerprint: stepFingerprint,
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
    previewProducer,
    sourceScript: {
      partDefinitionElementId: options.target.partDefinitionElementId,
      label: options.target.label,
      script,
      scriptHash,
      admission: {
        schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
        artifactId: `technical-compilation-admission-${"d".repeat(64)}`,
        fingerprint: fp("d"),
        sourceFingerprint: scriptHash,
        target: options.target,
      },
      authoritativeStep: {
        fileIndex: 0,
        fingerprint: stepFingerprint,
        bytes: 48,
      },
    },
    sourceAnalysis: {
      sourceId: `cad-part-definition:${
        (await textFingerprint(options.target.partDefinitionElementId)).digest
      }`,
      selector: {
        kind: "part-definition" as const,
        elementId: options.target.partDefinitionElementId,
      },
      sourceFingerprint: scriptHash,
      sourceCaptureFingerprint: fp("e"),
      analysisFingerprint: fp("f"),
    },
    sealedAt: AT,
  };
  const captureFingerprint = await sha256Fingerprint(capture);
  const primary: ThreadArtifact = {
    id: `geometry-${captureFingerprint.digest}`,
    name: `Canonical PartDefinition geometry: ${options.target.label}`,
    kind: "cad-model",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: options.runId,
    },
    inputArtifactIds: [options.architecture.id],
    freshness: fresh(),
  };
  const step: ThreadArtifact = {
    id: `cad-asset-${captureFingerprint.digest}-target-0-${stepFingerprint.digest}`,
    name: `Authoritative STEP: ${options.target.label}`,
    kind: "step",
    version: stepFingerprint.digest,
    fingerprint: stepFingerprint,
    uri: `/api/thread/assets/${stepFingerprint.digest}.step`,
    mediaType: "model/step",
    producer: previewProducer,
    inputArtifactIds: [],
    freshness: fresh(),
  };
  options.store.set(captureFingerprint.digest, deterministicJson(capture));
  options.artifacts.push(primary, step);
  addArchitectureAttestation(
    options.consumptions,
    options.provenance,
    primary,
    options.architecture,
  );
  const consumptionId = `consume-${primary.id}-by-${step.id}`;
  options.consumptions.push({
    id: consumptionId,
    artifactId: primary.id,
    consumer: primary.producer,
    observedFingerprint: primary.fingerprint,
    verifiedAt: AT,
    status: "verified",
  });
  options.provenance.push({
    id: `traces-${step.id}-from-${primary.id}`,
    relation: "traces_to",
    from: { kind: "artifact", id: step.id },
    to: { kind: "artifact", id: primary.id },
    rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
  }, {
    id: `uses-${consumptionId}`,
    relation: "uses",
    from: { kind: "consumption", id: consumptionId },
    to: { kind: "artifact", id: primary.id },
    rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  });
  return { primary, step };
}

function leafChild(
  usageElementId: string,
  partDefinitionElementId: string,
  leaf: { readonly primary: ThreadArtifact; readonly step: ThreadArtifact },
): GeometryModuleChild {
  return childRow(
    usageElementId,
    partDefinitionElementId,
    GEOMETRY_PART_CAPTURE_SCHEMA,
    leaf.primary,
    leaf.step,
  );
}

function moduleChild(
  usageElementId: string,
  partDefinitionElementId: string,
  artifact: ThreadArtifact,
): GeometryModuleChild {
  return childRow(
    usageElementId,
    partDefinitionElementId,
    GEOMETRY_MODULE_CAPTURE_SCHEMA,
    artifact,
  );
}

function childRow(
  usageElementId: string,
  partDefinitionElementId: string,
  schemaVersion:
    | typeof GEOMETRY_PART_CAPTURE_SCHEMA
    | typeof GEOMETRY_MODULE_CAPTURE_SCHEMA,
  artifact: ThreadArtifact,
  authoritativeStep: ThreadArtifact = artifact,
): GeometryModuleChild {
  return {
    usageElementId,
    partDefinitionElementId,
    placement: { translationMm: [1, 0, 0], rotationDeg: [0, 90, 0] },
    placementCapture: fp("b"),
    childGeometry: {
      schemaVersion,
      artifactId: artifact.id,
      fingerprint: artifact.fingerprint,
    },
    authoritativeStep: {
      fingerprint: authoritativeStep.fingerprint,
      bytes: 32,
    },
  };
}

async function sealModule(options: {
  readonly artifacts: ThreadArtifact[];
  readonly consumptions: ThreadArtifactConsumption[];
  readonly provenance: ThreadProvenanceLink[];
  readonly store: Map<string, string>;
  readonly architecture: ThreadArtifact;
  readonly structure: ThreadArtifact;
  readonly target: { readonly partDefinitionElementId: string; readonly label: string };
  readonly children: readonly GeometryModuleChild[];
  readonly runId: string;
  readonly exactChildAttestations: boolean;
  readonly publishUri: boolean;
}): Promise<{ primary: ThreadArtifact; capture: GeometryModuleCapture }> {
  const children = [...options.children].toSorted((left, right) =>
    left.usageElementId < right.usageElementId
      ? -1
      : left.usageElementId > right.usageElementId
      ? 1
      : 0
  );
  const placement = await placementLocator(options.runId);
  for (const child of children) {
    (child as { placementCapture: ContentFingerprint }).placementCapture =
      placement.fingerprint;
  }
  const bundle = await sha256Fingerprint({ bundle: options.runId });
  const step = await sha256Fingerprint({ step: options.runId });
  const glb = await sha256Fingerprint({ glb: options.runId });
  const implementation = await sha256Fingerprint({ implementation: options.runId });
  const inputBundle = inputBundleIdentity(bundle, 64, children);
  const receipt = {
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
    capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
    runId: `${options.runId}.assembly`,
    inputBundle: { fingerprint: bundle, byteCount: 64 },
    assembly: {
      step: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
        fingerprint: step,
        byteCount: 48,
      },
      glb: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
        fingerprint: glb,
        byteCount: 24,
      },
    },
    implementation: {
      id: "fixture-neutral-cad-assembler",
      version: "2026.1",
      evidenceFingerprint: implementation,
    },
  };
  const draftDigest = (await sha256Fingerprint({ draft: options.runId })).digest;
  const architectureFp = options.architecture.fingerprint;
  const unsigned = {
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: options.runId,
    draftDigest,
    manifest: {
      schemaVersion: GEOMETRY_MODULE_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: SNAPSHOT_ID,
        revision: 1,
        artifactFingerprint: architectureFp,
      },
      structureCapture: {
        schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
        artifactId: options.structure.id,
        fingerprint: options.structure.fingerprint,
        uri:
          `${GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX}${options.structure.fingerprint.digest}`,
        byteCount: 512,
        architecture: {
          artifactId: options.architecture.id,
          fingerprint: architectureFp,
          uri:
            `${GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX}${architectureFp.digest}`,
        },
      },
      target: options.target,
      placementAnalysis: placement,
      children,
      unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
      placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
      assembly: {
        inputBundle,
        step: { fingerprint: step },
        glb: { fingerprint: glb },
      },
    },
    architectureBasis: {
      artifactId: options.architecture.id,
      fingerprint: architectureFp,
      producerRunId: options.architecture.producer.runId,
    },
    structureCapture: {
      schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
      artifactId: options.structure.id,
      fingerprint: options.structure.fingerprint,
      uri:
        `${GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX}${options.structure.fingerprint.digest}`,
      byteCount: 512,
      architecture: {
        artifactId: options.architecture.id,
        fingerprint: architectureFp,
        uri:
          `${GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX}${architectureFp.digest}`,
      },
    },
    placementAnalysis: placement,
    children,
    inputBundle,
    receipt,
    assemblyStep: { fingerprint: step, bytes: 48 },
    assemblyGlb: { fingerprint: glb, bytes: 24 },
    sealedAt: AT,
  };
  const capture = await parseGeometryModuleCapture(unsigned);
  const fingerprint = await sha256Fingerprint(capture);
  const primaryId = `geometry-${fingerprint.digest}`;
  const childPrimaryIds = [
    ...new Set(children.map((child) => child.childGeometry.artifactId)),
  ];
  const primary: ThreadArtifact = {
    id: primaryId,
    name: `Geometry: ${options.target.label}`,
    kind: "cad-model",
    version: fingerprint.digest,
    fingerprint,
    ...(options.publishUri
      ? {
        uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
        mediaType: "application/json",
      }
      : {}),
    producer: {
      serverId: "digital-thread",
      tool:
        `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
      runId: options.runId,
    },
    inputArtifactIds: geometryModulePrimaryInputIds({
      architectureId: options.architecture.id,
      structureId: options.structure.id,
      childPrimaryIds,
    }),
    freshness: fresh(),
  };
  options.store.set(fingerprint.digest, deterministicJson(capture));
  options.artifacts.push(primary);
  addArchitectureAttestation(
    options.consumptions,
    options.provenance,
    primary,
    options.architecture,
  );
  const structureAttestation = geometryModuleStructureAttestation({
    primaryId: primary.id,
    captureDigest: fingerprint.digest,
    structure: options.structure,
    sealProducer: primary.producer,
    capturedAt: AT,
  });
  options.consumptions.push(structureAttestation.consumption);
  options.provenance.push(...structureAttestation.provenance);
  const childArtifacts = childPrimaryIds.map((id) =>
    options.artifacts.find((artifact) => artifact.id === id)!
  );
  for (const child of childArtifacts) {
    addChildAttestation(
      options.consumptions,
      options.provenance,
      primary,
      child,
      options.exactChildAttestations,
    );
  }
  const binaries = geometryModuleAssemblyArtifacts({
    captureDigest: fingerprint.digest,
    primaryId: primary.id,
    manifest: capture.manifest,
    producer: geometryModuleBinaryProducer(capture.receipt),
    freshness: fresh(),
  });
  options.artifacts.push(...binaries);
  for (const binary of binaries) {
    addBinaryAttestation(options.consumptions, options.provenance, primary, binary);
  }
  return { primary, capture };
}

function addArchitectureAttestation(
  consumptions: ThreadArtifactConsumption[],
  provenance: ThreadProvenanceLink[],
  primary: ThreadArtifact,
  architecture: ThreadArtifact,
): void {
  const consumptionId = `consume-arch-${architecture.id}-by-${primary.id}`;
  consumptions.push({
    id: consumptionId,
    artifactId: architecture.id,
    consumer: primary.producer,
    observedFingerprint: architecture.fingerprint,
    verifiedAt: AT,
    status: "verified",
  });
  provenance.push({
    id: `derived-from-architecture-${primary.fingerprint.digest}`,
    relation: "derived_from",
    from: { kind: "artifact", id: primary.id },
    to: { kind: "artifact", id: architecture.id },
    rationale: GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
  }, {
    id: `uses-${consumptionId}`,
    relation: "uses",
    from: { kind: "consumption", id: consumptionId },
    to: { kind: "artifact", id: architecture.id },
    rationale: GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
  });
}

function addChildAttestation(
  consumptions: ThreadArtifactConsumption[],
  provenance: ThreadProvenanceLink[],
  primary: ThreadArtifact,
  child: ThreadArtifact,
  exact: boolean,
): void {
  const consumptionId = exact
    ? `consume-child-${child.id}-by-${primary.id}`
    : `consume-${child.id}-by-${primary.id}`;
  consumptions.push({
    id: consumptionId,
    artifactId: child.id,
    consumer: primary.producer,
    observedFingerprint: child.fingerprint,
    verifiedAt: AT,
    status: "verified",
  });
  provenance.push({
    id: exact
      ? `derived-from-child-${primary.fingerprint.digest}-${child.fingerprint.digest}`
      : `derived-from-${primary.id}-${child.id}`,
    relation: "derived_from",
    from: { kind: "artifact", id: primary.id },
    to: { kind: "artifact", id: child.id },
    rationale: exact
      ? GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE
      : "Generic child derivation.",
  }, {
    id: `uses-${consumptionId}`,
    relation: "uses",
    from: { kind: "consumption", id: consumptionId },
    to: { kind: "artifact", id: child.id },
    rationale: exact ? GEOMETRY_MODULE_CHILD_USE_RATIONALE : "Generic child use.",
  });
}

function addBinaryAttestation(
  consumptions: ThreadArtifactConsumption[],
  provenance: ThreadProvenanceLink[],
  primary: ThreadArtifact,
  binary: ThreadArtifact,
): void {
  const consumptionId = `consume-${primary.id}-by-${binary.id}`;
  consumptions.push({
    id: consumptionId,
    artifactId: primary.id,
    consumer: binary.producer,
    observedFingerprint: primary.fingerprint,
    verifiedAt: AT,
    status: "verified",
  });
  provenance.push({
    id: `traces-${binary.id}-from-${primary.id}`,
    relation: "traces_to",
    from: { kind: "artifact", id: binary.id },
    to: { kind: "artifact", id: primary.id },
    rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
  }, {
    id: `uses-${consumptionId}`,
    relation: "uses",
    from: { kind: "consumption", id: consumptionId },
    to: { kind: "artifact", id: primary.id },
    rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  }, {
    id: `derived-from-module-primary-${binary.id}`,
    relation: "derived_from",
    from: { kind: "artifact", id: binary.id },
    to: { kind: "artifact", id: primary.id },
    rationale: GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
  });
}

function inputBundleIdentity(
  fingerprint: ContentFingerprint,
  byteCount: number,
  children: readonly GeometryModuleChild[],
) {
  let offset = 0;
  const occurrences = children.map((row) => {
    const occurrence = {
      usageElementId: row.usageElementId,
      partDefinitionElementId: row.partDefinitionElementId,
      placement: row.placement,
      childCapture: row.childGeometry,
      step: {
        mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
        byteOffset: offset,
        byteCount: row.authoritativeStep.bytes,
        sha256: row.authoritativeStep.fingerprint.digest,
      },
    };
    offset += row.authoritativeStep.bytes;
    return occurrence;
  });
  return {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint,
    byteCount,
    manifest: validateGeometryModuleInputBundleManifest({
      schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
      unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
      placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
      occurrences,
    }),
  };
}

async function placementLocator(runId: string) {
  const fingerprint = await sha256Fingerprint({ placement: runId });
  return {
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint,
    byteCount: 64,
    casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${fingerprint.digest}`,
  };
}

function finishSnapshot(
  artifacts: readonly ThreadArtifact[],
  consumptions: readonly ThreadArtifactConsumption[],
  provenance: readonly ThreadProvenanceLink[],
  changes: ThreadSnapshot["changeSet"]["changes"],
  archFp: ContentFingerprint,
): ThreadSnapshot {
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: SNAPSHOT_ID,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Airframe hierarchy fixture",
      kind: "system",
      version: archFp.digest,
      modelArtifactId: "seed-artifact",
    },
    freshness: fresh(),
    changeSet: {
      id: "changeset-r1",
      name: "architecture and geometry",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  });
}

async function cadSession(
  artifactId: string,
  salt: string,
): Promise<ThreadViewerSession> {
  const payload = {
    schemaVersion: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
    kind: "recorded-canonical-geometry",
    projection: { artifactId, salt },
  };
  const fingerprint = await sha256Fingerprint(payload);
  const identity = await sha256Fingerprint({ artifactId, salt });
  return {
    id: `mcp-app:${identity.digest}`,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: artifactId },
    app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
    manifest: {
      uri: "ui://mcp-build123d/app-manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-build123d/results-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 321,
    },
    launchUri: "/viewer-apps/build123d/session-a",
    readResources: [{
      uri: `/api/thread/viewer-apps/resources/${"c".repeat(64)}`,
      mimeType: "model/gltf-binary",
      bytes: 123,
      fingerprint: `sha256:${"c".repeat(64)}`,
    }],
    session: {
      action: "viewer.session.apply",
      schema: payload.schemaVersion,
      payload,
      fingerprint: `${fingerprint.algorithm}:${fingerprint.digest}`,
    },
  };
}

function fp(char: string): ContentFingerprint {
  return { algorithm: "sha256", digest: char.repeat(64) };
}

async function textFingerprint(text: string): Promise<ContentFingerprint> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}
