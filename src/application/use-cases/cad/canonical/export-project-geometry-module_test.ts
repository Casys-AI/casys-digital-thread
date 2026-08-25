import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { IsolatedCodeExecutionRequest } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  validateIsolatedCodeExecutionRequest,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "../../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
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
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import { GEOMETRY_PART_MANIFEST_SCHEMA } from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
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
    assertEquals(harness.runner.requests.length, 1);
    const request = harness.runner.requests[0]!;
    assertEquals(
      request.profile.id,
      GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id,
    );
    assertEquals(
      request.profile.version,
      GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version,
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
    );
    harness.geometryCaptures.captures.set(
      extraCapture.fingerprint.digest,
      extraCapture.text,
    );
    harness.snapshots.artifacts = [
      ...harness.snapshots.artifacts,
      geometryArtifact(extraCapture.fingerprint),
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

Deno.test("geometry-module export fails when isolated assembly is rejected", async () => {
  await withHarness(async (harness) => {
    harness.runner.failure = new Error("isolated assembler rejected");
    await assertCode(harness, "isolated_failure");
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
  readonly runner: FakeRunner;
  readonly draftStore: FakeDraftStore;
  readonly armStepDigest: string;
  readonly baseStepDigest: string;
}

async function createHarness(): Promise<Harness> {
  const armStepDigest = await fingerprintResourceBytes(ARM_STEP);
  const baseStepDigest = await fingerprintResourceBytes(BASE_STEP);
  const glbDigest = "c".repeat(64);
  const placementDigest = "b".repeat(64);
  const armCapture = await partCapture(ARM, "Arm", armStepDigest, glbDigest);
  const baseCapture = await partCapture(BASE, "Base", baseStepDigest, glbDigest);
  const structure = await storedJson({
    schemaVersion: "part-definitions-capture/1.0",
  });
  const projects = new FakeProjects();
  const snapshots = new FakeSnapshots([
    structureArtifact(structure.fingerprint, ARCH_ID),
    geometryArtifact(armCapture.fingerprint),
    geometryArtifact(baseCapture.fingerprint),
  ]);
  const placements = new FakePlacements(placementLocator(placementDigest));
  const geometryCaptures = new FakeGeometryCaptures();
  geometryCaptures.captures.set(armCapture.fingerprint.digest, armCapture.text);
  geometryCaptures.captures.set(baseCapture.fingerprint.digest, baseCapture.text);
  const partDefinitions = new FakeTextStore();
  partDefinitions.captures.set(structure.fingerprint.digest, structure.text);
  const stepAssets = new FakeStepAssets();
  stepAssets.bytes.set(armStepDigest, ARM_STEP);
  stepAssets.bytes.set(baseStepDigest, BASE_STEP);
  const runner = new FakeRunner();
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
    profiles: {
      initial: () =>
        Promise.resolve({
          executionProfile: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
          isolationPolicy: {
            id: "isolation.geometry-module-assembly-v1",
            version: "1.0.0",
            fingerprint: fp("a".repeat(64)),
          },
          outputManifest: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
        } as never),
      resolve: () => Promise.reject(new Error("not used")),
    },
    runner,
    draftStore,
    draftAssets,
    now: () => "2026-08-25T10:00:00.000Z",
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
    runner,
    draftStore,
    armStepDigest,
    baseStepDigest,
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

class FakeTextStore {
  readonly captures = new Map<string, string>();

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return Promise.resolve(this.captures.get(fingerprint.digest));
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

class FakeRunner {
  readonly requests: IsolatedCodeExecutionRequest[] = [];
  failure?: Error;

  async run(request: IsolatedCodeExecutionRequest) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    const stepDigest = await fingerprintResourceBytes(ASSEMBLY_STEP);
    const glbDigest = await fingerprintResourceBytes(ASSEMBLY_GLB);
    const validated = await validateIsolatedCodeExecutionRequest(request);
    const outputs = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.map((declaration) => ({
      ...declaration,
      bytes: declaration.role === "assembly.step" ? ASSEMBLY_STEP : ASSEMBLY_GLB,
      sha256: declaration.role === "assembly.step" ? stepDigest : glbDigest,
    }));
    const publicationMembers = outputs.map((output) => ({
      role: output.role,
      basename: output.basename,
      mediaType: output.mediaType,
      format: output.format,
      byteCount: output.bytes.byteLength,
      sha256: output.sha256,
      casUri: `casys://isolated-output/sha256/${output.sha256}`,
    }));
    return await createIsolatedCodeExecutionReceipt({
      request: validated,
      runtime: {
        isolationClass: "kernel-isolated",
        imageDigest: fp("a".repeat(64)),
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
        runId: request.runId,
        proofFingerprint: fp("e".repeat(64)),
      },
      publication: await createIsolatedOutputPublicationRef(
        request.runId,
        0,
        await fingerprintIsolatedOutputPublicationManifest(
          request.runId,
          0,
          publicationMembers,
        ),
      ),
    });
  }
}

class FakeDraftStore {
  saveCalls = 0;
  readCalls = 0;
  lastUnsigned?: {
    readonly children: readonly {
      readonly usageElementId: string;
      readonly authoritativeStep: { readonly fingerprint: ContentFingerprint };
    }[];
    readonly inputBundle: {
      readonly manifest: {
        readonly occurrences: readonly { readonly usageElementId: string }[];
      };
    };
  };
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
  async persist(bytes: Uint8Array) {
    const digest = await fingerprintResourceBytes(bytes);
    return {
      fingerprint: fp(digest),
      byteCount: bytes.byteLength,
    };
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

function geometryArtifact(fingerprint: ContentFingerprint) {
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
      runId: "run.2",
    },
    inputArtifactIds: [ARCH_ID],
    freshness: {
      status: "fresh" as const,
      changedAt: "2026-08-25T10:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

async function partCapture(
  targetId: string,
  label: string,
  stepDigest: string,
  glbDigest: string,
) {
  return await storedJson({
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
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
        scriptHash: fp("d".repeat(64)),
        files: [
          { format: "step", name: "part.step", fingerprint: fp(stepDigest) },
          { format: "gltf", name: "part.glb", fingerprint: fp(glbDigest) },
        ],
      },
      unitSystem: "mm",
      exportFormats: ["step", "gltf"],
    },
  });
}

async function storedJson(value: unknown) {
  const text = deterministicJson(value);
  const fingerprint = await sha256Fingerprint(JSON.parse(text));
  return { text, fingerprint };
}
