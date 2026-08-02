import { assertEquals } from "@std/assert";
import { COFFEE_MACHINE_PROJECT_FIXTURE } from "./src/project/fixture.ts";
import {
  agentRunSummary,
  buildProjectBrief,
  projectBriefStatusLabel,
  projectStatusLabel,
  workOwnerLabel,
} from "./src/project/model.ts";
import { isEngineeringProjectSnapshot } from "./src/project/contract.ts";

Deno.test("project brief derives factual gates and operator attention", () => {
  const brief = buildProjectBrief(COFFEE_MACHINE_PROJECT_FIXTURE);

  assertEquals(brief.completedPhases, 3);
  assertEquals(brief.phases.length, 6);
  assertEquals(brief.status, "attention-required");
  assertEquals(projectStatusLabel(brief.status), "Decision required");
  assertEquals(projectBriefStatusLabel(brief), "Agent preparing proposal");
  assertEquals(brief.activeRuns[0]?.status, "waiting-for-decision");
  assertEquals(brief.pendingDecisions[0]?.id, "decision-mechanical-inputs");
  assertEquals(brief.openBlockers[0]?.id, "blocker-mechanical-inputs");
});

Deno.test("project brief separates agent preparation from human review", () => {
  const proposed = {
    ...structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE),
    decisions: COFFEE_MACHINE_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0 ? { ...decision, status: "proposed" as const } : decision
    ),
  };

  assertEquals(
    projectBriefStatusLabel(buildProjectBrief(proposed)),
    "Review required",
  );
  assertEquals(workOwnerLabel("shared"), "Agent + human review");
  assertEquals(workOwnerLabel("human"), "Human review");
});

Deno.test("browser project contract rejects a half-defined input anchor", () => {
  const valid = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const invalid = JSON.parse(JSON.stringify(valid)) as {
    decisions: Array<Record<string, unknown>>;
  };
  invalid.decisions[0]!.baseSnapshot = valid.threadSnapshots[0];
  assertEquals(isEngineeringProjectSnapshot(invalid), false);
});

Deno.test("browser project contract accepts a planning envelope and rejects malformed operation provenance", () => {
  const valid = planningProjectEnvelope();
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const malformedBasis = structuredClone(valid) as Record<string, unknown>;
  (
    (malformedBasis.plan as Record<string, unknown>).basis as Record<
      string,
      unknown
    >
  ).approvedBriefFingerprint = {
    algorithm: "sha256",
    digest: "not-a-content-fingerprint",
  };
  assertEquals(isEngineeringProjectSnapshot(malformedBasis), false);

  const malformedPublisher = structuredClone(valid) as Record<string, unknown>;
  (malformedPublisher.plan as Record<string, unknown>).publishedBy = {
    id: "engineering-agent",
    origin: "human",
  };
  assertEquals(isEngineeringProjectSnapshot(malformedPublisher), false);

  const rawProviderEscape = structuredClone(valid) as Record<string, unknown>;
  const rawOperation = (
    rawProviderEscape.workItems as Array<Record<string, unknown>>
  )[0]!.operation as Record<string, unknown>;
  (rawOperation.bindings as Array<Record<string, unknown>>)[0]!.source = {
    kind: "approved-discovery",
    provider: "untrusted-direct-call",
  };
  assertEquals(isEngineeringProjectSnapshot(rawProviderEscape), false);

  const malformedThreadBinding = structuredClone(valid) as Record<
    string,
    unknown
  >;
  const threadOperation = (
    malformedThreadBinding.workItems as Array<Record<string, unknown>>
  )[0]!.operation as Record<string, unknown>;
  threadOperation.bindings = [{
    name: "existingPart",
    source: {
      kind: "thread-entity",
      reference: {
        snapshotId: "thread-cm01",
        snapshotRevision: 0,
        kind: "artifact",
        id: "ART-CAD-018",
      },
    },
  }];
  assertEquals(isEngineeringProjectSnapshot(malformedThreadBinding), false);
});

Deno.test("project brief keeps a rejected decision actionable", () => {
  const rejected = {
    ...structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE),
    decisions: COFFEE_MACHINE_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0 ? { ...decision, status: "rejected" as const } : decision
    ),
  };

  const brief = buildProjectBrief(rejected);

  assertEquals(brief.pendingDecisions[0]?.id, rejected.decisions[0]!.id);
  assertEquals(brief.pendingDecisions[0]?.status, "rejected");
});

Deno.test("cockpit falls back to a named work item for an accidental run summary", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
  const run = { ...snapshot.agentRuns[0]!, summary: "dsadsadas" };

  assertEquals(
    agentRunSummary(snapshot, run),
    "Working on: Prepare mechanical verification inputs",
  );
});

function planningProjectEnvelope(): Record<string, unknown> {
  const project = structuredClone(
    COFFEE_MACHINE_PROJECT_FIXTURE,
  ) as unknown as Record<string, unknown>;
  project.threadSnapshots = [];
  project.agentRuns = [];
  project.decisions = [];
  project.approvals = [];
  project.blockers = [];
  project.plan = {
    startingPoint: "idea-or-spec",
    basis: {
      kind: "approved-discovery",
      discoveryId: "discovery-cm01",
      snapshotId: "discovery-snapshot-cm01-r3",
      revision: 3,
      briefId: "brief-cm01",
      approvedBriefFingerprint: {
        algorithm: "sha256",
        digest: "a".repeat(64),
      },
    },
    publishedAt: "2026-08-02T12:00:00.000Z",
    publishedBy: { id: "engineering-agent", origin: "agent" },
  };
  const firstWorkItem = (
    project.workItems as Array<Record<string, unknown>>
  )[0]!;
  firstWorkItem.operation = {
    id: "baseline.from-approved-discovery",
    version: "1",
    bindings: [{
      name: "approvedDiscovery",
      source: { kind: "approved-discovery" },
    }],
  };
  return project;
}
