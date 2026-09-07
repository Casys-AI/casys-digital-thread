import { assertEquals, assertRejects } from "@std/assert";
import {
  DecideAssemblyIntegrityEvaluationCloseoutRunExecutor,
} from "./decide-assembly-integrity-evaluation-closeout-run-executor.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  assemblyIntegrityCloseoutAuthorization,
  assemblyIntegrityEvaluationCloseoutAdmission,
  resolveAssemblyIntegrityCloseoutEvidence,
} from "./assembly-integrity-closeout-evidence-resolver.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX,
  type AssemblyIntegrityEvaluationCapture,
  assemblyIntegrityEvaluationCaptureUri,
  assemblyIntegrityEvaluationMethod,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  type AssemblyIntegrityEvaluationCloseoutAdmission,
  assemblyIntegrityEvaluationCloseoutWorkItemOperation,
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  encodeAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import { ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY } from "../../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  canonicalAssemblyIntegrityEvaluationCloseoutCaptureText,
  validateAssemblyIntegrityEvaluationCloseoutCapture,
} from "./assembly-integrity-evaluation-closeout-capture.ts";
import type {
  EngineeringProjectCommandOrigin,
} from "../../../application/ports/in/engineering-project-command-origin.ts";
import type {
  EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  CompleteRunCommand,
  EngineeringProjectCommandService,
  RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  applyThreadSnapshotExtension,
  applyThreadSnapshotExtensionIfNew,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const DIGEST_E = "e".repeat(64);
const DIGEST_F = "f".repeat(64);
const AT = "2026-08-26T10:00:00.000Z";
const HUMAN = { kind: "human" as const, actorId: "human:assembly-reviewer" };

Deno.test("assembly-integrity L5 accept satisfies only recorded L4 contributes-to claims in canonical order", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly-z", "gate-assembly-a"],
    l4GateClaimIds: ["gate-assembly-z", "gate-assembly-a"],
  });
  const accept = assemblyIntegrityCloseoutAuthorization(
    fixture.current(),
    "accept",
    fixture.l4Work(),
  );
  const reject = assemblyIntegrityCloseoutAuthorization(
    fixture.current(),
    "reject",
    fixture.l4Work(),
  );

  assertEquals(accept.verificationAuthority, ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY);
  assertEquals(accept.gateClaims, [
    { gateItemId: "gate-assembly-a", role: "satisfies", status: "current" },
    { gateItemId: "gate-assembly-z", role: "satisfies", status: "current" },
  ]);
  assertEquals(reject.gateClaims, []);
});

Deno.test("zero-claim L4 does not let L5 invent satisfaction of current Brief assembly-integrity gates", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly-z", "gate-assembly-a"],
    l4GateClaimIds: [],
    l3GateClaimIds: ["gate-assembly-z", "gate-assembly-a"],
  });
  assertEquals(
    assemblyIntegrityCloseoutAuthorization(
      fixture.current(),
      "accept",
      fixture.l4Work(),
    ).gateClaims,
    [],
  );
});

Deno.test("assembly-integrity L5 satisfies only one declared current L4 gate among multiple compatible Brief gates", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly-z", "gate-assembly-a"],
    l4GateClaimIds: ["gate-assembly-a"],
  });
  assertEquals(
    assemblyIntegrityCloseoutAuthorization(
      fixture.current(),
      "accept",
      fixture.l4Work(),
    ).gateClaims,
    [{ gateItemId: "gate-assembly-a", role: "satisfies", status: "current" }],
  );
});

Deno.test("assembly-integrity L5 accepts a zero-gate compatible Brief without caller selection", async () => {
  const fixture = await executableFixture({ matchingGateIds: [], l4GateClaimIds: [] });
  assertEquals(
    assemblyIntegrityCloseoutAuthorization(
      fixture.current(),
      "accept",
      fixture.l4Work(),
    ).gateClaims,
    [],
  );
});

Deno.test("TPS03: assembly-integrity L5 refuses an appended leaf that omitted the signed gate claims", async () => {
  const fixture = await executableFixture();
  fixture.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) => {
        if (work.id !== "work-l5") return work;
        const { gateClaims: _omitted, ...leaf } = work;
        return leaf;
      }),
    }) as EngineeringProjectSnapshot
  );

  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command()),
    Error,
    "exactly equal the signed canonical admission claims",
  );
});

Deno.test("assembly-integrity L5 refuses gate claims mutated after MRTR", async () => {
  const fixture = await executableFixture();
  fixture.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) =>
        work.id === "work-l5"
          ? {
            ...work,
            gateClaims: [{
              gateItemId: "safety-gate",
              role: "satisfies" as const,
              status: "current" as const,
            }],
          }
          : work
      ),
    }) as EngineeringProjectSnapshot
  );

  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command()),
    Error,
    "exactly equal the signed canonical admission claims",
  );
});

