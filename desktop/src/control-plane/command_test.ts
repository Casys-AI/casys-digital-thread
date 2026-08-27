import { assertEquals } from "jsr:@std/assert@1.0.14";
import { constructHelperCommand } from "./command.ts";

const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";
const HELPER =
  "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane";
const MAC_WORKSPACE = "ai.casys.digital-thread/control-plane";

function macInput() {
  return {
    helperPath: HELPER,
    cwd: "/Users/ada/Library/Application Support",
    platform: "macOS" as const,
    layoutProfile: "macos-application-support" as const,
    relativeWorkspace: MAC_WORKSPACE,
  };
}

function assertFailed(
  result: { ok: boolean; error?: { code: string } },
  code: string,
) {
  if (result.ok) throw new Error(`expected failure ${code}`);
  assertEquals(result.error?.code, code);
}

Deno.test("constructHelperCommand sends start identity only as exact CLI arguments", () => {
  const result = constructHelperCommand({
    ...macInput(),
    mode: "start",
    launchId: LAUNCH_ID,
  });
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(result.value, {
    program: HELPER,
    args: [
      "start",
      "--layout-profile=macos-application-support",
      `--launch-id=${LAUNCH_ID}`,
    ],
    cwd: "/Users/ada/Library/Application Support",
    env: {},
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
    clearEnv: true,
  });
});

Deno.test("constructHelperCommand sends inspect with only the fixed layout profile", () => {
  const result = constructHelperCommand({ ...macInput(), mode: "inspect" });
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(result.value.args, [
    "inspect",
    "--layout-profile=macos-application-support",
  ]);
  assertEquals(result.value.env, {});
});

Deno.test("constructHelperCommand accepts the macOS support base and requires its fixed profile workspace", () => {
  const supportBase = constructHelperCommand({
    ...macInput(),
    mode: "start",
    launchId: LAUNCH_ID,
  });
  assertEquals(supportBase.ok, true);

  assertFailed(
    constructHelperCommand({
      ...macInput(),
      relativeWorkspace: "control-plane",
      mode: "inspect",
    }),
    "command.workspace-invalid",
  );
  assertFailed(
    constructHelperCommand({
      ...macInput(),
      platform: "Linux",
      mode: "inspect",
    }),
    "command.layout-profile-invalid",
  );
});

Deno.test("constructHelperCommand validates every finite platform layout pair", () => {
  const cases = [
    {
      platform: "Linux" as const,
      cwd: "/var/lib/casys",
      layoutProfile: "linux-xdg" as const,
      relativeWorkspace: "ai.casys.digital-thread/control-plane",
      helperPath: "/opt/casys/casys-control-plane",
    },
    {
      platform: "Linux" as const,
      cwd: "/home/ada",
      layoutProfile: "linux-home" as const,
      relativeWorkspace: ".local/share/ai.casys.digital-thread/control-plane",
      helperPath: "/opt/casys/casys-control-plane",
    },
    {
      platform: "Windows" as const,
      cwd: "C:\\Users\\ada\\AppData\\Local",
      layoutProfile: "windows-local-appdata" as const,
      relativeWorkspace: "ai.casys.digital-thread\\control-plane",
      helperPath: "C:\\Program Files\\Casys\\casys-control-plane.exe",
    },
  ];
  for (const input of cases) {
    const result = constructHelperCommand({ ...input, mode: "inspect" });
    if (!result.ok) throw new Error(result.error.message);
    assertEquals(result.value.cwd, input.cwd);
  }
});

Deno.test("constructHelperCommand rejects a general Deno CLI and relative or root paths", () => {
  assertFailed(
    constructHelperCommand({
      ...macInput(),
      helperPath: "/usr/bin/deno",
      mode: "inspect",
    }),
    "command.deno-cli-rejected",
  );
  assertFailed(
    constructHelperCommand({
      ...macInput(),
      helperPath: "casys-control-plane",
      mode: "inspect",
    }),
    "command.relative-path-rejected",
  );
  assertFailed(
    constructHelperCommand({ ...macInput(), cwd: "/", mode: "inspect" }),
    "command.cwd-invalid",
  );
  assertFailed(
    constructHelperCommand({
      ...macInput(),
      helperPath: "/tmp/../casys-control-plane",
      mode: "inspect",
    }),
    "command.relative-path-rejected",
  );
});

Deno.test("constructHelperCommand requires a v4 launch id only for start", () => {
  assertFailed(
    constructHelperCommand({ ...macInput(), mode: "start" }),
    "command.launch-id-invalid",
  );
  assertFailed(
    constructHelperCommand({
      ...macInput(),
      mode: "start",
      launchId: "11111111-1111-1111-8111-111111111111",
    }),
    "command.launch-id-invalid",
  );
  assertFailed(
    constructHelperCommand({
      ...macInput(),
      mode: "inspect",
      launchId: LAUNCH_ID,
    }),
    "command.mode-invalid",
  );
});
