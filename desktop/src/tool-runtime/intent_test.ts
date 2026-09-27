import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  intentFileName,
  loadToolRuntimeIntent,
  newToolRuntimeIntent,
  recordStep,
  saveToolRuntimeIntent,
  ToolRuntimeIntentCorruptError,
} from "./intent.ts";

Deno.test("intent round-trips through atomic save/load", async () => {
  const directory = await Deno.makeTempDir({ prefix: "tool-runtime-intent-" });
  try {
    assertEquals(
      await loadToolRuntimeIntent(directory, "build123d"),
      undefined,
    );
    let intent = newToolRuntimeIntent({
      toolId: "build123d",
      imageRef: "example@sha256:" + "a".repeat(64),
      platform: "linux/arm64",
      now: "2026-09-27T12:00:00.000Z",
    });
    intent = recordStep(intent, "detect-engine", "done", "2026-09-27T12:00:01.000Z");
    await saveToolRuntimeIntent(directory, intent);
    const reloaded = await loadToolRuntimeIntent(directory, "build123d");
    assertEquals(reloaded, intent);
    assertEquals(intentFileName("build123d"), "tool-runtime-build123d.intent.json");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("intent attempts increment on running only", () => {
  let intent = newToolRuntimeIntent({
    toolId: "build123d",
    imageRef: "example@sha256:" + "a".repeat(64),
    platform: "linux/arm64",
    now: "2026-09-27T12:00:00.000Z",
  });
  intent = recordStep(intent, "acquire-image", "running", "2026-09-27T12:00:01.000Z");
  intent = recordStep(intent, "acquire-image", "running", "2026-09-27T12:00:02.000Z");
  intent = recordStep(intent, "acquire-image", "done", "2026-09-27T12:00:03.000Z");
  assertEquals(intent.steps["acquire-image"].attempts, 2);
  assertEquals(intent.steps["acquire-image"].status, "done");
});

Deno.test("corrupt intents fail closed with the file path", async () => {
  const directory = await Deno.makeTempDir({ prefix: "tool-runtime-corrupt-" });
  try {
    const path = `${directory}/${intentFileName("build123d")}`;
    await Deno.writeTextFile(path, "{not-json");
    await assertRejects(
      () => loadToolRuntimeIntent(directory, "build123d"),
      ToolRuntimeIntentCorruptError,
      path,
    );
    await Deno.writeTextFile(path, JSON.stringify({ schemaVersion: "other/9.9" }));
    await assertRejects(
      () => loadToolRuntimeIntent(directory, "build123d"),
      ToolRuntimeIntentCorruptError,
      "schema mismatch",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
