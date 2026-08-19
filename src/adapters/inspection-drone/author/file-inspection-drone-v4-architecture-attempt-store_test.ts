import { assertEquals, assertRejects } from "@std/assert";
import {
  FileInspectionDroneV4ArchitectureAttemptStore,
  InspectionDroneV4ArchitectureWriteOutcomeUnknownError,
} from "./file-inspection-drone-v4-architecture-attempt-store.ts";

Deno.test("inspection-drone architecture WAL never re-dispatches an uncertain insertion", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-drone-architecture-wal-" });
  try {
    const store = new FileInspectionDroneV4ArchitectureAttemptStore(directory);
    const input = {
      projectId: "inspection-drone-v4",
      runId: "run:architecture",
      dispatchedAt: "2026-08-08T04:00:00.000Z",
    };
    assertEquals(await store.begin(input), { action: "dispatch" });
    await assertRejects(
      () => store.begin(input),
      InspectionDroneV4ArchitectureWriteOutcomeUnknownError,
    );
    await store.complete({
      projectId: input.projectId,
      runId: input.runId,
      result: { parentId: "root", textSha256: "a".repeat(64) },
    });
    assertEquals(await store.begin(input), {
      action: "completed",
      result: { parentId: "root", textSha256: "a".repeat(64) },
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
