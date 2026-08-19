import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { QualifiedBuild123dSourceAnalyzer } from "../../cad/source/qualified-build123d-source-analyzer.ts";
import { COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION } from "../../../domain/sensitivity/correction-source/apply-correction-source.ts";
import {
  type CorrectionProposal,
  proposeVectorCorrection,
} from "../../../domain/sensitivity/vector-correction/propose-vector-correction.ts";
import type { SensitivityEdge } from "../../../domain/sensitivity/edges/sensitivity-edge.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../domain/sensitivity/study/sensitivity-study.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityStudyCapture,
} from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import { vectorCorrectionDecisionFromComputed } from "../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import {
  CORRECTION_PROPOSAL_CAPTURE_GRANTS,
  CORRECTION_PROPOSAL_CAPTURE_SCHEMA,
} from "../vector-correction/vector-correction-capture.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { CompileCaptureCorrectedSourceRunExecutor } from "./compile-capture-corrected-source-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl05";
const SUBJECT_ID = "project:desk-lamp-dl05";
const RUN_ID = "run.capture-corrected";
const WORK_ID = "work.capture-corrected";
const DECISION_ID = "decision.capture-corrected";
const APPROVAL_ID = "approval.capture-corrected";
const COMMAND_ID = "command.capture-corrected";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const SOURCE = [
  "from build123d import Box",
  "arm_thickness = 10",
  "result = Box(arm_thickness, 20, 30)",
  "",
].join("\n");

Deno.test("the executor refuses a human origin before any store access", async () => {
  const executor = new CompileCaptureCorrectedSourceRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
    corrections: {} as never,
    studyCaptures: {} as never,
    admissions: {} as never,
    sourceCaptures: {} as never,
    captures: {} as never,
    lease: {} as never,
    profileId: "build123d-closed-subset-v1",
  });
  await assertRejects(
    () =>
      executor.execute({ kind: "human", actorId: "human:test" }, {
        commandId: "cmd",
        projectId: PROJECT_ID,
        expectedRevision: 1,
        issuedAt: AT,
        runId: "run",
      }),
    EngineeringProjectCommandError,
    "authenticated agent",
  );
});

Deno.test("the executor substitutes the signed z* and publishes a corrected-source document", async () => {
  const fixture = await createFixture();
  const project = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(project.agentRuns[0]?.status, "completed");
  const snapshot = await fixture.snapshots.get(
    project.agentRuns[0]!.resultSnapshot!.snapshotId,
  );
  const artifact = snapshot!.artifacts.find((item) =>
    item.id.startsWith("corrected-source-")
  );
  assertEquals(artifact?.kind, "document");
  assertEquals(
    fixture.sourceCaptures.calls[0]?.sourceText.includes("arm_thickness = 10.5"),
    true,
  );
  assertEquals(fixture.sourceCaptures.calls[0]?.sourceId, fixture.sourceId);
});