Deno.test("assembly-integrity L5 refuses a plan change whose signed Brief basis drifted", async () => {
  const fixture = await executableFixture();
  fixture.mutate((project) =>
    ({
      ...project,
      planChanges: project.planChanges?.map((change) => ({
        ...change,
        approvedBriefBasis: {
          ...fixture.admission.approvedBriefBasis,
          projectRevision: fixture.admission.approvedBriefBasis.projectRevision + 1,
        },
      })),
    }) as EngineeringProjectSnapshot
  );

  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command()),
    Error,
    "exact signed current approved Brief basis",
  );
});

Deno.test("assembly-integrity L5 refuses a current Brief authority change after MRTR", async () => {
  const fixture = await executableFixture();
  fixture.mutate((project) =>
    ({
      ...project,
      framing: {
        ...project.framing!,
        currentBrief: {
          ...project.framing!.currentBrief!,
          items: project.framing!.currentBrief!.items.map((item) =>
            item.id === "gate-assembly"
              ? { ...item, verificationAuthority: { id: "other", version: "1.0" } }
              : item
          ),
        },
      },
    }) as EngineeringProjectSnapshot
  );

  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command()),
    Error,
    "current contributes-to claims targeting current approved Brief V2",
  );
});

Deno.test("assembly-integrity L5 refuses a stale or incompatible selected L4 claim", async () => {
  const stale = await executableFixture();
  stale.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) =>
        work.id === "work-l4"
          ? {
            ...work,
            gateClaims: [{
              gateItemId: "gate-removed",
              role: "contributes-to" as const,
              status: "current" as const,
            }],
          }
          : work
      ),
    }) as EngineeringProjectSnapshot
  );
  await assertRejects(
    () => stale.executor.execute(HUMAN, stale.command()),
    Error,
    "current contributes-to claims targeting current approved Brief V2",
  );

  const incompatible = await executableFixture();
  incompatible.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) =>
        work.id === "work-l4"
          ? {
            ...work,
            gateClaims: [{
              gateItemId: "safety-gate",
              role: "contributes-to" as const,
              status: "current" as const,
            }],
          }
          : work
      ),
    }) as EngineeringProjectSnapshot
  );
  await assertRejects(
    () => incompatible.executor.execute(HUMAN, incompatible.command()),
    Error,
    "current contributes-to claims targeting current approved Brief V2",
  );
});

Deno.test("assembly-integrity L5 refuses forged added or omitted L4 claims after MRTR", async () => {
  const added = await executableFixture({
    matchingGateIds: ["gate-assembly-a", "gate-assembly-z"],
    l4GateClaimIds: ["gate-assembly-a"],
  });
  added.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) =>
        work.id === "work-l4"
          ? {
            ...work,
            gateClaims: [
              {
                gateItemId: "gate-assembly-a",
                role: "contributes-to",
                status: "current",
              },
              {
                gateItemId: "gate-assembly-z",
                role: "contributes-to",
                status: "current",
              },
            ],
          }
          : work
      ),
    }) as EngineeringProjectSnapshot
  );
  await assertRejects(
    () => added.executor.execute(HUMAN, added.command()),
    Error,
    "no longer matches the exact current fresh L4 capture and limits",
  );

  const omitted = await executableFixture();
  omitted.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) => {
        if (work.id !== "work-l4") return work;
        const { gateClaims: _omitted, ...leaf } = work;
        return leaf;
      }),
    }) as EngineeringProjectSnapshot
  );
  await assertRejects(
    () => omitted.executor.execute(HUMAN, omitted.command()),
    Error,
    "no longer matches the exact current fresh L4 capture and limits",
  );
});

Deno.test("assembly-integrity L5 refuses a superseded activity revision", async () => {
  const fixture = await executableFixture();
  fixture.mutate((project) => {
    const current = project.workItems.find((work) => work.id === "work-l5")!;
    return {
      ...project,
      workItems: [
        ...project.workItems,
        {
          ...current,
          id: "work-l5-revised",
          predecessorRevisionId: current.id,
        },
      ],
    } as EngineeringProjectSnapshot;
  });

  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command()),
    Error,
    "unique current leaf revision",
  );
});

