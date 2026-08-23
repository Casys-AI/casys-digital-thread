import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  compilePermissionFlagsAreClosed,
  CONTROL_PLANE_COMPILE_PERMISSION_FLAGS,
  CONTROL_PLANE_HELPER_NAME,
  CONTROL_PLANE_LOOPBACK_PORTS,
  PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT,
} from "./compile-permissions.ts";

Deno.test("compile flags bake relative cwd FS grants and exact loopback ports", () => {
  assertEquals(CONTROL_PLANE_HELPER_NAME, "casys-control-plane");
  assert(
    CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.includes(
      `--allow-read=${PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT}`,
    ),
  );
  assert(
    CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.includes(
      `--allow-write=${PACKAGED_CONTROL_PLANE_RELATIVE_PRODUCT_ROOT}`,
    ),
  );
  assert(CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.includes("--deny-env"));
  assertEquals(
    CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.some((flag) =>
      flag.startsWith("--allow-env")
    ),
    false,
  );
  assertEquals(
    CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.includes("--allow-read=."),
    false,
  );
  assertEquals(
    CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.includes("--allow-write=."),
    false,
  );
  const net = CONTROL_PLANE_COMPILE_PERMISSION_FLAGS.find((flag) =>
    flag.startsWith("--allow-net=")
  );
  for (const port of CONTROL_PLANE_LOOPBACK_PORTS) {
    assert(net?.includes(`127.0.0.1:${port}`), `missing 127.0.0.1:${port}`);
  }
  assertEquals(net?.includes("0.0.0.0"), false);
  assert(compilePermissionFlagsAreClosed(CONTROL_PLANE_COMPILE_PERMISSION_FLAGS));
});

Deno.test("compile flags reject a general Deno CLI or open sandbox", () => {
  assertEquals(
    compilePermissionFlagsAreClosed(["-A", "--allow-run=deno"]),
    false,
  );
  assertEquals(
    compilePermissionFlagsAreClosed(["--allow-net", "--deny-run"]),
    false,
  );
  assertEquals(
    compilePermissionFlagsAreClosed([
      ...CONTROL_PLANE_COMPILE_PERMISSION_FLAGS,
      "--allow-read=.",
    ]),
    false,
  );
});
