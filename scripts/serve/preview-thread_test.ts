import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildPreviewThreadCommands,
  PREVIEW_THREAD_BFF_PORT,
  PREVIEW_THREAD_UI_PORT,
  previewThreadPorts,
} from "./preview-thread.ts";

Deno.test("preview:thread defaults Vite to 5173 and the BFF to 5175", () => {
  assertEquals(previewThreadPorts(), { uiPort: 5173, bffPort: 5175 });
  assertEquals(PREVIEW_THREAD_UI_PORT, 5173);
  assertEquals(PREVIEW_THREAD_BFF_PORT, 5175);
});

Deno.test("preview:thread launches the BFF on 5175 and Vite on 5173", () => {
  const commands = buildPreviewThreadCommands(["--project-id=cantilever-arm-ca01"]);
  assertEquals(commands.map((command) => command.name), ["bff", "ui"]);

  const [bff, ui] = commands;
  assertEquals(bff.args.includes(`--port=${PREVIEW_THREAD_BFF_PORT}`), true);
  assertEquals(bff.args.includes("--workspace-id=primary"), true);
  assertEquals(bff.args.includes("--project-id=cantilever-arm-ca01"), true);

  assertEquals(ui.command, "npm");
  assertEquals(ui.args.includes("dev:thread"), true);
  assertEquals(ui.env, {
    CASYS_COCKPIT_BFF_PORT: "5175",
    CASYS_COCKPIT_UI_PORT: "5173",
  });
});

Deno.test("native Vite config defaults match preview:thread ports", async () => {
  const source = await Deno.readTextFile(
    new URL("../../src/ui/vite.native.config.ts", import.meta.url),
  );
  assertStringIncludes(source, 'environmentPort("CASYS_COCKPIT_BFF_PORT", 5175)');
  assertStringIncludes(source, 'environmentPort("CASYS_COCKPIT_UI_PORT", 5173)');
  assertStringIncludes(source, "workbench-root-rewrite");
});
