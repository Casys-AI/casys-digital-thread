import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import denoConfig from "../../deno.json" with { type: "json" };
import { CONTROL_PLANE_COMPILE_PERMISSION_FLAGS } from "../sidecar/compile-permissions.ts";

Deno.test("Lot 2 tasks compile the dedicated helper and keep the host free of a Deno CLI", () => {
  const compile = denoConfig.tasks["sidecar:compile"];
  const generalTest = denoConfig.tasks.test;
  const sidecarTest = denoConfig.tasks["sidecar:test"];
  const pack = denoConfig.tasks.package;
  const compiledE2e = Deno.readTextFileSync(
    "src/build/compiled-helper_e2e_test.ts",
  );
  assert(compile.includes("src/build/compile-control-plane-helper.ts"));
  assertEquals(compile.includes("allow-run=deno"), true);
  assertEquals(compile.includes("--allow-env"), false);
  assertEquals(compile.includes("--allow-net"), false);
  assertEquals(compile.includes("--deny-env"), true);
  assertEquals(compile.includes("--deny-net"), true);
  assertEquals(
    generalTest.includes("--ignore=src/build/compiled-helper_e2e_test.ts"),
    true,
  );
  assertEquals(generalTest.includes("--allow-run"), false);
  assertEquals(
    sidecarTest.includes("--allow-net=127.0.0.1:3020"),
    true,
  );
  assertEquals(sidecarTest.startsWith("deno task sidecar:compile &&"), true);
  assertEquals(compiledE2e.includes('args: ["task", "sidecar:compile"]'), false);
  assertEquals(pack.includes("sidecar:compile"), true);
  assertEquals(pack.includes("DENO_BIN=$(which deno)"), true);
  assertEquals(pack.includes('PATH="$PWD/dist/helpers:$PATH"'), true);
  assertEquals(pack.includes('"$DENO_BIN" desktop'), true);
  assertEquals(pack.includes("--deny-import"), true);
  assertEquals(pack.includes("allow-run=deno"), false);
  assertEquals(pack.includes("deno compile"), false);
  assertEquals(pack.includes("/usr/bin/clang"), true);
  assertEquals(pack.includes("src/build/finalize-macos.ts"), true);
  for (const flag of CONTROL_PLANE_COMPILE_PERMISSION_FLAGS) {
    assertEquals(flag.includes("allow-run=deno"), false);
  }
  assertEquals(denoConfig.version, "0.2.0");
  assertEquals(denoConfig.permissions.desktop.run, ["casys-control-plane"]);
  assertEquals(denoConfig.permissions.desktop.net, ["127.0.0.1:3020"]);
  assertEquals("dev" in denoConfig.tasks, false);
  assertEquals("read" in denoConfig.permissions.desktop, false);
  assertEquals("write" in denoConfig.permissions.desktop, false);
});
