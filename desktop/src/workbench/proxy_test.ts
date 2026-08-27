import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.14";
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_ORIGIN } from "./contracts.ts";
import { isAllowedWorkbenchPath, proxyDesktopWorkbenchRequest } from "./proxy.ts";

const TOKEN = "a".repeat(64);
const SESSION = { origin: WORKBENCH_ORIGIN, accessToken: TOKEN } as const;

Deno.test("Desktop Workbench proxy forwards only bounded read headers and its host token", async () => {
  let upstreamUrl = "";
  let upstreamInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = (input, init) => {
    upstreamUrl = String(input);
    upstreamInit = init;
    return Promise.resolve(
      new Response("projection", {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Casys-Data-Source": "engineering-project-plan",
          "Set-Cookie": "credential=must-not-pass",
          "X-Upstream-Origin": WORKBENCH_ORIGIN,
        },
      }),
    );
  };
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/workbench?view=summary", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer renderer-secret",
        Cookie: "provider=secret",
        [WORKBENCH_ACCESS_HEADER]: "renderer-token",
      },
    }),
    { session: SESSION, fetchImpl },
  );

  assertEquals(upstreamUrl, `${WORKBENCH_ORIGIN}/api/thread/workbench?view=summary`);
  assertEquals(upstreamInit?.method, "GET");
  const headers = new Headers(upstreamInit?.headers);
  assertEquals(headers.get(WORKBENCH_ACCESS_HEADER), TOKEN);
  assertEquals(headers.get("accept"), "application/json");
  assertEquals(headers.get("authorization"), null);
  assertEquals(headers.get("cookie"), null);
  assertEquals(response?.status, 200);
  assertEquals(await response?.text(), "projection");
  assertEquals(response?.headers.get("set-cookie"), null);
  assertEquals(response?.headers.get("x-upstream-origin"), null);
  assertEquals(
    response?.headers.get("x-casys-data-source"),
    "engineering-project-plan",
  );
  assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
  assertFalse(JSON.stringify([...response!.headers]).includes(TOKEN));
});

Deno.test("Desktop Workbench proxy translates HEAD to a bodyless upstream GET", async () => {
  let upstreamMethod = "";
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/native-workbench.html", { method: "HEAD" }),
    {
      session: SESSION,
      fetchImpl: (_input, init) => {
        upstreamMethod = init?.method ?? "";
        return Promise.resolve(
          new Response("must be stripped", {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        );
      },
    },
  );
  assertEquals(upstreamMethod, "GET");
  assertEquals(await response?.text(), "");
  assertStringIncludes(
    response?.headers.get("content-security-policy") ?? "",
    "connect-src 'self'",
  );
});

Deno.test("Desktop Workbench proxy streams SSE and preserves only Last-Event-ID", async () => {
  let upstreamHeaders = new Headers();
  const response = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/workbench/events", {
      headers: {
        "Last-Event-ID": "revision-7",
        "X-Provider-Key": "must-not-pass",
      },
    }),
    {
      session: SESSION,
      fetchImpl: (_input, init) => {
        upstreamHeaders = new Headers(init?.headers);
        return Promise.resolve(
          new Response("event: snapshot\ndata: {}\n\n", {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          }),
        );
      },
    },
  );
  assertEquals(upstreamHeaders.get("last-event-id"), "revision-7");
  assertEquals(upstreamHeaders.get("x-provider-key"), null);
  assertEquals(response?.headers.get("x-accel-buffering"), "no");
  assertEquals(await response?.text(), "event: snapshot\ndata: {}\n\n");
});

Deno.test("Desktop Workbench proxy rejects methods, commands, and traversal before fetch", async () => {
  let fetches = 0;
  const fetchImpl: typeof fetch = () => {
    fetches += 1;
    return Promise.resolve(new Response("unexpected"));
  };
  const rejected = await proxyDesktopWorkbenchRequest(
    new Request("http://desktop.local/api/thread/workbench", { method: "POST" }),
    { session: SESSION, fetchImpl },
  );
  assertEquals(rejected?.status, 405);
  assertEquals(rejected?.headers.get("allow"), "GET, HEAD");
  assertEquals(fetches, 0);
  assertEquals(
    await proxyDesktopWorkbenchRequest(
      new Request("http://desktop.local/mcp"),
      { session: SESSION, fetchImpl },
    ),
    undefined,
  );
  for (
    const path of [
      "/healthz",
      "/api/project/commands",
      "/assets/%252e%252e/secret.js",
      "/assets/a\\secret.js",
      "/api/thread/assets/a/b",
      "/api/draft-assets/not-a-digest",
    ]
  ) assertFalse(isAllowedWorkbenchPath(path), path);
  assertEquals(fetches, 0);
});
