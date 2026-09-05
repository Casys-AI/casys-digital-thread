import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_ASSETS,
  GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
} from "../../../../domain/cad/module-assembly/geometry-module-assembly-receipt.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../../../domain/capability/engineering-capability.ts";
import type { GeometryModuleAssembler } from "../../../ports/out/cad/module-assembly/geometry-module-assembler.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
} from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import { CadPlacementAnalysisCaptureStoreError } from "../../../ports/out/cad/placement/cad-placement-analysis-capture-store.ts";
import {
  type GeometryModuleDraftCapture,
  parseGeometryModuleDecisionParameters,
} from "../../../../domain/cad/canonical/geometry-module-evidence.ts";
import type { CadPlacementAnalysisDocument } from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import { GEOMETRY_MODULE_CAPTURE_SCHEMA } from "../../../../domain/cad/canonical/geometry-module-evidence.ts";
import { geometrySourceIdFor } from "../../../../domain/cad/source/geometry-source-analysis-reference.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import { GEOMETRY_PART_MANIFEST_SCHEMA } from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  fingerprintResourceBytes,
  immutableBytes,
} from "../../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { OpenedProductStructure } from "../../../ports/out/product-navigation/product-structure-traversal.ts";
import type { CadPlacementArchitectureFacts } from "../../../../domain/cad/placement/cad-placement-coverage.ts";
import {
  ExportProjectGeometryModule,
  ProjectGeometryModuleExportError,
} from "./export-project-geometry-module.ts";

const PROJECT = "project.module";
const SNAPSHOT = "snapshot.12";
const SUBJECT = "subject.module";
const TARGET = "sysml.part.assembly";
const ARM = "sysml.part.arm";
const BASE = "sysml.part.base";
const USAGE_ARM = "sysml.usage.arm";
const USAGE_BASE = "sysml.usage.base";
const ARCH_DIGEST = "a".repeat(64);
const ARCH_ID = `architecture-${ARCH_DIGEST}`;
const encoder = new TextEncoder();
const ARM_STEP = encoder.encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=ARM;\nENDSEC;\nEND-ISO-10303-21;\n",
);
const BASE_STEP = encoder.encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=BASE;\nENDSEC;\nEND-ISO-10303-21;\n",
);
const TARGET_STEP = encoder.encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=TARGET;\nENDSEC;\nEND-ISO-10303-21;\n",
);
const ASSEMBLY_STEP = encoder.encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=ASSEMBLY;\nENDSEC;\nEND-ISO-10303-21;\n",
);
const ASSEMBLY_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function basis(revision = 12) {
  return {
    kind: "thread-snapshot" as const,
    snapshotId: SNAPSHOT,
    revision,
    subjectId: SUBJECT,
  };
}

