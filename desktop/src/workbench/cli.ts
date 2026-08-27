import {
  type ControlPlaneLayoutProfile,
  isControlPlaneLayoutProfile,
} from "../sidecar/contracts.ts";
import { LAUNCH_ID_PATTERN } from "./contracts.ts";

export type WorkbenchCli =
  | { readonly mode: "inspect"; readonly layoutProfile: ControlPlaneLayoutProfile }
  | {
    readonly mode: "start";
    readonly layoutProfile: ControlPlaneLayoutProfile;
    readonly launchId: string;
  };

export function parseWorkbenchCli(args: readonly string[]): WorkbenchCli {
  const layoutProfile = parseLayoutProfile(args[1]);
  if (args.length === 2 && args[0] === "inspect") {
    return { mode: "inspect", layoutProfile };
  }
  if (
    args.length === 3 && args[0] === "start" &&
    args[2].startsWith("--launch-id=")
  ) {
    const launchId = args[2].slice("--launch-id=".length);
    if (!LAUNCH_ID_PATTERN.test(launchId)) {
      throw new TypeError("Workbench launch id must be a lowercase UUID v4.");
    }
    return { mode: "start", layoutProfile, launchId };
  }
  throw new TypeError(
    "Workbench helper accepts only inspect --layout-profile=<profile> or start --layout-profile=<profile> --launch-id=<uuid-v4>.",
  );
}

function parseLayoutProfile(argument: string | undefined): ControlPlaneLayoutProfile {
  if (argument?.startsWith("--layout-profile=") !== true) {
    throw new TypeError("Workbench requires one exact layout profile.");
  }
  const value = argument.slice("--layout-profile=".length);
  if (!isControlPlaneLayoutProfile(value)) {
    throw new TypeError("Workbench layout profile is not registered.");
  }
  return value;
}
