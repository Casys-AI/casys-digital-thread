import { assertEquals, assertThrows } from "@std/assert";
import { parseCapabilityRuntimeAdminCli } from "./capability-runtime-admin.ts";

Deno.test("admin CLI parses exact unit+material non-persistent removal targets", () => {
  assertEquals(
    parseCapabilityRuntimeAdminCli([
      "remove-review",
      "--unit-id=casys.spice-worker",
      "--material-id=ngspice-runtime-image",
    ]),
    {
      command: "remove-review",
      target: {
        kind: "material",
        unitId: "casys.spice-worker",
        materialId: "ngspice-runtime-image",
      },
    },
  );
  const apply = parseCapabilityRuntimeAdminCli([
    "remove-apply",
    "--unit-id=casys.spice-worker",
    "--material-id=ngspice-runtime-image",
    `--review-fingerprint=${"a".repeat(64)}`,
    "--confirm",
  ]);
  assertEquals(apply.command, "remove-apply");
  if (apply.command !== "remove-apply") throw new Error("expected apply");
  assertEquals(apply.confirm, true);
  assertEquals(apply.target, {
    kind: "material",
    unitId: "casys.spice-worker",
    materialId: "ngspice-runtime-image",
  });
});

Deno.test("admin CLI keeps unit-only and launch-group Compose removal targets", () => {
  assertEquals(
    parseCapabilityRuntimeAdminCli([
      "remove-review",
      "--unit-id=casys.syson-stack",
    ]),
    {
      command: "remove-review",
      target: { kind: "unit", id: "casys.syson-stack" },
    },
  );
  assertEquals(
    parseCapabilityRuntimeAdminCli([
      "remove-review",
      "--launch-group-id=casys-syson",
    ]),
    {
      command: "remove-review",
      target: { kind: "launch-group", id: "casys-syson" },
    },
  );
});

Deno.test("admin CLI rejects a bare or empty --material-id and never falls back to unit removal", () => {
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "remove-review",
        "--unit-id=casys.spice-worker",
        "--material-id",
      ]),
    Error,
    "--material-id=<id>",
  );
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "remove-review",
        "--unit-id=casys.spice-worker",
        "--material-id=",
      ]),
    Error,
    "--material-id=<id>",
  );
});

Deno.test("admin CLI rejects partial, mixed, backend, image, force and prune removal flags", () => {
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "remove-review",
        "--material-id=ngspice-runtime-image",
      ]),
    Error,
    "--unit-id with --material-id",
  );
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "remove-review",
        "--unit-id=casys.spice-worker",
        "--material-id=ngspice-runtime-image",
        "--launch-group-id=casys-syson",
      ]),
    Error,
    "mixed",
  );
  for (
    const flag of [
      "--backend=docker-cache",
      "--image=casys/ngspice@sha256:deadbeef",
      "--force",
      "--prune",
      "--digest=abc",
      "--provider=docker",
    ]
  ) {
    assertThrows(
      () =>
        parseCapabilityRuntimeAdminCli([
          "remove-review",
          "--unit-id=casys.spice-worker",
          "--material-id=ngspice-runtime-image",
          flag,
        ]),
      Error,
      "is not valid for local admin",
    );
  }
});

Deno.test("admin CLI refuses retired rollover commands and --transition-id", async () => {
  for (
    const command of ["rollover-status", "rollover-review", "rollover-apply"] as const
  ) {
    assertThrows(
      () => parseCapabilityRuntimeAdminCli([command]),
      Error,
      "Usage: capability-runtime-admin",
    );
  }
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "status",
        "--transition-id=casys-syson-node-repack-v1",
      ]),
    Error,
    "is not valid for local admin",
  );
  const text = await Deno.readTextFile(
    new URL("./capability-runtime-admin.ts", import.meta.url),
  );
  assertEquals(text.includes("rollover-status"), false);
  assertEquals(text.includes("rollover-review"), false);
  assertEquals(text.includes("rollover-apply"), false);
  assertEquals(text.includes("--transition-id"), false);
});
