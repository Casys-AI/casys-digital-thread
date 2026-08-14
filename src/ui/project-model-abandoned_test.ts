import { assertEquals } from "@std/assert";
import { GENERIC_PROJECT_FIXTURE } from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import { buildProjectBrief, selectCurrentProjectFocus } from "./src/project/model.ts";
import { isEngineeringProjectSnapshot } from "./src/project/contract.ts";

/**
 * Builds a project snapshot based on the generic fixture with one work item
 * forced to `abandoned` status.
 *
 * "work-verify" is planned/ready with no runs or evidence in the fixture,
 * consistent with the domain guard requirements for abandonment.
 */
function projectWithAbandonedWorkItem() {
  return {
    ...GENERIC_PROJECT_FIXTURE,
    workItems: GENERIC_PROJECT_FIXTURE.workItems.map((item) =>
      item.id === "work-verify" ? { ...item, status: "abandoned" as const } : item
    ),
  };
}

/**
 * Builds a project snapshot with the first decision forced to `abandoned`.
 * An abandoned required decision never carried a proposal, so we strip it.
 */
function projectWithAbandonedDecision() {
  return {
    ...GENERIC_PROJECT_FIXTURE,
    decisions: GENERIC_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0
        ? { ...decision, status: "abandoned" as const, proposal: undefined }
        : decision
    ),
    // Remove any waiting-for-decision run that would reference the now-abandoned decision.
    agentRuns: GENERIC_PROJECT_FIXTURE.agentRuns.filter(
      (run) => run.status !== "waiting-for-decision",
    ),
  };
}

Deno.test(
  "an abandoned work item is never presented as active work or as next work",
  () => {
    const snapshot = projectWithAbandonedWorkItem();
    const brief = buildProjectBrief(snapshot);

    // nextWork is status === "ready"; abandoned must never appear there.
    assertEquals(
      brief.nextWork.some((item) => item.id === "work-verify"),
      false,
    );
    // currentWork is "in-progress" | "waiting-for-decision"; abandoned excluded.
    const focus = selectCurrentProjectFocus(snapshot);
    assertEquals(focus.work?.id === "work-verify", false);
  },
);

Deno.test(
  "an abandoned decision is never presented as a pending decision requiring operator attention",
  () => {
    const snapshot = projectWithAbandonedDecision();
    const brief = buildProjectBrief(snapshot);

    // pendingDecisions = required | proposed | rejected; abandoned excluded.
    assertEquals(
      brief.pendingDecisions.some((d) => d.status === "abandoned"),
      false,
    );
  },
);

Deno.test(
  "the contract boundary validator accepts a snapshot containing abandoned work items and decisions",
  () => {
    const snapshotWithAbandoned = {
      ...GENERIC_PROJECT_FIXTURE,
      workItems: GENERIC_PROJECT_FIXTURE.workItems.map((item, index) =>
        index === 0 ? { ...item, status: "abandoned" as const } : item
      ),
      decisions: GENERIC_PROJECT_FIXTURE.decisions.map((decision, index) =>
        index === 0
          ? {
            ...decision,
            status: "abandoned" as const,
            // An abandoned required decision never carried a proposal.
            proposal: undefined,
          }
          : decision
      ),
    };

    assertEquals(
      isEngineeringProjectSnapshot(snapshotWithAbandoned),
      true,
    );
  },
);
