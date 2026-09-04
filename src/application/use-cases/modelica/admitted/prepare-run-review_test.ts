import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ProjectAdmittedModelicaRunReviewCommand } from "../../../ports/in/modelica/admitted-run-review.ts";
import {
  ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
  type AdmittedModelicaExecutionProfile,
  type AdmittedModelicaExecutionProfileCatalog,
  type AdmittedModelicaExecutionProfileFingerprintBody,
} from "../../../ports/out/modelica/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  parseModelicaAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../../../domain/modelica/admitted/run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  fingerprintSourceAnalysisBundle,
} from "../../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  technicalSourceCaptureInput,
} from "../../../../testing/technical-source-capture-test-support.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { QualifiedModelicaSourceAnalyzer } from "../../../../adapters/modelica/source/qualified-source-analyzer.ts";
import {
  PrepareProjectAdmittedModelicaRunReview,
  ProjectAdmittedModelicaRunReviewError,
} from "./prepare-run-review.ts";

const MODELICA_ADMITTED_GENERIC_SOURCE = `model GenericOscillator
  parameter Real initialPosition(unit = "m") = 0;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericOscillator;
`;

interface Harness {
  readonly service: PrepareProjectAdmittedModelicaRunReview;
  readonly command: ProjectAdmittedModelicaRunReviewCommand;
  readonly reopened: ReopenedTechnicalCompilationAdmission;
  readonly profile: AdmittedModelicaExecutionProfile;
  readonly reader: FakeAdmissionReader;
  readonly profiles: FakeExecutionProfileCatalog;
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

class FakeExecutionProfileCatalog implements AdmittedModelicaExecutionProfileCatalog {
  initialCalls = 0;
  resolveCalls = 0;
  failure?: Error;

  constructor(public profile: AdmittedModelicaExecutionProfile) {}

  initial(): Promise<AdmittedModelicaExecutionProfile> {
    this.initialCalls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(structuredClone(this.profile));
  }

  resolve(): Promise<AdmittedModelicaExecutionProfile> {
    this.resolveCalls += 1;
    return Promise.reject(new Error("prepare must never resolve caller input"));
  }
}

Deno.test("admitted Modelica review reopens sealed source and never returns Modelica text", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute(fixture.command);
  const replay = parseModelicaAdmittedRunAdmissionParameters(
    result.decisionParameters,
  );

  assertEquals(result.admission, replay);
  assertEquals(fixture.reader.calls, [fixture.command]);
  assertEquals(fixture.profiles.initialCalls, 1);
  assertEquals(
    result.admission.compilation.projection.target,
    "modelica-source-qualification",
  );
  assertEquals(result.admission.execution.outputs, MODELICA_ADMITTED_OUTPUT_MANIFEST);
  assertEquals(
    deterministicJson(result).includes("der(position)"),
    false,
  );
  assertEquals(recursiveKeys(result).has("sourceText"), false);
  assertEquals(recursiveKeys(result).has("modelicaText"), false);
  assertDeeplyFrozen(result);
});

Deno.test(
  "admitted Modelica review binds compilationAdmission to the current review basis, not the earlier creation snapshot",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute(fixture.command);
    const binding = result.operation.bindings[0];

    assertEquals(fixture.reopened.admission.basis.thread.snapshotId, "snapshot.7");
    assertEquals(fixture.reopened.admission.basis.thread.revision, 7);
    assertEquals(fixture.command.basis.snapshotId, "snapshot.8");
    assertEquals(fixture.command.basis.revision, 8);
    assertEquals(result.operation, {
      id: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id,
      version: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version,
      bindings: [{
        name: "compilationAdmission",
        source: {
          kind: "thread-entity",
          reference: {
            snapshotId: fixture.command.basis.snapshotId,
            snapshotRevision: fixture.command.basis.revision,
            kind: "artifact",
            id: fixture.command.artifactId,
          },
        },
      }],
    });
    assertEquals(binding.name, "compilationAdmission");
    assertEquals(binding.source.kind, "thread-entity");
    assertEquals(binding.source.reference.kind, "artifact");
    assertEquals(
      binding.source.reference.snapshotId ===
        fixture.reopened.admission.basis.thread.snapshotId,
      false,
    );
    assertEquals(
      binding.source.reference.snapshotRevision ===
        fixture.reopened.admission.basis.thread.revision,
      false,
    );
    assertEquals(recursiveKeys(result).has("sourceText"), false);
    assertEquals(recursiveKeys(result).has("modelicaText"), false);
    assertDeeplyFrozen(result);
    assertDeeplyFrozen(result.operation);
  },
);

Deno.test("admitted Modelica review refuses a Build123d admission before profile selection", async () => {
  const fixture = await harness();
  const capture = structuredClone(fixture.reopened);
  (capture.document.projections[0] as { target: string }).target = "build123d-source";
  (capture.document.projections[0]!.profile as { target: string }).target =
    "build123d-source";
  fixture.reader.result = capture;
  await assertReviewError(
    () => fixture.service.execute(fixture.command),
    "admission_integrity_failed",
  );
  assertEquals(fixture.profiles.initialCalls, 0);
});

Deno.test("admitted Modelica review refuses caller fields and missing admissions", async () => {
  const extra = await harness();
  await assertReviewError(
    () => extra.service.execute({ ...extra.command, modelicaText: "model X end X;" }),
    "invalid_request",
  );
  assertEquals(extra.reader.calls.length, 0);

  const missing = await harness();
  missing.reader.missing = true;
  await assertReviewError(
    () => missing.service.execute(missing.command),
    "admission_not_found",
  );
  assertEquals(missing.profiles.initialCalls, 0);
});

