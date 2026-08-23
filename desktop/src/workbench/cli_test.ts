import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { parseWorkbenchCli } from "./cli.ts";

const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("Workbench CLI accepts only a registered layout plus exact mode fields", () => {
  assertEquals(
    parseWorkbenchCli(["inspect", "--layout-profile=linux-xdg"]),
    { mode: "inspect", layoutProfile: "linux-xdg" },
  );
  assertEquals(
    parseWorkbenchCli([
      "start",
      "--layout-profile=windows-local-appdata",
      `--launch-id=${LAUNCH_ID}`,
    ]),
    {
      mode: "start",
      layoutProfile: "windows-local-appdata",
      launchId: LAUNCH_ID,
    },
  );
});

Deno.test("Workbench CLI rejects omitted, caller-invented, and reordered layouts", () => {
  for (
    const args of [
      ["inspect"],
      ["inspect", "--layout-profile=other"],
      ["start", `--launch-id=${LAUNCH_ID}`],
      [
        "start",
        `--launch-id=${LAUNCH_ID}`,
        "--layout-profile=linux-home",
      ],
      [
        "start",
        "--layout-profile=linux-home",
        `--launch-id=${LAUNCH_ID}`,
        "--project-id=hidden-default",
      ],
    ]
  ) {
    assertThrows(() => parseWorkbenchCli(args), TypeError);
  }
});
