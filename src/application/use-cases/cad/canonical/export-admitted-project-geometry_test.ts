import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ProjectAdmittedGeometryExportCommand } from "../../../ports/in/cad/canonical/project-admitted-geometry-export.ts";
import type {
  AdmittedGeometryExportDraft,
  AdmittedGeometryExporter,
  AdmittedGeometryExportRequest,
  AdmittedGeometryTargetedPartExportDraft,
  AdmittedGeometryTargetedPartExportRequest,
} from "../../../ports/out/cad/canonical/admitted-geometry-exporter.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
} from "../../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  QualifiedBuild123dSourceAnalyzer,
} from "../../../../adapters/cad/source/qualified-build123d-source-analyzer.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  GEOMETRY_DRAFT_ADMISSION_SCHEMA,
  GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
} from "../../../../domain/cad/canonical/geometry-draft-admission.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  parseGeometryDecisionParameters,
} from "../../../../domain/cad/canonical/geometry-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { sampleAdmissionSourceWorkspaceFields } from "../../../../testing/technical-source-capture-test-support.ts";
import {
  CAPABILITY_RUNTIME_PREPARATION_UNAVAILABLE_PHASES,
  CapabilityRuntimePreparationUnavailableError,
} from "../../../control-plane/capability-runtime-preparation-session.ts";
import {
  type ArchitecturePartGraph,
  ExportAdmittedProjectGeometry,
  ProjectAdmittedGeometryExportError,
} from "./export-admitted-project-geometry.ts";
import {
  PrepareProjectAdmittedGeometryExportPreflight,
  ProjectAdmittedGeometryExportPreflightError,
} from "./prepare-project-admitted-geometry-export-preflight.ts";
import { FileAdmittedGeometryExportReplayCache } from "../../../../adapters/cad/canonical/file-admitted-geometry-export-replay-cache.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import {
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
} from "../../../../domain/cad/canonical/geometry-bundle.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_PART_MANIFEST_SCHEMA,
  parseGeometryPartDecisionParameters,
} from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import { parseGeometryModuleCapture } from "../../../../domain/cad/canonical/geometry-module-capture.ts";
import {
  GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX,
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
} from "../../../../domain/cad/canonical/geometry-module-evidence.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
} from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";

interface Harness {
  readonly service: ExportAdmittedProjectGeometry;
  readonly command: ProjectAdmittedGeometryExportCommand;
  readonly reopened: ReopenedTechnicalCompilationAdmission;
  readonly admittedSource: string;
  readonly reader: FakeAdmissionReader;
  readonly exporter: FakeExporter;
  readonly architecture: FakeArchitectureReader;
  readonly snapshots: FakeSnapshots;
  readonly geometryCaptures: FakeGeometryCaptureReader;
}

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  readonly calls: TechnicalCompilationAdmissionReadRequest[] = [];
  failure?: Error;
  missing = false;

  constructor(public result: ReopenedTechnicalCompilationAdmission) {}

  read(
    request: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    this.calls.push(structuredClone(request));
    if (this.failure) return Promise.reject(this.failure);
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve(structuredClone(this.result));
  }
}

class FakeArchitectureReader {
  failure?: Error;
  missing = false;
  graph: ArchitecturePartGraph = {
    partDefinitions: [{
      id: "sysml.part.box",
      label: "Box",
      usages: [],
    }],
  };

  read(): Promise<ArchitecturePartGraph | undefined> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve(structuredClone(this.graph));
  }
}

class FakeSnapshots {
  failure?: Error;
  snapshot: ThreadSnapshot = {
    id: "snapshot.8",
    revision: 8,
    subject: { id: "subject.box" },
    artifacts: [],
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;

  get(id: string): Promise<ThreadSnapshot | undefined> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(id === this.snapshot.id ? this.snapshot : undefined);
  }
}

class FakeGeometryCaptureReader {
  readonly captures = new Map<string, string>();
  readonly calls: string[] = [];

  read(fingerprint: { readonly digest: string }): Promise<string | undefined> {
    this.calls.push(fingerprint.digest);
    return Promise.resolve(this.captures.get(fingerprint.digest));
  }
}

class FakeExporter implements AdmittedGeometryExporter {
  readonly calls: AdmittedGeometryExportRequest[] = [];
  readonly targetedCalls: AdmittedGeometryTargetedPartExportRequest[] = [];
  failure?: Error;
  draft: AdmittedGeometryExportDraft = {
    draftDigest: "d".repeat(64),
    scriptHash: { algorithm: "sha256", digest: "e".repeat(64) },
    exportFormats: ["step", "gltf"],
    partExportFormats: ["step", "gltf"],
    assemblyFiles: [{
      format: "step",
      name: "geometry-preview-assembly",
      bytes: 2048,
      digest: "a".repeat(64),
    }, {
      format: "gltf",
      name: "geometry-preview-assembly",
      bytes: 1024,
      digest: "f".repeat(64),
    }],
    partMeshes: [],
    partDefinitions: [{
      elementId: "sysml.part.box",
      label: "Box",
      scriptHash: { algorithm: "sha256", digest: "e".repeat(64) },
      files: [{
        format: "step",
        name: "geometry-preview-definition-000",
        bytes: 2048,
        digest: "a".repeat(64),
      }, {
        format: "gltf",
        name: "geometry-preview-definition-000",
        bytes: 1024,
        digest: "f".repeat(64),
      }],
    }],
    sourceAnalysis: {
      sourceId: "geometry-source:assembly",
      selector: { kind: "assembly" },
      sourceDigest: "e".repeat(64),
      sourceCaptureDigest: "c".repeat(64),
      analysisDigest: "b".repeat(64),
    },
  };

  export(request: AdmittedGeometryExportRequest): Promise<AdmittedGeometryExportDraft> {
    this.calls.push(structuredClone(request));
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      ...structuredClone(this.draft),
      partDefinitions: [{
        ...this.draft.partDefinitions[0]!,
        elementId: request.representedPart.elementId,
        label: request.representedPart.label,
      }],
      ...(request.predecessor ? { predecessor: request.predecessor } : {}),
    });
  }

  exportTargetedPart(
    request: AdmittedGeometryTargetedPartExportRequest,
  ): Promise<AdmittedGeometryTargetedPartExportDraft> {
    this.targetedCalls.push(structuredClone(request));
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      draftDigest: "d".repeat(64),
      target: {
        partDefinitionElementId: request.target.partDefinitionElementId,
        label: request.target.label,
        scriptHash: { algorithm: "sha256", digest: "e".repeat(64) },
        files: [{
          format: "step",
          name: "geometry-part-preview",
          bytes: 2048,
          digest: "a".repeat(64),
        }, {
          format: "gltf",
          name: "geometry-part-preview",
          bytes: 1024,
          digest: "f".repeat(64),
        }],
      },
      ...(request.predecessor ? { predecessor: request.predecessor } : {}),
      sourceAnalysis: {
        sourceId:
          `geometry-source:part-definition:${request.target.partDefinitionElementId}`,
        selector: {
          kind: "part-definition",
          elementId: request.target.partDefinitionElementId,
        },
        sourceDigest: "e".repeat(64),
        sourceCaptureDigest: "c".repeat(64),
        analysisDigest: "b".repeat(64),
      },
    });
  }
}

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

