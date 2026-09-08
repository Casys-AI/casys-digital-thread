import { assertEquals, assertThrows } from "@std/assert";
import { parseCapabilityRuntimeQualificationCli } from "./capability-runtime-qualification.ts";

Deno.test("qualification CLI accepts review, apply and recover with either code-owned candidate", () => {
  assertEquals(
    parseCapabilityRuntimeQualificationCli([
      "review",
      "--candidate=chrono-arm64-emulation-v1",
    ]),
    {
      command: "review",
      candidate: "chrono-arm64-emulation-v1",
      confirm: false,
    },
  );
  const apply = parseCapabilityRuntimeQualificationCli([
    "apply",
    "--candidate=chrono-arm64-emulation-v1",
    `--review-fingerprint=${"a".repeat(64)}`,
    "--confirm",
  ]);
  assertEquals(apply.command, "apply");
  assertEquals(apply.confirm, true);
  assertEquals(
    parseCapabilityRuntimeQualificationCli([
      "recover",
      "--candidate=chrono-arm64-emulation-v1",
    ]).command,
    "recover",
  );
  assertEquals(
    parseCapabilityRuntimeQualificationCli([
      "review",
      "--candidate=calculix-http-arm64-native-v1",
    ]),
    {
      command: "review",
      candidate: "calculix-http-arm64-native-v1",
      confirm: false,
    },
  );
  assertEquals(
    parseCapabilityRuntimeQualificationCli([
      "apply",
      "--candidate=calculix-http-arm64-native-v1",
      `--review-fingerprint=${"b".repeat(64)}`,
      "--confirm",
    ]).candidate,
    "calculix-http-arm64-native-v1",
  );
});

Deno.test("qualification CLI refuses provider, image, digest, platform, mode, URL, tool, token, project, MRTR and Thread flags", () => {
  for (
    const flag of [
      "--provider=chrono",
      "--image=ghcr.io/casys-ai/mcp-chrono",
      `--digest=${"a".repeat(64)}`,
      "--platform=linux/amd64",
      "--mode=emulated",
      "--url=http://127.0.0.1:3025/mcp",
      "--tool=chrono_run_prescribed_kinematics",
      "--token=secret",
      "--project=desk-lamp",
      "--project-id=desk-lamp",
      "--mrtr=1",
      "--thread=1",
      "--unknown=1",
    ]
  ) {
    assertThrows(
      () =>
        parseCapabilityRuntimeQualificationCli([
          "review",
          "--candidate=chrono-arm64-emulation-v1",
          flag,
        ]),
      Error,
    );
  }
  assertThrows(
    () =>
      parseCapabilityRuntimeQualificationCli([
        "review",
        "--candidate=other-runtime",
      ]),
    Error,
    "calculix-http-arm64-native-v1",
  );
  assertThrows(
    () => parseCapabilityRuntimeQualificationCli(["status"]),
    Error,
    "Usage:",
  );
});
