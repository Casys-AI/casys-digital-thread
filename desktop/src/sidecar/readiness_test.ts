import { assertRejects } from "jsr:@std/assert@1.0.14";
import {
  CONTROL_PLANE_ENDPOINT,
  CONTROL_PLANE_HEALTH_URL,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  EXACT_DISCOVER_SERVER_INFO,
  EXACT_HEALTH,
  SidecarFailure,
} from "./contracts.ts";
import { createLifecycleIdentity } from "./lifecycle-tool.ts";
import { assertControlPlaneReady } from "./readiness.ts";

const IDENTITY = createLifecycleIdentity(
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  `sha256:${"ab".repeat(32)}`,
);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function readyFetch(input: string, init?: RequestInit): Promise<Response> {
  if (input === CONTROL_PLANE_HEALTH_URL) {
    return Promise.resolve(jsonResponse(EXACT_HEALTH));
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    method?: string;
    params?: { name?: string };
  };
  if (body.method === "server/discover") {
    return Promise.resolve(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        serverInfo: EXACT_DISCOVER_SERVER_INFO,
      },
    }));
  }
  if (
    body.method === "tools/call" &&
    body.params?.name === DESKTOP_LIFECYCLE_TOOL_NAME
  ) {
    return Promise.resolve(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        structuredContent: IDENTITY,
      },
    }));
  }
  return Promise.resolve(new Response("unexpected", { status: 500 }));
}

Deno.test("assertControlPlaneReady accepts exact health, discover, and lifecycle identity", async () => {
  await assertControlPlaneReady(IDENTITY, readyFetch);
});

Deno.test("assertControlPlaneReady fails closed on a foreign server identity", async () => {
  await assertRejects(
    () =>
      assertControlPlaneReady(IDENTITY, (input) => {
        if (input === CONTROL_PLANE_HEALTH_URL) {
          return Promise.resolve(jsonResponse({
            status: "ok",
            server: "other-console",
            version: "9.9.9",
          }));
        }
        return readyFetch(input);
      }),
    SidecarFailure,
    "GET /health",
  );
  await assertRejects(
    () =>
      assertControlPlaneReady(IDENTITY, (input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        if (body.method === "tools/call") {
          return Promise.resolve(jsonResponse({
            jsonrpc: "2.0",
            id: 1,
            result: {
              resultType: "complete",
              structuredContent: {
                ...IDENTITY,
                launchId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              },
            },
          }));
        }
        return readyFetch(input, init);
      }),
    SidecarFailure,
    "does not match this launch",
  );
  await assertRejects(
    () =>
      assertControlPlaneReady(IDENTITY, (input) => {
        if (input === CONTROL_PLANE_ENDPOINT) {
          return Promise.resolve(new Response("no", { status: 500 }));
        }
        return readyFetch(input);
      }),
    SidecarFailure,
  );
});
