import { assertEquals } from "@std/assert";
import type {
  EngineeringApproval,
  EngineeringDecision,
} from "../domain/engineering-project.ts";
import { COFFEE_MACHINE_PROJECT_FIXTURE } from "./src/project/fixture.ts";
import {
  approvalMatchesDecisionScope,
  canQueueWorkItem,
  emptyDecisionParameterDraft,
  proposalFromDraft,
  unavailableCommandReason,
} from "./src/project/control-model.ts";

Deno.test("proposal draft keeps explicit value types and numeric units", () => {
  const result = proposalFromDraft(" Reviewed inputs ", [
    {
      ...emptyDecisionParameterDraft("one"),
      key: "reference_load",
      label: "Reference load",
      valueType: "number",
      value: "125.5",
      unit: "N",
    },
    {
      ...emptyDecisionParameterDraft("two"),
      key: "include_gravity",
      label: "Include gravity",
      valueType: "boolean",
      value: "false",
    },
  ]);

  assertEquals(result, {
    proposal: {
      summary: "Reviewed inputs",
      parameters: [
        {
          key: "reference_load",
          label: "Reference load",
          value: 125.5,
          unit: "N",
        },
        {
          key: "include_gravity",
          label: "Include gravity",
          value: false,
        },
      ],
    },
  });
});

Deno.test("proposal draft rejects units on non-numeric values", () => {
  const result = proposalFromDraft("Reviewed", [{
    ...emptyDecisionParameterDraft("one"),
    key: "material",
    label: "Material",
    value: "reviewed alloy",
    unit: "MPa",
  }]);
  assertEquals(
    result.error,
    "Material can only have a unit when its value is numeric.",
  );
});

Deno.test("approval scope compares snapshot, fingerprint and ordered evidence refs", () => {
  const baseDecision = COFFEE_MACHINE_PROJECT_FIXTURE.decisions[0]!;
  const anchor = COFFEE_MACHINE_PROJECT_FIXTURE.threadSnapshots[0]!;
  const inputEvidenceRefs = [{
    snapshotId: anchor.snapshotId,
    snapshotRevision: anchor.revision,
    kind: "artifact" as const,
    id: "ART-CAD-018",
  }];
  const decision: EngineeringDecision = {
    ...baseDecision,
    baseSnapshot: anchor,
    inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    inputEvidenceRefs,
  };
  const approval: EngineeringApproval = {
    id: "approval-exact",
    decisionId: decision.id,
    status: "approved",
    requestedAt: decision.requestedAt,
    baseSnapshot: anchor,
    inputFingerprint: decision.inputFingerprint,
    inputEvidenceRefs,
  };

  assertEquals(approvalMatchesDecisionScope(decision, approval), true);
  assertEquals(
    approvalMatchesDecisionScope(decision, {
      ...approval,
      inputFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    }),
    false,
  );
});

Deno.test("queue gate only opens for ready, approved and unblocked work", () => {
  const project = {
    ...structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE),
    workItems: COFFEE_MACHINE_PROJECT_FIXTURE.workItems.map((item) =>
      item.id === "work-simulate" ? { ...item, status: "ready" as const } : item
    ),
    decisions: COFFEE_MACHINE_PROJECT_FIXTURE.decisions.map((decision) => ({
      ...decision,
      status: "approved" as const,
    })),
    blockers: COFFEE_MACHINE_PROJECT_FIXTURE.blockers.map((blocker) => ({
      ...blocker,
      status: "resolved" as const,
    })),
    agentRuns: [],
  };
  const item = project.workItems.find((candidate) => candidate.id === "work-simulate")!;

  assertEquals(canQueueWorkItem(project, item), true);
  const withRun = {
    ...project,
    agentRuns: [{
      ...COFFEE_MACHINE_PROJECT_FIXTURE.agentRuns[0]!,
      status: "queued" as const,
    }],
  };
  assertEquals(canQueueWorkItem(withRun, item), false);
});

Deno.test("read-only and missing identity command reasons are explicit", () => {
  assertEquals(
    unavailableCommandReason({
      enabled: false,
      intent: "decision.propose",
      allowedIntents: [],
      actorId: "",
      busy: false,
    }),
    "This snapshot is read-only.",
  );
  assertEquals(
    unavailableCommandReason({
      enabled: true,
      intent: "decision.propose",
      allowedIntents: ["decision.propose"],
      actorId: "",
      busy: false,
    }),
    "Declare the local operator identity first.",
  );
});
