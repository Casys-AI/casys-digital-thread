import {
  type ControlPlaneLayoutProfile,
  isControlPlaneLayoutProfile,
  LAUNCH_ID_PATTERN,
  SidecarFailure,
} from "./contracts.ts";

export type HelperCli =
  | {
    readonly mode: "start";
    readonly layoutProfile: ControlPlaneLayoutProfile;
    readonly launchId: string;
  }
  | {
    readonly mode: "inspect";
    readonly layoutProfile: ControlPlaneLayoutProfile;
  };

const FORBIDDEN_FLAGS = [
  "--yolo",
  "--local-execution",
  "--port",
  "--hostname",
  "--stop",
  "--pid",
  "-A",
  "--allow-all",
] as const;

export function parseHelperCli(args: readonly string[]): HelperCli {
  if (args.length === 0) {
    throw new SidecarFailure(
      "cli.mode-required",
      "The helper accepts only inspect --layout-profile=<profile> or start --layout-profile=<profile> --launch-id=<uuid-v4>.",
    );
  }

  for (const argument of args) {
    for (const flag of FORBIDDEN_FLAGS) {
      if (argument === flag || argument.startsWith(`${flag}=`)) {
        throw new SidecarFailure(
          "cli.forbidden",
          `The helper does not accept ${flag}. YOLO, local execution, and stop-by-pid are disabled.`,
        );
      }
    }
  }

  const [mode, ...rest] = args;
  if (mode === "inspect") {
    if (rest.length !== 1) {
      throw new SidecarFailure(
        "cli.inspect-readonly",
        "inspect requires exactly --layout-profile=<profile>.",
      );
    }
    return { mode: "inspect", layoutProfile: readLayoutProfile(rest[0]) };
  }

  if (mode !== "start") {
    throw new SidecarFailure(
      "cli.mode-invalid",
      "The helper accepts only start and inspect. There is no stop-by-pid mode.",
    );
  }

  if (rest.length !== 2) {
    throw new SidecarFailure(
      "cli.start-invalid",
      "start requires exactly --layout-profile=<profile> --launch-id=<uuid-v4>.",
    );
  }
  return {
    mode: "start",
    layoutProfile: readLayoutProfile(rest[0]),
    launchId: readLaunchId(rest[1]),
  };
}

function readLayoutProfile(argument: string): ControlPlaneLayoutProfile {
  if (!argument.startsWith("--layout-profile=")) {
    throw new SidecarFailure(
      "cli.layout-profile-required",
      "The first helper argument must be --layout-profile=<profile>.",
    );
  }
  const value = argument.slice("--layout-profile=".length);
  if (!isControlPlaneLayoutProfile(value)) {
    throw new SidecarFailure(
      "cli.layout-profile-invalid",
      "layout profile must be one of the finite Desktop platform profiles.",
    );
  }
  return value;
}

function readLaunchId(argument: string): string {
  if (!argument.startsWith("--launch-id=")) {
    throw new SidecarFailure(
      "cli.launch-id-required",
      "start requires exactly --launch-id=<uuid-v4>.",
    );
  }
  return requireLaunchId(argument.slice("--launch-id=".length));
}

function requireLaunchId(value: string): string {
  if (!LAUNCH_ID_PATTERN.test(value)) {
    throw new SidecarFailure(
      "cli.launch-id-invalid",
      "launch id must be a lowercase UUID v4.",
    );
  }
  return value;
}
