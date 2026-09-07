import { assertEquals, assertRejects } from "@std/assert";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  validateIsolatedCodeExecutionRequest,
} from "../../domain/compile/isolation/isolated-code-execution.ts";
import {
  fingerprintResourceBytes,
  immutableBytes,
} from "../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  admittedModelicaExecutionContractFromSourceBytes,
  deriveAdmittedModelicaExecutionRunId,
  type ModelicaAdmittedExecutionCapture,
} from "../../domain/modelica/admitted/execution-evidence.ts";
import { buildDocumentarySuccessor } from "../../domain/modelica/admitted/documentary-thread-evidence.ts";
import { buildAdmittedModelicaPublishedOutputCapture } from "../../domain/modelica/admitted/published-output-evidence.ts";
import {
  encodeModelicaAdmittedRunAdmissionParameters,
  MODELICA_ADMITTED_COMPILATION_PROFILE_ID,
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  MODELICA_ADMITTED_RUN_ADMISSION_SCHEMA,
  parseModelicaAdmittedRunAdmissionParameters,
} from "../../domain/modelica/admitted/run-proposal.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import {
  buildModelicaViewerBinding,
  type ModelicaExecutionCaptureReader,
} from "./modelica-viewer-binding.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";

const AT = "2026-09-07T12:00:00.000Z";
const SOURCE = `model ViewerOscillator
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = 0, fixed = true);
equation
  der(position) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end ViewerOscillator;
`;

