import { createConsoleServer } from "../../../server.ts";
import { validateFleetManifest } from "../../../src/adapters/control-plane/manifest.ts";
import { validateRunFixture } from "../../../src/adapters/control-plane/run-fixtures.ts";
import { CONTROL_PLANE_HOSTNAME, CONTROL_PLANE_PORT } from "./contracts.ts";
import { DESKTOP_LIFECYCLE_TOOL, lifecycleToolResult } from "./lifecycle-tool.ts";
import { UnavailableComposeObserver } from "./observer.ts";
import type { PreparedSidecarServer, StartedSidecarHttp } from "./start.ts";

/**
 * Programmatic `createConsoleServer` binding. YOLO and local Microsandbox
 * execution stay omitted. The default Docker observer is replaced.
 */
export async function bindPackagedConsoleServer(
  prepared: PreparedSidecarServer,
): Promise<StartedSidecarHttp> {
  const { app } = await createConsoleServer({
    manifest: validateFleetManifest(JSON.parse(prepared.fleetText)),
    runs: [validateRunFixture(JSON.parse(prepared.fixtureText))],
    docker: new UnavailableComposeObserver(),
    mrtrSigningKey: prepared.mrtrSigningKey,
    approvalMode: { kind: "interactive" },
    logger: (message) => console.error(message),
  });
  app.registerTool(
    DESKTOP_LIFECYCLE_TOOL,
    () => lifecycleToolResult(prepared.identity),
  );
  const http = await app.startHttp({
    port: CONTROL_PLANE_PORT,
    hostname: CONTROL_PLANE_HOSTNAME,
    corsOrigins: ["http://127.0.0.1", "http://localhost"],
    onListen: () => {
      console.error(
        `Casys desktop control-plane: ${CONTROL_PLANE_HOSTNAME}:${CONTROL_PLANE_PORT}/mcp`,
      );
    },
  });
  return { shutdown: () => http.shutdown() };
}
