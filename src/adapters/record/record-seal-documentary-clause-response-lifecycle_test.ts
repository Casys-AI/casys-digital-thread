/**
 * Synthetic registered-writer lifecycle for documentary clause-response.
 * Temporary fixture state only; no ID01, provider, or live atelier.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { persistAgentResourceText } from "../../testing/agent-resource-test-support.ts";
import {
  startSyntheticApprovedBriefBaseline,
  SYNTHETIC_BASELINE_AGENT,
  SYNTHETIC_BASELINE_HUMAN,
} from "../../testing/synthetic-approved-brief-baseline.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ReadProjectResponse } from "../../application/use-cases/project-response/read-project-response.ts";
import { ThreadProjectResponseEvidenceReader } from "../thread/project-response-evidence-reader.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";

import {
  DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX,
  documentaryClauseResponseArtifactId,
  documentaryClauseResponseUri,
  RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
} from "../../domain/record/documentary-clause-response.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { PROJECT_RESPONSE_SCHEMA } from "../../domain/project/project-response.ts";
import type { ProjectDocumentaryClauseResponseReviewSourceRef } from "../../application/ports/in/record/project-documentary-clause-response-review.ts";
import { PrepareProjectDocumentaryClauseResponseReview } from "./capture-backed-documentary-clause-response-reviewer.ts";
import { createDocumentaryClauseResponseStore } from "./documentary-clause-response-store.ts";
import { RecordSealDocumentaryClauseResponseRunExecutor } from "./record-seal-documentary-clause-response-run-executor.ts";
import { readDocumentaryClauseResponseHistory } from "./documentary-clause-response-history.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ProjectResponseReadModel } from "../../domain/project/project-response.ts";

const PROJECT_ID = "synthetic-clause-response";
const AGENT = SYNTHETIC_BASELINE_AGENT;
const HUMAN = SYNTHETIC_BASELINE_HUMAN;
type ThreadArtifactSourceRef = Extract<
  ProjectDocumentaryClauseResponseReviewSourceRef,
  { readonly kind: "thread-artifact" }
>;

Deno.test({
  name:
    "registered clause-response writer seals a sourced exclusion, replays, and supersedes",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "clause-response-life-" });
    try {
      const baseline = await startSyntheticApprovedBriefBaseline({
        directory: root,
        projectId: PROJECT_ID,
        projectName: "Synthetic clause-response",
        intent: "Record a sourced documentary exclusion answer.",
        items: syntheticBriefItems(),
      });
      const persisted = await persistAgentResourceText(`${root}/resources`, {
        name: "exclusion-note.md",
        mimeType: "text/markdown",
        text: "Bench evidence does not claim outdoor use.",
      });
      const captures = createDocumentaryClauseResponseStore(`${root}/captures`);
      const review = new PrepareProjectDocumentaryClauseResponseReview({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
      });
      const executor = new RecordSealDocumentaryClauseResponseRunExecutor({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
        commands: baseline.commands,
        lease: new FileEngineeringProjectRunLease(`${root}/writer-leases`),
      });
      const reader = new ReadProjectResponse({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        evidence: new ThreadProjectResponseEvidenceReader({
          projects: baseline.projects,
          snapshots: baseline.snapshots,
          captures: { read: () => Promise.resolve(undefined) },
          clauseResponses: captures,
          resources: persisted.reopen,
        }),
      });

      const first = await sealClauseResponse({
        baseline,
        review,
        executor,
        resource: persisted.reference,
        workItemId: "seal-exclusion-r1",
        decisionId: "decision-exclusion-r1",
        runId: "run:clause-r1",
        commandPrefix: "first",
        answer: "Outdoor use remains excluded from this bench record.",
      });
      assertEquals(first.status, "resolved");

      const afterFirst = await reader.read({ projectId: PROJECT_ID });
      assertEquals(afterFirst.schemaVersion, PROJECT_RESPONSE_SCHEMA);
      const exclusion = afterFirst.items.find((row) => row.item.id === "exclusion")!;
      assertEquals(exclusion.requirements, []);
      assertEquals(exclusion.clauseResponses.length, 1);
      assertEquals(exclusion.clauseResponses[0]!.recordingStatus, "proposal");
      assertEquals(exclusion.clauseResponses[0]!.authorKind, "agent");
      assertEquals(exclusion.clauseResponses[0]!.predecessorArtifactId, undefined);
      assertEquals(
        afterFirst.items.every((row) =>
          row.requirements.every((requirement) => requirement.evaluations.length === 0)
        ),
        true,
      );
      const firstArtifacts = await clauseResponseArtifacts(baseline);
      assertEquals(firstArtifacts.length, 1);

      const replayed = await executor.execute(AGENT, {
        commandId: "execute-first",
        projectId: PROJECT_ID,
        expectedRevision: first.queuedRevision,
        issuedAt: "2026-09-13T10:00:00.000Z",
        runId: "run:clause-r1",
      });
      const afterReplay = await baseline.projects.get(PROJECT_ID);
      assertEquals(afterReplay!.revision, replayed.revision);
      assertEquals(
        (await clauseResponseArtifacts(baseline)).length,
        1,
      );

      const foreignExecutor = new RecordSealDocumentaryClauseResponseRunExecutor({
        projects: {
          get: async (id: string) => {
            const project = await baseline.projects.get(id);
            if (!project) return undefined;
            return {
              ...project,
              commandReceipts: project.commandReceipts?.map((receipt) =>
                receipt.commandId.endsWith(":complete") &&
                  receipt.type === "agent-run.complete"
                  ? {
                    ...receipt,
                    resultingSnapshot: {
                      snapshotId: "project:foreign-same-revision",
                      revision: receipt.resultingSnapshot.revision,
                    },
                  }
                  : receipt
              ),
            };
          },
          getRevision: (id, revision) => baseline.projects.getRevision(id, revision),
        },
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
        commands: baseline.commands,
        lease: new FileEngineeringProjectRunLease(`${root}/writer-leases-foreign`),
      });
      await assertRejects(
        () =>
          foreignExecutor.execute(AGENT, {
            commandId: "execute-first",
            projectId: PROJECT_ID,
            expectedRevision: first.queuedRevision,
            issuedAt: "2026-09-13T10:00:00.000Z",
            runId: "run:clause-r1",
          }),
        EngineeringProjectCommandError,
        "no unique exact completion receipt",
      );

      const historyExecutor = (
        projects: Pick<
          typeof baseline.projects,
          "get" | "getRevision"
        >,
      ) =>
        new RecordSealDocumentaryClauseResponseRunExecutor({
          projects,
          snapshots: baseline.snapshots,
          captures,
          resources: persisted.reopen,
          commands: baseline.commands,
          lease: new FileEngineeringProjectRunLease(`${root}/history-leases`),
        });
      const withoutAttachment = (project: EngineeringProjectSnapshot) => ({
        ...project,
        workItems: project.workItems.map((item) =>
          item.id === "seal-exclusion-r1" ? { ...item, evidenceRefs: [] } : item
        ),
      });
      const replayCommand = {
        commandId: "execute-first",
        projectId: PROJECT_ID,
        expectedRevision: first.queuedRevision,
        issuedAt: "2026-09-13T10:00:00.000Z",
        runId: "run:clause-r1",
      };
      const historicalAttachment = historyExecutor({
        get: async (id) => {
          const current = await baseline.projects.get(id);
          return current ? withoutAttachment(current) : undefined;
        },
        getRevision: (id, revision) => baseline.projects.getRevision(id, revision),
      });
      await historicalAttachment.execute(AGENT, replayCommand);
      const missingHistoricalAttachment = historyExecutor({
        get: (id) => baseline.projects.get(id),
        getRevision: async (id, revision) => {
          const historical = await baseline.projects.getRevision(id, revision);
          return historical ? withoutAttachment(historical) : undefined;
        },
      });
      await assertRejects(
        () => missingHistoricalAttachment.execute(AGENT, replayCommand),
        EngineeringProjectCommandError,
        "not attached to exactly one declared successor",
      );

      const second = await sealClauseResponse({
        baseline,
        review,
        executor,
        resource: persisted.reference,
        workItemId: "seal-exclusion-r2",
        decisionId: "decision-exclusion-r2",
        runId: "run:clause-r2",
        commandPrefix: "second",
        answer: "Outdoor use remains excluded; the successor restates the same scope.",
        dependsOnWorkItemIds: ["seal-exclusion-r1"],
      });
      assertEquals(second.status, "resolved");
      const afterSecond = await reader.read({ projectId: PROJECT_ID });
      const later = afterSecond.items.find((row) => row.item.id === "exclusion")!;
      assertEquals(later.clauseResponses.length, 2);
      const head = later.clauseResponses.find((item) => item.revision === 2)!;
      const prior = later.clauseResponses.find((item) => item.revision === 1)!;
      assertEquals(head.predecessorArtifactId, prior.artifactId);
      assertEquals(head.applicability, "current");
      assertEquals(prior.applicability, "historical");
      assertEquals(
        (await clauseResponseArtifacts(baseline)).length,
        2,
      );
      assertEquals(later.requirements, []);

      let laterTick = 0;
      const briefs = new ProjectBriefCommandService(
        baseline.projects,
        () =>
          new Date(
            Date.parse("2026-09-13T20:00:00.000Z") + ++laterTick * 1_000,
          ).toISOString(),
      );
      let changed = (await baseline.projects.get(PROJECT_ID))!;
      const laterIssued = "2026-09-13T20:00:00.000Z";
      changed = await briefs.proposeBrief(AGENT, {
        commandId: "propose-later-brief",
        projectId: PROJECT_ID,
        expectedRevision: changed.revision,
        issuedAt: laterIssued,
        items: syntheticBriefItems(
          "Outdoor use is restated after a later review.",
        ),
      });
      await briefs.approveBrief(HUMAN, {
        commandId: "approve-later-brief",
        projectId: PROJECT_ID,
        expectedRevision: changed.revision,
        issuedAt: laterIssued,
        briefSnapshotId: changed.framing!.proposedBrief!.id,
        briefRevision: changed.framing!.proposedBrief!.revision,
        rationale: "Later brief revision must retain historical answers.",
        inputFingerprint: changed.framing!.proposalReview!.inputFingerprint,
      });
      const beforeHistoricalReplay = (await baseline.projects.get(PROJECT_ID))!;
      const historicalReplay = await executor.execute(AGENT, {
        commandId: "execute-first",
        projectId: PROJECT_ID,
        expectedRevision: first.queuedRevision,
        issuedAt: "2026-09-13T10:00:00.000Z",
        runId: "run:clause-r1",
      });
      assertEquals(historicalReplay.revision, beforeHistoricalReplay.revision);
      assertEquals(
        (await baseline.projects.get(PROJECT_ID))!.revision,
        beforeHistoricalReplay.revision,
      );
      assertEquals((await clauseResponseArtifacts(baseline)).length, 2);
      const afterLaterBrief = await reader.read({ projectId: PROJECT_ID });
      assertEquals(afterLaterBrief.status, "available");
      const retained = afterLaterBrief.items.find((row) =>
        row.item.id === "exclusion"
      )!;
      assertEquals(retained.clauseResponses.length, 2);
      assertEquals(
        retained.clauseResponses.every((item) => item.applicability === "historical"),
        true,
      );
      assertEquals(
        retained.clauseResponses.map((item) => item.revision).toSorted(),
        [1, 2],
      );
      assertEquals(retained.requirements, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "production reader refuses tampered producer, run, missing human approval, absent capture, and broken predecessor",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "clause-response-reader-" });
    try {
      const baseline = await startSyntheticApprovedBriefBaseline({
        directory: root,
        projectId: PROJECT_ID,
        projectName: "Synthetic clause-response reader",
        intent: "Refuse unauthenticated declared clause-response captures.",
        items: syntheticBriefItems(),
      });
      const persisted = await persistAgentResourceText(`${root}/resources`, {
        name: "exclusion-note.md",
        mimeType: "text/markdown",
        text: "Bench evidence does not claim outdoor use.",
      });
      const captures = createDocumentaryClauseResponseStore(`${root}/captures`);
      const review = new PrepareProjectDocumentaryClauseResponseReview({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
      });
      const executor = new RecordSealDocumentaryClauseResponseRunExecutor({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
        commands: baseline.commands,
        lease: new FileEngineeringProjectRunLease(`${root}/writer-leases`),
      });
      const sourceRef = await exactBaselineThreadArtifactSource(baseline);
      await sealClauseResponse({
        baseline,
        review,
        executor,
        resource: persisted.reference,
        workItemId: "seal-exclusion-r1",
        decisionId: "decision-exclusion-r1",
        runId: "run:clause-r1",
        commandPrefix: "first",
        answer: "Outdoor use remains excluded from this bench record.",
        sourceRefs: [sourceRef],
      });

      const project = (await baseline.projects.get(PROJECT_ID))!;
      const thread = await currentSnapshot(baseline);
      const readerFor = (
        overrides: {
          readonly project?: EngineeringProjectSnapshot;
          readonly thread?: ThreadSnapshot;
          readonly captures?: {
            read(
              fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
            ): Promise<string | undefined>;
          };
          readonly snapshots?: Pick<typeof baseline.snapshots, "get">;
        } = {},
      ) =>
        new ReadProjectResponse({
          projects: baseline.projects,
          snapshots: baseline.snapshots,
          evidence: new ThreadProjectResponseEvidenceReader({
            projects: baseline.projects,
            snapshots: overrides.snapshots ?? baseline.snapshots,
            captures: { read: () => Promise.resolve(undefined) },
            clauseResponses: overrides.captures ?? captures,
            resources: persisted.reopen,
          }),
        }).project({
          project: overrides.project ?? project,
          thread: overrides.thread ?? thread,
        });

      const valid = await readerFor();
      assertEquals(valid.status, "available");
      assertEquals(
        valid.items.find((row) => row.item.id === "exclusion")!.clauseResponses
          .length,
        1,
      );

      const sourceIdentityMismatch = await readerFor({
        snapshots: snapshotOverride(baseline, baseline.threadRef.snapshotId, (
          snapshot,
        ) => ({
          ...snapshot,
          artifacts: snapshot.artifacts.map((artifact) =>
            artifact.id === sourceRef.artifactId
              ? {
                ...artifact,
                fingerprint: {
                  algorithm: "sha256" as const,
                  digest: "0".repeat(64),
                },
              }
              : artifact
          ),
        })),
      });
      assertRefused(sourceIdentityMismatch, "clause-response.unavailable");

      const changedSuccessorSource = await readerFor({
        snapshots: snapshotOverride(baseline, thread.id, (snapshot) => ({
          ...snapshot,
          artifacts: snapshot.artifacts.map((artifact) =>
            artifact.id === sourceRef.artifactId
              ? { ...artifact, name: "Different source in the published successor" }
              : artifact
          ),
        })),
      });
      assertRefused(changedSuccessorSource, "clause-response.unavailable");
      const uncomposedCas = await new ReadProjectResponse({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        evidence: new ThreadProjectResponseEvidenceReader({
          projects: baseline.projects,
          snapshots: baseline.snapshots,
          captures: { read: () => Promise.resolve(undefined) },
          resources: persisted.reopen,
        }),
      }).project({ project, thread });
      assertRefused(uncomposedCas, "clause-response.unavailable");

      const declaredFirst = thread.artifacts.find((artifact) =>
        artifact.uri?.startsWith(DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX)
      )!;
      const originalCapture = JSON.parse(
        (await captures.read(declaredFirst.fingerprint))!,
      );
      const forgedClaimCapture = {
        ...originalCapture,
        claim: {
          ...originalCapture.claim,
          id: `documentary-clause-response-${"f".repeat(64)}`,
        },
      };
      const forgedFingerprint = await sha256Fingerprint(forgedClaimCapture);
      const forgedArtifactId = documentaryClauseResponseArtifactId(
        forgedFingerprint,
      );
      const forgedThread = replaceString(
        thread,
        declaredFirst.id,
        forgedArtifactId,
      );
      const forgedFingerprintThread = replaceFingerprint(
        forgedThread,
        declaredFirst.fingerprint.digest,
        forgedFingerprint,
      );
      const coherentForgedThread: ThreadSnapshot = {
        ...forgedFingerprintThread,
        artifacts: forgedFingerprintThread.artifacts.map((artifact) =>
          artifact.id === forgedArtifactId
            ? {
              ...artifact,
              fingerprint: forgedFingerprint,
              version: forgedFingerprint.digest,
              uri: documentaryClauseResponseUri(forgedFingerprint),
            }
            : artifact
        ),
      };
      const forgedProject: EngineeringProjectSnapshot = {
        ...project,
        agentRuns: project.agentRuns.map((run) =>
          run.id === "run:clause-r1"
            ? {
              ...run,
              evidenceRefs: [{
                snapshotId: run.resultSnapshot!.snapshotId,
                snapshotRevision: run.resultSnapshot!.revision,
                kind: "artifact" as const,
                id: forgedArtifactId,
              }],
            }
            : run
        ),
      };
      await assertRejects(
        () =>
          readDocumentaryClauseResponseHistory({
            project: forgedProject,
            thread: coherentForgedThread,
            dependencies: {
              captures: {
                read: (fingerprint) =>
                  Promise.resolve(
                    fingerprint.digest === forgedFingerprint.digest
                      ? deterministicJson(forgedClaimCapture)
                      : undefined,
                  ),
              },
              projects: baseline.projects,
              snapshots: snapshotOverride(
                baseline,
                thread.id,
                () => coherentForgedThread,
              ),
              resources: persisted.reopen,
            },
          }),
        TypeError,
        "claim does not equal its project and approved brief item identity",
      );

      const absent = await readerFor({
        captures: { read: () => Promise.resolve(undefined) },
      });
      assertRefused(absent, "clause-response.unavailable");

      const forgedProducer = await readerFor({
        thread: {
          ...thread,
          artifacts: thread.artifacts.map((artifact) =>
            artifact.uri?.startsWith(DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX)
              ? {
                ...artifact,
                producer: { ...artifact.producer, tool: "forged.producer@1" },
              }
              : artifact
          ),
        },
      });
      assertRefused(forgedProducer, "clause-response.unavailable");

      const forgedRun = await readerFor({
        project: {
          ...project,
          agentRuns: project.agentRuns.map((run) =>
            run.id === "run:clause-r1"
              ? { ...run, status: "failed" as const, resultSnapshot: undefined }
              : run
          ),
        },
      });
      assertRefused(forgedRun, "clause-response.unavailable");

      const missingApproval = await readerFor({
        project: {
          ...project,
          approvals: project.approvals.filter((item) =>
            item.decisionId !== "decision-exclusion-r1"
          ),
        },
      });
      assertRefused(missingApproval, "clause-response.unavailable");

      const forgedHuman = await readerFor({
        project: {
          ...project,
          approvals: project.approvals.map((item) =>
            item.decisionId === "decision-exclusion-r1"
              ? { ...item, decidedByOrigin: "agent" as const }
              : item
          ),
        },
      });
      assertRefused(forgedHuman, "clause-response.unavailable");

      await sealClauseResponse({
        baseline,
        review,
        executor,
        resource: persisted.reference,
        workItemId: "seal-exclusion-r2",
        decisionId: "decision-exclusion-r2",
        runId: "run:clause-r2",
        commandPrefix: "second",
        answer: "Outdoor use remains excluded; the successor restates the same scope.",
        dependsOnWorkItemIds: ["seal-exclusion-r1"],
      });
      const afterSuccessor = await currentSnapshot(baseline);
      const declared = afterSuccessor.artifacts.filter((artifact) =>
        artifact.uri?.startsWith(DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX)
      );
      assertEquals(declared.length, 2);
      const successor = declared.find((artifact) =>
        artifact.inputArtifactIds.some((id) =>
          declared.some((candidate) => candidate.id === id)
        )
      )!;
      const predecessorId = successor.inputArtifactIds.find((id) =>
        declared.some((candidate) => candidate.id === id)
      )!;
      const brokenPredecessor = await new ReadProjectResponse({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        evidence: new ThreadProjectResponseEvidenceReader({
          projects: baseline.projects,
          snapshots: baseline.snapshots,
          captures: { read: () => Promise.resolve(undefined) },
          clauseResponses: captures,
          resources: persisted.reopen,
        }),
      }).project({
        project: (await baseline.projects.get(PROJECT_ID))!,
        thread: {
          ...afterSuccessor,
          artifacts: afterSuccessor.artifacts.map((artifact) =>
            artifact.id === predecessorId
              ? { ...artifact, uri: `casys://other/${artifact.uri}` }
              : artifact
          ),
        },
      });
      assertRefused(brokenPredecessor, "clause-response.unresolved");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "stale brief and forged nonhuman MRTR refuse a successor before it is written",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "clause-response-stale-" });
    try {
      const baseline = await startSyntheticApprovedBriefBaseline({
        directory: root,
        projectId: PROJECT_ID,
        projectName: "Synthetic clause-response stale",
        intent: "Refuse stale or forged successor writes.",
        items: syntheticBriefItems(),
      });
      const persisted = await persistAgentResourceText(`${root}/resources`, {
        name: "exclusion-note.md",
        mimeType: "text/markdown",
        text: "Bench evidence does not claim outdoor use.",
      });
      const captures = createDocumentaryClauseResponseStore(`${root}/captures`);
      const review = new PrepareProjectDocumentaryClauseResponseReview({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
      });
      const executor = new RecordSealDocumentaryClauseResponseRunExecutor({
        projects: baseline.projects,
        snapshots: baseline.snapshots,
        captures,
        resources: persisted.reopen,
        commands: baseline.commands,
        lease: new FileEngineeringProjectRunLease(`${root}/writer-leases`),
      });
      await sealClauseResponse({
        baseline,
        review,
        executor,
        resource: persisted.reference,
        workItemId: "seal-exclusion-r1",
        decisionId: "decision-exclusion-r1",
        runId: "run:clause-r1",
        commandPrefix: "first",
        answer: "Outdoor use remains excluded from this bench record.",
      });
      assertEquals((await clauseResponseArtifacts(baseline)).length, 1);

      let project = (await baseline.projects.get(PROJECT_ID))!;
      project = await baseline.commands.appendChange(AGENT, {
        ...baseline.commandContext("append-forged", project.revision),
        baseSnapshot: await currentThreadRef(baseline),
        phases: [{
          id: "forged-phase",
          name: "Forged successor",
          description: "Attempt a nonhuman recording approval.",
        }],
        workItems: [{
          id: "seal-exclusion-forged",
          phaseId: "forged-phase",
          owner: "agent",
          dependsOnWorkItemIds: ["seal-exclusion-r1"],
          decisionIds: ["decision-exclusion-forged"],
          operation: {
            id: RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.id,
            version: RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.version,
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        }],
        requiredDecisions: [{
          id: "decision-exclusion-forged",
          phaseId: "forged-phase",
          title: "Record a forged successor",
          question: "Approve recording this successor?",
        }],
      });
      const forgedReview = await review.execute({
        projectId: PROJECT_ID,
        sourceItemId: "exclusion",
        answer: "This successor must not be recorded with an agent MRTR.",
        scope: "context",
        sourceRefs: [{
          kind: "agent-resource",
          resourceRef: persisted.reference,
        }],
      });
      assertEquals(forgedReview.status, "resolved");
      if (forgedReview.status !== "resolved") return;
      project = await baseline.commands.proposeDecision(AGENT, {
        ...baseline.commandContext("propose-forged", project.revision),
        decisionId: "decision-exclusion-forged",
        baseSnapshot: await currentThreadRef(baseline),
        proposal: {
          summary: "Record a documentary successor.",
          parameters: [...forgedReview.decisionParameters],
        },
      });
      await assertRejects(
        () =>
          baseline.commands.approveDecision(AGENT, {
            ...baseline.commandContext("approve-forged", project.revision),
            decisionId: "decision-exclusion-forged",
            rationale: "Agent cannot authorize recording.",
            inputFingerprint: project.decisions.find((item) =>
              item.id === "decision-exclusion-forged"
            )!.inputFingerprint!,
          }),
        EngineeringProjectCommandError,
      );
      assertEquals((await clauseResponseArtifacts(baseline)).length, 1);

      const queued = await queueSuccessor({
        baseline,
        review,
        resource: persisted.reference,
        workItemId: "seal-exclusion-stale",
        decisionId: "decision-exclusion-stale",
        runId: "run:clause-stale",
        commandPrefix: "stale",
        answer: "This successor is queued against the current brief.",
        dependsOnWorkItemIds: ["seal-exclusion-r1"],
      });
      let later = 0;
      const briefs = new ProjectBriefCommandService(
        baseline.projects,
        () =>
          new Date(
            Date.parse("2026-09-13T20:00:00.000Z") + ++later * 1_000,
          ).toISOString(),
      );
      let changed = (await baseline.projects.get(PROJECT_ID))!;
      const laterIssued = "2026-09-13T20:00:00.000Z";
      changed = await briefs.proposeBrief(AGENT, {
        commandId: "propose-new-brief",
        projectId: PROJECT_ID,
        expectedRevision: changed.revision,
        issuedAt: laterIssued,
        items: syntheticBriefItems("Outdoor use is restated after a later review."),
      });
      await briefs.approveBrief(HUMAN, {
        commandId: "approve-new-brief",
        projectId: PROJECT_ID,
        expectedRevision: changed.revision,
        issuedAt: laterIssued,
        briefSnapshotId: changed.framing!.proposedBrief!.id,
        briefRevision: changed.framing!.proposedBrief!.revision,
        rationale: "Later brief revision for stale-mutation coverage.",
        inputFingerprint: changed.framing!.proposalReview!.inputFingerprint,
      });
      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "execute-clause-stale",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-09-13T10:00:00.000Z",
            runId: "run:clause-stale",
          }),
        EngineeringProjectCommandError,
      );
      assertEquals((await clauseResponseArtifacts(baseline)).length, 1);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

function syntheticBriefItems(
  exclusionStatement = "No outdoor use.",
) {
  return [{
    id: "objective",
    kind: "objective" as const,
    statement: "Record a sourced documentary exclusion.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:synthetic" }],
  }, {
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Keep context answers distinct from requirements.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:synthetic" }],
  }, {
    id: "exclusion",
    kind: "exclusion" as const,
    statement: exclusionStatement,
    sourceRefs: [{ kind: "document" as const, reference: "brief:exclusion" }],
  }, {
    id: "success",
    kind: "success-criterion" as const,
    statement: "Displacement stays at or below 2 mm.",
    sourceRefs: [{ kind: "document" as const, reference: "brief:limit" }],
    dependsOnItemIds: [],
  }];
}

async function clauseResponseArtifacts(
  baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>,
) {
  const project = (await baseline.projects.get(PROJECT_ID))!;
  const tip = project.threadSnapshots.reduce((latest, candidate) =>
    candidate.revision > latest.revision ? candidate : latest
  );
  const snapshot = await baseline.snapshots.get(tip.snapshotId);
  return (snapshot?.artifacts ?? []).filter((artifact) =>
    artifact.uri?.startsWith(DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX)
  );
}

function assertRefused(
  result: ProjectResponseReadModel,
  code: "clause-response.unavailable" | "clause-response.unresolved",
): void {
  assertEquals(
    result.status,
    code === "clause-response.unresolved" ? "unresolved" : "unavailable",
  );
  assertEquals(result.diagnostics.some((item) => item.code === code), true);
  assertEquals(
    result.items.every((row) => row.clauseResponses.length === 0),
    true,
  );
  assertEquals(
    result.items.every((row) =>
      row.requirements.every((requirement) => requirement.evaluations.length === 0)
    ),
    true,
  );
  assertEquals("pass" in result, false);
}

async function currentSnapshot(
  baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>,
): Promise<ThreadSnapshot> {
  const ref = await currentThreadRef(baseline);
  const snapshot = await baseline.snapshots.get(ref.snapshotId);
  if (!snapshot) throw new Error("Current Thread snapshot is unavailable.");
  return snapshot;
}

async function exactBaselineThreadArtifactSource(
  baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>,
): Promise<ThreadArtifactSourceRef> {
  const snapshot = await baseline.snapshots.get(baseline.threadRef.snapshotId);
  const artifact = snapshot?.artifacts[0];
  if (!artifact) {
    throw new Error("The synthetic approved-brief baseline has no source artifact.");
  }
  return { kind: "thread-artifact", artifactId: artifact.id };
}

function snapshotOverride(
  baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>,
  snapshotId: string,
  change: (snapshot: ThreadSnapshot) => ThreadSnapshot,
): Pick<typeof baseline.snapshots, "get"> {
  return {
    get: async (id) => {
      const snapshot = await baseline.snapshots.get(id);
      return snapshot && id === snapshotId ? change(snapshot) : snapshot;
    },
  };
}

function replaceString<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") return (value === from ? to : value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => replaceString(item, from, to)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceString(item, from, to)]),
    ) as T;
  }
  return value;
}

function replaceFingerprint<T>(
  value: T,
  digest: string,
  replacement: { readonly algorithm: "sha256"; readonly digest: string },
): T {
  if (Array.isArray(value)) {
    return value.map((item) => replaceFingerprint(item, digest, replacement)) as T;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.algorithm === "sha256" && record.digest === digest) {
      return replacement as T;
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        replaceFingerprint(item, digest, replacement),
      ]),
    ) as T;
  }
  return value;
}

async function currentThreadRef(
  baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>,
) {
  const project = (await baseline.projects.get(PROJECT_ID))!;
  const tip = project.threadSnapshots.reduce((latest, candidate) =>
    candidate.revision > latest.revision ? candidate : latest
  );
  return {
    snapshotId: tip.snapshotId,
    revision: tip.revision,
    subjectId: tip.subjectId,
  };
}

async function sealClauseResponse(input: {
  readonly baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>;
  readonly review: PrepareProjectDocumentaryClauseResponseReview;
  readonly executor: RecordSealDocumentaryClauseResponseRunExecutor;
  readonly resource: AgentResourceReference;
  readonly workItemId: string;
  readonly decisionId: string;
  readonly runId: string;
  readonly commandPrefix: string;
  readonly answer: string;
  readonly sourceRefs?: readonly ProjectDocumentaryClauseResponseReviewSourceRef[];
  readonly dependsOnWorkItemIds?: readonly string[];
}): Promise<{
  readonly status: "resolved" | "unresolved";
  readonly queuedRevision: number;
}> {
  const queued = await queueSuccessor({
    baseline: input.baseline,
    review: input.review,
    resource: input.resource,
    workItemId: input.workItemId,
    decisionId: input.decisionId,
    runId: input.runId,
    commandPrefix: input.commandPrefix,
    answer: input.answer,
    sourceRefs: input.sourceRefs,
    dependsOnWorkItemIds: input.dependsOnWorkItemIds ?? ["record-brief"],
  });
  await input.executor.execute(AGENT, {
    commandId: `execute-${input.commandPrefix}`,
    projectId: PROJECT_ID,
    expectedRevision: queued.revision,
    issuedAt: "2026-09-13T10:00:00.000Z",
    runId: input.runId,
  });
  return { status: "resolved", queuedRevision: queued.revision };
}

async function queueSuccessor(input: {
  readonly baseline: Awaited<ReturnType<typeof startSyntheticApprovedBriefBaseline>>;
  readonly review: PrepareProjectDocumentaryClauseResponseReview;
  readonly resource: AgentResourceReference;
  readonly workItemId: string;
  readonly decisionId: string;
  readonly runId: string;
  readonly commandPrefix: string;
  readonly answer: string;
  readonly sourceRefs?: readonly ProjectDocumentaryClauseResponseReviewSourceRef[];
  readonly dependsOnWorkItemIds: readonly string[];
}): Promise<EngineeringProjectSnapshot> {
  const reviewed = await input.review.execute({
    projectId: PROJECT_ID,
    sourceItemId: "exclusion",
    answer: input.answer,
    scope: "context",
    sourceRefs: input.sourceRefs ?? [{
      kind: "agent-resource",
      resourceRef: input.resource,
    }],
  });
  if (reviewed.status !== "resolved") {
    throw new Error(reviewed.diagnostics.map((item) => item.message).join("; "));
  }
  const threadRef = await currentThreadRef(input.baseline);
  let project = (await input.baseline.projects.get(PROJECT_ID))!;
  project = await input.baseline.commands.appendChange(AGENT, {
    ...input.baseline.commandContext(
      `append-${input.commandPrefix}`,
      project.revision,
    ),
    baseSnapshot: threadRef,
    phases: [{
      id: `${input.commandPrefix}-phase`,
      name: "Documentary clause-response",
      description: "Record one sourced documentary answer.",
    }],
    workItems: [{
      id: input.workItemId,
      phaseId: `${input.commandPrefix}-phase`,
      owner: "agent",
      dependsOnWorkItemIds: [...input.dependsOnWorkItemIds],
      decisionIds: [input.decisionId],
      operation: {
        id: RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.id,
        version: RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.version,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [{
      id: input.decisionId,
      phaseId: `${input.commandPrefix}-phase`,
      title: "Record the documentary clause-response",
      question: "Authorize recording this agent proposal?",
    }],
  });
  project = await input.baseline.commands.proposeDecision(AGENT, {
    ...input.baseline.commandContext(
      `propose-${input.commandPrefix}`,
      project.revision,
    ),
    decisionId: input.decisionId,
    baseSnapshot: threadRef,
    proposal: {
      summary: "Record one documentary clause-response proposal.",
      parameters: [...reviewed.decisionParameters],
    },
  });
  const decision = project.decisions.find((item) => item.id === input.decisionId)!;
  project = await input.baseline.commands.approveDecision(HUMAN, {
    ...input.baseline.commandContext(
      `approve-${input.commandPrefix}`,
      project.revision,
    ),
    decisionId: input.decisionId,
    rationale: "Human authorizes the act of recording, not the answer content.",
    inputFingerprint: decision.inputFingerprint!,
  });
  return await input.baseline.commands.queueRun(AGENT, {
    ...input.baseline.commandContext(
      `queue-${input.commandPrefix}`,
      project.revision,
    ),
    runId: input.runId,
    workItemId: input.workItemId,
    summary: "Seal the documentary clause-response.",
    basis: { kind: "thread-snapshot", ...threadRef },
  });
}
