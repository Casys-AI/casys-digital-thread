import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertProposalMatchesOperationGrammar,
  gatedProposalOperations,
  ProposalGrammarError,
} from "./proposal-validation.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/engineering/architecture-proposal.ts";
import { RECONCILE_UNCERTAIN_WRITER_OPERATION } from "../../domain/project/reconcile-uncertain-writer-proposal.ts";
import { validateSimulationCase } from "../../domain/analysis/simulation-case.ts";
import {
  encodeSimulationCaseDecisionParameters,
} from "../../domain/analysis/simulation-case-proposal.ts";
import { validateSimulationCaseV2 } from "../../domain/analysis/simulation-case-v2.ts";
import {
  encodeSimulationCaseV2DecisionParameters,
} from "../../domain/analysis/simulation-case-v2-proposal.ts";
import {
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
} from "../../domain/analysis/simulation-case-proposal.ts";
import { SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION } from "./recorded-analysis.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../domain/analysis/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/analysis/build123d-execution-proposal.ts";

const VALID_ARCHITECTURE = [
  { key: "architecture.package", label: "Package", value: "DemoArchitecture" },
  { key: "system.name", label: "System", value: "DemoSystem" },
  { key: "component.part.name", label: "Part", value: "DemoPart" },
  { key: "component.part.usage", label: "Usage", value: "demoPart" },
  { key: "component.part.parent", label: "Parent", value: "DemoSystem" },
];

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

function validTechnicalCompilationAdmissionParameters() {
  const projectId = "project.technical-compilation";
  const documentFingerprint = fingerprint("a");
  return encodeTechnicalCompilationAdmissionParameters({
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    draft: {
      draftId: `technical-compilation:${projectId}:${documentFingerprint.digest}`,
      projectId,
      documentFingerprint,
      envelopeFingerprint: fingerprint("b"),
    },
    basis: {
      fingerprint: fingerprint("c"),
      thread: {
        projectId,
        subjectId: "subject.technical-compilation",
        snapshotId: "thread.snapshot.7",
        revision: 7,
        fingerprint: fingerprint("d"),
      },
      sysml: {
        artifactId: "artifact.sysml.model.4",
        artifactFingerprint: fingerprint("e"),
        captureId: "capture.sysml.model.4",
        editingContextId: "editing-context.sysml.model.4",
        rootElementId: "sysml.package.4",
        rootElementKind: "Package",
        anchorFingerprint: fingerprint("f"),
      },
    },
    sources: [{
      id: "source.cad",
      role: "cad-script",
      language: "python",
      profileId: "source-profile.build123d",
      profileVersion: "1.0.0",
      profileFingerprint: fingerprint("1"),
      analyzer: { id: "analyzer.python-cad", version: "1.0.0" },
      sourceFingerprint: fingerprint("2"),
      captureFingerprint: fingerprint("3"),
      analysisFingerprint: fingerprint("4"),
    }],
    bindings: [{
      id: "binding.cad-result-to-sysml-part",
      sourceId: "source.cad",
      sourceSymbolId: "cad.result",
      sysmlElementId: "sysml.part-definition.4",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
    compilationProfileRequests: [{
      profileId: "compilation-profile.build123d",
      profileVersion: "1.0.0",
      target: "build123d-source",
      sourceIds: ["source.cad"],
      profileFingerprint: fingerprint("5"),
    }],
    compilation: {
      fingerprint: documentFingerprint,
      status: "ready-for-review",
    },
  });
}

Deno.test("a proposal the authorising operation cannot parse is refused before it is recorded", () => {
  const misspelledSlug = VALID_ARCHITECTURE.map((parameter) =>
    parameter.key === "component.part.name"
      ? { ...parameter, key: "component.demo-part.name" }
      : parameter
  );
  const error = assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        MODEL_WRITE_ARCHITECTURE_OPERATION,
        misspelledSlug,
      ),
    ProposalGrammarError,
  );
  assertEquals(error.operationKey, "model.write-architecture@1");
  // The underlying grammar message is carried verbatim: the agent needs the
  // offending key, not a generic rejection.
  assert(error.message.includes("component.demo-part.name"));
});

