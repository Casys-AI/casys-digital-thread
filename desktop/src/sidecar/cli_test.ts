import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { parseHelperCli } from "./cli.ts";
import { SidecarFailure } from "./contracts.ts";

const LAUNCH_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

Deno.test("parseHelperCli accepts start with an exact launch id", () => {
  assertEquals(
    parseHelperCli([
      "start",
      "--layout-profile=macos-application-support",
      `--launch-id=${LAUNCH_ID}`,
    ]),
    {
      mode: "start",
      layoutProfile: "macos-application-support",
      launchId: LAUNCH_ID,
    },
  );
});

Deno.test("parseHelperCli accepts read-only inspect", () => {
  assertEquals(parseHelperCli(["inspect", "--layout-profile=linux-xdg"]), {
    mode: "inspect",
    layoutProfile: "linux-xdg",
  });
});

Deno.test("parseHelperCli rejects YOLO, local execution, and stop-by-pid", () => {
  for (
    const args of [
      [
        "start",
        "--layout-profile=macos-application-support",
        `--launch-id=${LAUNCH_ID}`,
        "--yolo",
      ],
      [
        "start",
        "--layout-profile=macos-application-support",
        `--launch-id=${LAUNCH_ID}`,
        "--local-execution",
      ],
      ["stop", "--pid", "12"],
      [
        "start",
        "--port=3020",
        "--layout-profile=macos-application-support",
        `--launch-id=${LAUNCH_ID}`,
      ],
      ["inspect", "--launch-id", LAUNCH_ID],
      ["inspect", "--layout-profile=other"],
      ["inspect"],
    ]
  ) {
    assertThrows(() => parseHelperCli(args), SidecarFailure);
  }
});

Deno.test("parseHelperCli rejects a non-UUID launch id", () => {
  assertThrows(
    () =>
      parseHelperCli([
        "start",
        "--layout-profile=macos-application-support",
        "--launch-id=latest",
      ]),
    SidecarFailure,
    "lowercase UUID v4",
  );
});