function placementLocator(digest: string) {
  return {
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint: fp(digest),
    byteCount: 64,
    casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${digest}`,
  };
}

async function withHarness(
  run: (harness: Harness) => Promise<void>,
  mutate?: (harness: Harness) => void,
): Promise<void> {
  const harness = await createHarness();
  mutate?.(harness);
  await run(harness);
}

Deno.test("geometry-module export recrosses exact child bytes, saves a reread draft, and writes no Thread state", async () => {
  await withHarness(async (harness) => {
    const result = await harness.service.execute(harness.command);
    assertEquals(result.grants, "none");
    assertEquals(result.target.partDefinitionElementId, TARGET);
    assertEquals(result.target.label, "Assembly");
    assertEquals(result.target.files.map((file) => file.name), [
      "assembly.step",
      "assembly.glb",
    ]);
    const armCall = harness.stepAssets.calls.find((digest) =>
      digest === harness.armStepDigest
    );
    const baseCall = harness.stepAssets.calls.find((digest) =>
      digest === harness.baseStepDigest
    );
    assertEquals(armCall, harness.armStepDigest);
    assertEquals(baseCall, harness.baseStepDigest);
    assertEquals(harness.assembler.calls.length, 1);
    assertEquals(
      harness.draftStore.lastUnsigned?.receipt.implementation.id,
      "fixture-neutral-cad-assembler",
    );
    assertEquals(
      harness.draftStore.lastUnsigned?.receipt.capability,
      GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
    );
    const occurrences = harness.draftStore.lastUnsigned?.children.map((child) =>
      child.usageElementId
    );
    assertEquals(occurrences, [USAGE_ARM, USAGE_BASE]);
    assertEquals(
      harness.draftStore.lastUnsigned?.inputBundle.manifest.occurrences.map(
        (item) => item.usageElementId,
      ),
      [USAGE_ARM, USAGE_BASE],
    );
    assertEquals(
      harness.draftStore.lastUnsigned?.children[0]?.authoritativeStep.fingerprint
        .digest,
      harness.armStepDigest,
    );
    assertEquals(
      harness.draftStore.lastUnsigned?.children[1]?.authoritativeStep.fingerprint
        .digest,
      harness.baseStepDigest,
    );
    assertEquals(harness.draftStore.saveCalls, 1);
    assertEquals(harness.draftStore.readCalls, 1);
    const parsed = parseGeometryModuleDecisionParameters(
      new Map(result.decisionParameters.map((item) => [item.key, item.value])),
    );
    assertEquals(parsed.draftDigest, result.draftDigest);
    assertEquals(parsed.manifest.target.partDefinitionElementId, TARGET);
    assertEquals(harness.snapshots.saveCalls, 0);
    assertEquals(harness.snapshots.artifacts.length, 3);
  });
});

Deno.test("geometry-module export refuses an extra public field", async () => {
  await withHarness(async (harness) => {
    await assertRejects(
      () =>
        harness.service.execute({
          ...harness.command,
          workspaceRevision: 3,
        }),
      ProjectGeometryModuleExportError,
      "exact validation",
    );
  });
});

Deno.test("geometry-module export treats a provider PartDefinition id as opaque", async () => {
  await withHarness(async (harness) => {
    const error = await assertRejects(
      () =>
        harness.service.execute({
          ...harness.command,
          partDefinitionElementId: "https://syson.example/elements#assembly/1",
        }),
      ProjectGeometryModuleExportError,
    );
    assertEquals(error.code, "unavailable");
  });
});

Deno.test("geometry-module export proposes the unique active same-target leaf as predecessor", async () => {
  await withHarness(async (harness) => {
    const targetStepDigest = await fingerprintResourceBytes(TARGET_STEP);
    const targetCapture = await partCapture(
      TARGET,
      "Assembly leaf",
      targetStepDigest,
      "7".repeat(64),
      {
        trustedRunId: "run.geometry.assembly-leaf",
        stepBytes: TARGET_STEP.byteLength,
      },
    );
    harness.geometryCaptures.captures.set(
      targetCapture.fingerprint.digest,
      targetCapture.text,
    );
    harness.stepAssets.bytes.set(targetStepDigest, TARGET_STEP);
    harness.snapshots.artifacts = [
      ...harness.snapshots.artifacts,
      geometryArtifact(
        targetCapture.fingerprint,
        "run.geometry.assembly-leaf",
      ),
    ];
    harness.snapshots.sync();

    await harness.service.execute(harness.command);

    assertEquals(harness.draftStore.lastUnsigned?.predecessor, {
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: `geometry-${targetCapture.fingerprint.digest}`,
      fingerprint: targetCapture.fingerprint,
      partDefinitionElementId: TARGET,
    });
  });
});

Deno.test("geometry-module export fails when the current Thread tip is not the command basis", async () => {
  await withHarness(async (harness) => {
    harness.projects.project = {
      project: { id: PROJECT },
      threadSnapshots: [basis(13)],
    } as unknown as EngineeringProjectSnapshot;
    await assertCode(harness, "basis_mismatch");
  });
});

Deno.test("geometry-module export fails when placement owner or Thread basis is foreign", async () => {
  await withHarness(async (harness) => {
    harness.placements.document.owner.elementId = "sysml.part.other";
    await assertCode(harness, "unresolved");
  });
  await withHarness(async (harness) => {
    harness.placements.document.declaredAgainst.thread.revision = 11;
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails when placement coverage is missing or extra", async () => {
  await withHarness(async (harness) => {
    harness.placements.document.placements = [
      harness.placements.document.placements[0]!,
    ];
    await assertCode(harness, "unresolved");
  });
  await withHarness(async (harness) => {
    harness.placements.document.placements = [
      ...harness.placements.document.placements,
      {
        usageElementId: "sysml.usage.extra",
        partDefinitionElementId: ARM,
        placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      },
    ];
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails when a child capture is missing or ambiguous", async () => {
  await withHarness(async (harness) => {
    harness.snapshots.artifacts = harness.snapshots.artifacts
      .filter((artifact) => !artifact.id.startsWith("geometry-"));
    harness.snapshots.sync();
    await assertCode(harness, "unavailable");
  });
  await withHarness(async (harness) => {
    const extraCapture = await partCapture(
      ARM,
      "Arm-alt",
      harness.armStepDigest,
      "8".repeat(64),
      { trustedRunId: "run.geometry.arm-alt", stepBytes: ARM_STEP.byteLength },
    );
    harness.geometryCaptures.captures.set(
      extraCapture.fingerprint.digest,
      extraCapture.text,
    );
    harness.snapshots.artifacts = [
      ...harness.snapshots.artifacts,
      geometryArtifact(extraCapture.fingerprint, "run.geometry.arm-alt"),
    ];
    harness.snapshots.sync();
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails when a child STEP digest does not match reopened bytes", async () => {
  await withHarness(async (harness) => {
    harness.stepAssets.bytes.set(harness.armStepDigest, BASE_STEP);
    await assertCode(harness, "asset_digest_mismatch");
  });
});

Deno.test("geometry-module export fails when a child STEP byteCount does not match reopened bytes", async () => {
  await withHarness(async (harness) => {
    const corrupt = await partCapture(
      ARM,
      "Arm",
      harness.armStepDigest,
      "c".repeat(64),
      {
        trustedRunId: harness.armRunId,
        stepBytes: ARM_STEP.byteLength + 1,
      },
    );
    harness.geometryCaptures.captures.delete(harness.armCaptureDigest);
    harness.geometryCaptures.captures.set(corrupt.fingerprint.digest, corrupt.text);
    harness.snapshots.artifacts = harness.snapshots.artifacts.map((artifact) =>
      artifact.fingerprint.digest === harness.armCaptureDigest
        ? geometryArtifact(corrupt.fingerprint, harness.armRunId)
        : artifact
    );
    harness.snapshots.sync();
    await assertCode(harness, "asset_digest_mismatch");
  });
});

Deno.test("geometry-module export fails when a child geometry producer is not digital-thread design.write-geometry@1", async () => {
  await withHarness(async (harness) => {
    harness.snapshots.artifacts = harness.snapshots.artifacts.map((artifact) =>
      artifact.fingerprint.digest === harness.armCaptureDigest
        ? {
          ...artifact,
          producer: {
            serverId: "build123d-sandbox",
            tool: "build123d_export",
            runId: harness.armRunId,
          },
        }
        : artifact
    );
    harness.snapshots.sync();
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails closed when an exact-family module capture is corrupt", async () => {
  await withHarness(async (harness) => {
    const corrupt = await storedJson({
      schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    });
    harness.geometryCaptures.captures.set(corrupt.fingerprint.digest, corrupt.text);
    harness.snapshots.artifacts = [
      ...harness.snapshots.artifacts,
      geometryArtifact(corrupt.fingerprint, "run.geometry.corrupt"),
    ];
    harness.snapshots.sync();
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails closed on a near-canonical active primary identity", async () => {
  await withHarness(async (harness) => {
    harness.snapshots.artifacts = harness.snapshots.artifacts.map((artifact) =>
      artifact.fingerprint.digest === harness.armCaptureDigest
        ? { ...artifact, version: "foreign-version" }
        : artifact
    );
    harness.snapshots.sync();
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails when the structure capture URI is not the exact sha256 identity", async () => {
  await withHarness(async (harness) => {
    harness.snapshots.artifacts = harness.snapshots.artifacts.map((artifact) =>
      artifact.id.startsWith("part-definitions-")
        ? {
          ...artifact,
          uri: `casys://part-definitions-capture/${artifact.fingerprint.digest}`,
        }
        : artifact
    );
    harness.snapshots.sync();
    await assertCode(harness, "unresolved");
  });
});

