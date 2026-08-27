import { assertEquals } from "jsr:@std/assert@1.0.14";
import { ENGINEERING_WORKBENCH_SCHEMA } from "../../../src/presentation/workbench/engineering/schema.ts";
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_ORIGIN } from "../workbench/contracts.ts";
import { createWorkbenchProjectFocusAuthority } from "./workbench-project-focus.ts";

const SESSION = Object.freeze({
  origin: WORKBENCH_ORIGIN,
  accessToken: "a".repeat(64),
});

Deno.test("Workbench project focus authority reads the authenticated current projection", async () => {
  let request: { readonly url: string; readonly init?: RequestInit } | undefined;
  const authority = createWorkbenchProjectFocusAuthority(SESSION, {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), init };
      return Promise.resolve(Response.json({
        schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
        surface: "evidence",
        project: { project: { id: "coffee-machine" } },
      }));
    }) as typeof fetch,
  });

  assertEquals(await authority.currentProjectId(), "coffee-machine");
  assertEquals(request?.url, `${WORKBENCH_ORIGIN}/api/thread/workbench`);
  assertEquals(request?.init?.method, "GET");
  assertEquals(request?.init?.cache, "no-store");
  assertEquals(request?.init?.redirect, "error");
  assertEquals(
    new Headers(request?.init?.headers).get(WORKBENCH_ACCESS_HEADER),
    SESSION.accessToken,
  );
});

Deno.test("Workbench project focus authority fails closed on absence and malformed state", async () => {
  const responses: Array<() => Promise<Response>> = [
    () =>
      Promise.resolve(Response.json({ error: "cockpit_focus_not_selected" }, {
        status: 409,
      })),
    () =>
      Promise.resolve(Response.json({
        schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
        surface: "evidence",
        project: { project: { id: "../foreign" } },
      })),
    () => Promise.reject(new Error("Workbench unavailable")),
  ];
  for (const response of responses) {
    const authority = createWorkbenchProjectFocusAuthority(SESSION, {
      fetch: (() => response()) as typeof fetch,
    });
    assertEquals(await authority.currentProjectId(), undefined);
  }
});
