import { assert, assertEquals } from "@std/assert";
import type { ProjectAdmittedSpiceRunReviewCommand } from "../../../../ports/in/electrical/spice/admitted-run-review.ts";
import {
  ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
  type AdmittedSpiceExecutionProfile,
  type AdmittedSpiceExecutionProfileCatalog,
  type AdmittedSpiceExecutionProfileFingerprintBody,
} from "../../../../ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  SPICE_ADMITTED_EXECUTION_PROFILE,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
} from "../../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintSourceAnalysisBundle } from "../../../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  technicalSourceCaptureInput,
} from "../../../../../testing/technical-source-capture-test-support.ts";
import { sha256Fingerprint } from "../../../../../domain/kernel/deterministic-json.ts";
import { SpiceCircuitSourceAnalyzer } from "../../../../../adapters/electrical/spice/circuit-source-analyzer.ts";
import { PrepareProjectAdmittedSpiceRunReview } from "./prepare-run-review.ts";

const SPICE_DIVIDER_SOURCE = "Vin in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n";

interface Harness {
  readonly service: PrepareProjectAdmittedSpiceRunReview;
  readonly command: ProjectAdmittedSpiceRunReviewCommand;
  readonly reopened: ReopenedTechnicalCompilationAdmission;
}

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  constructor(public result: ReopenedTechnicalCompilationAdmission) {}

  read(
    _request: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    return Promise.resolve(structuredClone(this.result));
  }
}

class FakeExecutionProfileCatalog implements AdmittedSpiceExecutionProfileCatalog {
  constructor(public profile: AdmittedSpiceExecutionProfile) {}

  initial(): Promise<AdmittedSpiceExecutionProfile> {
    return Promise.resolve(structuredClone(this.profile));
  }

  resolve(): Promise<AdmittedSpiceExecutionProfile> {
    return Promise.reject(new Error("prepare must never resolve caller input"));
  }
}

Deno.test(
  "admitted SPICE review binds compilationAdmission to the current review basis, not the earlier creation snapshot",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute(fixture.command);
    const binding = result.operation.bindings[0];

    assertEquals(fixture.reopened.admission.basis.thread.snapshotId, "snapshot.7");
    assertEquals(fixture.reopened.admission.basis.thread.revision, 7);
    assertEquals(fixture.command.basis.snapshotId, "snapshot.8");
    assertEquals(fixture.command.basis.revision, 8);
    assertEquals(result.operation, {
      id: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id,
      version: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version,
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
    assertEquals(JSON.stringify(result).includes("Vin in 0"), false);
    assertDeeplyFrozen(result);
    assertDeeplyFrozen(result.operation);
  },
);

async function harness(): Promise<Harness> {
  const sourceText = SPICE_DIVIDER_SOURCE;
  const sourceWorkspace = sampleAdmissionSourceWorkspaceFields(
    "source.spice.divider",
    { projectId: "project.ramp" },
  );
  const sourceCapture = technicalSourceCaptureInput({
    profileId: "spice-circuit-closed-subset-v1",
    sourceId: "source.spice.divider",
    sourceText,
    projectId: "project.ramp",
    attachment: sourceWorkspace.attachment,
    sourceClosure: sourceWorkspace.sourceClosure,
  });
  const analysis = await new SpiceCircuitSourceAnalyzer().analyze({
    sourceId: sourceCapture.sourceId,
    role: "spice-circuit",
    language: "spice",
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
      { id: "sysml.part.divider", kind: "PartUsage", provenance },
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
    id: "spice-circuit-closed-subset-v1",
    version: "1.0.0",
    target: "spice-circuit-source",
    sourceRole: "spice-circuit",
    language: "spice",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "spice-circuit-closed-subset-v1",
    requiredBindingSymbolKinds: ["parameter"],
  };
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
    bindings: [],
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
          role: "spice-circuit",
          language: "spice",
          analyzer: compilationProfile.analyzer,
          maximumSourceBytes: 262_144,
        }),
        analyzer: analysis.analyzer,
        sourceFingerprint,
        captureFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
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
        target: "spice-circuit-source",
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
    schemaVersion: SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
    projectId: "project.ramp",
    compilation: compiled.fingerprint,
  });
  const command: ProjectAdmittedSpiceRunReviewCommand = {
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
  const profileBody: AdmittedSpiceExecutionProfileFingerprintBody = {
    schemaVersion: ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    executionProfile: SPICE_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "spice-circuit-source",
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.spice-closed-v1",
      version: "1.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.spice-closed-v1",
        version: "1.0.0",
        network: "deny-all",
      }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `casys/ngspice-microsandbox-worker@sha256:${"5".repeat(64)}`,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
    },
    runtime: {
      isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
      requestedLimits: {
        maxWallTimeMs: 30_000,
        maxCpuTimeMs: 25_000,
        maxMemoryBytes: 512 * 1_048_576,
        maxProcesses: 16,
        maxStdoutBytes: 65_536,
        maxStderrBytes: 65_536,
        maxOutputFileBytes: 262_144,
        maxOutputTotalBytes: 524_288,
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
    outputManifest: [...SPICE_ADMITTED_OUTPUT_MANIFEST],
    outputValidator: {
      id: "spice-operating-point-print-vectors",
      version: "1.0.0",
    },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "proven",
  };
  const profile: AdmittedSpiceExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const reader = new FakeAdmissionReader(reopened);
  const profiles = new FakeExecutionProfileCatalog(profile);
  return {
    service: new PrepareProjectAdmittedSpiceRunReview({
      admissions: reader,
      profiles,
    }),
    command,
    reopened,
  };
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