Deno.test("geometry-module export fails when the neutral assembler rejects the bundle", async () => {
  await withHarness(async (harness) => {
    harness.assembler.failure = new Error("assembler rejected");
    await assertCode(harness, "assembly_failure");
  });
});

async function assertCode(
  harness: Harness,
  code: ProjectGeometryModuleExportError["code"],
): Promise<void> {
  const error = await assertRejects(
    () => harness.service.execute(harness.command),
    ProjectGeometryModuleExportError,
  );
  assertEquals(error.code, code);
}

interface Harness {
  readonly service: ExportProjectGeometryModule;
  readonly command: {
    readonly projectId: string;
    readonly basis: ReturnType<typeof basis>;
    readonly partDefinitionElementId: string;
    readonly placementAnalysis: ReturnType<typeof placementLocator>;
  };
  readonly projects: FakeProjects;
  readonly snapshots: FakeSnapshots;
  readonly placements: FakePlacements;
  readonly geometryCaptures: FakeGeometryCaptures;
  readonly stepAssets: FakeStepAssets;
  readonly assembler: FakeNeutralAssembler;
  readonly draftStore: FakeDraftStore;
  readonly armStepDigest: string;
  readonly baseStepDigest: string;
  readonly armCaptureDigest: string;
  readonly armRunId: string;
}

