import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ProjectBuild123dExecutionReviewCommand } from "../../../ports/in/cad/isolated/project-build123d-execution-review.ts";
import {
  BUILD123D_EXECUTION_PROFILE_SCHEMA,
  type Build123dExecutionProfile,
  type Build123dExecutionProfileCatalog,
  type Build123dExecutionProfileFingerprintBody,
} from "../../../ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  parseBuild123dExecutionAdmissionParameters,
} from "../../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
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
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { sampleAdmissionSourceWorkspaceFields } from "../../../../testing/technical-source-capture-test-support.ts";
import {
  PrepareProjectBuild123dExecutionReview,
  ProjectBuild123dExecutionReviewError,
} from "./prepare-project-build123d-execution-review.ts";

interface Harness {
  readonly service: PrepareProjectBuild123dExecutionReview;
  readonly command: ProjectBuild123dExecutionReviewCommand;
  readonly reopened: ReopenedTechnicalCompilationAdmission;
  readonly profile: Build123dExecutionProfile;
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

class FakeExecutionProfileCatalog implements Build123dExecutionProfileCatalog {
  initialCalls = 0;
  resolveCalls = 0;
  failure?: Error;

  constructor(public profile: Build123dExecutionProfile) {}

  initial(): Promise<Build123dExecutionProfile> {
    this.initialCalls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(structuredClone(this.profile));
  }

  resolve(): Promise<Build123dExecutionProfile> {
    this.resolveCalls += 1;
    return Promise.reject(new Error("prepare must never resolve caller input"));
  }
}

Deno.test("execution review reopens one sealed source and derives canonical provider-free MRTR facts", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute(fixture.command);
  const replay = parseBuild123dExecutionAdmissionParameters(
    result.decisionParameters,
  );

  assertEquals(result.admission, replay);
  assertEquals(fixture.reader.calls, [fixture.command]);
  assertEquals(fixture.profiles.initialCalls, 1);
  assertEquals(fixture.profiles.resolveCalls, 0);
  assertEquals(result.admission.admissionArtifact, {
    schemaVersion: BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
    id: fixture.command.artifactId,
    fingerprint: fixture.command.artifactFingerprint,
  });
  assertEquals(
    result.admission.compilation.document.fingerprint,
    fixture.reopened.admission.compilation.fingerprint,
  );
  assertEquals(
    result.admission.compilation.projection.fingerprint,
    await sha256Fingerprint(fixture.reopened.document.projections[0]),
  );
  assertEquals(
    result.admission.execution.profile.fingerprint,
    fixture.profile.profileFingerprint,
  );
  assertEquals(
    result.admission.execution.runtimeBackend,
    fixture.profile.runtimeBackend,
  );
  assertEquals(result.admission.execution.output, BUILD123D_EXECUTION_OUTPUT);
  assertEquals(
    result.admission.execution.outputValidator,
    fixture.profile.outputValidator,
  );
  assertEquals(
    result.decisionParameters.find((parameter) =>
      parameter.key === "design.build123d.execution.outputValidator.id"
    )?.value,
    fixture.profile.outputValidator.id,
  );
  assertEquals(
    result.decisionParameters.find((parameter) =>
      parameter.key === "design.build123d.execution.outputValidator.version"
    )?.value,
    fixture.profile.outputValidator.version,
  );
  for (const key of ["id", "version", "lifecycle", "network"] as const) {
    assertEquals(
      result.decisionParameters.find((parameter) =>
        parameter.key === `design.build123d.execution.runtimeBackend.${key}`
      )?.value,
      fixture.profile.runtimeBackend[key],
    );
  }
  assertEquals(
    result.decisionParameters.find((parameter) =>
      parameter.key ===
        "design.build123d.execution.runtimeBackend.imageReference"
    )?.value,
    fixture.profile.runtimeBackend.imageReference,
  );
  assertDeeplyFrozen(result);

  const serialized = deterministicJson(result);
  assertEquals(serialized.includes("from build123d import Box"), false);
  assertEquals(recursiveKeys(result).has("sourceText"), false);
  assertEquals(recursiveKeys(result).has("bytes"), false);
});