Deno.test("admitted geometry export reopens one sealed source and never accepts caller Python", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute(fixture.command);
  const replay = parseGeometryDecisionParameters(
    new Map(result.decisionParameters.map((parameter) => [
      parameter.key,
      parameter.value,
    ])),
  );

  assertEquals(result.draftDigest, fixture.exporter.draft.draftDigest);
  assertEquals(result.assemblyFiles, fixture.exporter.draft.assemblyFiles);
  assertEquals(result.partMeshes, []);
  assertEquals(result.partDefinitions[0]?.elementId, "sysml.part.box");
  assertEquals(result.sourceAnalysis, fixture.exporter.draft.sourceAnalysis);
  assertEquals(replay.draftDigest, fixture.exporter.draft.draftDigest);
  assertEquals(replay.manifest.schemaVersion, GEOMETRY_BUNDLE_MANIFEST_SCHEMA);
  assertEquals(replay.manifest.architectureBasis, {
    snapshotId: fixture.command.basis.snapshotId,
    revision: fixture.command.basis.revision,
    artifactFingerprint: fixture.reopened.admission.basis.sysml.artifactFingerprint,
  });
  assertEquals(
    replay.manifest.schemaVersion === GEOMETRY_BUNDLE_MANIFEST_SCHEMA
      ? replay.manifest.components
      : undefined,
    [],
  );
  assertEquals(
    replay.manifest.schemaVersion === GEOMETRY_BUNDLE_MANIFEST_SCHEMA
      ? replay.manifest.exportFormats
      : undefined,
    ["step", "gltf"],
  );
  assertEquals(
    replay.manifest.schemaVersion === GEOMETRY_BUNDLE_MANIFEST_SCHEMA
      ? replay.manifest.partDefinitions[0]?.elementId
      : undefined,
    "sysml.part.box",
  );
  assertEquals(fixture.reader.calls, [fixture.command]);
  assertEquals(fixture.exporter.calls, [{
    script: fixture.admittedSource,
    architectureBasis: replay.manifest.architectureBasis,
    admission: {
      schemaVersion: GEOMETRY_DRAFT_ADMISSION_SCHEMA,
      artifactId: fixture.command.artifactId,
      fingerprint: fixture.command.artifactFingerprint,
      sourceFingerprint: fixture.reopened.admission.sources[0]!.sourceFingerprint,
    },
    representedPart: { elementId: "sysml.part.box", label: "Box" },
  }]);
  assertDeeplyFrozen(result);

  const serialized = deterministicJson(result);
  assertEquals(serialized.includes("from build123d import Box"), false);
  assertEquals(recursiveKeys(result).has("sourceText"), false);
  assertEquals(recursiveKeys(result).has("script"), false);
});

Deno.test("canonical geometry export reopens exact standalone-comment bytes from a 3.1.0 admission", async () => {
  const fixture = await harness({ standaloneComment: true });

  await fixture.service.execute(fixture.command);

  assertEquals(
    fixture.reopened.admission.sources[0]?.profileVersion,
    PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  );
  assertEquals(
    fixture.reopened.admission.sources[0]?.analyzer.version,
    QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  );
  assertEquals(fixture.exporter.calls[0]?.script, fixture.admittedSource);
  assertEquals(
    fixture.exporter.calls[0]?.script,
    "# physical provenance annotation\nfrom build123d import Box\nthickness = 2\nresult = Box(20, 10, thickness)\n",
  );
});

Deno.test("admitted geometry export is deterministic across exact reopens", async () => {
  const fixture = await harness();
  const first = await fixture.service.execute(structuredClone(fixture.command));
  const second = await fixture.service.execute(structuredClone(fixture.command));

  assertEquals(first, second);
  assertEquals(deterministicJson(first), deterministicJson(second));
  assertEquals(fixture.reader.calls.length, 2);
  assertEquals(fixture.exporter.calls.length, 2);
  assertEquals(fixture.exporter.calls[0], fixture.exporter.calls[1]);
});

