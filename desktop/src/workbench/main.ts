import { denoLifelineRuntime, waitForLifeline } from "../sidecar/lifeline.ts";
import { parseWorkbenchCli } from "./cli.ts";
import {
  WORKBENCH_ACCESS_HEADER,
  WORKBENCH_HANDSHAKE_SCHEMA,
  WORKBENCH_HEALTH_SCHEMA,
  WORKBENCH_HOSTNAME,
  WORKBENCH_INSPECT_SCHEMA,
  WORKBENCH_MARKER_SCHEMA,
  WORKBENCH_PORT,
  WORKBENCH_VERSION,
  WORKBENCH_WORKSPACE_ID,
  type WorkbenchHandshake,
  type WorkbenchHealthDocument,
  type WorkbenchInspectDocument,
} from "./contracts.ts";
import { createPackagedWorkbenchBff } from "./bff.ts";
import {
  acquireWorkbenchRuntimeLock,
  clearOwnedWorkbenchRuntime,
  createAccessToken,
  inspectWorkbenchRuntime,
  publishWorkbenchRuntime,
} from "./runtime.ts";
import {
  prepareWorkbenchRuntime,
  readWorkbenchConfigurationDigest,
  workbenchRuntimePaths,
} from "./workspace.ts";

export async function runWorkbenchHelper(
  args: readonly string[],
  launchCwd = Deno.cwd(),
): Promise<void> {
  const cli = parseWorkbenchCli(args);
  const paths = workbenchRuntimePaths(launchCwd, cli.layoutProfile);
  if (cli.mode === "inspect") {
    console.log(JSON.stringify(await inspectDocument(paths)));
    return;
  }

  const configDigest = await readWorkbenchConfigurationDigest(paths);
  if (configDigest === undefined) {
    throw new Error("Workbench configuration is unavailable.");
  }
  await prepareWorkbenchRuntime(paths);
  const lock = await acquireWorkbenchRuntimeLock(paths.lockPath);
  const accessToken = createAccessToken();
  const native = createPackagedWorkbenchBff(
    accessToken,
    paths.controlPlaneRoot,
  );
  const health: WorkbenchHealthDocument = Object.freeze({
    schema: WORKBENCH_HEALTH_SCHEMA,
    status: "ok",
    version: WORKBENCH_VERSION,
    launchId: cli.launchId,
    configDigest,
    workspaceId: WORKBENCH_WORKSPACE_ID,
  });
  let server: Deno.HttpServer | undefined;
  let published = false;
  try {
    server = Deno.serve({
      hostname: WORKBENCH_HOSTNAME,
      port: WORKBENCH_PORT,
      onListen: () => undefined,
    }, async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") {
        if (
          request.method !== "GET" ||
          request.headers.get(WORKBENCH_ACCESS_HEADER) !== accessToken
        ) {
          return new Response("Not found", { status: 404 });
        }
        return Response.json(health, {
          headers: {
            "Cache-Control": "no-store",
            "Cross-Origin-Resource-Policy": "same-origin",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return await native(request);
    });
    await publishWorkbenchRuntime(paths, {
      schema: WORKBENCH_MARKER_SCHEMA,
      version: WORKBENCH_VERSION,
      launchId: cli.launchId,
      pid: Deno.pid,
      configDigest,
      startedAt: new Date().toISOString(),
    }, accessToken);
    published = true;
    await assertSelfReady(accessToken, health);
    const handshake: WorkbenchHandshake = Object.freeze({
      schema: WORKBENCH_HANDSHAKE_SCHEMA,
      status: "ready",
      version: WORKBENCH_VERSION,
      launchId: cli.launchId,
      configDigest,
      accessToken,
    });
    console.log(JSON.stringify(handshake));
    await waitForLifeline(denoLifelineRuntime);
  } finally {
    await server?.shutdown().catch(() => undefined);
    if (published) {
      await clearOwnedWorkbenchRuntime(paths, cli.launchId).catch(() => undefined);
    }
    await lock.release().catch(() => undefined);
  }
}

async function inspectDocument(
  paths: ReturnType<typeof workbenchRuntimePaths>,
): Promise<WorkbenchInspectDocument> {
  let configDigest: string | undefined;
  try {
    configDigest = await readWorkbenchConfigurationDigest(paths);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      return Object.freeze({
        schema: WORKBENCH_INSPECT_SCHEMA,
        version: WORKBENCH_VERSION,
        configuration: "error",
        lock: "unavailable",
        marker: null,
      });
    }
  }
  try {
    return await inspectWorkbenchRuntime(paths, configDigest);
  } catch {
    return Object.freeze({
      schema: WORKBENCH_INSPECT_SCHEMA,
      version: WORKBENCH_VERSION,
      configuration: configDigest === undefined ? "unavailable" : "error",
      ...(configDigest === undefined ? {} : { configDigest }),
      lock: "unavailable",
      marker: null,
    });
  }
}

async function assertSelfReady(
  accessToken: string,
  expected: WorkbenchHealthDocument,
): Promise<void> {
  const response = await fetch(
    `http://${WORKBENCH_HOSTNAME}:${WORKBENCH_PORT}/healthz`,
    { headers: { [WORKBENCH_ACCESS_HEADER]: accessToken } },
  );
  if (
    !response.ok || JSON.stringify(await response.json()) !== JSON.stringify(expected)
  ) {
    throw new Error("Workbench helper did not reach exact readiness.");
  }
}

if (import.meta.main) {
  try {
    await runWorkbenchHelper(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