Deno.test("assembly-integrity L5 persists one recovered documentary successor with only its direct L4 consumption", async () => {
  const fixture = await executableFixture();
  const command = {
    commandId: "execute-assembly-l5",
    projectId: "project-assembly",
    expectedRevision: fixture.current().revision,
    issuedAt: AT,
    runId: "run-l5",
  };

  const completed = await fixture.executor.execute(HUMAN, command);
  const run = completed.agentRuns.find((item) => item.id === "run-l5")!;
  const successor = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
  const artifact = successor!.artifacts.find((item) =>
    item.producer.runId === "run-l5"
  )!;

  assertEquals(run.status, "completed");
  assertEquals(successor!.previous, {
    snapshotId: fixture.l4Snapshot.id,
    revision: fixture.l4Snapshot.revision,
  });
  assertEquals(artifact.kind, "document");
  assertEquals(artifact.inputArtifactIds, [fixture.l4Artifact.id]);
  assertEquals(successor!.evaluations, []);
  assertEquals(successor!.proposedActions, []);
  assertEquals(
    successor!.consumptions.filter((item) => item.consumer.runId === "run-l5"),
    [{
      id: `consume-${fixture.l4Artifact.id}-by-${artifact.id}`,
      artifactId: fixture.l4Artifact.id,
      consumer: artifact.producer,
      observedFingerprint: fixture.l4Artifact.fingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
  );
  assertEquals(
    successor!.provenance.filter((link) =>
      link.to.id === fixture.l4Artifact.id &&
      (link.from.id === artifact.id || link.from.kind === "consumption" &&
          link.from.id === `consume-${fixture.l4Artifact.id}-by-${artifact.id}`)
    ).map((link) => link.relation).sort(),
    ["derived_from", "uses"],
  );
  assertEquals(fixture.closeoutCaptureCount(), 1);

  const recovered = await fixture.executor.execute(HUMAN, {
    ...command,
    expectedRevision: completed.revision,
  });
  assertEquals(recovered.revision, completed.revision);
  assertEquals(fixture.closeoutCaptureCount(), 1);
  assertEquals(fixture.snapshotCount(), 3);
});

Deno.test("zero-claim L5 accept completed replay reopens evidence without Thread or capture writes", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
  });
  assertEquals(fixture.admission.gateClaims, []);
  const command = {
    commandId: "execute-assembly-l5",
    projectId: "project-assembly",
    expectedRevision: fixture.current().revision,
    issuedAt: AT,
    runId: "run-l5",
  };
  const completed = await fixture.executor.execute(HUMAN, command);
  const recovered = await fixture.executor.execute(HUMAN, {
    ...command,
    expectedRevision: completed.revision,
  });
  assertEquals(recovered.revision, completed.revision);
  assertEquals(fixture.closeoutCaptureCount(), 1);
  assertEquals(fixture.snapshotCount(), 3);
});

Deno.test("historical completed L5 with Brief-derived satisfies and zero L4 claims reopens identical bytes without writes", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
    alreadyCompleted: true,
  });
  assertEquals(fixture.l4Work().gateClaims, undefined);
  assertEquals(fixture.admission.gateClaims, [{
    gateItemId: "gate-assembly",
    role: "satisfies",
    status: "current",
  }]);
  const run = fixture.current().agentRuns.find((item) => item.id === "run-l5")!;
  const successorId = run.resultSnapshot!.snapshotId;
  const captureBefore = fixture.closeoutCaptureText();
  const successorBefore = deterministicJson(
    await fixture.snapshots.getFresh(successorId),
  );

  const recovered = await fixture.executor.execute(HUMAN, fixture.command());

  assertEquals(recovered.revision, fixture.current().revision);
  assertEquals(
    recovered.agentRuns.find((item) => item.id === "run-l5")?.resultSnapshot,
    run.resultSnapshot,
  );
  assertEquals(fixture.closeoutCaptureText(), captureBefore);
  assertEquals(
    deterministicJson(await fixture.snapshots.getFresh(successorId)),
    successorBefore,
  );
  assertEquals(fixture.commandCalls(), []);
  assertEquals(fixture.captureSaves(), 0);
  assertEquals(fixture.snapshotSaves(), 0);
  assertEquals(fixture.closeoutCaptureCount(), 1);
  assertEquals(fixture.snapshotCount(), 3);
});

Deno.test("historical publishing recovery attests the signed closeout and completes without new capture or successor writes", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
    alreadyPublishing: true,
  });
  const captureBefore = fixture.closeoutCaptureText();
  const snapshotsBefore = fixture.snapshotBytes();

  const recovered = await fixture.executor.execute(HUMAN, fixture.command());
  const run = recovered.agentRuns.find((item) => item.id === "run-l5")!;

  assertEquals(run.status, "completed");
  assertEquals(fixture.admission.gateClaims, [{
    gateItemId: "gate-assembly",
    role: "satisfies",
    status: "current",
  }]);
  assertEquals(fixture.closeoutCaptureText(), captureBefore);
  assertEquals(fixture.snapshotBytes(), snapshotsBefore);
  assertEquals(fixture.commandCalls(), ["completeRun"]);
  assertEquals(fixture.captureSaves(), 0);
  assertEquals(fixture.snapshotSaves(), 0);
});

Deno.test("the same unsealed queued legacy Brief-derived L5 accept is refused", async () => {
  const fixture = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
  });
  assertEquals(
    fixture.current().agentRuns.find((item) => item.id === "run-l5")?.status,
    "queued",
  );
  assertEquals(fixture.admission.gateClaims, [{
    gateItemId: "gate-assembly",
    role: "satisfies",
    status: "current",
  }]);
  assertEquals(fixture.l4Work().gateClaims, undefined);

  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command()),
    Error,
    "no longer matches the exact current fresh L4 capture and limits",
  );
  assertEquals(fixture.commandCalls(), []);
  assertEquals(fixture.captureSaves(), 0);
  assertEquals(fixture.snapshotSaves(), 0);
  assertEquals(fixture.closeoutCaptureCount(), 0);
});

