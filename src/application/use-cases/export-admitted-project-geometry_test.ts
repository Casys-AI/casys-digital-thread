import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ProjectAdmittedGeometryExportCommand } from "../ports/in/project-admitted-geometry-export.ts";
import type {
  AdmittedGeometryExportDraft,
  AdmittedGeometryExporter,
  AdmittedGeometryExportRequest,
} from "../ports/out/admitted-geometry-exporter.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../ports/out/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../ports/out/technical-compilation-draft-store.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
} from "../../domain/analysis/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../domain/analysis/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../domain/analysis/technical-compilation-proposal.ts";
import { GEOMETRY_DRAFT_ADMISSION_SCHEMA } from "../../domain/engineering/geometry-draft-admission.ts";
import {
  parseGeometryDecisionParameters,
} from "../../domain/engineering/geometry-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  ExportAdmittedProjectGeometry,
  ProjectAdmittedGeometryExportError,
} from "./export-admitted-project-geometry.ts";

interface Harness {
  readonly service: ExportAdmittedProjectGeometry;
  readonly command: ProjectAdmittedGeometryExportCommand;
  readonly reopened: ReopenedTechnicalCompilationAdmission;
  readonly admittedSource: string;
  readonly reader: FakeAdmissionReader;
  readonly exporter: FakeExporter;
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

class FakeExporter implements AdmittedGeometryExporter {
  readonly calls: AdmittedGeometryExportRequest[] = [];
  failure?: Error;
  draft: AdmittedGeometryExportDraft = {
    draftDigest: "d".repeat(64),
    scriptHash: { algorithm: "sha256", digest: "e".repeat(64) },
    exportFormats: ["gltf"],
    assemblyFiles: [{
      format: "gltf",
      name: "geometry-preview-assembly",
      bytes: 1024,
      digest: "f".repeat(64),
    }],
    partMeshes: [],
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
    return Promise.resolve(structuredClone(this.draft));
  }
}

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
  assertEquals(result.sourceAnalysis, fixture.exporter.draft.sourceAnalysis);
  assertEquals(replay.draftDigest, fixture.exporter.draft.draftDigest);
  assertEquals(replay.manifest.architectureBasis, {
    snapshotId: fixture.command.basis.snapshotId,
    revision: fixture.command.basis.revision,
    artifactFingerprint: fixture.reopened.admission.basis.sysml.artifactFingerprint,
  });
  assertEquals(replay.manifest.components, []);
  assertEquals(replay.manifest.exportFormats, ["gltf"]);
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
  }]);
  assertDeeplyFrozen(result);

  const serialized = deterministicJson(result);
  assertEquals(serialized.includes("from build123d import Box"), false);
  assertEquals(recursiveKeys(result).has("sourceText"), false);
  assertEquals(recursiveKeys(result).has("script"), false);
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

async function harness(): Promise<Harness> {
  const admittedSource = [
    "from build123d import Box",
    "thickness = 2",
    "result = Box(20, 10, thickness)",
    "",
  ].join("\n");
  const sourceFingerprint = await fingerprintTechnicalSourceText(admittedSource);
  const analysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: "source.cad.box",
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
      { id: "sysml.part.box", kind: "PartUsage", provenance },
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
    version: "1.0.0",
    target: "build123d-source",
    sourceRole: "cad-script",
    language: "python",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "build123d-closed-subset-v1",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{ sourceText: admittedSource, analysis, analysisFingerprint }],
    bindings: [
      {
        id: "binding.result",
        sourceId: analysis.source.id,
        sourceSymbolId: analysis.symbols[0]!.id,
        sysmlElementId: "sysml.part.box",
        sysmlElementKind: "PartUsage",
        relation: "represents",
      },
      {
        id: "binding.thickness",
        sourceId: analysis.source.id,
        sourceSymbolId: "parameter:thickness",
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
    schemaVersion: "technical-compilation-admission-capture/1.0",
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
    schemaVersion: "technical-compilation-admission-capture/1.0",
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
  return {
    service: new ExportAdmittedProjectGeometry({
      admissions: reader,
      exporter,
    }),
    command,
    reopened,
    admittedSource,
    reader,
    exporter,
  };
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
