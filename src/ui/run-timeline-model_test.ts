import { assertEquals } from "@std/assert";
import {
  buildRunTimeline,
  waitShare,
} from "./src/project/run-timeline-model.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../domain/project/engineering-project.ts";

function run(
  id: string,
  times: Partial<
    Pick<EngineeringAgentRun, "queuedAt" | "startedAt" | "completedAt">
  >,
  status: EngineeringAgentRun["status"] = "completed",
): EngineeringAgentRun {
  return {
    id,
    workItemId: "w1",
    status,
    queuedAt: times.queuedAt ?? "2026-08-20T00:00:00.000Z",
    ...(times.startedAt ? { startedAt: times.startedAt } : {}),
    ...(times.completedAt ? { completedAt: times.completedAt } : {}),
    evidenceRefs: [],
    statusHistory: [],
  } as unknown as EngineeringAgentRun;
}

function project(runs: EngineeringAgentRun[]): EngineeringProjectSnapshot {
  return { agentRuns: runs } as unknown as EngineeringProjectSnapshot;
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
