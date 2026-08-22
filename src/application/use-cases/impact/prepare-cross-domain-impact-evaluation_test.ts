import { assertEquals } from "@std/assert";
import { PrepareCrossDomainImpactEvaluation } from "./prepare-cross-domain-impact-evaluation.ts";
import {
  VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
} from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-impact-selection";
const SUBJECT = "subject-impact-selection";

Deno.test("X07 refuses a lookalike X05 document not exactly attached by its completed run", async () => {
  const head = manifestSealHead();
  const project = projectWithTamperedManifestSealAttachment(head) as EngineeringProjectSnapshot;
  const evaluation = new PrepareCrossDomainImpactEvaluation({
    projects: { get: () => Promise.resolve(project) },
    snapshots: { get: () => Promise.resolve(head) },
    // This test must stop at X06 attachment selection. Reaching any of these
    // readers would mean a lookalike seal was trusted.
    manifests: { read: () => Promise.reject(new Error("must not reopen manifest")) },
    manifestSeals: {
      save: () => Promise.reject(new Error("must not save seal")),
      read: () => Promise.reject(new Error("must not reopen seal")),
    },
    lineage: { read: () => Promise.reject(new Error("must not reread lineage")) },
    briefGates: { read: () => Promise.reject(new Error("must not reread brief")) },
  });

  const result = await evaluation.execute({
    projectId: PROJECT,
    trustedRunId: "run-impact-evaluation",
    basis: { kind: "thread-snapshot", snapshotId: head.id, revision: head.revision, subjectId: SUBJECT },
    evaluatedAt: AT,
  });

  assertEquals(result.status, "unavailable");
  assertEquals(result.diagnostics.map((item) => item.code), ["manifest_seal_unavailable"]);
});

function manifestSealHead(): ThreadSnapshot {
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-impact-selection-r2",
    revision: 2,
    previous: { snapshotId: "thread-impact-selection-r1", revision: 1 },
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Impact selection subject",
      kind: "system",
      version: "r2",
      modelArtifactId: "manifest-seal-document",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-impact-selection-r2",
      name: "Manifest seal",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-manifest-seal-document",
        kind: "created",
        target: { kind: "artifact", id: "manifest-seal-document" },
        summary: "Manifest seal.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: "manifest-seal-document",
      name: "Manifest seal",
      kind: "document",
      version: "1",
      fingerprint,
      uri: "casys://cross-domain-impact-manifest-seal-capture/sha256/" + fingerprint.digest,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-cross-domain-impact-manifest@1",
        runId: "run-manifest-seal",
      },
      inputArtifactIds: [],
      freshness: fresh(),
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance-change-manifest-seal-document",
      relation: "changes",
      from: { kind: "change", id: "change-manifest-seal-document" },
      to: { kind: "artifact", id: "manifest-seal-document" },
      rationale: "Manifest seal.",
    }],
    proposedActions: [],
  });
}

function projectWithTamperedManifestSealAttachment(head: ThreadSnapshot): unknown {
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: "thread-impact-selection-r1",
    revision: 1,
    subjectId: SUBJECT,
  };
  const operation = {
    id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
    version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  return {
    schemaVersion: "3.0",
    id: "project-impact-selection-r2",
    revision: 2,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Impact selection project",
      subjectId: SUBJECT,
      objective: { title: "Impact", statement: "Refuse tampered attachment." },
    },
    threadSnapshots: [{ snapshotId: head.id, revision: head.revision, subjectId: SUBJECT }],
    phases: [{
      id: "phase-impact-selection",
      name: "Impact",
      order: 1,
      description: "Seal impact manifest",
      workItemIds: ["work-manifest-seal"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-manifest-seal",
      phaseId: "phase-impact-selection",
      title: "Seal manifest",
      description: "Seal manifest",
      kind: "review",
      operation,
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      // Deliberately absent: the producer label alone must not authorize X07.
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run-manifest-seal",
      workItemId: "work-manifest-seal",
      status: "completed",
      summary: "Seal manifest",
      queuedAt: AT,
      startedAt: AT,
      completedAt: AT,
      basis,
      resultSnapshot: { snapshotId: head.id, revision: head.revision, subjectId: SUBJECT },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
