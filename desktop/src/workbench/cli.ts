import { LAUNCH_ID_PATTERN } from "./contracts.ts";

export type WorkbenchCli =
  | { readonly mode: "inspect" }
  | { readonly mode: "start"; readonly launchId: string };

export function parseWorkbenchCli(args: readonly string[]): WorkbenchCli {
  if (args.length === 1 && args[0] === "inspect") return { mode: "inspect" };
  if (
    args.length === 2 && args[0] === "start" &&
    args[1].startsWith("--launch-id=")
  ) {
    const launchId = args[1].slice("--launch-id=".length);
    if (!LAUNCH_ID_PATTERN.test(launchId)) {
      throw new TypeError("Workbench launch id must be a lowercase UUID v4.");
    }
    return { mode: "start", launchId };
  }
  throw new TypeError(
    "Workbench helper accepts only inspect or start --launch-id=<uuid-v4>.",
  );
}
