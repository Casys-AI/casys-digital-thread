import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  clearToolRuntimeBinding,
  loadToolRuntimeBinding,
  saveToolRuntimeBinding,
} from "./runtime-state.ts";

Deno.test("binding round-trips through the state file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "binding-state-" });
  try {
    assertEquals(await loadToolRuntimeBinding(dir, "build123d"), undefined);
    await saveToolRuntimeBinding(dir, {
      toolId: "build123d",
      hostPort: 45678,
      mcpUrl: "http://127.0.0.1:45678/mcp",
      healthUrl: "http://127.0.0.1:45678/health",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
    assertEquals(await loadToolRuntimeBinding(dir, "build123d"), {
      schema: "desktop-tool-runtime-binding/1.0",
      toolId: "build123d",
      hostPort: 45678,
      mcpUrl: "http://127.0.0.1:45678/mcp",
      healthUrl: "http://127.0.0.1:45678/health",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
    await clearToolRuntimeBinding(dir, "build123d");
    assertEquals(await loadToolRuntimeBinding(dir, "build123d"), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("binding load fails closed on corrupt bytes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "binding-state-" });
  try {
    await Deno.writeTextFile(
      `${dir}/tool-runtime-build123d.binding.json`,
      "{oops",
    );
    await assertRejects(
      () => loadToolRuntimeBinding(dir, "build123d"),
      Error,
      "binding",
    );
    await Deno.writeTextFile(
      `${dir}/tool-runtime-build123d.binding.json`,
      JSON.stringify({ schema: "desktop-tool-runtime-binding/1.0", hostPort: 1 }),
    );
    await assertRejects(
      () => loadToolRuntimeBinding(dir, "build123d"),
      Error,
      "binding",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