Deno.test("Build123d execution cannot enter human review without its closed admission grammar", () => {
  const error = assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        DESIGN_EXECUTE_BUILD123D_OPERATION,
        [],
      ),
    ProposalGrammarError,
  );
  assertEquals(error.operationKey, "design.execute-build123d@1");
});

Deno.test("a proposal naming an unknown parent is refused with the offending component", () => {
  const unknownParent = VALID_ARCHITECTURE.map((parameter) =>
    parameter.key === "component.part.parent"
      ? { ...parameter, value: "system" }
      : parameter
  );
  const error = assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        MODEL_WRITE_ARCHITECTURE_OPERATION,
        unknownParent,
      ),
    ProposalGrammarError,
  );
  assert(error.message.includes("DemoPart"));
});

Deno.test("a proposal the operation can parse passes the gate untouched", () => {
  assertProposalMatchesOperationGrammar(
    MODEL_WRITE_ARCHITECTURE_OPERATION,
    VALID_ARCHITECTURE,
  );
});

Deno.test("technical compilation admission rejects malformed or extra fields before human review", () => {
  const valid = validTechnicalCompilationAdmissionParameters();
  assertProposalMatchesOperationGrammar(
    COMPILE_SEAL_ADMISSION_OPERATION,
    valid,
  );

  const malformed = valid.map((parameter) =>
    parameter.key === "compile.admission.compilation.status"
      ? { ...parameter, value: "unresolved" }
      : { ...parameter }
  );
  const extra = [...valid, {
    key: "compile.admission.provider",
    label: "Provider",
    value: "caller-selected-provider",
  }];

  for (const parameters of [malformed, extra]) {
    const error = assertThrows(
      () =>
        assertProposalMatchesOperationGrammar(
          COMPILE_SEAL_ADMISSION_OPERATION,
          parameters,
        ),
      ProposalGrammarError,
    );
    assertEquals(error.operationKey, "compile.seal-admission@1");
    assert(error.message.includes("nothing was recorded"));
  }
});

Deno.test("a decision bound to no operation is never gated", () => {
  assertProposalMatchesOperationGrammar(undefined, [
    { key: "anything", label: "Free form", value: "accepted" },
  ]);
});

Deno.test("an operation without a declared grammar is left untouched", () => {
  assertProposalMatchesOperationGrammar(
    { id: "record.archive-lineage", version: "1" },
    [{ key: "archiveAction", label: "Action", value: "retire-lineage" }],
  );
});

Deno.test("reconciliation grammar rejects duplicate, extra, typed and invalid-outcome parameters", () => {
  const valid = [
    { key: "reconcileAction", label: "Action", value: "resolve-uncertain-writer" },
    {
      key: "reconcileOperation",
      label: "Operation",
      value: "record.reconcile-uncertain-writer@1",
    },
    { key: "reconcileRunId", label: "Run", value: "run:failed" },
    {
      key: "reconcileFailureCode",
      label: "Failure",
      value: "provider-outcome-unknown",
    },
    { key: "reconcileBasisSnapshotId", label: "Basis", value: "thread:r4" },
    { key: "reconcileOutcome", label: "Outcome", value: "write-effect-accepted" },
    {
      key: "reconcileAttestation",
      label: "Attestation",
      value: "Inspected provider history.",
    },
  ];
  for (
    const invalid of [
      [...valid, { key: "extra", label: "Extra", value: "x" }],
      [...valid, valid[0]!],
      valid.map((item) =>
        item.key === "reconcileOutcome" ? { ...item, value: "maybe" } : item
      ),
      valid.map((item) =>
        item.key === "reconcileRunId" ? { ...item, value: 42 } : item
      ),
    ]
  ) {
    assertThrows(
      () =>
        assertProposalMatchesOperationGrammar(
          RECONCILE_UNCERTAIN_WRITER_OPERATION,
          invalid,
        ),
      ProposalGrammarError,
    );
  }
});