async function createHarness(): Promise<Harness> {
  const armStepDigest = await fingerprintResourceBytes(ARM_STEP);
  const baseStepDigest = await fingerprintResourceBytes(BASE_STEP);
  const glbDigest = "c".repeat(64);
  const placementDigest = "b".repeat(64);
  const armRunId = "run.geometry.arm";
  const baseRunId = "run.geometry.base";
  const armCapture = await partCapture(ARM, "Arm", armStepDigest, glbDigest, {
    trustedRunId: armRunId,
    stepBytes: ARM_STEP.byteLength,
  });
  const baseCapture = await partCapture(BASE, "Base", baseStepDigest, glbDigest, {
    trustedRunId: baseRunId,
    stepBytes: BASE_STEP.byteLength,
  });
  const structureFingerprint = fp("9".repeat(64));
  const projects = new FakeProjects();
  const snapshots = new FakeSnapshots([
    structureArtifact(structureFingerprint, ARCH_ID),
    geometryArtifact(armCapture.fingerprint, armRunId),
    geometryArtifact(baseCapture.fingerprint, baseRunId),
  ]);
  const placements = new FakePlacements(placementLocator(placementDigest));
  const geometryCaptures = new FakeGeometryCaptures();
  geometryCaptures.captures.set(armCapture.fingerprint.digest, armCapture.text);
  geometryCaptures.captures.set(baseCapture.fingerprint.digest, baseCapture.text);
  const partDefinitions = new FakeStructureReader();
  const stepAssets = new FakeStepAssets();
  stepAssets.bytes.set(armStepDigest, ARM_STEP);
  stepAssets.bytes.set(baseStepDigest, BASE_STEP);
  const assembler = new FakeNeutralAssembler();
  const draftStore = new FakeDraftStore();
  const draftAssets = new FakeDraftAssets();
  const service = new ExportProjectGeometryModule({
    projects,
    snapshots,
    traversal: {
      open: () => Promise.resolve(openedStructure()),
    },
    architectureIndex: {
      open: () => Promise.resolve(architectureFacts()),
    },
    partDefinitions,
    placements,
    geometryCaptures,
    stepAssets,
    assembler,
    draftStore,
    draftAssets,
  });
  return {
    service,
    command: {
      projectId: PROJECT,
      basis: basis(),
      partDefinitionElementId: TARGET,
      placementAnalysis: placementLocator(placementDigest),
    },
    projects,
    snapshots,
    placements,
    geometryCaptures,
    stepAssets,
    assembler,
    draftStore,
    armStepDigest,
    baseStepDigest,
    armCaptureDigest: armCapture.fingerprint.digest,
    armRunId,
  };
}

class FakeProjects {
  project: EngineeringProjectSnapshot = {
    project: { id: PROJECT },
    threadSnapshots: [basis()],
  } as unknown as EngineeringProjectSnapshot;

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(
      projectId === PROJECT ? this.project : undefined,
    );
  }
}