Deno.test("historical completed L5 reopen stays fail-closed on tampered capture, missing successor, forged result, and mismatched work", async () => {
  const tampered = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
    alreadyCompleted: true,
  });
  tampered.tamperCloseoutCapture();
  await assertRejects(
    () => tampered.executor.execute(HUMAN, tampered.command()),
    Error,
    "no exact durable capture for recovery",
  );

  const missingSuccessor = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
    alreadyCompleted: true,
  });
  missingSuccessor.dropSuccessor();
  await assertRejects(
    () => missingSuccessor.executor.execute(HUMAN, missingSuccessor.command()),
    Error,
    "no exact saved Thread successor",
  );

  const forged = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
    alreadyCompleted: true,
  });
  forged.mutate((project) =>
    ({
      ...project,
      agentRuns: project.agentRuns.map((run) =>
        run.id === "run-l5"
          ? { ...run, resultSnapshot: threadRef(forged.l4Snapshot) }
          : run
      ),
    }) as EngineeringProjectSnapshot
  );
  await assertRejects(
    () => forged.executor.execute(HUMAN, forged.command()),
    Error,
    "does not retain its exact successor evidence",
  );

  const mismatchedWork = await executableFixture({
    matchingGateIds: ["gate-assembly"],
    l4GateClaimIds: [],
    legacyBriefDerivedAccept: true,
    alreadyCompleted: true,
  });
  mismatchedWork.mutate((project) =>
    ({
      ...project,
      workItems: project.workItems.map((work) => {
        if (work.id !== "work-l5") return work;
        const { gateClaims: _omitted, ...leaf } = work;
        return leaf;
      }),
    }) as EngineeringProjectSnapshot
  );
  await assertRejects(
    () => mismatchedWork.executor.execute(HUMAN, mismatchedWork.command()),
    Error,
    "exactly equal the signed canonical admission claims",
  );
});

