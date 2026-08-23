import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  WORKBENCH_COMPILE_PERMISSION_FLAGS,
  workbenchCompilePermissionsAreClosed,
} from "./compile-permissions.ts";

Deno.test("Workbench helper has one read-only project authority and a separate runtime write root", () => {
  assertEquals(WORKBENCH_COMPILE_PERMISSION_FLAGS, [
    "--allow-read=./ai.casys.digital-thread/control-plane,./ai.casys.digital-thread/workbench-runtime",
    "--allow-write=./ai.casys.digital-thread/workbench-runtime",
    "--allow-net=127.0.0.1:5176",
    "--deny-env",
    "--deny-run",
    "--deny-ffi",
    "--deny-sys",
    "--deny-import",
  ]);
  assertEquals(
    workbenchCompilePermissionsAreClosed(WORKBENCH_COMPILE_PERMISSION_FLAGS),
    true,
  );
  assertEquals(
    workbenchCompilePermissionsAreClosed([
      ...WORKBENCH_COMPILE_PERMISSION_FLAGS,
      "--allow-run=deno",
    ]),
    false,
  );
});
