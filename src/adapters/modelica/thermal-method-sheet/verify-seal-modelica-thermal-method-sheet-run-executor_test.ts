import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { TechnicalCompilationBasisResolver } from "../../../application/ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../application/ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { TechnicalCompilationBasis } from "../../../domain/compile/admission/technical-compilation.ts";
import { encodeThermalMethodSheetSealParameters } from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import type { ThermalMethodSheetSourceIdentity } from "../../../domain/modelica/thermal-method-sheet-recross.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  type ThermalMethodSheetSealCaptureStore,
  type ThermalMethodSheetThreadSnapshotStore,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
  VerifySealModelicaThermalMethodSheetRunExecutor,
} from "./verify-seal-modelica-thermal-method-sheet-run-executor.ts";

const AT = "2026-08-21T12:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const RUN_ID = "run.thermal-method-sheet";
const WORK_ID = "work.thermal-method-sheet";
const DECISION_ID = "placeholder-seal-decision";
const APPROVAL_ID = "approval.thermal-method-sheet";
const COMMAND_ID = "command.thermal-method-sheet";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const SOURCE_FINGERPRINT = hash("c");

Deno.test(
  "verify.seal-modelica-thermal-method-sheet@1 writes a document-only successor and never runs OMC",
  async () => {
    const fixture = await executeFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "verify.seal-modelica-thermal-method-sheet@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(sealed?.[0]?.mediaType, "application/json");
    assertEquals(
      sealed?.[0]?.id.startsWith("modelica-thermal-method-sheet-seal-"),
      true,
    );
    assertEquals(
      snapshot?.artifacts.some((item) => item.kind === "sysml-model"),
      false,
    );
    const captureText = await fixture.captures.read(sealed![0]!.fingerprint);
    const capture = JSON.parse(captureText!);
    assertEquals(capture.kind, "modelica-thermal-method-sheet-seal");
    assertEquals(capture.recross.sourceCapture.role, "modelica-model");
    assertEquals(fixture.sources.reads.length >= 1, true);
    assertEquals(fixture.basis.resolves.length >= 1, true);
  },
);

Deno.test(
  "verify.seal-modelica-thermal-method-sheet@1 refuses a non-agent origin",
  async () => {
    const fixture = await executeFixture();
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      "authenticated agent",
    );
  },
);

Deno.test(
  "verify.seal-modelica-thermal-method-sheet@1 refuses a missing Modelica source recross",
  async () => {
    const fixture = await executeFixture();
    fixture.sources.missing = true;
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "unavailable",
    );
  },
);

async function executeFixture(): Promise<{
  readonly executor: VerifySealModelicaThermalMethodSheetRunExecutor;
  readonly command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  };
  readonly snapshots: ExecuteMemorySnapshots;
  readonly captures: ExecuteMemoryCaptures;
  readonly sources: MemorySourceReader;
  readonly basis: MemoryBasisResolver;
}> {
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "placeholder-thread-snapshot",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Thermal method sheet fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Recorded the documentary brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts: [{
      id: "artifact.brief",
      name: "Brief",
      kind: "document",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief document.",
    }],
    proposedActions: [],
  });
  const basisFingerprint = await sha256Fingerprint(basisSnapshot);
  const input = validThermalMethodSheetPlaceholder();
  (input.basis as { fingerprint: ContentFingerprint }).fingerprint = basisFingerprint;
  (input.model as { sourceCaptureFingerprint: ContentFingerprint })
    .sourceCaptureFingerprint = SOURCE_FINGERPRINT;
  const sheet = validateModelicaThermalMethodSheet(input);
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  const admission = await encodeThermalMethodSheetSealParameters(sheet);
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    ...VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const summary = "Seal the exact reviewed Modelica thermal method sheet.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters: admission },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Thermal method sheet fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Seal", statement: "Seal exact thermal method sheet." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.verify",
      name: "Verify",
      order: 1,
      description: "Seal thermal method sheet.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.verify",
      title: "Seal thermal method sheet",
      description: "Seal exact reviewed thermal method sheet.",
      kind: "verify",
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
      summary: "Seal thermal method sheet.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.verify",
      title: "Approve thermal method sheet",
      question: "Seal the exact thermal method sheet?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters: admission,
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
      rationale: "Reviewed exact identities.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot);
  const captures = new ExecuteMemoryCaptures();
  const sheets = new MemorySheetStore(sheet, sheetFingerprint);
  const sources = new MemorySourceReader(SOURCE_FINGERPRINT);
  const basis = new MemoryBasisResolver(basisFingerprint);
  const commands = new ExecuteCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new VerifySealModelicaThermalMethodSheetRunExecutor({
      projects,
      commands,
      snapshots,
      sheets,
      sourceCaptures: sources,
      basisResolver: basis,
      captures,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    snapshots,
    captures,
    sources,
    basis,
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};

class ExecuteMemorySnapshots implements ThermalMethodSheetThreadSnapshotStore {
  readonly #items = new Map<string, ThreadSnapshot>();

  constructor(basis: ThreadSnapshot) {
    this.#items.set(basis.id, structuredClone(basis));
  }

  get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }

  getFresh(id: string): Promise<ThreadSnapshot | undefined> {
    return this.get(id);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const result =
      [...this.#items.values()].filter((item) => item.subject.id === subjectId).sort((
        left,
        right,
      ) => right.revision - left.revision)[0];
    return Promise.resolve(result && structuredClone(result));
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    const attempted = structuredClone(snapshot);
    const existing = this.#items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(attempted)) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, attempted);
    return Promise.resolve();
  }
}