Deno.test("a durable replay survives a new server composition without another preparation activation", async () => {
  const fixture = await harness();
  const root = await Deno.makeTempDir();
  try {
    const cache = new FileAdmittedGeometryExportReplayCache(`${root}/replay`);
    const state = { begins: 0, releases: 0, retains: 0, recordedReleases: 0 };
    const begunOperations: unknown[] = [];
    const project = {
      project: { id: fixture.command.projectId },
      threadSnapshots: [{
        snapshotId: fixture.command.basis.snapshotId,
        revision: fixture.command.basis.revision,
        subjectId: fixture.command.basis.subjectId,
      }],
    } as never;
    const preparation = {
      begin: ({ operation }: { readonly operation: unknown }) => {
        state.begins++;
        begunOperations.push(structuredClone(operation));
        return Promise.resolve({
          lease: { id: "lease:geometry" },
          releaseSuccess: () => {
            state.releases++;
            return Promise.resolve();
          },
          retainForRecovery: () => state.retains++,
        });
      },
      releaseRecorded: () => {
        state.recordedReleases++;
        return Promise.resolve();
      },
    } as never;
    const compose = () =>
      new ExportAdmittedProjectGeometry({
        admissions: fixture.reader,
        exporter: fixture.exporter,
        exporterFactory: () => fixture.exporter,
        projects: { get: () => Promise.resolve(project) },
        preparation,
        replayCache: new FileAdmittedGeometryExportReplayCache(`${root}/replay`),
        architecture: fixture.architecture,
        snapshots: fixture.snapshots,
        geometryCaptures: fixture.geometryCaptures,
      });

    const first = await compose().execute(fixture.command);
    const second = await compose().execute(fixture.command);

    assertEquals(second, first);
    assertEquals(state, {
      begins: 1,
      releases: 1,
      retains: 0,
      recordedReleases: 1,
    });
    assertEquals(begunOperations, [{
      ...DESIGN_WRITE_GEOMETRY_OPERATION,
      bindings: [],
    }]);
    assertEquals(fixture.exporter.calls.length, 1);
    assert((await cache.read(await replayKey(fixture.command))) !== undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a corrupt durable replay refuses before preparation instead of blindly redispatching", async () => {
  const fixture = await harness();
  const root = await Deno.makeTempDir();
  try {
    const key = await replayKey(fixture.command);
    await Deno.mkdir(`${root}/replay`, { recursive: true });
    await Deno.writeTextFile(`${root}/replay/${key.digest}.dispatching.json`, "{");
    let begins = 0;
    const service = new ExportAdmittedProjectGeometry({
      admissions: fixture.reader,
      exporter: fixture.exporter,
      exporterFactory: () => fixture.exporter,
      projects: {
        get: () =>
          Promise.resolve({
            project: { id: fixture.command.projectId },
            threadSnapshots: [{
              snapshotId: fixture.command.basis.snapshotId,
              revision: fixture.command.basis.revision,
              subjectId: fixture.command.basis.subjectId,
            }],
          } as never),
      },
      preparation: {
        begin: () => {
          begins++;
          return Promise.reject(new Error("must not activate"));
        },
      } as never,
      replayCache: new FileAdmittedGeometryExportReplayCache(`${root}/replay`),
      architecture: fixture.architecture,
      snapshots: fixture.snapshots,
      geometryCaptures: fixture.geometryCaptures,
    });

    await assertExportError(
      () => service.execute(fixture.command),
      "runtime_unavailable",
    );
    assertEquals(begins, 0);
    assertEquals(fixture.exporter.calls.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("admitted geometry export preserves only the safe preparation phase on runtime_unavailable", async () => {
  const fixture = await harness();
  assertEquals(
    [...CAPABILITY_RUNTIME_PREPARATION_UNAVAILABLE_PHASES],
    ["scope", "projection", "lease-recovery", "h1-preflight"],
  );
  for (const phase of CAPABILITY_RUNTIME_PREPARATION_UNAVAILABLE_PHASES) {
    const service = serviceWithPreparation(fixture, () =>
      Promise.reject(
        new CapabilityRuntimePreparationUnavailableError(
          `raw host cause at /var/run/docker.sock secret=super-secret-token ${phase}`,
          phase,
        ),
      ));
    const error = await assertExportError(
      () => service.execute(fixture.command),
      "runtime_unavailable",
    );
    assertEquals(
      error.message,
      `The server-owned Build123d preparation runtime is unavailable (${phase}).`,
    );
    assertEquals(error.cause, undefined);
    assertEquals(error.message.includes("/var/run/docker.sock"), false);
    assertEquals(error.message.includes("super-secret-token"), false);
    assertEquals(error.message.includes("raw host cause"), false);
  }
  assertEquals(fixture.exporter.calls.length, 0);
});

Deno.test("unknown preparation failures stay generic without leaking causes", async () => {
  const fixture = await harness();
  const service = serviceWithPreparation(
    fixture,
    () =>
      Promise.reject(
        new Error(
          "Cannot start mcp-build123d at /var/run/docker.sock endpoint http://127.0.0.1:2375 secret=super-secret-token",
        ),
      ),
  );
  const error = await assertExportError(
    () => service.execute(fixture.command),
    "runtime_unavailable",
  );
  assertEquals(
    error.message,
    "The server-owned Build123d preparation runtime is unavailable.",
  );
  assertEquals(error.cause, undefined);
  assertEquals(error.message.includes("/var/run/docker.sock"), false);
  assertEquals(error.message.includes("mcp-build123d"), false);
  assertEquals(error.message.includes("super-secret-token"), false);
  assertEquals(error.message.includes("("), false);
  assertEquals(fixture.exporter.calls.length, 0);
});

Deno.test("a generic replay-store failure is fail-closed before preparation or provider", async () => {
  const fixture = await harness();
  let begins = 0;
  const service = new ExportAdmittedProjectGeometry({
    admissions: fixture.reader,
    exporter: fixture.exporter,
    exporterFactory: () => fixture.exporter,
    projects: {
      get: () =>
        Promise.resolve({
          project: { id: fixture.command.projectId },
          threadSnapshots: [{
            snapshotId: fixture.command.basis.snapshotId,
            revision: fixture.command.basis.revision,
            subjectId: fixture.command.basis.subjectId,
          }],
        } as never),
    },
    preparation: {
      begin: () => {
        begins++;
        return Promise.reject(new Error("must not activate"));
      },
      releaseRecorded: () => Promise.resolve(),
    } as never,
    replayCache: {
      read: () => Promise.reject(new Error("disk I/O failed")),
      prepare: () => Promise.resolve(),
      dispatch: () => Promise.resolve(),
      save: () => Promise.resolve(),
    },
    architecture: fixture.architecture,
    snapshots: fixture.snapshots,
    geometryCaptures: fixture.geometryCaptures,
  });

  await assertExportError(
    () => service.execute(fixture.command),
    "runtime_unavailable",
  );
  assertEquals(begins, 0);
  assertEquals(fixture.exporter.calls.length, 0);
});

Deno.test("a durable dispatching record quarantines a non-idempotent Build123d retry before activation", async () => {
  const fixture = await harness();
  const root = await Deno.makeTempDir();
  try {
    const cache = new FileAdmittedGeometryExportReplayCache(`${root}/replay`);
    const key = await replayKey(fixture.command);
    await cache.prepare(key);
    await cache.dispatch(key);
    let begins = 0;
    const service = new ExportAdmittedProjectGeometry({
      admissions: fixture.reader,
      exporter: fixture.exporter,
      exporterFactory: () => fixture.exporter,
      projects: {
        get: () =>
          Promise.resolve({
            project: { id: fixture.command.projectId },
            threadSnapshots: [{
              snapshotId: fixture.command.basis.snapshotId,
              revision: fixture.command.basis.revision,
              subjectId: fixture.command.basis.subjectId,
            }],
          } as never),
      },
      preparation: {
        begin: () => {
          begins++;
          return Promise.reject(new Error("must not activate"));
        },
      } as never,
      replayCache: new FileAdmittedGeometryExportReplayCache(`${root}/replay`),
      architecture: fixture.architecture,
      snapshots: fixture.snapshots,
      geometryCaptures: fixture.geometryCaptures,
    });

    await assertExportError(
      () => service.execute(fixture.command),
      "runtime_unavailable",
    );
    assertEquals(begins, 0);
    assertEquals(fixture.exporter.calls.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("concurrent dispatch claims permit exactly one Build123d provider call", async () => {
  const root = await Deno.makeTempDir();
  try {
    const cache = new FileAdmittedGeometryExportReplayCache(`${root}/replay`);
    const key = { algorithm: "sha256" as const, digest: "7".repeat(64) };
    await cache.prepare(key);

    const claims = await Promise.allSettled([
      cache.dispatch(key),
      cache.dispatch(key),
    ]);
    let providerCalls = 0;
    for (const claim of claims) {
      if (claim.status === "fulfilled") providerCalls++;
    }

    assertEquals(providerCalls, 1);
    assertEquals(
      claims.filter((claim) => claim.status === "rejected").length,
      1,
    );
    await assertRejects(
      () => cache.read(key),
      Error,
      "may have dispatched",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unknown caller fields and non-derived artifact ids perform no outward I/O", async () => {
  const fixture = await harness();
  await assertExportError(
    () => fixture.service.execute({ ...fixture.command, script: "result = Box()" }),
    "invalid_request",
  );
  await assertExportError(
    () => fixture.service.execute({ ...fixture.command, sourceText: "x" }),
    "invalid_request",
  );
  await assertExportError(
    () => fixture.service.execute({ ...fixture.command, provider: "build123d" }),
    "invalid_request",
  );
  await assertExportError(
    () =>
      fixture.service.execute({
        ...fixture.command,
        artifactId: "technical-compilation-admission-foreign",
      }),
    "invalid_request",
  );

  assertEquals(fixture.reader.calls.length, 0);
  assertEquals(fixture.exporter.calls.length, 0);
});

Deno.test("missing admission stops before provider export", async () => {
  const fixture = await harness();
  fixture.reader.missing = true;

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "admission_not_found",
  );
  assertEquals(fixture.reader.calls.length, 1);
  assertEquals(fixture.exporter.calls.length, 0);
});

Deno.test("foreign or stale reopened admissions fail closed before export", async () => {
  const foreign = await harness();
  const foreignCapture = structuredClone(foreign.reopened);
  (foreignCapture.admission.draft as { projectId: string }).projectId =
    "project.foreign";
  foreign.reader.result = foreignCapture;
  await assertExportError(
    () => foreign.service.execute(foreign.command),
    "admission_integrity_failed",
  );
  assertEquals(foreign.exporter.calls.length, 0);

  const stale = await harness();
  const staleCapture = structuredClone(stale.reopened);
  (staleCapture.document as { status: string }).status = "unresolved";
  stale.reader.result = staleCapture;
  await assertExportError(
    () => stale.service.execute(stale.command),
    "admission_integrity_failed",
  );
  assertEquals(stale.exporter.calls.length, 0);

  const nonSuccessor = await harness();
  await assertExportError(
    () =>
      nonSuccessor.service.execute({
        ...nonSuccessor.command,
        basis: {
          ...nonSuccessor.command.basis,
          snapshotId: nonSuccessor.reopened.admission.basis.thread.snapshotId,
          revision: nonSuccessor.reopened.admission.basis.thread.revision,
        },
      }),
    "admission_integrity_failed",
  );
  assertEquals(nonSuccessor.exporter.calls.length, 0);
});

Deno.test("additional projection or source can never enter singular Build123d V1 export", async () => {
  const extraProjection = await harness();
  const projectionCapture = structuredClone(extraProjection.reopened);
  (projectionCapture.document.projections as unknown[]).push(
    structuredClone(projectionCapture.document.projections[0]),
  );
  extraProjection.reader.result = projectionCapture;
  await assertExportError(
    () => extraProjection.service.execute(extraProjection.command),
    "admission_integrity_failed",
  );
  assertEquals(extraProjection.exporter.calls.length, 0);

  const extraSource = await harness();
  const sourceCapture = structuredClone(extraSource.reopened);
  (sourceCapture.document.inputManifest.sources as unknown[]).push(
    structuredClone(sourceCapture.document.inputManifest.sources[0]),
  );
  extraSource.reader.result = sourceCapture;
  await assertExportError(
    () => extraSource.service.execute(extraSource.command),
    "admission_integrity_failed",
  );
  assertEquals(extraSource.exporter.calls.length, 0);
});

Deno.test("admitted geometry export preflight is provider-free and preserves singular or unresolved boundaries", async () => {
  const singular = await harness();
  const preflight = new PrepareProjectAdmittedGeometryExportPreflight({
    admissions: singular.reader,
  });
  assertEquals(await preflight.execute(singular.command), {
    schemaVersion: "project-admitted-geometry-export-preflight/1.0",
    status: "singular-export-ready",
    nextTool: "project_admitted_geometry_export",
  });
  assertEquals(singular.exporter.calls.length, 0);

  const ambiguous = await harness();
  const capture = structuredClone(ambiguous.reopened);
  const secondId = `technical-unit:${"5".repeat(64)}`;
  const secondDocumentSource = structuredClone(
    capture.document.inputManifest.sources[0],
  ) as unknown as Mutable<
    (typeof capture.document.projections)[number]["sources"][number]
  >;
  secondDocumentSource.analysis.source.id = secondId;
  secondDocumentSource.effectiveUnit.unitId = secondId;
  secondDocumentSource.effectiveUnit.closureFingerprint.digest = "5".repeat(64);
  secondDocumentSource.analysisFingerprint = await fingerprintSourceAnalysisBundle(
    secondDocumentSource.analysis,
  );
  (capture.document.inputManifest.sources as unknown[]).push(secondDocumentSource);
  const secondProjectionSource = structuredClone(
    capture.document.projections[0]!.sources[0],
  ) as unknown as Mutable<
    (typeof capture.document.projections)[number]["sources"][number]["bindings"]
  >;
  secondProjectionSource.analysis.source.id = secondId;
  secondProjectionSource.effectiveUnit.unitId = secondId;
  secondProjectionSource.effectiveUnit.closureFingerprint.digest = "5".repeat(64);
  secondProjectionSource.analysisFingerprint = await fingerprintSourceAnalysisBundle(
    secondProjectionSource.analysis,
  );
  secondProjectionSource.bindings = structuredClone(
    capture.document.projections[0]!.sources[0]!.bindings,
  ) as unknown as Mutable<typeof capture.admission.sources[0]>;
  for (const binding of secondProjectionSource.bindings) {
    binding.sourceId = secondId;
    binding.id = `${binding.id}.second`;
    if (binding.relation === "represents") binding.sysmlElementId = "sysml.part.lid";
  }
  (capture.document.projections[0]!.sources as unknown[]).push(secondProjectionSource);
  const secondAdmissionSource = structuredClone(
    capture.admission.sources[0],
  ) as Mutable<typeof capture.document.inputManifest.sources[0]>;
  (capture.admission.sources[0] as Mutable<typeof capture.admission.sources[0]>)
    .attachment.target.elementId = "sysml.part.box";
  secondAdmissionSource.id = secondId;
  secondAdmissionSource.effectiveUnit.unitId = secondId;
  secondAdmissionSource.effectiveUnit.closureFingerprint.digest = "5".repeat(64);
  secondAdmissionSource.sourceClosure.fingerprint.digest = "5".repeat(64);
  secondAdmissionSource.attachment.attachmentId = "attachment.cad.second";
  secondAdmissionSource.attachment.fileId = "file.cad.second";
  secondAdmissionSource.attachment.target.elementId = "sysml.part.lid";
  secondAdmissionSource.sourceClosure.root.fileId = "file.cad.second";
  secondAdmissionSource.analysisFingerprint = secondDocumentSource.analysisFingerprint;
  (capture.admission.sources as unknown[]).push(secondAdmissionSource);
  const secondBindings = structuredClone(capture.admission.bindings).map((
    binding: Mutable<typeof capture.admission.bindings[number]>,
  ) => ({
    ...binding,
    id: `${binding.id}.second`,
    sourceId: secondId,
  }));
  secondBindings.find((binding) => binding.relation === "represents")!
    .sysmlElementId = "sysml.part.lid";
  (capture.admission.bindings as unknown[]).push(...secondBindings);
  (capture.document.inputManifest.bindings as unknown[]).push(
    ...structuredClone(secondBindings),
  );
  (capture.admission.compilationProfileRequests[0]!.sourceIds as string[]).push(
    secondId,
  );
  (capture.document.inputManifest.profileRequests[0]!.sourceIds as string[]).push(
    secondId,
  );
  const basis = capture.document.basis as Mutable<typeof capture.document.basis>;
  basis.sysmlAnchor.elements.push({
    id: "sysml.part.lid",
    kind: "PartDefinition",
    provenance: structuredClone(basis.sysmlAnchor.elements[1].provenance),
  });
  basis.sysmlAnchorFingerprint = await fingerprintTechnicalSysmlAnchor(
    basis.sysmlAnchor,
  );
  (capture.document as Mutable<typeof capture.document>).basisFingerprint =
    await fingerprintTechnicalCompilationBasis(basis);
  (capture.admission.basis as Mutable<typeof capture.admission.basis>).fingerprint =
    capture.document.basisFingerprint;
  ambiguous.reader.result = capture;
  const childRoute = await new PrepareProjectAdmittedGeometryExportPreflight({
    admissions: ambiguous.reader,
  }).execute(ambiguous.command);
  assertEquals(childRoute.status, "child-root-admission-required");
  if (childRoute.status === "child-root-admission-required") {
    assertEquals(
      childRoute.childRoots.map((root) => root.sourceId),
      [...childRoute.childRoots].map((root) => root.sourceId).sort(),
    );
  }
  secondAdmissionSource.attachment.target.elementId = "sysml.part.box";
  ambiguous.reader.result = capture;
  assertEquals(
    (await new PrepareProjectAdmittedGeometryExportPreflight({
      admissions: ambiguous.reader,
    }).execute(ambiguous.command)).status,
    "unresolved",
  );
  secondAdmissionSource.attachment.target.elementId = "sysml.part.lid";
  secondBindings.find((binding) => binding.relation === "represents")!
    .sysmlElementId = "sysml.part.box";
  ambiguous.reader.result = capture;
  assertEquals(
    (await new PrepareProjectAdmittedGeometryExportPreflight({
      admissions: ambiguous.reader,
    }).execute(ambiguous.command)).status,
    "unresolved",
  );
  assertEquals(ambiguous.exporter.calls.length, 0);

  const corrupted = await harness();
  const corruptCapture = structuredClone(corrupted.reopened);
  (corruptCapture.admission.basis as Mutable<typeof corruptCapture.admission.basis>)
    .fingerprint.digest = "0".repeat(64);
  corrupted.reader.result = corruptCapture;
  await assertRejects(
    () =>
      new PrepareProjectAdmittedGeometryExportPreflight({
        admissions: corrupted.reader,
      }).execute(corrupted.command),
    ProjectAdmittedGeometryExportPreflightError,
    "not exact",
  );
  assertEquals(corrupted.exporter.calls.length, 0);
});

Deno.test("reader and exporter failures are normalized without leaking causes or paths", async () => {
  const readerFailure = await harness();
  readerFailure.reader.failure = new Error(
    "secret token at /private/technical-admission.json",
  );
  const readerError = await assertExportError(
    () => readerFailure.service.execute(readerFailure.command),
    "admission_resolution_failed",
  );
  assertEquals(readerError.cause, undefined);
  assertEquals(readerError.message.includes("/private/"), false);
  assertEquals(readerError.message.includes("secret"), false);
  assertEquals(readerFailure.exporter.calls.length, 0);

  const exportFailure = await harness();
  exportFailure.exporter.failure = new Error(
    "provider credential at /private/build123d.json",
  );
  const exportError = await assertExportError(
    () => exportFailure.service.execute(exportFailure.command),
    "export_failed",
  );
  assertEquals(exportError.cause, undefined);
  assertEquals(exportError.message.includes("/private/"), false);
  assertEquals(exportError.message.includes("credential"), false);
});

Deno.test("a multi-part architecture exports exactly its admitted represented PartDefinition", async () => {
  const fixture = await harness();
  fixture.architecture.graph = {
    partDefinitions: [{
      id: "sysml.part.box",
      label: "Box",
      usages: [],
    }, {
      id: "sysml.part.lid",
      label: "Lid",
      usages: [],
    }],
  };
  const result = await fixture.service.execute(fixture.command);
  const replay = parseGeometryPartDecisionParameters(
    new Map(result.decisionParameters.map((parameter) => [
      parameter.key,
      parameter.value,
    ])),
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 1);
  assertEquals(fixture.exporter.targetedCalls[0]?.target, {
    partDefinitionElementId: "sysml.part.box",
    label: "Box",
  });
  assertEquals(fixture.exporter.targetedCalls[0]?.admission, {
    schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
    artifactId: fixture.command.artifactId,
    fingerprint: fixture.command.artifactFingerprint,
    sourceFingerprint: fixture.reopened.admission.sources[0]!.sourceFingerprint,
    target: { partDefinitionElementId: "sysml.part.box", label: "Box" },
  });
  assertEquals(result.assemblyFiles, []);
  assertEquals(result.target?.partDefinitionElementId, "sysml.part.box");
  assertEquals(replay.manifest.schemaVersion, GEOMETRY_PART_MANIFEST_SCHEMA);
  assertEquals(replay.manifest.target.partDefinitionElementId, "sysml.part.box");
  assertEquals(Object.hasOwn(replay.manifest, "components"), false);
  assertEquals(Object.hasOwn(replay.manifest, "partDefinitions"), false);
});

Deno.test("an unrepresented multi-part target fails before the provider", async () => {
  const fixture = await harness();
  fixture.architecture.graph = {
    partDefinitions: [{
      id: "sysml.part.lid",
      label: "Lid",
      usages: [],
    }],
  };
  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "admission_not_represented",
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("an old geometry-capture/2.0 cannot authorize a targeted predecessor", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addV2Capture(fixture, {
    inputArtifactIds: ["artifact.sysml"],
    schemaVersion: "geometry-capture/2.0",
  });

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "geometry_part_predecessor_unavailable",
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("an active attested V2 bundle covering the target blocks part preview before the provider", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addV2Capture(fixture, { inputArtifactIds: ["artifact.sysml"] });

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "geometry_part_v2_bundle_conflict",
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("a V2 capture with inexact lineage cannot block target preview", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addV2Capture(fixture, {
    inputArtifactIds: ["artifact.sysml", "unexpected-input"],
  });

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "geometry_part_predecessor_unavailable",
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("an attested exact same-target capture becomes the targeted predecessor", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  const predecessor = await addPartCapture(fixture, "one");

  await fixture.service.execute(fixture.command);

  assertEquals(fixture.exporter.targetedCalls[0]?.predecessor, predecessor);
});

Deno.test("ambiguous active exact same-target captures fail before the provider", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addPartCapture(fixture, "one");
  await addPartCapture(fixture, "two");

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "geometry_part_tip_ambiguous",
  );
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("an attested same-target part remains the predecessor beside an unrelated module", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  const predecessor = await addPartCapture(fixture, "one");
  await addModuleCapture(fixture);

  await fixture.service.execute(fixture.command);

  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 1);
  assertEquals(fixture.exporter.targetedCalls[0]?.predecessor, predecessor);
});

Deno.test("an unrelated module alone does not invent a targeted part predecessor", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addModuleCapture(fixture);

  await fixture.service.execute(fixture.command);

  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 1);
  assertEquals(fixture.exporter.targetedCalls[0]?.predecessor, undefined);
});

Deno.test("a same-target module is a typed conflict, never a part predecessor", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addPartCapture(fixture, "one");
  await addModuleCapture(fixture, {
    targetId: "sysml.part.box",
    label: "Box",
  });

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "geometry_part_target_conflict",
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("a same-id module with a different label is a typed target conflict", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  await addModuleCapture(fixture, {
    targetId: "sysml.part.box",
    label: "Airframe",
  });

  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "geometry_part_target_conflict",
  );
  assertEquals(fixture.exporter.calls.length, 0);
  assertEquals(fixture.exporter.targetedCalls.length, 0);
});

Deno.test("a forged module producer, hash, lineage or schema stays fail-closed", async () => {
  for (const forge of ["producer", "hash", "lineage", "schema"] as const) {
    const fixture = await harness();
    fixture.architecture.graph = multiPartArchitecture();
    await addPartCapture(fixture, "one");
    await addModuleCapture(fixture, { forge });

    await assertExportError(
      () => fixture.service.execute(fixture.command),
      "geometry_part_predecessor_unavailable",
    );
    assertEquals(fixture.exporter.calls.length, 0);
    assertEquals(fixture.exporter.targetedCalls.length, 0);
  }
});

Deno.test("a completed targeted replay with an unrelated module does not call the exporter again", async () => {
  const fixture = await harness();
  fixture.architecture.graph = multiPartArchitecture();
  const predecessor = await addPartCapture(fixture, "one");
  await addModuleCapture(fixture);
  const root = await Deno.makeTempDir();
  try {
    const cache = new FileAdmittedGeometryExportReplayCache(`${root}/replay`);
    const state = { begins: 0, releases: 0, retains: 0, recordedReleases: 0 };
    const project = {
      project: { id: fixture.command.projectId },
      threadSnapshots: [{
        snapshotId: fixture.command.basis.snapshotId,
        revision: fixture.command.basis.revision,
        subjectId: fixture.command.basis.subjectId,
      }],
    } as never;
    const preparation = {
      begin: () => {
        state.begins++;
        return Promise.resolve({
          lease: { id: "lease:geometry" },
          releaseSuccess: () => {
            state.releases++;
            return Promise.resolve();
          },
          retainForRecovery: () => state.retains++,
        });
      },
      releaseRecorded: () => {
        state.recordedReleases++;
        return Promise.resolve();
      },
    } as never;
    const compose = () =>
      new ExportAdmittedProjectGeometry({
        admissions: fixture.reader,
        exporter: fixture.exporter,
        exporterFactory: () => fixture.exporter,
        projects: { get: () => Promise.resolve(project) },
        preparation,
        replayCache: new FileAdmittedGeometryExportReplayCache(`${root}/replay`),
        architecture: fixture.architecture,
        snapshots: fixture.snapshots,
        geometryCaptures: fixture.geometryCaptures,
      });

    const first = await compose().execute(fixture.command);
    const second = await compose().execute(fixture.command);

    assertEquals(second, first);
    assertEquals(state, {
      begins: 1,
      releases: 1,
      retains: 0,
      recordedReleases: 1,
    });
    assertEquals(fixture.exporter.calls.length, 0);
    assertEquals(fixture.exporter.targetedCalls.length, 1);
    assertEquals(fixture.exporter.targetedCalls[0]?.predecessor, predecessor);
    assert((await cache.read(await replayKey(fixture.command))) !== undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("missing architecture stops before provider export", async () => {
  const fixture = await harness();
  fixture.architecture.missing = true;
  await assertExportError(
    () => fixture.service.execute(fixture.command),
    "architecture_unavailable",
  );
  assertEquals(fixture.exporter.calls.length, 0);
});

Deno.test("an existing unique geometry tip becomes the signed predecessor", async () => {
  const fixture = await harness();
  const digest = "9".repeat(64);
  fixture.snapshots.snapshot = {
    ...fixture.snapshots.snapshot,
    artifacts: [{
      id: `geometry-${digest}`,
      kind: "cad-model",
      uri: `casys://geometry-capture/sha256/${digest}`,
      fingerprint: { algorithm: "sha256", digest },
    }],
  } as unknown as ThreadSnapshot;
  const result = await fixture.service.execute(fixture.command);
  assertEquals(fixture.exporter.calls[0]?.predecessor, {
    artifactId: `geometry-${digest}`,
    fingerprint: { algorithm: "sha256", digest },
  });
  const replay = parseGeometryDecisionParameters(
    new Map(result.decisionParameters.map((parameter) => [
      parameter.key,
      parameter.value,
    ])),
  );
  assertEquals(
    replay.manifest.schemaVersion === GEOMETRY_BUNDLE_MANIFEST_SCHEMA
      ? replay.manifest.predecessor
      : undefined,
    {
      artifactId: `geometry-${digest}`,
      fingerprint: { algorithm: "sha256", digest },
    },
  );
});

async function harness(
  options: { readonly standaloneComment?: boolean } = {},
): Promise<Harness> {
  const admittedSource = [
    ...(options.standaloneComment ? ["# physical provenance annotation"] : []),
    "from build123d import Box",
    "thickness = 2",
    "result = Box(20, 10, thickness)",
    "",
  ].join("\n");
  const sourceFingerprint = await fingerprintTechnicalSourceText(admittedSource);
  const sourceWorkspace = sampleAdmissionSourceWorkspaceFields("source.cad.box", {
    projectId: "project.box",
  });
  const sourceId = `technical-unit:${sourceWorkspace.sourceClosure.fingerprint.digest}`;
  const effectiveUnit = {
    kind: "authored-root" as const,
    closureKind: "root-only" as const,
    unitId: sourceId,
    closureFingerprint: sourceWorkspace.sourceClosure.fingerprint,
    scriptFingerprint: sourceFingerprint,
  };
  const analysis: SourceAnalysisBundle = options.standaloneComment
    ? await new QualifiedBuild123dSourceAnalyzer().analyze({
      sourceId,
      role: "cad-script",
      language: "python",
      sourceText: admittedSource,
    })
    : {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: sourceId,
        role: "cad-script",
        language: "python",
        fingerprint: sourceFingerprint,
      },
      analyzer: {
        id: "build123d-qualified-lezer",
        version: "1.1.0",
      },
      policy: {
        profile: "build123d-closed-subset-v1",
        status: "passed",
        findings: [],
      },
      symbols: [
        {
          id: "artifact:qualified-box",
          kind: "artifact",
          name: "result",
        },
        {
          id: "parameter:thickness",
          kind: "parameter",
          name: "thickness",
          span: {
            start: { line: 2, column: 0 },
            end: { line: 2, column: 9 },
          },
        },
      ],
      dependencies: [{
        id: "dependency:thickness:result",
        kind: "structural-incidence",
        fromSymbolId: "parameter:thickness",
        toSymbolId: "artifact:qualified-box",
      }],
      unresolvedConstructs: [],
    };
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  const sysmlFingerprint = {
    algorithm: "sha256" as const,
    digest: "2".repeat(64),
  };
  const provenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlFingerprint,
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.package.main",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.package.main", kind: "Package", provenance },
      { id: "sysml.part.box", kind: "PartDefinition", provenance },
      {
        id: "sysml.attribute.thickness",
        kind: "AttributeUsage",
        provenance,
      },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: "project.box",
      subjectId: "subject.box",
      snapshotId: "snapshot.7",
      revision: 7,
      snapshotFingerprint: {
        algorithm: "sha256",
        digest: "1".repeat(64),
      },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const compilationProfile: TechnicalCompilationProfile = {
    id: "build123d-closed-subset-v1",
    version: options.standaloneComment
      ? PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION
      : "1.0.0",
    target: "build123d-source",
    sourceRole: "cad-script",
    language: "python",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: options.standaloneComment
      ? QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE
      : "build123d-closed-subset-v1",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
  const artifactSymbol = analysis.symbols.find((symbol) => symbol.kind === "artifact");
  const thicknessSymbol = analysis.symbols.find((symbol) =>
    symbol.kind === "parameter" && symbol.name === "thickness"
  );
  if (!artifactSymbol || !thicknessSymbol) {
    throw new Error("fixture analysis must contain result and thickness symbols");
  }
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText: admittedSource,
      analysis,
      analysisFingerprint,
      effectiveUnit,
    }],
    bindings: [
      {
        id: "binding.result",
        sourceId: analysis.source.id,
        sourceSymbolId: artifactSymbol.id,
        sysmlElementId: "sysml.part.box",
        sysmlElementKind: "PartDefinition",
        relation: "represents",
      },
      {
        id: "binding.thickness",
        sourceId: analysis.source.id,
        sourceSymbolId: thicknessSymbol.id,
        sysmlElementId: "sysml.attribute.thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
    ],
    profileRequests: [{
      profileId: compilationProfile.id,
      profileVersion: compilationProfile.version,
      sourceIds: [analysis.source.id],
    }],
  }, {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [compilationProfile],
  });
  assertEquals(compiled.document.status, "ready-for-review");
  const projection = compiled.document.projections[0]!;
  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters({
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
      draft: {
        draftId: `technical-compilation:project.box:${compiled.fingerprint.digest}`,
        projectId: "project.box",
        documentFingerprint: compiled.fingerprint,
        envelopeFingerprint: {
          algorithm: "sha256",
          digest: "3".repeat(64),
        },
      },
      basis: {
        fingerprint: compiled.document.basisFingerprint,
        thread: {
          projectId: basis.thread.projectId,
          subjectId: basis.thread.subjectId,
          snapshotId: basis.thread.snapshotId,
          revision: basis.thread.revision,
          fingerprint: basis.thread.snapshotFingerprint,
        },
        sysml: {
          artifactId: basis.sysmlAnchor.artifactId,
          artifactFingerprint: basis.sysmlAnchor.artifactFingerprint,
          captureId: basis.sysmlAnchor.captureId,
          editingContextId: basis.sysmlAnchor.editingContextId,
          rootElementId: basis.sysmlAnchor.rootElementId,
          rootElementKind: basis.sysmlAnchor.rootElementKind,
          anchorFingerprint: basis.sysmlAnchorFingerprint,
        },
      },
      sources: [{
        id: analysis.source.id,
        role: analysis.source.role,
        language: analysis.source.language,
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        profileFingerprint: await sha256Fingerprint({
          id: compilationProfile.id,
          version: compilationProfile.version,
          role: "cad-script",
          language: "python",
          analyzer: compilationProfile.analyzer,
          maximumSourceBytes: 262_144,
        }),
        analyzer: analysis.analyzer,
        sourceFingerprint,
        captureFingerprint: {
          algorithm: "sha256",
          digest: "4".repeat(64),
        },
        analysisFingerprint,
        effectiveUnit,
        ...sourceWorkspace,
      }],
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: [{
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        target: "build123d-source",
        sourceIds: [analysis.source.id],
        profileFingerprint: projection.profileFingerprint,
      }],
      compilation: {
        fingerprint: compiled.fingerprint,
        status: "ready-for-review",
      },
    }),
  );
  const artifactFingerprint = await sha256Fingerprint({
    schemaVersion: "technical-compilation-admission-capture/4.0",
    projectId: "project.box",
    compilation: compiled.fingerprint,
  });
  const command: ProjectAdmittedGeometryExportCommand = {
    projectId: "project.box",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.box",
    },
    artifactId: `technical-compilation-admission-${artifactFingerprint.digest}`,
    artifactFingerprint,
  };
  const reopened: ReopenedTechnicalCompilationAdmission = {
    schemaVersion: "technical-compilation-admission-capture/4.0",
    operation: COMPILE_SEAL_ADMISSION_OPERATION,
    trustedRunId: "run.compile.seal",
    decisionId: "decision.compile.seal",
    sealedAt: "2026-08-13T08:00:00.000Z",
    draftReference: {
      schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
      draftId: admission.draft.draftId,
      projectId: admission.draft.projectId,
      documentFingerprint: admission.draft.documentFingerprint,
      envelopeFingerprint: admission.draft.envelopeFingerprint,
    },
    admission,
    document: compiled.document,
  };
  const reader = new FakeAdmissionReader(reopened);
  const exporter = new FakeExporter();
  const architecture = new FakeArchitectureReader();
  const snapshots = new FakeSnapshots();
  const geometryCaptures = new FakeGeometryCaptureReader();
  return {
    service: new ExportAdmittedProjectGeometry({
      admissions: reader,
      exporter,
      architecture,
      snapshots,
      geometryCaptures,
    }),
    command,
    reopened,
    admittedSource,
    reader,
    exporter,
    architecture,
    snapshots,
    geometryCaptures,
  };
}

function multiPartArchitecture(): ArchitecturePartGraph {
  return {
    partDefinitions: [{
      id: "sysml.part.box",
      label: "Box",
      usages: [],
    }, {
      id: "sysml.part.lid",
      label: "Lid",
      usages: [],
    }],
  };
}

function serviceWithPreparation(
  fixture: Harness,
  begin: () => Promise<never>,
): ExportAdmittedProjectGeometry {
  return new ExportAdmittedProjectGeometry({
    admissions: fixture.reader,
    exporter: fixture.exporter,
    exporterFactory: () => fixture.exporter,
    projects: {
      get: () =>
        Promise.resolve({
          project: { id: fixture.command.projectId },
          threadSnapshots: [{
            snapshotId: fixture.command.basis.snapshotId,
            revision: fixture.command.basis.revision,
            subjectId: fixture.command.basis.subjectId,
          }],
        } as never),
    },
    preparation: {
      begin,
      releaseRecorded: () => Promise.resolve(),
    } as never,
    architecture: fixture.architecture,
    snapshots: fixture.snapshots,
    geometryCaptures: fixture.geometryCaptures,
  });
}

async function replayKey(command: ProjectAdmittedGeometryExportCommand) {
  return await sha256Fingerprint({
    schemaVersion: "project-admitted-geometry-export-replay/1.0",
    projectId: command.projectId,
    basis: command.basis,
    artifactId: command.artifactId,
    artifactFingerprint: command.artifactFingerprint,
  });
}

async function addV2Capture(
  fixture: Harness,
  options: {
    readonly inputArtifactIds: readonly string[];
    readonly schemaVersion?: "geometry-capture/2.0" | "geometry-capture/2.1";
  },
): Promise<void> {
  const sealedAt = "2026-08-13T08:00:00.000Z";
  const architectureFingerprint =
    fixture.reopened.admission.basis.sysml.artifactFingerprint;
  const manifest = {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: fixture.command.basis.snapshotId,
      revision: fixture.command.basis.revision,
      artifactFingerprint: architectureFingerprint,
    },
    components: [],
    unitSystem: "mm" as const,
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats: ["step", "gltf"],
    partExportFormats: ["step", "gltf"],
    partDefinitions: [{
      elementId: "sysml.part.box",
      label: "Box",
      scriptHash: { algorithm: "sha256" as const, digest: "e".repeat(64) },
      files: [{
        format: "step" as const,
        name: "geometry-preview",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      }, {
        format: "gltf" as const,
        name: "geometry-preview",
        fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
      }],
    }],
    occurrences: [],
    scriptHash: { algorithm: "sha256" as const, digest: "e".repeat(64) },
    artifactHashes: {
      assemblyFiles: [{
        format: "step" as const,
        name: "geometry-preview",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      }, {
        format: "gltf" as const,
        name: "geometry-preview",
        fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
      }],
      partMeshes: [] as const,
    },
  };
  const schemaVersion = options.schemaVersion ?? "geometry-capture/2.1";
  const capture = {
    schemaVersion,
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: "run.geometry.v2",
    draftDigest: "d".repeat(64),
    manifest,
    architectureBasis: {
      artifactId: "artifact.sysml",
      fingerprint: architectureFingerprint,
      producerRunId: "run.architecture",
    },
    previewProducer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "preview.geometry.v2",
    },
    sourceScripts: {},
    ...(schemaVersion === "geometry-capture/2.1"
      ? { sourceAnalyses: { assembly: {}, partDefinitions: [] } }
      : {}),
    sealedAt,
  };
  const fingerprint = await sha256Fingerprint(capture);
  fixture.geometryCaptures.captures.set(
    fingerprint.digest,
    deterministicJson(capture),
  );
  fixture.snapshots.snapshot = {
    ...fixture.snapshots.snapshot,
    artifacts: [{
      id: "artifact.sysml",
      name: "Architecture",
      kind: "sysml-model",
      version: architectureFingerprint.digest,
      fingerprint: architectureFingerprint,
      producer: {
        serverId: "digital-thread",
        tool: "model.write-architecture@1",
        runId: "run.architecture",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: sealedAt,
        invalidatedByChangeIds: [],
      },
    }, {
      id: `geometry-${fingerprint.digest}`,
      name: "Geometry: Box",
      kind: "cad-model",
      version: fingerprint.digest,
      fingerprint,
      uri: `casys://geometry-capture/sha256/${fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "design.write-geometry@1",
        runId: "run.geometry.v2",
      },
      inputArtifactIds: [...options.inputArtifactIds],
      freshness: {
        status: "fresh",
        changedAt: sealedAt,
        invalidatedByChangeIds: [],
      },
    }],
  } as unknown as ThreadSnapshot;
}

async function addPartCapture(
  fixture: Harness,
  suffix: string,
): Promise<{
  readonly schemaVersion: typeof GEOMETRY_PART_CAPTURE_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  readonly partDefinitionElementId: string;
}> {
  const sealedAt = "2026-08-13T08:00:00.000Z";
  const architectureFingerprint =
    fixture.reopened.admission.basis.sysml.artifactFingerprint;
  const manifest = {
    schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: fixture.command.basis.snapshotId,
      revision: fixture.command.basis.revision,
      artifactFingerprint: architectureFingerprint,
    },
    target: {
      partDefinitionElementId: "sysml.part.box",
      label: "Box",
      scriptHash: { algorithm: "sha256" as const, digest: "e".repeat(64) },
      files: [{
        format: "step" as const,
        name: "geometry-part-preview",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      }, {
        format: "gltf" as const,
        name: "geometry-part-preview",
        fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
      }],
    },
    unitSystem: "mm" as const,
    exportFormats: ["step", "gltf"],
  };
  const runId = `run.geometry.part.${suffix}`;
  const capture = {
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: runId,
    draftDigest: "d".repeat(64),
    manifest,
    architectureBasis: {
      artifactId: "artifact.sysml",
      fingerprint: architectureFingerprint,
      producerRunId: "run.architecture",
    },
    previewProducer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: `preview.geometry.part.${suffix}`,
    },
    sourceScript: {},
    sourceAnalysis: {},
    sealedAt,
  };
  const fingerprint = await sha256Fingerprint(capture);
  fixture.geometryCaptures.captures.set(
    fingerprint.digest,
    deterministicJson(capture),
  );
  const prior = fixture.snapshots.snapshot.artifacts as unknown as readonly {
    readonly id: string;
  }[];
  const hasArchitecture = prior.some((artifact) => artifact.id === "artifact.sysml");
  fixture.snapshots.snapshot = {
    ...fixture.snapshots.snapshot,
    artifacts: [
      ...(hasArchitecture ? prior : [{
        id: "artifact.sysml",
        name: "Architecture",
        kind: "sysml-model",
        version: architectureFingerprint.digest,
        fingerprint: architectureFingerprint,
        producer: {
          serverId: "digital-thread",
          tool: "model.write-architecture@1",
          runId: "run.architecture",
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh",
          changedAt: sealedAt,
          invalidatedByChangeIds: [],
        },
      }]),
      {
        id: `geometry-${fingerprint.digest}`,
        name: "Geometry: Box",
        kind: "cad-model",
        version: fingerprint.digest,
        fingerprint,
        uri: `casys://geometry-capture/sha256/${fingerprint.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "design.write-geometry@1",
          runId,
        },
        inputArtifactIds: ["artifact.sysml"],
        freshness: {
          status: "fresh",
          changedAt: sealedAt,
          invalidatedByChangeIds: [],
        },
      },
    ],
  } as unknown as ThreadSnapshot;
  return {
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    artifactId: `geometry-${fingerprint.digest}`,
    fingerprint,
    partDefinitionElementId: "sysml.part.box",
  };
}

const MODULE_ARCH = "11".repeat(32);
const MODULE_STRUCTURE = "22".repeat(32);
const MODULE_PLACEMENT = "33".repeat(32);
const MODULE_CHILD = "44".repeat(32);
const MODULE_CHILD_STEP = "55".repeat(32);
const MODULE_BUNDLE = "66".repeat(32);
const MODULE_STEP = "77".repeat(32);
const MODULE_GLB = "88".repeat(32);
const MODULE_DRAFT = "99".repeat(32);
const MODULE_EVIDENCE = "aa".repeat(32);

function moduleFingerprint(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

async function addModuleCapture(
  fixture: Harness,
  options: {
    readonly targetId?: string;
    readonly label?: string;
    readonly forge?: "producer" | "hash" | "lineage" | "schema";
  } = {},
): Promise<void> {
  const sealedAt = "2026-08-13T08:00:00.000Z";
  const architectureId = `architecture-${MODULE_ARCH}`;
  const structureId = `part-definitions-${MODULE_STRUCTURE}`;
  const childId = `geometry-${MODULE_CHILD}`;
  const runId = "run.geometry.module.airframe";
  const targetId = options.targetId ?? "sysml.part.airframe";
  const label = options.label ?? "Airframe";
  const child = {
    usageElementId: "sysml.usage.skin",
    partDefinitionElementId: "sysml.part.skin",
    placement: {
      translationMm: [1, 0, 0],
      rotationDeg: [0, 90, 0],
    },
    placementCapture: moduleFingerprint(MODULE_PLACEMENT),
    childGeometry: {
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: childId,
      fingerprint: moduleFingerprint(MODULE_CHILD),
    },
    authoritativeStep: {
      fingerprint: moduleFingerprint(MODULE_CHILD_STEP),
      bytes: 32,
    },
  };
  const placementAnalysis = {
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint: moduleFingerprint(MODULE_PLACEMENT),
    byteCount: 64,
    casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${MODULE_PLACEMENT}`,
  };
  const structureCapture = {
    schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
    artifactId: structureId,
    fingerprint: moduleFingerprint(MODULE_STRUCTURE),
    uri: `${GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX}${MODULE_STRUCTURE}`,
    byteCount: 512,
    architecture: {
      artifactId: architectureId,
      fingerprint: moduleFingerprint(MODULE_ARCH),
      uri: `${GEOMETRY_MODULE_ARCHITECTURE_CAPTURE_URI_PREFIX}${MODULE_ARCH}`,
    },
  };
  const inputBundle = {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: moduleFingerprint(MODULE_BUNDLE),
    byteCount: 128,
    manifest: {
      schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
      unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
      placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
      occurrences: [{
        usageElementId: child.usageElementId,
        partDefinitionElementId: child.partDefinitionElementId,
        placement: child.placement,
        childCapture: child.childGeometry,
        step: {
          mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
          byteOffset: 0,
          byteCount: child.authoritativeStep.bytes,
          sha256: MODULE_CHILD_STEP,
        },
      }],
    },
  };
  const assemblyStep = {
    fingerprint: moduleFingerprint(MODULE_STEP),
    bytes: 64,
  };
  const assemblyGlb = {
    fingerprint: moduleFingerprint(MODULE_GLB),
    bytes: 48,
  };
  const receipt = {
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
    capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
    runId: "run.geometry-module.assembly.1",
    inputBundle: {
      fingerprint: inputBundle.fingerprint,
      byteCount: inputBundle.byteCount,
    },
    assembly: {
      step: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
        fingerprint: assemblyStep.fingerprint,
        byteCount: assemblyStep.bytes,
      },
      glb: {
        ...GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
        fingerprint: assemblyGlb.fingerprint,
        byteCount: assemblyGlb.bytes,
      },
    },
    implementation: {
      id: "fixture-neutral-cad-assembler",
      version: "2026.1",
      evidenceFingerprint: moduleFingerprint(MODULE_EVIDENCE),
    },
  };
  const manifest = {
    schemaVersion: GEOMETRY_MODULE_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: "snapshot.7",
      revision: 7,
      artifactFingerprint: moduleFingerprint(MODULE_ARCH),
    },
    structureCapture,
    target: {
      partDefinitionElementId: targetId,
      label,
    },
    placementAnalysis,
    children: [child],
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle,
      step: { fingerprint: assemblyStep.fingerprint },
      glb: { fingerprint: assemblyGlb.fingerprint },
    },
  };
  const capture = options.forge === "schema"
    ? { schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA }
    : {
      schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
      operation: { id: "design.write-geometry", version: "1" },
      trustedRunId: runId,
      draftDigest: MODULE_DRAFT,
      manifest,
      architectureBasis: {
        artifactId: architectureId,
        fingerprint: moduleFingerprint(MODULE_ARCH),
        producerRunId: "run.architecture.module",
      },
      structureCapture,
      placementAnalysis,
      children: [child],
      inputBundle,
      receipt,
      assemblyStep,
      assemblyGlb,
      sealedAt,
    };
  if (options.forge !== "schema") {
    await parseGeometryModuleCapture(capture);
  }
  const stored = options.forge === "hash"
    ? { ...capture, trustedRunId: "run.geometry.module.forged-hash" }
    : capture;
  const fingerprint = await sha256Fingerprint(
    options.forge === "hash" ? capture : stored,
  );
  fixture.geometryCaptures.captures.set(
    fingerprint.digest,
    deterministicJson(stored),
  );
  const prior = fixture.snapshots.snapshot.artifacts as unknown as readonly {
    readonly id: string;
  }[];
  const hasArchitecture = prior.some((artifact) => artifact.id === architectureId);
  const inputArtifactIds = options.forge === "lineage"
    ? ["unexpected-input"]
    : [architectureId, structureId, childId];
  fixture.snapshots.snapshot = {
    ...fixture.snapshots.snapshot,
    artifacts: [
      ...prior,
      ...(hasArchitecture ? [] : [{
        id: architectureId,
        name: "Architecture",
        kind: "sysml-model",
        version: MODULE_ARCH,
        fingerprint: moduleFingerprint(MODULE_ARCH),
        producer: {
          serverId: "digital-thread",
          tool: "model.write-architecture@1",
          runId: "run.architecture.module",
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh",
          changedAt: sealedAt,
          invalidatedByChangeIds: [],
        },
      }]),
      {
        id: `geometry-${fingerprint.digest}`,
        name: "Geometry: Airframe",
        kind: "cad-model",
        version: fingerprint.digest,
        fingerprint,
        uri: `casys://geometry-capture/sha256/${fingerprint.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "design.write-geometry@1",
          runId: options.forge === "producer" ? "run.geometry.module.forged" : runId,
        },
        inputArtifactIds,
        freshness: {
          status: "fresh",
          changedAt: sealedAt,
          invalidatedByChangeIds: [],
        },
      },
    ],
  } as unknown as ThreadSnapshot;
}

async function assertExportError(
  operation: () => Promise<unknown>,
  code: ProjectAdmittedGeometryExportError["code"],
): Promise<ProjectAdmittedGeometryExportError> {
  const error = await assertRejects(
    operation,
    ProjectAdmittedGeometryExportError,
  );
  assertEquals(error.code, code);
  return error;
}

function recursiveKeys(value: unknown, seen = new Set<unknown>()): Set<string> {
  const keys = new Set<string>();
  if (value === null || typeof value !== "object" || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    for (const nested of recursiveKeys(child, seen)) keys.add(nested);
  }
  return keys;
}

function assertDeeplyFrozen(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeeplyFrozen(child, seen);
}
