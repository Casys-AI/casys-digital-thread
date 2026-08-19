import { assertEquals, assertRejects } from "@std/assert";
import { MODELICA_QUALIFIED_MODEL_SOURCE } from "../qualified-kit/kit-v1/run.ts";
import { QualifiedModelicaSourceAnalyzer } from "../source/qualified-source-analyzer.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "../../../application/use-cases/modelica/admitted/prepare-run-review.ts";
import {
  ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
  type AdmittedModelicaExecutionProfile,
  type AdmittedModelicaExecutionProfileCatalog,
  type AdmittedModelicaExecutionProfileFingerprintBody,
} from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../application/ports/out/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../application/ports/out/technical-compilation-draft-store.ts";
import {
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
} from "../../../domain/modelica/admitted/run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/analysis/local-isolation-runtime.ts";
import { fingerprintSourceAnalysisBundle } from "../../../domain/analysis/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../domain/analysis/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../domain/analysis/technical-compilation-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { reopenAdmittedExecutionRequest } from "./run-executor.ts";

Deno.test("admitted execute reopens sealed Modelica bytes and never takes caller text", async () => {
  const fixture = await harness();
  const context = await reopenAdmittedExecutionRequest({
    admissions: fixture.reader,
    profiles: fixture.profiles,
    project: { project: { id: "project.ramp" } } as never,
    run: { id: "run.admitted", basis: fixture.command.basis } as never,
    basisSnapshot: { id: "snapshot.8", revision: 8 } as never,
    admission: (await fixture.review.execute(fixture.command)).admission,
  });
  const sourceSha = (await fingerprintTechnicalSourceText(
    MODELICA_QUALIFIED_MODEL_SOURCE,
  )).digest;
  assertEquals(context.request.source.sha256, sourceSha);
  assertEquals(
    new TextDecoder().decode(context.request.source.bytes),
    MODELICA_QUALIFIED_MODEL_SOURCE,
  );
  assertEquals(context.request.outputs, [...MODELICA_ADMITTED_OUTPUT_MANIFEST]);
});

Deno.test("admitted execute refuses a Build123d projection", async () => {
  const fixture = await harness();
  const admission = (await fixture.review.execute(fixture.command)).admission;
  const capture = structuredClone(fixture.reopened);
  (capture.document.projections[0] as { target: string }).target = "build123d-source";
  fixture.reader.result = capture;
  await assertRejects(
    () =>
      reopenAdmittedExecutionRequest({
        admissions: fixture.reader,
        profiles: fixture.profiles,
        project: { project: { id: "project.ramp" } } as never,
        run: { id: "run.admitted", basis: fixture.command.basis } as never,
        basisSnapshot: { id: "snapshot.8", revision: 8 } as never,
        admission,
      }),
    Error,
  );
});

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  constructor(public result: ReopenedTechnicalCompilationAdmission) {}
  read(): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    return Promise.resolve(structuredClone(this.result));
  }
}

class FakeProfiles implements AdmittedModelicaExecutionProfileCatalog {
  constructor(public profile: AdmittedModelicaExecutionProfile) {}
  initial(): Promise<AdmittedModelicaExecutionProfile> {
    return Promise.resolve(structuredClone(this.profile));
  }
  resolve(): Promise<AdmittedModelicaExecutionProfile> {
    return Promise.resolve(structuredClone(this.profile));
  }
}

async function harness() {
  const sourceText = MODELICA_QUALIFIED_MODEL_SOURCE;
  const analysis = await new QualifiedModelicaSourceAnalyzer().analyze({
    sourceId: "source.modelica.linear-ramp",
    role: "modelica-model",
    language: "modelica",
    sourceText,
  });
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  const sysmlFingerprint = { algorithm: "sha256" as const, digest: "2".repeat(64) };
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
      { id: "sysml.part.ramp", kind: "PartUsage", provenance },
      { id: "sysml.attribute.heating-rate", kind: "AttributeUsage", provenance },
      {
        id: "sysml.attribute.initial-temperature",
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
      snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const compilationProfile: TechnicalCompilationProfile = {
    id: "modelica-closed-subset-v1",
    version: "1.0.0",
    target: "modelica-source-qualification",
    sourceRole: "modelica-model",
    language: "modelica",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "modelica-closed-subset-v1",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
  const artifact = analysis.symbols.find((symbol) => symbol.kind === "artifact")!;
  const parameters = analysis.symbols.filter((symbol) => symbol.kind === "parameter");
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{ sourceText, analysis, analysisFingerprint }],
    bindings: [
      {
        id: "binding.model",
        sourceId: analysis.source.id,
        sourceSymbolId: artifact.id,
        sysmlElementId: "sysml.part.ramp",
        sysmlElementKind: "PartUsage",
        relation: "represents",
      },
      {
        id: "binding.heating-rate",
        sourceId: analysis.source.id,
        sourceSymbolId: parameters.find((symbol) => symbol.name === "heatingRate")!
          .id,
        sysmlElementId: "sysml.attribute.heating-rate",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
      {
        id: "binding.initial-temperature",
        sourceId: analysis.source.id,
        sourceSymbolId: parameters.find((symbol) =>
          symbol.name === "initialTemperature"
        )!.id,
        sysmlElementId: "sysml.attribute.initial-temperature",
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
  const projection = compiled.document.projections[0]!;
  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters({
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
      draft: {
        draftId: `technical-compilation:project.ramp:${compiled.fingerprint.digest}`,
        projectId: "project.ramp",
        documentFingerprint: compiled.fingerprint,
        envelopeFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
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
        captureFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
        analysisFingerprint,
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
  const command = {
    projectId: "project.ramp",
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.ramp",
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
  const profileBody: AdmittedModelicaExecutionProfileFingerprintBody = {
    schemaVersion: ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
    executionProfile: MODELICA_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "modelica-source-qualification",
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.modelica-closed-v1",
      version: "1.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.modelica-closed-v1",
        version: "1.0.0",
        network: "deny-all",
      }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `casys/modelica-microsandbox-worker@sha256:${"5".repeat(64)}`,
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
      id: "modelica-closed-subset-result-normalizer",
      version: "1.0.0",
    },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "acknowledged-unattested",
  };
  const profile: AdmittedModelicaExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const reader = new FakeAdmissionReader(reopened);
  const profiles = new FakeProfiles(profile);
  return {
    command,
    reopened,
    reader,
    profiles,
    review: new PrepareProjectAdmittedModelicaRunReview({
      admissions: reader,
      profiles,
    }),
  };
}
