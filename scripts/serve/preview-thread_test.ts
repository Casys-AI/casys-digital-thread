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
  const commands = buildPreviewThreadCommands([
    "--project-id=cantilever-arm-ca01",
  ]);
  assertEquals(commands.map((command) => command.name), ["bff", "ui"]);

  const [bff, ui] = commands;
  assertEquals(bff.args.includes(`--port=${PREVIEW_THREAD_BFF_PORT}`), true);
  assertEquals(bff.args.includes("--workspace-id=primary"), true);
  assertEquals(bff.args.includes("--no-prompt"), true);
  assertEquals(bff.args.includes("--frozen"), true);
  assertEquals(bff.args.includes("--node-modules-dir=auto"), true);
  assertEquals(
    bff.args.includes(
      "--allow-read=state,src/ui/dist/thread,config/projects,config/thread-subjects,config/mcp-fleet.json,config/microsandbox-local.json,node_modules",
    ),
    true,
  );
  assertEquals(bff.args.includes("--allow-run=docker"), true);
  assertEquals(
    bff.args.includes(
      "--allow-env=NAPI_RS_ENFORCE_VERSION_CHECK,NAPI_RS_NATIVE_LIBRARY_PATH,NAPI_RS_FORCE_WASI,NAPI_RS_WASI_FLAVOR,MSB_PATH,MSB_LIBKRUNFW_PATH,MSB_CONFIG_PATH,MSB_HOME,MSB_BACKEND,MSB_API_URL,MSB_API_KEY,MSB_PROFILE",
    ),
    true,
  );
  assertEquals(bff.args.includes("--allow-ffi=node_modules"), true);
  assertEquals(
    bff.args.includes(
      "--viewer-app-registry=state/local/thread-viewer-apps/registry.json",
    ),
    true,
  );
  assertEquals(
    bff.args.includes(
      "--viewer-app-object-dir=state/local/thread-viewer-apps/objects",
    ),
    true,
  );
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
  assertStringIncludes(
    source,
    'environmentPort("CASYS_COCKPIT_BFF_PORT", 5175)',
  );
  assertStringIncludes(
    source,
    'environmentPort("CASYS_COCKPIT_UI_PORT", 5173)',
  );
  assertStringIncludes(source, "workbench-root-rewrite");
  assertStringIncludes(source, "development-mcp-app-script-nonce");
  assertStringIncludes(source, "casys-mcp-app-script-nonce");
});

Deno.test("preview:cockpit grants the anchored state root to the read-only BFF", async () => {
  const config = await Deno.readTextFile(
    new URL("../../deno.json", import.meta.url),
  );
  assertStringIncludes(config, '"preview:cockpit"');
  assertStringIncludes(
    config,
    "--allow-read=state,src/ui/dist/thread,config/projects,config/thread-subjects,config/mcp-fleet.json,config/microsandbox-local.json,node_modules",
  );
  assertStringIncludes(config, "--allow-run=docker");
  assertStringIncludes(config, "--allow-ffi=node_modules");
});