Deno.test("admitted Modelica review refuses unresolved constructs", async () => {
  const fixture = await harness();
  const capture = structuredClone(fixture.reopened);
  const analysis = capture.document.projections[0]!.sources[0]!
    .analysis as unknown as { unresolvedConstructs: unknown[] };
  analysis.unresolvedConstructs = [{
    id: "unresolved.when",
    kind: "when",
    message: "when is unresolved",
    span: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
  }];
  fixture.reader.result = capture;
  await assertReviewError(
    () => fixture.service.execute(fixture.command),
    "admission_integrity_failed",
  );
});

async function harness(): Promise<Harness> {
  const sourceText = MODELICA_ADMITTED_GENERIC_SOURCE;
  const sourceWorkspace = sampleAdmissionSourceWorkspaceFields(
    "source.modelica.generic-oscillator",
    { projectId: "project.ramp" },
  );
  const sourceCapture = technicalSourceCaptureInput({
    profileId: "modelica-closed-subset-v2",
    sourceId: "source.modelica.generic-oscillator",
    sourceText,
    projectId: "project.ramp",
    attachment: sourceWorkspace.attachment,
    sourceClosure: sourceWorkspace.sourceClosure,
  });
  const analysis = await new QualifiedModelicaSourceAnalyzer().analyze({
    sourceId: sourceCapture.sourceId,
    role: "modelica-model",
    language: "modelica",
    sourceText,
  });
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
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
      { id: "sysml.part.oscillator", kind: "PartUsage", provenance },
      {
        id: "sysml.attribute.initial-position",
        kind: "AttributeUsage",
        provenance,
      },
      {
        id: "sysml.attribute.drive",
        kind: "AttributeUsage",
        provenance,
      },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: "project.ramp",
      subjectId: "subject.ramp",
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
    id: "modelica-closed-subset-v2",
    version: "2.0.0",
    target: "modelica-source-qualification",
    sourceRole: "modelica-model",
    language: "modelica",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "modelica-closed-subset-v2",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
  const artifact = analysis.symbols.find((symbol) => symbol.kind === "artifact")!;
  const parameters = analysis.symbols.filter((symbol) => symbol.kind === "parameter");
  assertEquals(parameters.length, 2);
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint,
      effectiveUnit: sourceCapture.effectiveUnit,
    }],
    bindings: [
      {
        id: "binding.model",
        sourceId: analysis.source.id,
        sourceSymbolId: artifact.id,
        sysmlElementId: "sysml.part.oscillator",
        sysmlElementKind: "PartUsage",
        relation: "represents",
      },
      {
        id: "binding.initial-position",
        sourceId: analysis.source.id,
        sourceSymbolId: parameters.find((symbol) =>
          symbol.name === "initialPosition"
        )!.id,
        sysmlElementId: "sysml.attribute.initial-position",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
      {
        id: "binding.drive",
        sourceId: analysis.source.id,
        sourceSymbolId: parameters.find((symbol) => symbol.name === "drive")!.id,
        sysmlElementId: "sysml.attribute.drive",
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
        draftId: `technical-compilation:project.ramp:${compiled.fingerprint.digest}`,
        projectId: "project.ramp",
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
          role: "modelica-model",
          language: "modelica",
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
        effectiveUnit: sourceCapture.effectiveUnit,
        attachment: sourceCapture.attachment,
        sourceClosure: sourceCapture.sourceClosure,
        locator: sourceWorkspace.locator,
      }],
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: [{
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        target: "modelica-source-qualification",
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
    schemaVersion: MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
    projectId: "project.ramp",
    compilation: compiled.fingerprint,
  });
  const command: ProjectAdmittedModelicaRunReviewCommand = {
    projectId: "project.ramp",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.ramp",
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
  const profileBody: AdmittedModelicaExecutionProfileFingerprintBody = {
    schemaVersion: ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
    executionProfile: MODELICA_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "modelica-source-qualification",
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.modelica-closed-v2",
      version: "2.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.modelica-closed-v2",
        version: "2.0.0",
        network: "deny-all",
      }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `docker.io/casys/modelica-microsandbox-worker@sha256:${
        "5".repeat(64)
      }`,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
    },
    runtime: {
      isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
      requestedLimits: {
        maxWallTimeMs: 30_000,
        maxCpuTimeMs: 20_000,
        maxMemoryBytes: 1_073_741_824,
        maxProcesses: 32,
        maxStdoutBytes: 65_536,
        maxStderrBytes: 65_536,
        maxOutputFileBytes: 1_048_576,
        maxOutputTotalBytes: 2_097_152,
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
    outputManifest: [...MODELICA_ADMITTED_OUTPUT_MANIFEST],
    outputValidator: {
      id: "modelica-closed-subset-v2-result-normalizer",
      version: "2.0.0",
    },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "acknowledged-unattested",
  };
  const profile: AdmittedModelicaExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const reader = new FakeAdmissionReader(reopened);
  const profiles = new FakeExecutionProfileCatalog(profile);
  return {
    service: new PrepareProjectAdmittedModelicaRunReview({
      admissions: reader,
      profiles,
    }),
    command,
    reopened,
    profile,
    reader,
    profiles,
  };
}

async function assertReviewError(
  operation: () => Promise<unknown>,
  code: ProjectAdmittedModelicaRunReviewError["code"],
): Promise<ProjectAdmittedModelicaRunReviewError> {
  const error = await assertRejects(
    operation,
    ProjectAdmittedModelicaRunReviewError,
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