class FakeSnapshots {
  saveCalls = 0;
  artifacts: ThreadSnapshot["artifacts"];
  snapshot: ThreadSnapshot;

  constructor(artifacts: ThreadSnapshot["artifacts"]) {
    this.artifacts = [...artifacts];
    this.snapshot = this.#snapshot();
  }

  sync(): void {
    this.snapshot = this.#snapshot();
  }

  #snapshot(): ThreadSnapshot {
    return {
      id: SNAPSHOT,
      revision: 12,
      subject: { id: SUBJECT },
      artifacts: this.artifacts,
      changeSet: { changes: [] },
    } as unknown as ThreadSnapshot;
  }

  get(id: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(id === this.snapshot.id ? this.snapshot : undefined);
  }

  save(): Promise<void> {
    this.saveCalls += 1;
    return Promise.resolve();
  }
}

class FakePlacements {
  document: {
    owner: { elementKind: "PartDefinition"; elementId: string };
    declaredAgainst: {
      thread: {
        snapshotId: string;
        revision: number;
        subjectId: string;
      };
      architecture: {
        artifactId: string;
        fingerprint: ContentFingerprint;
      };
    };
    placements: {
      usageElementId: string;
      partDefinitionElementId: string;
      placement: {
        translationMm: readonly [number, number, number];
        rotationDeg: readonly [number, number, number];
      };
    }[];
  };
  readonly locator: ReturnType<typeof placementLocator>;

  constructor(locator: ReturnType<typeof placementLocator>) {
    this.locator = locator;
    this.document = {
      owner: { elementKind: "PartDefinition", elementId: TARGET },
      declaredAgainst: {
        thread: basis(),
        architecture: {
          artifactId: ARCH_ID,
          fingerprint: fp(ARCH_DIGEST),
        },
      },
      placements: [
        {
          usageElementId: USAGE_BASE,
          partDefinitionElementId: BASE,
          placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
        },
        {
          usageElementId: USAGE_ARM,
          partDefinitionElementId: ARM,
          placement: { translationMm: [10, 0, 0], rotationDeg: [0, 90, 0] },
        },
      ],
    };
  }

  reopenLocator(locator: ReturnType<typeof placementLocator>) {
    if (!fingerprintsEqual(locator.fingerprint, this.locator.fingerprint)) {
      return Promise.reject(
        new CadPlacementAnalysisCaptureStoreError(
          "capture_absent",
          "absent",
        ),
      );
    }
    return Promise.resolve({
      locator: this.locator,
      document: this.document as unknown as CadPlacementAnalysisDocument,
    });
  }

  persist() {
    return Promise.reject(new Error("not used"));
  }
}

class FakeGeometryCaptures {
  readonly captures = new Map<string, string>();

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return Promise.resolve(this.captures.get(fingerprint.digest));
  }
}

class FakeStructureReader {
  reopen(
    identity: {
      readonly artifactId: string;
      readonly fingerprint: ContentFingerprint;
      readonly uri: string;
    },
    architecture: {
      readonly artifactId: string;
      readonly fingerprint: ContentFingerprint;
    },
  ) {
    const digest = identity.fingerprint.digest;
    if (identity.uri !== `casys://part-definitions-capture/sha256/${digest}`) {
      return Promise.reject(new TypeError("structure URI is not exact"));
    }
    if (identity.artifactId !== `part-definitions-${digest}`) {
      return Promise.reject(new TypeError("structure id is not exact"));
    }
    if (
      architecture.artifactId !== ARCH_ID ||
      architecture.fingerprint.digest !== ARCH_DIGEST
    ) {
      return Promise.reject(new TypeError("architecture reference is not exact"));
    }
    return Promise.resolve({
      schemaVersion: "part-definitions-capture/1.0" as const,
      artifactId: identity.artifactId,
      fingerprint: identity.fingerprint,
      uri: identity.uri,
      byteCount: 512,
      architecture: {
        artifactId: architecture.artifactId,
        fingerprint: architecture.fingerprint,
        uri: `casys://architecture-capture/sha256/${architecture.fingerprint.digest}`,
      },
    });
  }
}