class ExecuteMemoryCaptures implements ThermalMethodSheetSealCaptureStore {
  readonly #items = new Map<string, string>();

  save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve();
  }

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class MemorySheetStore implements ThermalMethodSheetStore {
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("executor test must not persist a new sheet"));
  }
  read(fingerprint: ContentFingerprint) {
    if (fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.sheet);
  }
}

class MemorySourceReader implements ThermalMethodSheetSourceCaptureReader {
  missing = false;
  readonly reads: ContentFingerprint[] = [];
  constructor(readonly fingerprint: ContentFingerprint) {}
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ThermalMethodSheetSourceIdentity | undefined> {
    this.reads.push(fingerprint);
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve({
      fingerprint,
      role: "modelica-model",
      language: "modelica",
      symbols: [
        {
          id: "placeholder-parameter",
          kind: "parameter",
          name: "placeholder-parameter",
        },
        { id: "placeholder-output", kind: "variable", name: "placeholder-output" },
      ],
    });
  }
}

class MemoryBasisResolver implements TechnicalCompilationBasisResolver {
  readonly resolves: unknown[] = [];
  constructor(readonly snapshotFingerprint: ContentFingerprint) {}
  resolve(request: unknown): Promise<TechnicalCompilationBasis | undefined> {
    this.resolves.push(request);
    return Promise.resolve({
      thread: {
        projectId: PROJECT_ID,
        subjectId: SUBJECT_ID,
        snapshotId: "placeholder-thread-snapshot",
        revision: 1,
        snapshotFingerprint: this.snapshotFingerprint,
      },
      sysmlAnchor: {
        artifactId: "artifact.architecture",
        artifactFingerprint: hash("a"),
        captureId: "a".repeat(64),
        editingContextId: "editing.context",
        rootElementId: "pkg",
        rootElementKind: "Package",
        elements: [
          {
            id: "placeholder-attribute-usage",
            kind: "AttributeUsage",
            provenance: {
              artifactId: "artifact.architecture",
              artifactFingerprint: hash("a"),
              captureId: "a".repeat(64),
            },
          },
          {
            id: "placeholder-requirement",
            kind: "RequirementUsage",
            provenance: {
              artifactId: "artifact.architecture",
              artifactFingerprint: hash("a"),
              captureId: "a".repeat(64),
            },
          },
        ],
      },
      sysmlAnchorFingerprint: hash("s"),
    });
  }
}

class ExecuteCommands {
  #claimIdentity?: string;

  constructor(readonly project: MutableProject) {}

  claimRun(
    origin: typeof AGENT,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const identity = deterministicJson({ origin, command });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      this.#claimIdentity = identity;
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      this.project.revision += 1;
      return Promise.resolve(this.project);
    }
    if (identity !== this.#claimIdentity) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "command_id_conflict",
          "claim command differs from its immutable receipt",
        ),
      );
    }
    return Promise.resolve(this.project);
  }

  publishRun(): Promise<EngineeringProjectSnapshot> {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }

  async completeRun(
    origin: typeof AGENT,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const requestFingerprint = await sha256Fingerprint({
      type: "agent-run.complete",
      origin,
      command,
    });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "completed") {
      return this.project;
    }
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
    if (
      !this.project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint,
      resultingSnapshot: {
        snapshotId: `project.receipt.r${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    return this.project;
  }

  failRun(
    _origin: typeof AGENT,
    command: FailRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}

type MutableRun = {
  -readonly [Key in keyof EngineeringProjectSnapshot["agentRuns"][number]]:
    EngineeringProjectSnapshot["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof EngineeringProjectSnapshot["workItems"][number]]:
    EngineeringProjectSnapshot["workItems"][number][Key];
};
type MutablePhase = {
  -readonly [Key in keyof EngineeringProjectSnapshot["phases"][number]]:
    EngineeringProjectSnapshot["phases"][number][Key];
};

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

function hash(digit: string): ContentFingerprint {
  return { algorithm: "sha256", digest: digit.repeat(64) };
}
