import { assertEquals, assertRejects } from "@std/assert";
import {
  CrossDomainImpactDecisionRecrossError,
  recrossCrossDomainImpactDecision,
} from "./recross-cross-domain-impact-decision.ts";
import { evaluateCrossDomainImpact } from "../../../domain/impact/cross-domain-impact-evaluation.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
  validateCrossDomainImpactEvaluationCapture,
} from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
} from "../../../testing/cross-domain-impact-fixtures.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-led-1";
const SUBJECT = "subject-led-1";
const EVAL_RUN = "run-impact-evaluation";
const EVAL_WORK = "work-impact-evaluation";

Deno.test("X09 recross refuses a tampered X08 evaluation artifact identity", async () => {
  const fixture = await recrossFixture();
  const artifact = fixture.snapshot.artifacts.find((item) =>
    item.id === fixture.evaluationId
  )!;
  (artifact as { name: string }).name = "forged evaluation";
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact X08 evaluation artifact",
  );
});

Deno.test("X09 recross refuses tampered X08 inputArtifactIds", async () => {
  const fixture = await recrossFixture();
  const artifact = fixture.snapshot.artifacts.find((item) =>
    item.id === fixture.evaluationId
  )!;
  (artifact as unknown as { inputArtifactIds: string[] }).inputArtifactIds = [
    ...artifact.inputArtifactIds,
    "forged-input",
  ];
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact X08 evaluation artifact",
  );
});

Deno.test("X09 recross refuses an archived X08 evaluation artifact", async () => {
  const fixture = await recrossFixture();
  (fixture.snapshot.changeSet.changes as unknown as Array<{
    id: string;
    kind: string;
    target: { kind: string; id: string };
    summary: string;
  }>).push({
    id: "change-archive-evaluation",
    kind: "archived",
    target: { kind: "artifact", id: fixture.evaluationId },
    summary: "Archived evaluation.",
  });
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "archived",
  );
});

Deno.test("X09 recross refuses a Brief V2 gate whose dependsOnItemIds drifted", async () => {
  const fixture = await recrossFixture();
  const gate = fixture.brief.gates[0]!;
  fixture.brief.gates = fixture.brief.gates.map((item) =>
    item.id === gate.id
      ? { ...item, dependsOnItemIds: [...item.dependsOnItemIds, "forged-dependency"] }
      : item
  );
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact impact-evaluation gate",
  );
});

Deno.test("X09 recross refuses a Brief V2 that dropped a captured gate identity", async () => {
  const fixture = await recrossFixture();
  fixture.brief.gates = fixture.brief.gates.slice(1);
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact impact-evaluation gate",
  );
});

Deno.test("X09 recross refuses a tampered X08 evaluation mediaType", async () => {
  const fixture = await recrossFixture();
  const artifact = fixture.snapshot.artifacts.find((item) =>
    item.id === fixture.evaluationId
  )!;
  (artifact as { mediaType?: string }).mediaType = "text/plain";
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact X08 evaluation artifact",
  );
});