async function executableFixture(options: {
  readonly matchingGateIds?: readonly string[];
  readonly l4GateClaimIds?: readonly string[];
  readonly l3GateClaimIds?: readonly string[];
  readonly legacyBriefDerivedAccept?: boolean;
  readonly alreadyCompleted?: boolean;
  readonly alreadyPublishing?: boolean;
} = {}) {
  const root = rootSnapshot();
  const l4Capture = await l4CaptureFixture(threadBasis(root));
  const l4Fingerprint = await sha256Fingerprint(l4Capture);
  const l4Artifact = l4CaptureArtifact(l4Capture, l4Fingerprint);
  const l4Sources = root.artifacts.filter((artifact) =>
    l4Artifact.inputArtifactIds.includes(artifact.id)
  );
  const l4Consumptions = l4Sources.map((source) => ({
    id: `consume-${source.id}-by-${l4Artifact.id}`,
    artifactId: source.id,
    consumer: l4Artifact.producer,
    observedFingerprint: source.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  }));
  const l4Snapshot = applyThreadSnapshotExtension(root, {
    id: "verify-evaluate-assembly-integrity-run-l4",
    name: "Evaluate assembly integrity",
    subjectId: root.subject.id,
    capturedAt: AT,
    artifacts: [l4Artifact],
    consumptions: l4Consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...l4Sources.map((source) => ({
        id: `${l4Artifact.id}-derived-from-${source.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: l4Artifact.id },
        to: { kind: "artifact" as const, id: source.id },
        rationale: "The L4 evaluation capture consumes this exact direct input.",
      })),
      ...l4Consumptions.map((consumption) => ({
        id: `${consumption.id}-uses`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumption.id },
        to: { kind: "artifact" as const, id: consumption.artifactId },
        rationale: "The L4 evaluator reread and fingerprint-attested this input.",
      })),
    ],
    proposedActions: [],
  });
  const rootBasis = threadBasis(root);
  const l4Result = threadRef(l4Snapshot);
  const l4Run = {
    id: "run-l4",
    workItemId: "work-l4",
    status: "completed",
    summary: "Completed L4 assembly-integrity evaluation.",
    queuedAt: AT,
    startedAt: AT,
    completedAt: AT,
    basis: rootBasis,
    inputFingerprint: fp(DIGEST_E),
    evidenceRefs: [{
      snapshotId: l4Snapshot.id,
      snapshotRevision: l4Snapshot.revision,
      kind: "artifact" as const,
      id: l4Artifact.id,
    }],
    resultSnapshot: l4Result,
  } as EngineeringAgentRun;
  const matchingGateIds = options.matchingGateIds ?? ["gate-assembly"];
  const l4GateClaimIds = options.l4GateClaimIds ?? matchingGateIds;
  const l4Work = {
    id: "work-l4",
    activityId: "activity-l4",
    status: "completed",
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    ...(l4GateClaimIds.length === 0 ? {} : {
      gateClaims: l4GateClaimIds.map((gateItemId) => ({
        gateItemId,
        role: "contributes-to" as const,
        status: "current" as const,
      })),
    }),
  };
  const l3Work = options.l3GateClaimIds === undefined ? undefined : {
    id: "work-l3",
    activityId: "activity-l3",
    status: "completed",
    operation: { id: "verify.observe-assembly-integrity", version: "1" },
    gateClaims: options.l3GateClaimIds.map((gateItemId) => ({
      gateItemId,
      role: "contributes-to" as const,
      status: "current" as const,
    })),
  };
  const briefFingerprint = fp(DIGEST_F);
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: "project-assembly",
    projectSnapshotId: "project-assembly-r1",
    projectRevision: 1,
    briefId: "brief-assembly",
    briefSnapshotId: "brief-assembly-r2",
    briefRevision: 2,
    approvedBriefFingerprint: briefFingerprint,
  };
  const currentBrief = {
    contractVersion: "2.0" as const,
    briefId: "brief-assembly",
    id: "brief-assembly-r2",
    revision: 2,
    proposedAt: AT,
    proposedBy: { id: HUMAN.actorId, origin: "human" as const },
    items: [
      ...matchingGateIds.map((id) => ({
        id,
        kind: "verification-activity" as const,
        statement: `Verify ${id}.`,
        sourceRefs: [],
        dependsOnItemIds: [],
        verificationAuthority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
      })),
      {
        id: "safety-gate",
        kind: "verification-activity" as const,
        statement: "Verify safety independently.",
        sourceRefs: [],
        dependsOnItemIds: [],
        verificationAuthority: { id: "safety", version: "1.0" },
      },
      {
        id: "unqualified-verification-gate",
        kind: "verification-activity" as const,
        statement: "Verify without authority.",
        sourceRefs: [],
        dependsOnItemIds: [],
      },
      {
        id: "product-success-criterion",
        kind: "success-criterion" as const,
        statement: "A product outcome, not this verification authority.",
        sourceRefs: [],
        dependsOnItemIds: [],
      },
    ],
  };
  let project = {
    project: { id: "project-assembly", subjectId: root.subject.id },
    revision: 1,
    threadSnapshots: [l4Result],
    workItems: l3Work === undefined ? [l4Work] : [l3Work, l4Work],
    agentRuns: [l4Run],
    framing: {
      currentBrief,
      currentBriefApproval: {
        status: "approved" as const,
        briefSnapshotId: currentBrief.id,
        briefRevision: currentBrief.revision,
        inputFingerprint: briefFingerprint,
        requestedAt: AT,
        decidedAt: AT,
        decidedBy: { id: HUMAN.actorId, origin: "human" as const },
      },
    },
    commandReceipts: [{
      type: "project.brief-approve",
      appliedAt: AT,
      actor: { id: HUMAN.actorId, origin: "human" as const },
      resultingSnapshot: {
        snapshotId: approvedBriefBasis.projectSnapshotId,
        revision: approvedBriefBasis.projectRevision,
      },
      approvedBriefBasis,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const evaluationCaptures = {
    read: (fingerprint: { readonly digest: string }) =>
      Promise.resolve(
        fingerprint.digest === l4Fingerprint.digest ? l4Capture : undefined,
      ),
  };
  const resolved = await resolveAssemblyIntegrityCloseoutEvidence(
    { evaluationCaptures },
    { project, basis: threadBasis(l4Snapshot), snapshot: l4Snapshot },
  );
  const derivedAuthorization = assemblyIntegrityCloseoutAuthorization(
    project,
    "accept",
    l4Work as EngineeringWorkItem,
  );
  const authorization = options.legacyBriefDerivedAccept === true
    ? {
      ...derivedAuthorization,
      gateClaims: briefDerivedSatisfiesClaims(matchingGateIds),
    }
    : derivedAuthorization;
  const admission = assemblyIntegrityEvaluationCloseoutAdmission(
    resolved,
    "accept",
    authorization,
  );
  const parameters = encodeAssemblyIntegrityEvaluationCloseoutAdmission(admission);
  const operation = assemblyIntegrityEvaluationCloseoutWorkItemOperation("accept");
  const decisionBasis = threadRef(l4Snapshot);
  const summary = "Accept this exact assembly-integrity evaluation closeout.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decisionBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters },
  });
  const decision = {
    id: "decision-l5",
    status: "approved",
    baseSnapshot: decisionBasis,
    inputFingerprint: decisionFingerprint,
    inputEvidenceRefs: [],
    approvalIds: ["approval-l5"],
    proposal: { summary, parameters },
  };
  const l5Work = {
    id: "work-l5",
    activityId: "activity-l5",
    status: "planned",
    operation,
    owner: "human",
    dependsOnWorkItemIds: [l4Work.id],
    decisionIds: [decision.id],
    gateClaims: authorization.gateClaims,
  };
  const l5Basis = threadBasis(l4Snapshot);
  const runFingerprint = await sha256Fingerprint({
    workItemId: l5Work.id,
    basis: l5Basis,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions: [{ id: decision.id, inputFingerprint: decisionFingerprint }],
  });
  const l5Run = {
    id: "run-l5",
    workItemId: l5Work.id,
    status: "queued",
    summary: "Queue human L5 closeout.",
    queuedAt: AT,
    basis: l5Basis,
    inputFingerprint: runFingerprint,
    evidenceRefs: [],
  } as EngineeringAgentRun;
  project = {
    ...project,
    workItems:
      (l3Work === undefined
        ? [l4Work, l5Work]
        : [l3Work, l4Work, l5Work]) as unknown as EngineeringProjectSnapshot[
          "workItems"
        ],
    agentRuns: [l4Run, l5Run],
    decisions: [decision],
    approvals: [{
      id: "approval-l5",
      decisionId: decision.id,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      baseSnapshot: decisionBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    planChanges: [{
      workItemIds: [l5Work.id],
      baseSnapshot: l4Result,
      approvedBriefBasis: authorization.approvedBriefBasis,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const snapshotsById = new Map<string, ThreadSnapshot>([
    [root.id, root],
    [l4Snapshot.id, l4Snapshot],
  ]);
  const closeoutCaptures = new Map<string, string>();
  if (options.alreadyCompleted === true || options.alreadyPublishing === true) {
    const seeded = await seedCompletedCloseout({
      admission,
      l4Snapshot,
      snapshotsById,
      closeoutCaptures,
    });
    const successorRef = threadRef(seeded.snapshot);
    const evidenceRefs = [{
      snapshotId: successorRef.snapshotId,
      snapshotRevision: successorRef.revision,
      kind: "artifact" as const,
      id: seeded.artifact.id,
    }];
    project = options.alreadyCompleted === true
      ? {
        ...project,
        threadSnapshots: [l4Result, successorRef],
        agentRuns: [l4Run, {
          ...l5Run,
          status: "completed",
          startedAt: AT,
          completedAt: AT,
          resultSnapshot: successorRef,
          evidenceRefs,
        }],
      } as unknown as EngineeringProjectSnapshot
      : {
        ...project,
        agentRuns: [l4Run, {
          ...l5Run,
          status: "publishing",
          startedAt: AT,
          claimedAt: AT,
          claimedBy: { origin: "human" as const, id: HUMAN.actorId },
        }],
      } as unknown as EngineeringProjectSnapshot;
  }
  const commandCalls: string[] = [];
  let snapshotSaves = 0;
  let captureSaves = 0;
  const snapshots = {
    get: (id: string) => Promise.resolve(snapshotsById.get(id)),
    getFresh: (id: string) => Promise.resolve(snapshotsById.get(id)),
    latest: () => Promise.resolve(l4Snapshot),
    save: (snapshot: ThreadSnapshot) => {
      snapshotSaves++;
      snapshotsById.set(snapshot.id, snapshot);
      return Promise.resolve();
    },
  };
  const commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  > = {
    claimRun: (
      origin: EngineeringProjectCommandOrigin,
      command: RunCommand,
    ) => {
      commandCalls.push("claimRun");
      project = replaceRun(project, command.runId, {
        status: "running",
        startedAt: AT,
        claimedAt: AT,
        claimedBy: { origin: origin.kind, id: origin.actorId },
      });
      return Promise.resolve(project);
    },
    publishRun: (_origin, command: RunCommand) => {
      commandCalls.push("publishRun");
      project = replaceRun(project, command.runId, { status: "publishing" });
      return Promise.resolve(project);
    },
    completeRun: (_origin, command: CompleteRunCommand) => {
      commandCalls.push("completeRun");
      project = replaceRun(project, command.runId, {
        status: "completed",
        completedAt: AT,
        resultSnapshot: command.resultSnapshot,
        evidenceRefs: command.evidenceRefs,
      }, command.resultSnapshot);
      return Promise.resolve(project);
    },
    failRun: (
      _origin,
      command: RunCommand & { readonly code: string; readonly message: string },
    ) => {
      commandCalls.push("failRun");
      project = replaceRun(project, command.runId, {
        status: "failed",
        failure: { code: command.code, message: command.message },
      });
      return Promise.resolve(project);
    },
  };
  const executor = new DecideAssemblyIntegrityEvaluationCloseoutRunExecutor({
    projects: {
      get: () => Promise.resolve(project),
    } as unknown as EngineeringProjectRevisionStore,
    commands,
    snapshots,
    evaluationCaptures,
    closeoutCaptures: {
      save: (fingerprint, text) => {
        captureSaves++;
        closeoutCaptures.set(fingerprint.digest, text);
        return Promise.resolve();
      },
      read: (fingerprint) => Promise.resolve(closeoutCaptures.get(fingerprint.digest)),
      uriFor: (fingerprint) =>
        `casys://assembly-integrity-evaluation-closeout/sha256/${fingerprint.digest}`,
    },
    lease: {
      withLease: async (_projectId, _scope, action) => await action(),
    } as EngineeringProjectRunLease,
  });
  return {
    executor,
    admission,
    l4Artifact,
    l4Snapshot,
    snapshots,
    current: () => project,
    l4Work: () =>
      project.workItems.find((item) => item.id === "work-l4") as EngineeringWorkItem,
    mutate: (
      change: (current: EngineeringProjectSnapshot) => EngineeringProjectSnapshot,
    ) => {
      project = change(project);
    },
    command: () => ({
      commandId: "execute-assembly-l5",
      projectId: "project-assembly",
      expectedRevision: project.revision,
      issuedAt: AT,
      runId: "run-l5",
    }),
    closeoutCaptureCount: () => closeoutCaptures.size,
    closeoutCaptureText: () => [...closeoutCaptures.values()].join("\n"),
    snapshotCount: () => snapshotsById.size,
    snapshotBytes: () =>
      [...snapshotsById.entries()]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([id, snapshot]) => `${id}:${deterministicJson(snapshot)}`),
    commandCalls: () => [...commandCalls],
    captureSaves: () => captureSaves,
    snapshotSaves: () => snapshotSaves,
    tamperCloseoutCapture: () => {
      const [digest, text] = [...closeoutCaptures.entries()][0]!;
      closeoutCaptures.set(digest, `${text}\n`);
    },
    dropSuccessor: () => {
      for (const id of [...snapshotsById.keys()]) {
        if (id !== root.id && id !== l4Snapshot.id) snapshotsById.delete(id);
      }
    },
  };
}

function replaceRun(
  project: EngineeringProjectSnapshot,
  runId: string,
  patch: Partial<EngineeringAgentRun>,
  resultSnapshot?: EngineeringAgentRun["resultSnapshot"],
): EngineeringProjectSnapshot {
  return {
    ...project,
    revision: project.revision + 1,
    agentRuns: project.agentRuns.map((run) =>
      run.id === runId ? { ...run, ...patch } : run
    ),
    ...(resultSnapshot === undefined ? {} : {
      threadSnapshots: [...project.threadSnapshots, resultSnapshot],
    }),
  } as EngineeringProjectSnapshot;
}

async function l4CaptureFixture(
  basis: EngineeringAgentRun["basis"],
): Promise<AssemblyIntegrityEvaluationCapture> {
  const method = await assemblyIntegrityEvaluationMethod();
  return await validateAssemblyIntegrityEvaluationCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation",
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: "run-l4",
    evaluatedAt: AT,
    basis,
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${DIGEST_A}`,
      fingerprint: fp(DIGEST_A),
    },
    assemblyStep: {
      artifactId: `cad-asset-${DIGEST_A}-module-step-${DIGEST_B}`,
      fingerprint: fp(DIGEST_B),
    },
    observation: {
      schemaVersion: "assembly-integrity-observation-capture/1.0",
      artifactId: `assembly-integrity-observation-${DIGEST_C}`,
      fingerprint: fp(DIGEST_C),
      observationFingerprint: fp(DIGEST_D),
    },
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0",
      fingerprint: fp(DIGEST_E),
      byteCount: 1024,
    },
    method,
    evaluation: {
      method,
      criteria: [
        { id: "assembly-import", verdict: "pass" },
        { id: "occurrence-coverage", verdict: "pass" },
        { id: "placement-recross", verdict: "pass" },
        { id: "brep-validity", verdict: "pass" },
        { id: "pairwise-intersection", verdict: "pass" },
      ],
      verdict: "pass",
      measurementDiagnostics: { pairwiseLinearToleranceMm: [] },
    },
  });
}

function rootSnapshot(): ThreadSnapshot {
  const geometry = sourceArtifact({
    id: `geometry-${DIGEST_A}`,
    fingerprint: fp(DIGEST_A),
    kind: "cad-model",
    tool: "design.write-geometry@1",
  });
  const step = sourceArtifact({
    id: `cad-asset-${DIGEST_A}-module-step-${DIGEST_B}`,
    fingerprint: fp(DIGEST_B),
    kind: "step",
    tool: "design.write-geometry@1",
    mediaType: "model/step",
  });
  const observation = sourceArtifact({
    id: `assembly-integrity-observation-${DIGEST_C}`,
    fingerprint: fp(DIGEST_C),
    kind: "evidence",
    tool: "verify.observe-assembly-integrity@1",
  });
  const artifacts = [geometry, step, observation];
  const changes = artifacts.map((artifact) => ({
    id: `created-${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: `Captured ${artifact.name}.`,
    afterFingerprint: artifact.fingerprint,
  }));
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-assembly-r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "assembly-subject",
      name: "Assembly subject",
      kind: "assembly",
      version: "1",
      modelArtifactId: geometry.id,
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "assembly-baseline",
      name: "Capture assembly baseline",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: changes.map((change) => ({
      id: `${change.id}-changes`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: change.id },
      to: change.target,
      rationale: "The baseline introduced this exact source artifact.",
    })),
    proposedActions: [],
  });
}