Deno.test("the executor refuses when the admitted literal is not the signed current", async () => {
  const fixture = await createFixture({ currentMismatch: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "not the signed current",
  );
  assertEquals(fixture.captures.saved, 0);
});

Deno.test("the executor refuses an admission with more than one source", async () => {
  const fixture = await createFixture({ extraSource: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "parent compilation admission could not be reopened",
  );
  assertEquals(fixture.captures.saved, 0);
});

async function createFixture(
  options: { readonly currentMismatch?: boolean; readonly extraSource?: boolean } = {},
) {
  const analysis = await new QualifiedBuild123dSourceAnalyzer().analyze({
    sourceId: "arm",
    role: "cad-script",
    language: "python",
    sourceText: SOURCE,
  });
  const admissionDigest = "a".repeat(64);
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV2(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/admission`,
    sha256: admissionDigest,
  });
  const base = studyCase.metrics.map((metric, index) => ({
    metric: metric.id,
    value: index === 0 ? 1.5 : 6,
    unit: metric.unit,
  }));
  const stepped = studyCase.metrics.map((metric, index) => ({
    metric: metric.id,
    value: index === 0 ? 0.5 : 5,
    unit: metric.unit,
  }));
  const studyCapture: SensitivityStudyCapture = {
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run.sensitivity",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "run.sensitivity:cad-base",
        sourceSha256: "1".repeat(64),
        stepSha256: "2".repeat(64),
        stepBytes: 4,
      },
      stepped: {
        executionRunId: "run.sensitivity:cad-stepped",
        sourceSha256: "3".repeat(64),
        stepSha256: "4".repeat(64),
        stepBytes: 4,
      },
    },
    measurements: { base, stepped },
    derivatives: computeSensitivities(
      studyCase,
      new Map(base.map((item) => [item.metric, item])),
      new Map(stepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  };
  const studyFingerprint = await sha256Fingerprint(studyCapture);
  const studyArtifactId = `sensitivity-study-${studyFingerprint.digest}`;
  const current = options.currentMismatch === true ? 11 : 10;
  const edge: SensitivityEdge = {
    schemaVersion: "sensitivity-edge/1.0",
    driver: {
      sysmlAttrName: "arm_thickness_for_maxDisplacement",
      unit: "mm",
      basePoint: { value: current, unit: "mm" },
      validityNeighborhood: {
        lower: { value: 10, unit: "mm" },
        upper: { value: 12, unit: "mm" },
        lowerConstraintName: "maxDisplacement_validity_lower",
        upperConstraintName: "maxDisplacement_validity_upper",
      },
    },
    response: {
      metric: "maxDisplacement",
      sysmlAttrName: "d_maxDisplacement_mm_per_mm",
      unit: "mm/mm",
    },
    derivative: { value: -1, unit: "mm/mm" },
    provenance: { runId: "run.study", capturedAt: AT },
  };
  const proposal = proposeVectorCorrection({
    evaluation: {
      id: "eval:fail",
      name: "Fail",
      requirementId: "req:disp",
      observationIds: ["obs"],
      status: "fail",
      evaluatedAt: AT,
      evaluator: { serverId: "t", tool: "t", runId: "t" },
      comparison: {
        observationId: "obs",
        actual: { value: 1.5, unit: "mm" },
        operator: "<=",
        limit: { value: 1, unit: "mm" },
        normalizedUnit: "mm",
      },
      evidenceArtifactIds: [],
      message: "fail",
      freshness: {
        status: "fresh",
        changedAt: AT,
        invalidatedByChangeIds: [],
      },
    },
    edges: [edge],
    currentDriverValue: { value: current, unit: "mm" },
    metricId: "maxDisplacement",
    actualResponse: { value: 1.5, unit: "mm" },
  }) as CorrectionProposal;
  const decision = vectorCorrectionDecisionFromComputed({
    proposal,
    studyCapture: {
      artifactId: studyArtifactId,
      fingerprint: studyFingerprint,
    },
    evaluationId: "eval:fail",
    caseDigest: studyCapture.caseDigest,
    limit: { value: 1, unit: "mm" },
  });
  const correctionEnvelope = {
    schemaVersion: CORRECTION_PROPOSAL_CAPTURE_SCHEMA,
    kind: "correction-proposal",
    grants: CORRECTION_PROPOSAL_CAPTURE_GRANTS,
    operation: { id: "design.apply-vector-correction", version: "1" },
    trustedRunId: "run.correction",
    decisionId: "decision.correction",
    sealedAt: AT,
    proposal: decision,
    studyCapture: {
      id: studyArtifactId,
      fingerprint: studyFingerprint,
      uri: `casys://sensitivity-study-capture/sha256/${studyFingerprint.digest}`,
    },
    evaluation: { id: "eval:fail" },
  };
  const correctionText = deterministicJson(correctionEnvelope);
  const correctionFingerprint = await sha256Fingerprint(
    JSON.parse(correctionText),
  );
  const correctionArtifactId = `correction-${correctionFingerprint.digest}`;
  const briefId = "artifact.brief";
  const briefFp = { algorithm: "sha256" as const, digest: "1".repeat(64) };
  const admissionFp = {
    algorithm: "sha256" as const,
    digest: admissionDigest,
  };
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.corrected.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "dl05",
      kind: "system",
      version: "1",
      modelArtifactId: briefId,
    },
    freshness: fresh(),
    changeSet: {
      id: "cs-corrected",
      name: "Correction",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [
        change("change.brief", briefId, briefFp),
        change("change.admission", "admission", admissionFp),
        change("change.study", studyArtifactId, studyFingerprint),
        change("change.correction", correctionArtifactId, correctionFingerprint),
      ],
    },
    artifacts: [
      artifact(briefId, "Brief", briefFp, "baseline.from-approved-brief@1", []),
      artifact(
        "admission",
        "Admission",
        admissionFp,
        "compile.seal-admission@1",
        [],
      ),
      artifact(
        studyArtifactId,
        "Study",
        studyFingerprint,
        "analyze.run-fea-sensitivity@1",
        [briefId],
      ),
      artifact(
        correctionArtifactId,
        "Correction",
        correctionFingerprint,
        "design.apply-vector-correction@1",
        [studyArtifactId],
      ),
    ],
    consumptions: [
      consumption(briefId, briefFp, "analyze.run-fea-sensitivity@1", studyArtifactId),
      consumption(
        studyArtifactId,
        studyFingerprint,
        "design.apply-vector-correction@1",
        correctionArtifactId,
      ),
    ],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      link("changes", "change", "change.brief", "artifact", briefId),
      link("changes", "change", "change.admission", "artifact", "admission"),
      link("changes", "change", "change.study", "artifact", studyArtifactId),
      link("changes", "change", "change.correction", "artifact", correctionArtifactId),
      link(
        "uses",
        "consumption",
        `consume-${briefId}-by-${studyArtifactId}`,
        "artifact",
        briefId,
      ),
      link(
        "uses",
        "consumption",
        `consume-${studyArtifactId}-by-${correctionArtifactId}`,
        "artifact",
        studyArtifactId,
      ),
      link("derived_from", "artifact", studyArtifactId, "artifact", briefId),
      link(
        "derived_from",
        "artifact",
        correctionArtifactId,
        "artifact",
        studyArtifactId,
      ),
    ],
    proposedActions: [],
  });
  const source = {
    sourceText: SOURCE,
    analysis,
  };
  const operation = {
    id: COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.id,
    version: COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.version,
    bindings: [{
      name: "correctionProposal",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: snapshot.id,
          snapshotRevision: snapshot.revision,
          kind: "artifact" as const,
          id: correctionArtifactId,
        },
      },
    }],
  };
  const runBasis = {
    kind: "thread-snapshot" as const,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runFingerprint = await sha256Fingerprint({ operation, basis: runBasis });
  const evidenceRefs = [{
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: correctionArtifactId,
  }];
  const decisionFingerprint = await sha256Fingerprint({
    operation,
    evidenceRefs,
  });
  const project = {
    schemaVersion: "3.0",
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Corrected source fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Capture", statement: "Substitute z*." },
    },
    threadSnapshots: [runBasis],
    phases: [{
      id: "phase.design",
      name: "Design",
      order: 1,
      description: "Capture.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      phaseId: "phase.design",
      title: "Capture corrected source",
      description: "Substitute z*.",
      kind: "design",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary: "Capture corrected source.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.design",
      title: "Approve corrected-source capture",
      question: "Capture the substituted source?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: runBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: evidenceRefs,
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Capture corrected source.",
        parameters: [],
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Reviewed the binding.",
      baseSnapshot: runBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: evidenceRefs,
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(snapshot);
  const captures = new MemoryCorrectedCaptures();
  const sourceCaptures = new MemorySourceCaptures();
  const commands = new MemoryCommands(project);
  return {
    sourceId: analysis.source.id,
    snapshots,
    captures,
    sourceCaptures,
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    executor: new CompileCaptureCorrectedSourceRunExecutor({
      projects: {
        get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
        getRevision: () =>
          Promise.resolve(project as unknown as EngineeringProjectSnapshot),
        createInitial: () => Promise.reject(new Error("unused")),
        commit: () => Promise.reject(new Error("unused")),
      } satisfies EngineeringProjectRevisionStore,
      commands,
      snapshots,
      corrections: {
        read: (fingerprint: ContentFingerprint) =>
          Promise.resolve(
            fingerprint.digest === correctionFingerprint.digest
              ? correctionText
              : undefined,
          ),
      },
      studyCaptures: {
        read: (fingerprint: ContentFingerprint) =>
          Promise.resolve(
            fingerprint.digest === studyFingerprint.digest
              ? JSON.stringify(studyCapture)
              : undefined,
          ),
      },
      admissions: {
        read: () =>
          Promise.resolve({
            document: {
              inputManifest: {
                sources: options.extraSource === true ? [source, source] : [source],
              },
            },
          } as never),
      },
      sourceCaptures,
      captures,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      profileId: "build123d-closed-subset-v1",
    }),
  };
}

function artifact(
  id: string,
  name: string,
  fingerprint: ContentFingerprint,
  tool: string,
  inputArtifactIds: readonly string[],
) {
  return {
    id,
    name,
    kind: "document" as const,
    version: fingerprint.digest,
    fingerprint,
    producer: {
      serverId: "digital-thread",
      tool,
      runId: `run.${id}`,
    },
    inputArtifactIds: [...inputArtifactIds],
    freshness: fresh(),
  };
}

function consumption(
  artifactId: string,
  fingerprint: ContentFingerprint,
  tool: string,
  consumerId: string,
) {
  return {
    id: `consume-${artifactId}-by-${consumerId}`,
    artifactId,
    consumer: {
      serverId: "digital-thread",
      tool,
      runId: `run.${consumerId}`,
    },
    observedFingerprint: fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  };
}

function change(
  id: string,
  artifactId: string,
  fingerprint: ContentFingerprint,
) {
  return {
    id,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: `Created ${artifactId}.`,
    afterFingerprint: fingerprint,
  };
}

function link(
  relation: "changes" | "uses" | "derived_from",
  fromKind: "change" | "consumption" | "artifact",
  fromId: string,
  toKind: "artifact",
  toId: string,
) {
  return {
    id: `${relation}:${fromKind}:${fromId}->${toKind}:${toId}`,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: relation,
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  commandReceipts: unknown[];
};

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  latest(_subjectId: string) {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryCorrectedCaptures {
  saved = 0;
  readonly #byDigest = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.saved += 1;
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({ uri: this.uriFor(fingerprint) });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://corrected-source-capture/sha256/${fingerprint.digest}`;
  }
}

class MemorySourceCaptures {
  readonly calls: Array<{ sourceId: string; sourceText: string }> = [];
  capture(input: { sourceId: string; sourceText: string; profileId: string }) {
    this.calls.push({ sourceId: input.sourceId, sourceText: input.sourceText });
    return Promise.resolve({
      schemaVersion: "technical-source-analysis-capture/1.0",
      sourceId: input.sourceId,
    });
  }
}

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0]!;
    if (run.status === "queued") {
      (run as { status: string }).status = "running";
      (run as { startedAt?: string }).startedAt = AT;
      (run as { claimedAt?: string }).claimedAt = AT;
      (run as { claimedBy?: { id: string; origin: "agent" } }).claimedBy = {
        id: origin.actorId,
        origin: "agent",
      };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as { status: string }).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  completeRun(_origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns[0] as unknown as {
      status: string;
      completedAt?: string;
      resultSnapshot?: CompleteRunCommand["resultSnapshot"];
      evidenceRefs: unknown[];
    };
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(_origin: typeof AGENT, command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    (this.project.agentRuns[0] as { failure?: unknown }).failure = {
      code: command.code,
      message: command.message,
    };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