class FakeStepAssets {
  readonly bytes = new Map<string, Uint8Array>();
  readonly calls: string[] = [];

  read(digest: string): Promise<Uint8Array> {
    this.calls.push(digest);
    const value = this.bytes.get(digest);
    if (!value) throw new Error("not_found");
    return Promise.resolve(Uint8Array.from(value));
  }
}

class FakeNeutralAssembler implements GeometryModuleAssembler {
  readonly calls: Parameters<GeometryModuleAssembler["assemble"]>[0][] = [];
  failure?: Error;

  async assemble(command: Parameters<GeometryModuleAssembler["assemble"]>[0]) {
    this.calls.push(command);
    if (this.failure) throw this.failure;
    const stepDigest = await fingerprintResourceBytes(ASSEMBLY_STEP);
    const glbDigest = await fingerprintResourceBytes(ASSEMBLY_GLB);
    return {
      receipt: {
        schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
        capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
        runId: command.runId,
        inputBundle: {
          fingerprint: command.bundle.fingerprint,
          byteCount: command.bundle.bytes.byteLength,
        },
        assembly: {
          step: {
            ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
            fingerprint: fp(stepDigest),
            byteCount: ASSEMBLY_STEP.byteLength,
          },
          glb: {
            ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
            fingerprint: fp(glbDigest),
            byteCount: ASSEMBLY_GLB.byteLength,
          },
        },
        implementation: {
          id: "fixture-neutral-cad-assembler",
          version: "2026.1",
          evidenceFingerprint: fp("f".repeat(64)),
        },
      },
      assemblyStep: immutableBytes(ASSEMBLY_STEP),
      assemblyGlb: immutableBytes(ASSEMBLY_GLB),
    };
  }
}

class FakeDraftStore {
  saveCalls = 0;
  readCalls = 0;
  lastUnsigned?: Omit<GeometryModuleDraftCapture, "fingerprint">;
  saved?: GeometryModuleDraftCapture;

  async save(value: unknown) {
    this.saveCalls += 1;
    const { parseGeometryModuleDraftCapture } = await import(
      "../../../../domain/cad/canonical/geometry-module-evidence.ts"
    );
    const unsigned = await parseGeometryModuleDraftCapture(value);
    this.lastUnsigned = unsigned;
    const fingerprint = await sha256Fingerprint(unsigned);
    this.saved = { ...unsigned, fingerprint };
    return {
      draft: this.saved,
      fingerprint,
      uri: `casys://geometry-draft-capture/sha256/${fingerprint.digest}`,
    };
  }

  read(fingerprint: ContentFingerprint) {
    this.readCalls += 1;
    if (!this.saved || !fingerprintsEqual(this.saved.fingerprint, fingerprint)) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.saved);
  }
}

class FakeDraftAssets {
  readonly bytes = new Map<string, Uint8Array>();

  async persist(bytes: Uint8Array) {
    const digest = await fingerprintResourceBytes(bytes);
    this.bytes.set(digest, Uint8Array.from(bytes));
    return {
      fingerprint: fp(digest),
      byteCount: bytes.byteLength,
    };
  }

  read(fingerprint: ContentFingerprint) {
    const bytes = this.bytes.get(fingerprint.digest);
    return Promise.resolve(bytes === undefined ? undefined : immutableBytes(bytes));
  }
}

function openedStructure(): OpenedProductStructure {
  return {
    architectureArtifactId: ARCH_ID,
    architectureFingerprint: fp(ARCH_DIGEST),
    root: () => undefined,
    childrenOfRoot: () => [],
    childrenOf: () => [],
    path: () => undefined,
    neighborhood: () => ({ siblings: [], children: [] }),
    element: (id) =>
      id === TARGET
        ? {
          element: { elementKind: "PartDefinition", elementId: TARGET },
          label: "Assembly",
          expandable: true,
        }
        : undefined,
    searchElements: () => [],
    pageOccurrences: () => ({ items: [], nextOffset: null }),
    hasDefinition: (id) => id === TARGET || id === ARM || id === BASE,
    hasElement: () => true,
    typedDefinition: (usageId) =>
      usageId === USAGE_ARM
        ? { element: { elementKind: "PartDefinition", elementId: ARM }, label: "Arm" }
        : usageId === USAGE_BASE
        ? { element: { elementKind: "PartDefinition", elementId: BASE }, label: "Base" }
        : undefined,
  };
}

