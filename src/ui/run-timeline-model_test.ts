import { assertEquals } from "@std/assert";
import { buildRunTimeline, waitShare } from "./src/project/run-timeline-model.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../domain/project/engineering-project.ts";

function run(
  id: string,
  times: Partial<
    Pick<EngineeringAgentRun, "queuedAt" | "startedAt" | "completedAt">
  >,
  status: EngineeringAgentRun["status"] = "completed",
  workItemId = "w1",
): EngineeringAgentRun {
  return {
    id,
    workItemId,
    status,
    queuedAt: times.queuedAt ?? "2026-08-20T00:00:00.000Z",
    ...(times.startedAt ? { startedAt: times.startedAt } : {}),
    ...(times.completedAt ? { completedAt: times.completedAt } : {}),
    evidenceRefs: [],
    statusHistory: [],
  } as unknown as EngineeringAgentRun;
}

function work(
  id: string,
  status: EngineeringWorkItem["status"],
  title: string,
  predecessorRevisionId?: string,
): EngineeringWorkItem {
  return {
    id,
    activityId: predecessorRevisionId
      ? `activity:${predecessorRevisionId}`
      : `activity:${id}`,
    ...(predecessorRevisionId ? { predecessorRevisionId } : {}),
    title,
    status,
  } as unknown as EngineeringWorkItem;
}

function project(
  runs: EngineeringAgentRun[],
  workItems: EngineeringWorkItem[] = [],
): EngineeringProjectSnapshot {
  return {
    agentRuns: runs,
    workItems,
  } as unknown as EngineeringProjectSnapshot;
}

Deno.test("a run reports how long it waited and how long it ran", () => {
  const view = buildRunTimeline(
    project([
      run("r1", {
        queuedAt: "2026-08-20T00:00:00.000Z",
        startedAt: "2026-08-20T00:00:08.000Z",
        completedAt: "2026-08-20T00:00:10.000Z",
      }),
    ]),
    () => "r1",
  );

  assertEquals(view.rows[0]?.waitSeconds, 8);
  assertEquals(view.rows[0]?.runSeconds, 2);
  assertEquals(view.rows[0]?.currentAttemptId, "r1");
  assertEquals(view.scaleSeconds, 10);
  assertEquals(waitShare(view), 0.8);
});

Deno.test("a run that never started has no run duration, not a zero one", () => {
  // Un zéro se lirait « exécution instantanée ». L'absence doit rester
  // absente : la barre ne peut pas prétendre à une durée jamais mesurée.
  const view = buildRunTimeline(
    project([
      run("queued", { queuedAt: "2026-08-20T00:00:00.000Z" }, "queued"),
    ]),
    () => "queued",
  );

  assertEquals(view.rows[0]?.waitSeconds, undefined);
  assertEquals(view.rows[0]?.runSeconds, undefined);
  assertEquals(view.scaleSeconds, 0);
  assertEquals(waitShare(view), undefined);
});

Deno.test("a running run reports its wait but not an unfinished duration", () => {
  const view = buildRunTimeline(
    project([
      run("running", {
        queuedAt: "2026-08-20T00:00:00.000Z",
        startedAt: "2026-08-20T00:00:05.000Z",
      }, "running"),
    ]),
    () => "running",
  );

  assertEquals(view.rows[0]?.waitSeconds, 5);
  assertEquals(view.rows[0]?.runSeconds, undefined);
});

