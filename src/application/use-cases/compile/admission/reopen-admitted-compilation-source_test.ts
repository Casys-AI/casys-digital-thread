import { assertEquals, assertRejects } from "@std/assert";
import {
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
  QualifiedModelicaSourceAnalyzer,
} from "../../../../adapters/modelica/source/qualified-source-analyzer.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import { fingerprintSourceAnalysisBundle } from "../../../../domain/compile/source/source-analysis.ts";
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
} from "../../../../testing/technical-source-capture-test-support.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import {
  isolatedRequestFromAdmittedSource,
  ReopenAdmittedCompilationSource,
} from "./reopen-admitted-compilation-source.ts";
import { ReopenAdmittedCompilationSourceError } from "../../../ports/in/compile/admission/reopen-admitted-compilation-source.ts";

const MODELICA_CLOSED_SUBSET_V2_SOURCE = `model ReopenedTemperatureTrial
  parameter Real initialTemperature(unit = "degC") = 20;
  parameter Real heatingRate(unit = "K/s") = 1;
  output Real temperatureC(
    unit = "degC",
    start = 20,
    fixed = true);
equation
  der(temperatureC) = heatingRate;
annotation(experiment(
  StartTime = 0,
  StopTime = 2,
  Interval = 0.1,
  Tolerance = 1e-6));
end ReopenedTemperatureTrial;
`;
const SOURCE_CLOSURE_DIGEST = "d".repeat(64);
const SOURCE_ID = `technical-unit:${SOURCE_CLOSURE_DIGEST}`;

Deno.test("admitted compilation reopen returns exact Modelica bytes for the microVM request", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute({
    ...fixture.command,
    expectedTarget: "modelica-source-qualification",
  });
  const sourceSha = (await fingerprintTechnicalSourceText(
    MODELICA_CLOSED_SUBSET_V2_SOURCE,
  )).digest;
  assertEquals(result.sourceText, MODELICA_CLOSED_SUBSET_V2_SOURCE);
  assertEquals(result.sourceFingerprint.digest, sourceSha);
  const request = await isolatedRequestFromAdmittedSource({
    runId: "admitted-modelica-test",
    sourceText: result.sourceText,
    sourceSha256: result.sourceFingerprint.digest,
    profile: {
      id: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
      version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
    },
    policy: {
      id: "isolation.modelica-closed-v2",
      version: "2.0.0",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    },
    outputs: [{
      role: "evidence",
      basename: "evidence.json",
      mediaType: "application/json",
      format: "modelica-isolated-evidence-v1",
    }, {
      role: "result",
      basename: "result.csv",
      mediaType: "text/csv",
      format: "openmodelica-result-csv",
    }],
    maximumSourceBytes: 262_144,
  });
  assertEquals(request.source.sha256, sourceSha);
  assertEquals(
    new TextDecoder().decode(request.source.bytes),
    MODELICA_CLOSED_SUBSET_V2_SOURCE,
  );
  assertEquals(fixture.reader.requests, [fixture.command]);
});

Deno.test("admitted compilation reopen refuses the wrong compilation target", async () => {
  const fixture = await harness();
  const error = await assertRejects(
    () =>
      fixture.service.execute({
        ...fixture.command,
        expectedTarget: "build123d-source",
      }),
    ReopenAdmittedCompilationSourceError,
  );
  assertEquals(error.code, "admission_integrity_failed");
});

Deno.test("admitted compilation reopen rejects caller source text", async () => {
  const fixture = await harness();
  const error = await assertRejects(
    () =>
      fixture.service.execute({
        ...fixture.command,
        expectedTarget: "modelica-source-qualification",
        sourceText: "model X end X;",
      }),
    ReopenAdmittedCompilationSourceError,
  );
  assertEquals(error.code, "invalid_request");
});

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  readonly requests: unknown[] = [];

  constructor(public result: ReopenedTechnicalCompilationAdmission) {}
  read(
    request: Parameters<TechnicalCompilationAdmissionReader["read"]>[0],
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    this.requests.push(structuredClone(request));
    return Promise.resolve(structuredClone(this.result));
  }
}

async function harness() {
  const sourceText = MODELICA_CLOSED_SUBSET_V2_SOURCE;
  const analysis = await new QualifiedModelicaSourceAnalyzer().analyze({
    sourceId: SOURCE_ID,
    role: "modelica-model",
    language: "modelica",
    sourceText,
  });
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  const effectiveUnit = {
    kind: "authored-root" as const,
    closureKind: "root-only" as const,
    unitId: SOURCE_ID,
    closureFingerprint: { algorithm: "sha256" as const, digest: SOURCE_CLOSURE_DIGEST },
    scriptFingerprint: sourceFingerprint,
  };
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
    id: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
    version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
    target: "modelica-source-qualification",
    sourceRole: "modelica-model",
    language: "modelica",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
  const artifact = analysis.symbols.find((symbol) => symbol.kind === "artifact")!;
  const parameters = analysis.symbols.filter((symbol) => symbol.kind === "parameter");
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
        effectiveUnit,
        ...sampleAdmissionSourceWorkspaceFields(analysis.source.id, {
          projectId: "project.ramp",
          locatorDigest: "4".repeat(64),
        }),
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
    schemaVersion: "technical-compilation-admission-capture/4.0",
    projectId: "project.ramp",
    compilation: compiled.fingerprint,
  });
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
  return {
    command: {
      projectId: "project.ramp",
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: "snapshot.8",
        revision: 8,
        subjectId: "subject.ramp",
      },
      artifactId: `technical-compilation-admission-${artifactFingerprint.digest}`,
      artifactFingerprint,
    },
    reader,
    service: new ReopenAdmittedCompilationSource({ admissions: reader }),
  };
}
