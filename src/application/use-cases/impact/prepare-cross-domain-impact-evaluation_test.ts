import { assertEquals, assertThrows } from "@std/assert";
import { PrepareCrossDomainImpactEvaluation } from "./prepare-cross-domain-impact-evaluation.ts";
import {
  VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
} from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { canonicalizeBriefGateDependsOnItemIds } from "../../../domain/project/project-brief.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-impact-selection";
const SUBJECT = "subject-impact-selection";

Deno.test("X07 refuses a lookalike X05 document not exactly attached by its completed run", async () => {
  const head = manifestSealHead();
  const project = projectWithTamperedManifestSealAttachment(
    head,
  ) as EngineeringProjectSnapshot;
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
    basis: {
      kind: "thread-snapshot",
      snapshotId: head.id,
      revision: head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });

  assertEquals(result.status, "unavailable");
  assertEquals(result.diagnostics.map((item) => item.code), [
    "manifest_seal_unavailable",
  ]);
});

Deno.test("X07 recross accepts unsorted unique Brief V2 dependencies as a canonical copy", () => {
  const persisted = ["brief.source.thermal", "brief.source.electrical"];
  assertEquals(
    canonicalizeBriefGateDependsOnItemIds(persisted),
    ["brief.source.electrical", "brief.source.thermal"],
  );
  assertEquals(persisted, ["brief.source.thermal", "brief.source.electrical"]);
});

Deno.test("X07 recross rejects duplicate Brief V2 dependencies", () => {
  assertThrows(
    () =>
      canonicalizeBriefGateDependsOnItemIds([
        "brief.source.impact",
        "brief.source.impact",
      ]),
    TypeError,
    "duplicated",
  );
});

Deno.test("X07 reopens the named X06 dependsOn leaf on a later descendant retry", async () => {
  const r2 = manifestSealHead();
  const r3 = descendantHead(r2);
  const namedFingerprint = r2.artifacts[0]!.fingerprint;
  const requested: string[] = [];
  const evaluation = new PrepareCrossDomainImpactEvaluation({
    projects: { get: () => Promise.resolve(descendantProject(r2, r3)) },
    snapshots: {
      get: (id: string) =>
        Promise.resolve(id === r3.id ? r3 : id === r2.id ? r2 : undefined),
    },
    manifests: { read: () => Promise.reject(new Error("must not reopen manifest")) },
    manifestSeals: {
      save: () => Promise.reject(new Error("must not save seal")),
      read: (fingerprint) => {
        requested.push(fingerprint.digest);
        return Promise.resolve(undefined);
      },
    },
    lineage: { read: () => Promise.reject(new Error("must not reread lineage")) },
    briefGates: { read: () => Promise.reject(new Error("must not reread brief")) },
  });

  const result = await evaluation.execute({
    projectId: PROJECT,
    trustedRunId: "run-impact-evaluation",
    basis: {
      kind: "thread-snapshot",
      snapshotId: r3.id,
      revision: r3.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });

  assertEquals(requested, [namedFingerprint.digest]);
  assertEquals(result.status, "unavailable");
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
      uri: "casys://cross-domain-impact-manifest-seal-capture/sha256/" +
        fingerprint.digest,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-cross-domain-impact-manifest@2",
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
    schemaVersion: "4.0",
    id: "project-impact-selection-r2",
    revision: 2,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Impact selection project",
      subjectId: SUBJECT,
      objective: { title: "Impact", statement: "Refuse tampered attachment." },
    },
    threadSnapshots: [{
      snapshotId: head.id,
      revision: head.revision,
      subjectId: SUBJECT,
    }],
    phases: [{
      id: "phase-impact-selection",
      name: "Impact",
      order: 1,
      description: "Seal impact manifest",
      workItemIds: ["work-manifest-seal", "work-impact-evaluation"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-manifest-seal",
      activityId: "activity:work-manifest-seal",
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
    }, {
      id: "work-impact-evaluation",
      activityId: "activity:work-impact-evaluation",
      phaseId: "phase-impact-selection",
      title: "Evaluate impact",
      description: "Evaluate impact",
      kind: "review",
      operation: {
        id: "analyze.evaluate-cross-domain-impact",
        version: "2",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" as const },
        }],
      },
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: ["work-manifest-seal"],
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
      resultSnapshot: {
        snapshotId: head.id,
        revision: head.revision,
        subjectId: SUBJECT,
      },
      evidenceRefs: [],
    }, {
      id: "run-impact-evaluation",
      workItemId: "work-impact-evaluation",
      status: "running",
      summary: "Evaluate impact",
      queuedAt: AT,
      startedAt: AT,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: head.id,
        revision: head.revision,
        subjectId: SUBJECT,
      },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  };
}

function descendantHead(r2: ThreadSnapshot): ThreadSnapshot {
  return validateThreadSnapshot({
    ...JSON.parse(JSON.stringify(r2)),
    id: "thread-impact-selection-r3",
    revision: 3,
    previous: { snapshotId: r2.id, revision: r2.revision },
    subject: { ...r2.subject, version: "r3" },
    changeSet: {
      ...r2.changeSet,
      id: "changes-impact-selection-r3",
    },
  });
}

function descendantProject(
  r2: ThreadSnapshot,
  r3: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const evidence = {
    snapshotId: r2.id,
    snapshotRevision: r2.revision,
    kind: "artifact" as const,
    id: "manifest-seal-document",
  };
  const operation = {
    id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
    version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  return {
    schemaVersion: "4.0",
    id: "project-impact-selection-r3",
    revision: 3,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Impact selection project",
      subjectId: SUBJECT,
      objective: { title: "Impact", statement: "Reuse the named X06 leaf." },
    },
    threadSnapshots: [
      { snapshotId: "thread-impact-selection-r1", revision: 1, subjectId: SUBJECT },
      { snapshotId: r2.id, revision: r2.revision, subjectId: SUBJECT },
      { snapshotId: r3.id, revision: r3.revision, subjectId: SUBJECT },
    ],
    phases: [{
      id: "phase-impact-selection",
      name: "Impact",
      order: 1,
      description: "Seal impact manifest",
      workItemIds: ["work-manifest-seal", "work-impact-evaluation"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-manifest-seal",
      activityId: "activity:work-manifest-seal",
      phaseId: "phase-impact-selection",
      title: "Seal manifest",
      description: "Seal manifest",
      kind: "review",
      operation,
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [evidence],
      decisionIds: [],
      blockerIds: [],
    }, {
      id: "work-impact-evaluation",
      activityId: "activity:work-impact-evaluation",
      phaseId: "phase-impact-selection",
      title: "Evaluate impact",
      description: "Evaluate impact",
      kind: "review",
      operation: {
        id: "analyze.evaluate-cross-domain-impact",
        version: "2",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" as const },
        }],
      },
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: ["work-manifest-seal"],
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
      basis: {
        kind: "thread-snapshot",
        snapshotId: "thread-impact-selection-r1",
        revision: 1,
        subjectId: SUBJECT,
      },
      resultSnapshot: { snapshotId: r2.id, revision: r2.revision, subjectId: SUBJECT },
      evidenceRefs: [evidence],
    }, {
      id: "run-impact-evaluation",
      workItemId: "work-impact-evaluation",
      status: "running",
      summary: "Evaluate impact",
      queuedAt: AT,
      startedAt: AT,
      basis: {
        kind: "thread-snapshot",
        snapshotId: r3.id,
        revision: r3.revision,
        subjectId: SUBJECT,
      },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot;
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