Deno.test(
  "a failed predecessor and completed successor collapse to one completed activity",
  () => {
    const title = "Shared successor title";
    const view = buildRunTimeline(
      project(
        [
          run(
            "attempt-failed",
            {
              queuedAt: "2026-08-20T00:00:00.000Z",
              startedAt: "2026-08-20T00:00:02.000Z",
              completedAt: "2026-08-20T00:00:04.000Z",
            },
            "failed",
            "rev-root",
          ),
          run(
            "attempt-completed",
            {
              queuedAt: "2026-08-20T00:01:00.000Z",
              startedAt: "2026-08-20T00:01:03.000Z",
              completedAt: "2026-08-20T00:01:10.000Z",
            },
            "completed",
            "rev-leaf",
          ),
        ],
        [
          work("rev-root", "cancelled", title),
          work("rev-leaf", "completed", title, "rev-root"),
        ],
      ),
      (item) => item.workItemId === "rev-leaf" ? title : `${title} · earlier`,
    );

    assertEquals(view.rows.length, 1);
    assertEquals(view.rows[0]?.id, "activity:rev-root");
    assertEquals(view.rows[0]?.label, title);
    assertEquals(view.rows[0]?.status, "completed");
    assertEquals(view.rows[0]?.revisionCount, 2);
    assertEquals(view.rows[0]?.attemptCount, 2);
    assertEquals(view.rows[0]?.currentAttemptId, "attempt-completed");
    assertEquals(
      view.rows[0]?.attempts.map((attempt) => attempt.status),
      ["failed", "completed"],
    );
    assertEquals(view.rows[0]?.waitSeconds, 3);
    assertEquals(view.rows[0]?.runSeconds, 7);
  },
);

Deno.test(
  "independent activities with the same title stay separate rows",
  () => {
    const title = "Shared independent title";
    const view = buildRunTimeline(
      project(
        [
          run(
            "a1",
            {
              queuedAt: "2026-08-20T00:00:00.000Z",
              startedAt: "2026-08-20T00:00:01.000Z",
              completedAt: "2026-08-20T00:00:02.000Z",
            },
            "completed",
            "rev-a",
          ),
          run(
            "b1",
            {
              queuedAt: "2026-08-20T00:00:10.000Z",
              startedAt: "2026-08-20T00:00:11.000Z",
              completedAt: "2026-08-20T00:00:12.000Z",
            },
            "completed",
            "rev-b",
          ),
        ],
        [
          work("rev-a", "completed", title),
          work("rev-b", "completed", title),
        ],
      ),
      () => title,
    );

    assertEquals(view.rows.map((row) => row.id), [
      "activity:rev-a",
      "activity:rev-b",
    ]);
    assertEquals(view.rows.map((row) => row.label), [title, title]);
    assertEquals(view.rows.map((row) => row.revisionCount), [1, 1]);
    assertEquals(view.rows.map((row) => row.attemptCount), [1, 1]);
    assertEquals(view.rows.map((row) => row.currentAttemptId), ["a1", "b1"]);
  },
);

Deno.test(
  "branched leaves do not elect a current winner from array order",
  () => {
    const title = "Branched activity title";
    const view = buildRunTimeline(
      project(
        [
          run(
            "attempt-left",
            {
              queuedAt: "2026-08-20T00:00:00.000Z",
              startedAt: "2026-08-20T00:00:01.000Z",
              completedAt: "2026-08-20T00:00:02.000Z",
            },
            "completed",
            "rev-left",
          ),
          run(
            "attempt-right",
            {
              queuedAt: "2026-08-20T00:00:10.000Z",
              startedAt: "2026-08-20T00:00:11.000Z",
              completedAt: "2026-08-20T00:00:12.000Z",
            },
            "cancelled",
            "rev-right",
          ),
        ],
        [
          work("rev-root", "cancelled", title),
          work("rev-left", "completed", title, "rev-root"),
          work("rev-right", "cancelled", title, "rev-root"),
        ],
      ),
      () => title,
    );

    assertEquals(view.rows.length, 1);
    assertEquals(view.rows[0]?.revisionCount, 3);
    assertEquals(view.rows[0]?.attemptCount, 2);
    assertEquals(view.rows[0]?.status, "planned");
    assertEquals(
      view.rows[0]?.attempts.map((attempt) => attempt.id).includes(
        view.rows[0]?.currentAttemptId ?? "",
      ),
      true,
    );
  },
);
