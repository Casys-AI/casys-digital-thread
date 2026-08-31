import { assertEquals, assertThrows } from "@std/assert";
import { parseCapabilityRuntimeAdminCli } from "./capability-runtime-admin.ts";
import { CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID } from "../../src/application/control-plane/capability-runtime-chrono-rollover-service.ts";
import { SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID } from "../../src/application/control-plane/capability-runtime-syson-rollover-service.ts";

Deno.test("admin CLI parses exact unit+material non-persistent removal targets", () => {
  assertEquals(
    parseCapabilityRuntimeAdminCli([
      "remove-review",
      "--unit-id=casys.spice-worker",
      "--material-id=ngspice-docker-source-image",
    ]),
    {
      command: "remove-review",
      target: {
        kind: "material",
        unitId: "casys.spice-worker",
        materialId: "ngspice-docker-source-image",
      },
    },
  );
  const apply = parseCapabilityRuntimeAdminCli([
    "remove-apply",
    "--unit-id=casys.spice-worker",
    "--material-id=ngspice-docker-source-image",
    `--review-fingerprint=${"a".repeat(64)}`,
    "--confirm",
  ]);
  assertEquals(apply.command, "remove-apply");
  if (apply.command !== "remove-apply") throw new Error("expected apply");
  assertEquals(apply.confirm, true);
  assertEquals(apply.target, {
    kind: "material",
    unitId: "casys.spice-worker",
    materialId: "ngspice-docker-source-image",
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
        "--material-id=ngspice-docker-source-image",
      ]),
    Error,
    "--unit-id with --material-id",
  );
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "remove-review",
        "--unit-id=casys.spice-worker",
        "--material-id=ngspice-docker-source-image",
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
          "--material-id=ngspice-docker-source-image",
          flag,
        ]),
      Error,
      "is not valid for local admin",
    );
  }
});

Deno.test("admin CLI accepts only the two literal rollover transition ids", async () => {
  assertEquals(
    parseCapabilityRuntimeAdminCli([
      "rollover-review",
      `--transition-id=${SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID}`,
    ]),
    {
      command: "rollover-review",
      transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    },
  );
  assertEquals(
    parseCapabilityRuntimeAdminCli([
      "rollover-status",
      `--transition-id=${CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID}`,
    ]),
    {
      command: "rollover-status",
      transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
    },
  );
  const apply = parseCapabilityRuntimeAdminCli([
    "rollover-apply",
    `--transition-id=${CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID}`,
    `--review-fingerprint=${"a".repeat(64)}`,
    "--confirm",
  ]);
  assertEquals(apply.command, "rollover-apply");
  if (apply.command !== "rollover-apply") throw new Error("expected apply");
  assertEquals(apply.transitionId, CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID);
  assertEquals(apply.confirm, true);
  assertThrows(
    () =>
      parseCapabilityRuntimeAdminCli([
        "rollover-review",
        "--transition-id=casys-chrono-latest",
      ]),
    Error,
    `${SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID} or ${CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID}`,
  );
  const text = await Deno.readTextFile(
    new URL("./capability-runtime-admin.ts", import.meta.url),
  );
  assertEquals(text.includes(SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID), true);
  assertEquals(text.includes(CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID), true);
  assertEquals(text.includes("CapabilityRuntimeChronoRolloverService"), true);
  assertEquals(text.includes("CapabilityRuntimeSysonRolloverService"), true);
});
