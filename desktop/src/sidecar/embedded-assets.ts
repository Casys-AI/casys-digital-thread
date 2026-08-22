import fleetText from "../../../config/mcp-fleet.json" with { type: "text" };
import fixtureText from "../../../state/fixtures/runs/bracket-demo.json" with {
  type: "text",
};
import type { PackagedAssets } from "./workspace.ts";

export const PACKAGED_CONTROL_PLANE_ASSETS: PackagedAssets = {
  fleetText,
  fixtureText,
};