Deno.test("a decision shared by distinct operations must satisfy every declared grammar", () => {
  assertThrows(
    () =>
      assertProposalMatchesOperationGrammar([
        { id: "record.archive-lineage", version: "1" },
        MODEL_WRITE_ARCHITECTURE_OPERATION,
      ], [{ key: "anything", label: "Free form", value: "accepted" }]),
    ProposalGrammarError,
  );
});

Deno.test("simulation-case proposal validation routes @1 to V1 and seal @2 to the closed V2 grammar", () => {
  const v1 = neutralSimulationCaseV1();
  const v2 = neutralSimulationCaseV2();
  const v1Parameters = encodeSimulationCaseDecisionParameters("a".repeat(64), v1);
  const v2Parameters = encodeSimulationCaseV2DecisionParameters("b".repeat(64), v2);
  assertProposalMatchesOperationGrammar(
    SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
    v1Parameters,
  );
  assertProposalMatchesOperationGrammar(
    SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
    v2Parameters,
  );
  assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
        v1Parameters,
      ),
    ProposalGrammarError,
  );
  assertThrows(
    () =>
      assertProposalMatchesOperationGrammar(
        SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
        v2Parameters,
      ),
    ProposalGrammarError,
  );
});

function neutralSimulationCaseV1() {
  return validateSimulationCase({
    schemaVersion: "simulation-case/1.0",
    id: "thermal-system-nominal-v1",
    revision: 1,
    scope: "Neutral thermal-system routing fixture.",
    evidenceBoundary: "Proposal grammar only; no provider run is asserted.",
    project: {
      id: "thermal-system-project",
      subjectId: "project:thermal-system",
      baseThreadSnapshot: {
        id: "project:thermal-system:r3",
        revision: 3,
        subjectId: "project:thermal-system",
      },
    },
    kit: {
      modelId: "thermal-system-model",
      modelVersion: "1.0.0",
      modelSha256: "c".repeat(64),
    },
    scenario: { id: "nominal-heating", sha256: "d".repeat(64) },
    parameters: [{ id: "targetTemperature", value: 333.15, unit: "K" }],
    expectedMetrics: [{ id: "peakTemperature", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 15_000,
  });
}

function neutralSimulationCaseV2() {
  return validateSimulationCaseV2({
    schemaVersion: "simulation-case/2.0",
    id: "thermal-system-nominal-v2",
    revision: 1,
    scope: "Neutral thermal-system routing fixture.",
    evidenceBoundary: "Proposal grammar only; no provider run is asserted.",
    project: {
      id: "thermal-system-project",
      subjectId: "project:thermal-system",
      baseThreadSnapshot: {
        id: "project:thermal-system:r3",
        revision: 3,
        subjectId: "project:thermal-system",
      },
    },
    kit: {
      modelId: "thermal-system-model",
      modelVersion: "2.0.0",
      modelSha256: "e".repeat(64),
    },
    scenario: {
      id: "nominal-heating",
      sourceSha256: "f".repeat(64),
      projectionSha256: "0".repeat(64),
    },
    parameters: [{ id: "targetTemperature", value: 333.15, unit: "K" }],
    expectedMetrics: [{ id: "peakTemperature", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 15_000,
  });
}

Deno.test("every operation carrying an MRTR grammar is gated", () => {
  // Adding a sealed or model-writing operation without registering its grammar
  // would silently reopen the round trip this module exists to close.
  assertEquals(gatedProposalOperations(), [
    "analyze.seal-sensitivity-study@1",
    "compile.seal-admission@1",
    "design.apply-vector-correction@1",
    "design.execute-build123d@1",
    "design.seal-isolated-geometry@1",
    "design.write-geometry@1",
    "model.seal-architecture-sysml@1",
    "model.write-architecture@1",
    "model.write-requirements@1",
    "record.reconcile-uncertain-writer@1",
    "simulate.run-qualified-modelica-kit@1",
    "simulate.seal-simulation-case@1",
    "simulate.seal-simulation-case@2",
    "verify.seal-proof-case@1",
  ]);
});