function l4CaptureArtifact(
  capture: AssemblyIntegrityEvaluationCapture,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
): ThreadArtifact {
  return {
    id: `assembly-integrity-evaluation-${fingerprint.digest}`,
    name: "Assembly-integrity evaluation capture",
    kind: "evidence",
    version: fingerprint.digest,
    fingerprint,
    uri: assemblyIntegrityEvaluationCaptureUri(fingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "verify.evaluate-assembly-integrity@1",
      runId: capture.trustedRunId,
    },
    inputArtifactIds: [
      capture.geometryModule.artifactId,
      capture.assemblyStep.artifactId,
      capture.observation.artifactId,
    ],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function sourceArtifact(input: {
  readonly id: string;
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  readonly kind: ThreadArtifact["kind"];
  readonly tool: string;
  readonly mediaType?: string;
}): ThreadArtifact {
  return {
    id: input.id,
    name: input.id,
    kind: input.kind,
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    producer: { serverId: "digital-thread", tool: input.tool, runId: "run-source" },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function threadBasis(snapshot: ThreadSnapshot) {
  return { kind: "thread-snapshot" as const, ...threadRef(snapshot) };
}

function threadRef(snapshot: ThreadSnapshot) {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function briefDerivedSatisfiesClaims(gateIds: readonly string[]) {
  return [...gateIds].toSorted((left, right) => left.localeCompare(right)).map(
    (gateItemId) => ({
      gateItemId,
      role: "satisfies" as const,
      status: "current" as const,
    }),
  );
}

async function seedCompletedCloseout(input: {
  readonly admission: AssemblyIntegrityEvaluationCloseoutAdmission;
  readonly l4Snapshot: ThreadSnapshot;
  readonly snapshotsById: Map<string, ThreadSnapshot>;
  readonly closeoutCaptures: Map<string, string>;
}): Promise<{
  readonly snapshot: ThreadSnapshot;
  readonly artifact: ThreadArtifact;
}> {
  const operation = DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION;
  const capture = validateAssemblyIntegrityEvaluationCloseoutCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    kind: "assembly-integrity-evaluation-closeout",
    operation,
    trustedRunId: "run-l5",
    decisionId: "decision-l5",
    sealedAt: AT,
    admission: input.admission,
    evaluationCapture: {
      id: input.admission.evaluationCapture.id,
      fingerprint: input.admission.evaluationCapture.fingerprint,
      uri:
        `${ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX}${input.admission.evaluationCapture.fingerprint.digest}`,
    },
    l4Limitations: input.admission.limitations,
    limits: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  });
  const text = canonicalAssemblyIntegrityEvaluationCloseoutCaptureText(capture);
  const captureFingerprint = await sha256Fingerprint(capture);
  input.closeoutCaptures.set(captureFingerprint.digest, text);
  const artifactId =
    `assembly-integrity-evaluation-closeout-${captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool: `${operation.id}@${operation.version}`,
    runId: "run-l5",
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Accepted assembly-integrity evaluation closeout",
    kind: "document",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri:
      `${ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.admission.evaluationCapture.id],
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
  };
  const consumption = {
    id: `consume-${input.admission.evaluationCapture.id}-by-${artifact.id}`,
    artifactId: input.admission.evaluationCapture.id,
    consumer: operationRef,
    observedFingerprint: input.admission.evaluationCapture.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.l4Snapshot,
    {
      id: `${operation.id.replaceAll(".", "-")}-run-l5`,
      name: "Accept assembly-integrity evaluation",
      subjectId: input.l4Snapshot.subject.id,
      capturedAt: AT,
      artifacts: [artifact],
      consumptions: [consumption],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [
        {
          id: `${artifact.id}-derived-from-${input.admission.evaluationCapture.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: artifact.id },
          to: { kind: "artifact", id: input.admission.evaluationCapture.id },
          rationale:
            "The human L5 closeout document is derived from this exact reopened L4 evaluation capture.",
        },
        {
          id: `${consumption.id}-uses`,
          relation: "uses",
          from: { kind: "consumption", id: consumption.id },
          to: { kind: "artifact", id: consumption.artifactId },
          rationale:
            "The closeout executor reread and fingerprint-attested the exact direct L4 input.",
        },
      ],
      proposedActions: [],
    },
    { appliedAt: AT },
  );
  if (!applied.applied) {
    throw new Error("Historical closeout successor must be a new Thread revision.");
  }
  const snapshot = validateThreadSnapshot(applied.snapshot);
  input.snapshotsById.set(snapshot.id, snapshot);
  return { snapshot, artifact };
}