function architectureFacts(): CadPlacementArchitectureFacts {
  return {
    ownerDefinitionId: (usageId) =>
      usageId === USAGE_ARM || usageId === USAGE_BASE ? TARGET : undefined,
    immediateUsageIds: (definitionId) =>
      definitionId === TARGET ? [USAGE_BASE, USAGE_ARM] : [],
    typedDefinitionId: (usageId) =>
      usageId === USAGE_ARM ? ARM : usageId === USAGE_BASE ? BASE : undefined,
  };
}

function structureArtifact(
  fingerprint: ContentFingerprint,
  architectureId: string,
) {
  return {
    id: `part-definitions-${fingerprint.digest}`,
    name: "PartDefinition product structure",
    kind: "sysml-model" as const,
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://part-definitions-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_element_children", runId: "run.1" },
    inputArtifactIds: [architectureId],
    freshness: {
      status: "fresh" as const,
      changedAt: "2026-08-25T10:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function geometryArtifact(fingerprint: ContentFingerprint, trustedRunId: string) {
  return {
    id: `geometry-${fingerprint.digest}`,
    name: "Child geometry",
    kind: "cad-model" as const,
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://geometry-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: trustedRunId,
    },
    inputArtifactIds: [ARCH_ID],
    freshness: {
      status: "fresh" as const,
      changedAt: "2026-08-25T10:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

const PART_SCRIPT = [
  "from build123d import Box",
  "width = 10",
  "result = Box(width, 2, 3)",
  "",
].join("\n");

async function partCapture(
  targetId: string,
  label: string,
  stepDigest: string,
  glbDigest: string,
  options: {
    readonly trustedRunId: string;
    readonly stepBytes: number;
  },
) {
  const scriptHash = fp(await sha256Hex(encoder.encode(PART_SCRIPT)));
  const admissionFingerprint = fp("e".repeat(64));
  const selector = { kind: "part-definition" as const, elementId: targetId };
  return await storedJson({
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: options.trustedRunId,
    draftDigest: "f".repeat(64),
    manifest: {
      schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
      architectureBasis: {
        snapshotId: SNAPSHOT,
        revision: 12,
        artifactFingerprint: fp(ARCH_DIGEST),
      },
      target: {
        partDefinitionElementId: targetId,
        label,
        scriptHash,
        files: [
          { format: "step", name: "part.step", fingerprint: fp(stepDigest) },
          { format: "gltf", name: "part.glb", fingerprint: fp(glbDigest) },
        ],
      },
      unitSystem: "mm",
      exportFormats: ["step", "gltf"],
    },
    architectureBasis: {
      artifactId: ARCH_ID,
      fingerprint: fp(ARCH_DIGEST),
      producerRunId: "run.architecture.12",
    },
    previewProducer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "run.preview",
    },
    sourceScript: {
      partDefinitionElementId: targetId,
      label,
      script: PART_SCRIPT,
      scriptHash,
      admission: {
        schemaVersion: "geometry-draft-admission/2.0",
        artifactId: `technical-compilation-admission-${admissionFingerprint.digest}`,
        fingerprint: admissionFingerprint,
        sourceFingerprint: scriptHash,
        target: { partDefinitionElementId: targetId, label },
      },
      authoritativeStep: {
        fileIndex: 0,
        fingerprint: fp(stepDigest),
        bytes: options.stepBytes,
      },
    },
    sourceAnalysis: {
      sourceId: await geometrySourceIdFor(selector),
      selector,
      sourceFingerprint: scriptHash,
      sourceCaptureFingerprint: fp("1".repeat(64)),
      analysisFingerprint: fp("2".repeat(64)),
    },
    sealedAt: "2026-08-25T10:00:00.000Z",
  });
}

async function storedJson(value: unknown) {
  const text = deterministicJson(value);
  const fingerprint = await sha256Fingerprint(JSON.parse(text));
  return { text, fingerprint };
}