async function recrossFixture() {
  const capture = await captureFixture();
  const captureFingerprint = await sha256Fingerprint(capture);
  const evaluationId = `cross-domain-impact-evaluation-${captureFingerprint.digest}`;
  const evaluationArtifact: ThreadArtifact = {
    id: evaluationId,
    name: "Cross-domain impact evaluation",
    kind: "document",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: crossDomainImpactEvaluationCaptureUri(captureFingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "analyze.evaluate-cross-domain-impact@1",
      runId: EVAL_RUN,
    },
    inputArtifactIds: capture.artifactInputs.map((item) => item.id),
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
  const inputArtifacts: ThreadArtifact[] = capture.artifactInputs.map((item) => ({
    id: item.id,
    name: item.id,
    kind: "document",
    version: "1",
    fingerprint: item.fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: "recorded-test@1",
      runId: `run-${item.id}`,
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  }));
  const snapshot = {
    id: "thread-impact-r2",
    revision: 2,
    previous: { snapshotId: "thread-impact-r1", revision: 1 },
    subject: { id: SUBJECT },
    artifacts: [...inputArtifacts, evaluationArtifact],
    changeSet: {
      changes: [] as Array<{
        id: string;
        kind: string;
        target: { kind: string; id: string };
        summary: string;
      }>,
    },
  } as unknown as ThreadSnapshot;
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: SUBJECT,
  };
  const evidence = {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: evaluationId,
  };
  const project = {
    project: { id: PROJECT, subjectId: SUBJECT },
    threadSnapshots: [basis],
    workItems: [
      {
        id: EVAL_WORK,
        status: "completed",
        operation: {
          id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
          version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
          bindings: [{
            name: "approvedBrief",
            source: { kind: "approved-brief" },
          }],
        },
        evidenceRefs: [evidence],
        gateClaims: [
          {
            gateItemId: "gate-electrical",
            role: "satisfies",
            status: "current",
          },
          {
            gateItemId: "gate-thermal",
            role: "contributes-to",
            status: "current",
          },
          {
            gateItemId: "gate-mechanical",
            role: "satisfies",
            status: "current",
          },
        ],
      },
    ],
    agentRuns: [{
      id: EVAL_RUN,
      workItemId: EVAL_WORK,
      status: "completed",
      startedAt: AT,
      resultSnapshot: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: SUBJECT,
      },
      basis: {
        kind: "thread-snapshot",
        snapshotId: "thread-impact-r1",
        revision: 1,
        subjectId: SUBJECT,
      },
      evidenceRefs: [evidence],
    }],
  } as unknown as EngineeringProjectSnapshot;
  const brief = {
    contractVersion: "2.0" as const,
    projectId: PROJECT,
    brief: {
      id: capture.brief.id,
      revision: capture.brief.revision,
      fingerprint: capture.brief.fingerprint,
    },
    gates: capture.brief.gates.map((gate) => ({
      id: gate.gateItemId,
      kind: gate.kind,
      fingerprint: gate.fingerprint,
      dependsOnItemIds: gate.dependsOnItemIds,
    })),
  };
  const captures = {
    save: () => Promise.reject(new Error("must not save")),
    read: (fingerprint: ContentFingerprint) =>
      Promise.resolve(
        fingerprint.digest === captureFingerprint.digest ? capture : undefined,
      ),
  };
  return {
    evaluationId,
    snapshot,
    brief,
    input: () => ({
      project,
      basis,
      snapshot,
      briefGates: { read: () => Promise.resolve(brief) },
      captures,
    }),
  };
}

async function captureFixture(): Promise<CrossDomainImpactEvaluationCapture> {
  const input = await validCrossDomainImpactEvaluationInput();
  const evaluation = await evaluateCrossDomainImpact(input);
  const branchFacts = input.branchReadiness.map((branch) => ({
    branchId: branch.branchId,
    method: {
      reference: branch.method.reference,
      availability: "available" as const,
    },
    joins: branch.joins.map((join) => ({
      reference: join.reference,
      currentness: "current" as const,
    })),
  }));
  const mechanicalEvidence = input.mechanicalEvidence!;
  const artifactInputs = [
    { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
    ...branchFacts.flatMap((branch) => [
      branch.method.reference,
      ...branch.joins.map((join) => join.reference),
    ]),
    mechanicalEvidence.evidence,
    ...mechanicalEvidence.consumptions.map((item) => item.input),
  ].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
  return await validateCrossDomainImpactEvaluationCapture({
    schemaVersion: "cross-domain-impact-evaluation-capture/1.0",
    kind: "cross-domain-impact-evaluation",
    operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: EVAL_RUN,
    evaluatedAt: AT,
    manifestSeal: {
      artifact: { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
      trustedRunId: "run-manifest-seal",
    },
    artifactInputs,
    manifest: {
      id: evaluation.manifest.id,
      fingerprint: evaluation.manifest.fingerprint,
      reference: impactFingerprint("8"),
    },
    brief: {
      id: "brief-impact-evaluation",
      revision: 2,
      fingerprint: impactFingerprint("7"),
      gates: evaluation.gateClaims.map((claim, index) => ({
        gateItemId: claim.gateItemId,
        kind: "success-criterion" as const,
        branchId: claim.branchId,
        role: claim.role,
        fingerprint: impactFingerprint(String(index + 1)),
        dependsOnItemIds: [],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    branchFacts,
    mechanicalFact: {
      status: "current" as const,
      assertionId: input.manifest.independenceAssertions[0]!.id,
      reviewTrigger: input.reviewTrigger,
      evidence: mechanicalEvidence.evidence,
      evidenceFreshness: "fresh" as const,
      consumptions: mechanicalEvidence.consumptions,
    },
    evaluation,
    limits: {
      providerCalls: "none",
      solverCalls: "none",
      gateClaimTransitions: "none",
      workItemInvalidations: "none",
      rerunProposals: "none",
    },
  });
}
