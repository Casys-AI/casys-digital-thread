import { assertEquals, assertStringIncludes } from "@std/assert";
import { GENERIC_PROJECT_FIXTURE } from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import {
  buildCurrentProjectWork,
  buildProjectBrief,
  selectCurrentProjectFocus,
} from "./src/project/model.ts";

function cancelledProofWithReadyWork({
  laterCompletedClaim,
}: { readonly laterCompletedClaim: boolean }) {
  const fixture = structuredClone(GENERIC_PROJECT_FIXTURE);
  const proofWorkId = "work-define";
  const proofTitle = "Seal the reviewed FEA proof case into the evidence thread";
  const cancelledAt = "2026-09-07T07:24:03.731Z";
  const completedAt = "2026-09-07T07:25:32.012Z";
  const originalRun = fixture.agentRuns[0]!;

  return {
    ...fixture,
    workItems: fixture.workItems.map((work) =>
      work.id === proofWorkId
        ? { ...work, title: proofTitle, status: "ready" as const }
        : work.status === "waiting-for-decision"
        ? { ...work, status: "planned" as const }
        : work
    ),
    agentRuns: [
      {
        ...originalRun,
        id: "run:proof-seal-cancelled-before-claim",
        workItemId: proofWorkId,
        status: "cancelled" as const,
        queuedAt: "2026-09-07T00:35:15.505Z",
        startedAt: undefined,
        claimedAt: undefined,
        claimedBy: undefined,
        completedAt: undefined,
        evidenceRefs: [],
        cancellation: {
          rationale: "Retired before any agent claim.",
          cancelledAt,
          cancelledBy: { id: "human:owner", origin: "human" as const },
        },
      },
      ...(laterCompletedClaim
        ? [{
          ...originalRun,
          id: "run:brief-claim-completed-after-dequeue",
          workItemId: "work-design",
          status: "completed" as const,
          completedAt,
          evidenceRefs: [],
          cancellation: undefined,
        }]
        : []),
    ],
  };
}

Deno.test("a cancelled pre-claim proof run leaves no NOW focus or live run, while its ready work is explicitly up next", async () => {
  const project = cancelledProofWithReadyWork({ laterCompletedClaim: true });
  const focus = selectCurrentProjectFocus(project);
  const currentWork = buildCurrentProjectWork(project);
  const brief = buildProjectBrief(project);

  assertEquals(focus.activeRun, undefined);
  assertEquals(focus.work, undefined);
  assertEquals(
    brief.activeRuns.some((run) => run.status === "running"),
    false,
  );
  assertEquals(brief.lastSettledRun?.id, "run:brief-claim-completed-after-dequeue");
  assertEquals(currentWork.nextWork.map((work) => work.id), ["work-define"]);

  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  assertStringIncludes(overview, 'glyph: "ready",');
  assertStringIncludes(
    overview,
    "tag: `Up next · Ready to queue · ${workOwnerLabel(nextWork.owner)}`",
  );
  assertStringIncludes(overview, 'entry.glyph === "ready"\n                ? "→"');
  assertEquals(
    overview.includes('if (nextWork) {\n    feed.push({\n      glyph: "queued"'),
    false,
  );
});

Deno.test("NOW retains a cancellation as history when it is the latest settled run", async () => {
  const project = cancelledProofWithReadyWork({ laterCompletedClaim: false });
  const focus = selectCurrentProjectFocus(project);
  assertEquals(focus.activeRun, undefined);
  const currentWork = buildCurrentProjectWork(project);
  const brief = buildProjectBrief(project);

  assertEquals(brief.lastSettledRun?.status, "cancelled");
  assertEquals(currentWork.nextWork[0]?.id, "work-define");
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  assertStringIncludes(overview, "tag: sentenceLabel(lastSettledRun.status)");
});