Deno.test("Modelica automatic registration reopens an exact admitted capture", async () => {
  const fixture = await modelicaFixture();
  try {
    const binding = await buildModelicaViewerBinding(fixture);
    assertEquals(
      binding?.session.schema,
      "io.casys.mcp-modelica.recorded-admitted-execution-session/1.0",
    );
    assertEquals(
      (binding?.session.payload.provenance as { operation: string }).operation,
      "simulate.run-admitted-modelica@1",
    );
    assertEquals(
      (binding?.session.payload.projection as { capture: { modelName: string } })
        .capture.modelName,
      "ViewerOscillator",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("Modelica registration rejects a capture whose project identity differs", async () => {
  const fixture = await modelicaFixture({ captureProjectId: "foreign-project" });
  try {
    await assertRejects(
      () => buildModelicaViewerBinding(fixture),
      TypeError,
      "current project or producer",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("Modelica registration rejects capture bytes that differ from their Thread fingerprint", async () => {
  const fixture = await modelicaFixture();
  try {
    fixture.captures.read = () => Promise.resolve(immutableBytes(new Uint8Array([1])));
    await assertRejects(
      () => buildModelicaViewerBinding(fixture),
      TypeError,
      "bytes do not match",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

async function modelicaFixture(options: { captureProjectId?: string } = {}) {
  const root = await Deno.makeTempDir({ prefix: "modelica-viewer-binding-" });
  const projectId = "modelica-viewer";
  const agentRunId = "run.admitted";
  const capture = await validCapture({
    projectId: options.captureProjectId ?? projectId,
    agentRunId,
  });
  const captureText = deterministicJson(capture);
  const captureFingerprint = await sha256Fingerprint(capture);
  const basis = await modelicaBasis(projectId, AT);
  const documentary = buildDocumentarySuccessor({
    basisSnapshot: basis,
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    runId: agentRunId,
    capturedAt: AT,
    capture,
    captureFingerprint,
    captureUri:
      `casys://modelica-admitted-execution-capture/sha256/${captureFingerprint.digest}`,
    receipt: capture.receipt as never,
  });
  const project = await projectFor(
    root,
    projectId,
    documentary.snapshot.id,
    basis.subject.id,
  );
  return {
    root,
    project,
    thread: documentary.snapshot,
    artifactId: documentary.artifacts[2].id,
    captures: {
      read: () =>
        Promise.resolve(immutableBytes(new TextEncoder().encode(captureText))),
    } as { read: ModelicaExecutionCaptureReader["read"] },
    packages: modelicaPackages(),
  };
}

async function validCapture(input: {
  projectId: string;
  agentRunId: string;
}): Promise<ModelicaAdmittedExecutionCapture> {
  const sourceBytes = new TextEncoder().encode(SOURCE);
  const sourceSha256 = await fingerprintResourceBytes(sourceBytes);
  const contract = admittedModelicaExecutionContractFromSourceBytes(sourceBytes);
  const executionRunId = await deriveAdmittedModelicaExecutionRunId(
    input.projectId,
    input.agentRunId,
  );
  const resultBytes = new TextEncoder().encode(
    `time,${contract.outputs.map((output) => output.name).join(",")}\n0,${
      contract.outputs.map(() => "0").join(",")
    }\n`,
  );
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  const evidenceBytes = new TextEncoder().encode(deterministicJson({
    schemaVersion: "modelica-isolated-evidence/2.0",
    inputBundleSha256: sourceSha256,
    status: "succeeded",
    method: {
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      resultNormalizer: {
        id: "modelica-closed-subset-v2-result-normalizer",
        version: "2.0.0",
      },
      engine: { name: "OpenModelica", version: "1.25.0", mslVersion: "not-used" },
    },
    modelName: contract.modelName,
    scenario: contract.scenario,
    resolvedParameters: contract.parameters,
    metrics: contract.outputs.flatMap((output) => [
      { outputName: output.name, statistic: "final", value: 0, unit: output.unit },
      { outputName: output.name, statistic: "max_abs", value: 0, unit: output.unit },
    ]),
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: resultSha256,
    },
    warnings: [],
  }));
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: "isolated-code-execution-request/1.0",
    runId: executionRunId,
    producerGeneration: 0,
    profile: MODELICA_ADMITTED_EXECUTION_PROFILE,
    source: { bytes: sourceBytes, sha256: sourceSha256 },
    policy: {
      id: "isolation.modelica-deny-net",
      version: "2.0.0",
      fingerprint: fingerprint("3"),
    },
    outputs: [...MODELICA_ADMITTED_OUTPUT_MANIFEST],
  });
  const outputs = await Promise.all(request.outputs.map(async (declaration) => {
    const bytes = declaration.role === "evidence" ? evidenceBytes : resultBytes;
    const sha256 = await fingerprintResourceBytes(bytes);
    return {
      ...declaration,
      bytes,
      byteCount: bytes.byteLength,
      sha256,
      casUri: `casys://isolated-output/sha256/${sha256}`,
    };
  }));
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: runtime(),
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs,
    destruction: {
      status: "proven",
      runId: executionRunId,
      proofFingerprint: fingerprint("7"),
    },
    publication: await createIsolatedOutputPublicationRef(
      executionRunId,
      0,
      fingerprint("8"),
    ),
  });
  return await buildAdmittedModelicaPublishedOutputCapture({
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    executionRunId,
    admission: admission(),
    sourceBytes,
    sourceSha256,
    receipt,
    evidenceBytes,
    resultBytes,
  });
}

function admission() {
  const admissionFingerprint = fingerprint("a");
  return parseModelicaAdmittedRunAdmissionParameters(
    encodeModelicaAdmittedRunAdmissionParameters({
      schemaVersion: MODELICA_ADMITTED_RUN_ADMISSION_SCHEMA,
      admissionArtifact: {
        schemaVersion: MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
        id: `technical-compilation-admission-${admissionFingerprint.digest}`,
        fingerprint: admissionFingerprint,
      },
      compilation: {
        document: {
          schemaVersion: "technical-compilation/2.0",
          fingerprint: fingerprint("b"),
          status: "ready-for-review",
        },
        projection: {
          target: "modelica-source-qualification",
          fingerprint: fingerprint("c"),
          status: "ready-for-review",
        },
        source: {
          id: "source.viewer-oscillator",
          sourceFingerprint: fingerprint("d"),
          captureFingerprint: fingerprint("e"),
          analysisFingerprint: fingerprint("f"),
        },
        profile: {
          id: MODELICA_ADMITTED_COMPILATION_PROFILE_ID,
          version: "2.0.0",
          fingerprint: fingerprint("1"),
        },
      },
      execution: {
        profile: {
          ...MODELICA_ADMITTED_EXECUTION_PROFILE,
          fingerprint: fingerprint("2"),
        },
        isolationPolicy: {
          id: "isolation.modelica-deny-net",
          version: "2.0.0",
          fingerprint: fingerprint("3"),
        },
        runtimeBackend: {
          id: "microsandbox-local",
          version: "0.6.8",
          lifecycle: "attached",
          network: "none",
          imageReference: `casys/modelica-microsandbox-worker@sha256:${"4".repeat(64)}`,
          imageDigest: fingerprint("4"),
        },
        runtime: {
          imageDigest: fingerprint("4"),
          isolationClass: "microsandbox-local-microvm-v1",
          limits: runtime().requestedLimits,
          limitAssurance: runtime().limitAssurance,
        },
        outputValidator: {
          id: "modelica-closed-subset-v2-result-normalizer",
          version: "2.0.0",
        },
        outputs: MODELICA_ADMITTED_OUTPUT_MANIFEST,
        minimumDestructionAssurance: "acknowledged-unattested",
      },
      status: "ready-for-execution-review",
    }),
  );
}

function runtime() {
  return {
    isolationClass: "kernel-isolated" as const,
    imageDigest: fingerprint("4"),
    requestedLimits: {
      maxWallTimeMs: 30_000,
      maxCpuTimeMs: 20_000,
      maxMemoryBytes: 512_000_000,
      maxProcesses: 8,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 1_048_576,
      maxOutputTotalBytes: 2_097_152,
    },
    limitAssurance: {
      maxWallTimeMs: "backend-attested" as const,
      maxCpuTimeMs: "backend-attested" as const,
      maxMemoryBytes: "backend-attested" as const,
      maxProcesses: "backend-attested" as const,
      maxStdoutBytes: "broker-observed-cap" as const,
      maxStderrBytes: "broker-observed-cap" as const,
      maxOutputFileBytes: "broker-observed-cap" as const,
      maxOutputTotalBytes: "broker-observed-cap" as const,
    },
  };
}

async function modelicaBasis(projectId: string, at: string) {
  const modelFingerprint = await sha256Fingerprint({ model: "viewer-oscillator" });
  const admissionFingerprint = fingerprint("a");
  const model = {
    id: "model.viewer-oscillator",
    name: "Viewer oscillator",
    kind: "sysml-model" as const,
    version: modelFingerprint.digest,
    fingerprint: modelFingerprint,
    uri: `casys://sysml/sha256/${modelFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "capture", runId: "run.syson" },
    inputArtifactIds: [],
    freshness: fresh(at),
  };
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `thread.${projectId}.1`,
    revision: 1,
    generatedAt: at,
    subject: {
      id: `project:${projectId}`,
      name: "Modelica viewer",
      kind: "system",
      version: "1",
      modelArtifactId: model.id,
    },
    freshness: fresh(at),
    changeSet: {
      id: "changes.1",
      name: "basis",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "created-model",
        kind: "created",
        target: { kind: "artifact", id: model.id },
        summary: "Created model.",
        afterFingerprint: modelFingerprint,
      }],
    },
    artifacts: [model],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "model-change",
      relation: "changes",
      from: { kind: "change", id: "created-model" },
      to: { kind: "artifact", id: model.id },
      rationale: "Created model.",
    }],
    proposedActions: [],
  });
  const applied = applyThreadSnapshotExtensionIfNew(snapshot, {
    id: "admission",
    name: "Admitted Modelica basis",
    subjectId: snapshot.subject.id,
    capturedAt: at,
    artifacts: [{
      id: `technical-compilation-admission-${admissionFingerprint.digest}`,
      name: "Admission",
      kind: "document",
      version: admissionFingerprint.digest,
      fingerprint: admissionFingerprint,
      uri:
        `casys://technical-compilation-admission-capture/sha256/${admissionFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "compile.seal-admission@3",
        runId: "run.seal",
      },
      inputArtifactIds: [],
      freshness: fresh(at),
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: at });
  if (!applied.applied) throw new Error("fixture admission was not applied");
  return validateThreadSnapshot(applied.snapshot);
}

async function projectFor(
  root: string,
  projectId: string,
  snapshotId: string,
  subjectId: string,
) {
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(root),
    () => AT,
  );
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await briefs.startProject(agent, {
    commandId: "start",
    projectId,
    projectName: "Modelica viewer fixture",
    issuedAt: AT,
    intent: "Exercise recorded evidence.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(agent, {
    commandId: "brief",
    projectId,
    expectedRevision: project.revision,
    issuedAt: AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Exercise viewer.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "scenario",
      kind: "mission-scenario",
      statement: "Reopen evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Preserve identity.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(human, {
    commandId: "approve",
    projectId,
    expectedRevision: project.revision,
    issuedAt: AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "fixture",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  return { ...project, threadSnapshots: [{ snapshotId, revision: 3, subjectId }] };
}

function modelicaPackages(): readonly InstalledThreadViewerAppPackage[] {
  return [{
    app: { id: "io.casys.mcp-modelica.results", version: "0.3.4" },
    manifest: {
      uri: "ui://mcp-modelica/app-manifest",
      path: "/manifest.json",
      fingerprint: "sha256:unused",
    },
    resources: [{
      uri: "ui://mcp-modelica/results-viewer",
      path: "/results.html",
      fingerprint: "sha256:unused",
      resultSchemas: [],
      sessionSchemas: ["io.casys.mcp-modelica.recorded-admitted-execution-session/1.0"],
      acceptedActions: ["viewer.session.apply"],
    }],
  }];
}

function fingerprint(letter: string) {
  return { algorithm: "sha256" as const, digest: letter.repeat(64) };
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}