Deno.test(
  "execution review binds compilationAdmission to the current review basis, not the earlier creation snapshot",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute(fixture.command);
    const binding = result.operation.bindings[0];

    assertEquals(fixture.reopened.admission.basis.thread.snapshotId, "snapshot.7");
    assertEquals(fixture.reopened.admission.basis.thread.revision, 7);
    assertEquals(fixture.command.basis.snapshotId, "snapshot.8");
    assertEquals(fixture.command.basis.revision, 8);
    assertEquals(result.operation, {
      id: DESIGN_EXECUTE_BUILD123D_OPERATION.id,
      version: DESIGN_EXECUTE_BUILD123D_OPERATION.version,
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
    assertEquals(recursiveKeys(result).has("bytes"), false);
    assertDeeplyFrozen(result);
    assertDeeplyFrozen(result.operation);
  },
);

Deno.test("execution review is deterministic across exact reopens", async () => {
  const fixture = await harness();
  const first = await fixture.service.execute(structuredClone(fixture.command));
  const second = await fixture.service.execute(structuredClone(fixture.command));

  assertEquals(first, second);
  assertEquals(deterministicJson(first), deterministicJson(second));
  assertEquals(fixture.reader.calls.length, 2);
  assertEquals(fixture.profiles.initialCalls, 2);
});

Deno.test("unknown caller fields and non-derived artifact ids perform no outward I/O", async () => {
  const fixture = await harness();
  await assertReviewError(
    () => fixture.service.execute({ ...fixture.command, profile: "caller" }),
    "invalid_request",
  );
  await assertReviewError(
    () =>
      fixture.service.execute({
        ...fixture.command,
        artifactId: "technical-compilation-admission-foreign",
      }),
    "invalid_request",
  );

  assertEquals(fixture.reader.calls.length, 0);
  assertEquals(fixture.profiles.initialCalls, 0);
  assertEquals(fixture.profiles.resolveCalls, 0);
});

Deno.test("missing admission stops before execution-profile selection", async () => {
  const fixture = await harness();
  fixture.reader.missing = true;

  await assertReviewError(
    () => fixture.service.execute(fixture.command),
    "admission_not_found",
  );
  assertEquals(fixture.reader.calls.length, 1);
  assertEquals(fixture.profiles.initialCalls, 0);
});

Deno.test("foreign or stale reopened admissions fail closed before profile selection", async () => {
  const foreign = await harness();
  const foreignCapture = structuredClone(foreign.reopened);
  (foreignCapture.admission.draft as { projectId: string }).projectId =
    "project.foreign";
  foreign.reader.result = foreignCapture;
  await assertReviewError(
    () => foreign.service.execute(foreign.command),
    "admission_integrity_failed",
  );
  assertEquals(foreign.profiles.initialCalls, 0);

  const stale = await harness();
  const staleCapture = structuredClone(stale.reopened);
  (staleCapture.document as { status: string }).status = "unresolved";
  stale.reader.result = staleCapture;
  await assertReviewError(
    () => stale.service.execute(stale.command),
    "admission_integrity_failed",
  );
  assertEquals(stale.profiles.initialCalls, 0);

  const nonSuccessor = await harness();
  await assertReviewError(
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
  assertEquals(nonSuccessor.profiles.initialCalls, 0);
});

Deno.test("additional projection or source can never enter singular Build123d V1 review", async () => {
  const extraProjection = await harness();
  const projectionCapture = structuredClone(extraProjection.reopened);
  (projectionCapture.document.projections as unknown[]).push(
    structuredClone(projectionCapture.document.projections[0]),
  );
  extraProjection.reader.result = projectionCapture;
  await assertReviewError(
    () => extraProjection.service.execute(extraProjection.command),
    "admission_integrity_failed",
  );
  assertEquals(extraProjection.profiles.initialCalls, 0);

  const extraSource = await harness();
  const sourceCapture = structuredClone(extraSource.reopened);
  (sourceCapture.document.inputManifest.sources as unknown[]).push(
    structuredClone(sourceCapture.document.inputManifest.sources[0]),
  );
  extraSource.reader.result = sourceCapture;
  await assertReviewError(
    () => extraSource.service.execute(extraSource.command),
    "admission_integrity_failed",
  );
  assertEquals(extraSource.profiles.initialCalls, 0);
});

Deno.test("self-consistent execution-profile drift is rejected against the sealed projection", async () => {
  const fixture = await harness();
  const driftedBody: Build123dExecutionProfileFingerprintBody = {
    ...withoutProfileFingerprint(fixture.profile),
    compilationProfile: {
      ...fixture.profile.compilationProfile,
      analysisPolicyProfile: "build123d-other-policy",
    },
  };
  fixture.profiles.profile = {
    ...driftedBody,
    compilationProfileFingerprint: await sha256Fingerprint(
      driftedBody.compilationProfile,
    ),
    profileFingerprint: await sha256Fingerprint({
      ...driftedBody,
      compilationProfileFingerprint: await sha256Fingerprint(
        driftedBody.compilationProfile,
      ),
    }),
  };

  await assertReviewError(
    () => fixture.service.execute(fixture.command),
    "execution_profile_integrity_failed",
  );
  assertEquals(fixture.reader.calls.length, 1);
  assertEquals(fixture.profiles.initialCalls, 1);
  assertEquals(fixture.profiles.resolveCalls, 0);
});

Deno.test("reader and profile failures are normalized without leaking causes or paths", async () => {
  const readerFailure = await harness();
  readerFailure.reader.failure = new Error(
    "secret token at /private/technical-admission.json",
  );
  const readerError = await assertReviewError(
    () => readerFailure.service.execute(readerFailure.command),
    "admission_resolution_failed",
  );
  assertEquals(readerError.cause, undefined);
  assertEquals(readerError.message.includes("/private/"), false);
  assertEquals(readerError.message.includes("secret"), false);

  const profileFailure = await harness();
  profileFailure.profiles.failure = new Error(
    "sdk credential at /private/runtime.json",
  );
  const profileError = await assertReviewError(
    () => profileFailure.service.execute(profileFailure.command),
    "execution_profile_unavailable",
  );
  assertEquals(profileError.cause, undefined);
  assertEquals(profileError.message.includes("/private/"), false);
  assertEquals(profileError.message.includes("credential"), false);
});

async function harness(): Promise<Harness> {
  const sourceText = [
    "from build123d import Box",
    "thickness = 2",
    "result = Box(20, 10, thickness)",
    "",
  ].join("\n");
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
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
  const analysis: SourceAnalysisBundle = {
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
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint,
      effectiveUnit,
    }],
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
  const command: ProjectBuild123dExecutionReviewCommand = {
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
  const profileBody: Build123dExecutionProfileFingerprintBody = {
    schemaVersion: BUILD123D_EXECUTION_PROFILE_SCHEMA,
    executionProfile: BUILD123D_EXECUTION_PROFILE,
    compilationTarget: "build123d-source",
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.build123d-closed-v1",
      version: "1.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.build123d-closed-v1",
        version: "1.0.0",
        network: "deny-all",
      }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `ghcr.io/casys-ai/build123d-runtime@sha256:${"5".repeat(64)}`,
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
        maxOutputFileBytes: 33_554_432,
        maxOutputTotalBytes: 33_554_432,
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
    outputManifest: [BUILD123D_EXECUTION_OUTPUT],
    outputValidator: {
      id: "occt-step-ap214",
      version: "1.0.0",
    },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "acknowledged-unattested",
  };
  const profile: Build123dExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const reader = new FakeAdmissionReader(reopened);
  const profiles = new FakeExecutionProfileCatalog(profile);
  return {
    service: new PrepareProjectBuild123dExecutionReview({
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
  code: ProjectBuild123dExecutionReviewError["code"],
): Promise<ProjectBuild123dExecutionReviewError> {
  const error = await assertRejects(
    operation,
    ProjectBuild123dExecutionReviewError,
  );
  assertEquals(error.code, code);
  return error;
}

function withoutProfileFingerprint(
  profile: Build123dExecutionProfile,
): Build123dExecutionProfileFingerprintBody {
  const { profileFingerprint: _profileFingerprint, ...body } = profile;
  return body;
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
