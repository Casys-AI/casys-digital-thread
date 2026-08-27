import { assertEquals, assertThrows } from "@std/assert";
import {
  FeaSmokeGateExit,
  settleFeaSmokeGate,
  validateSysonProjectListProbe,
} from "./verify-fea-live-smoke.ts";

Deno.test("FEA live smoke preserves success and maps sentinels to exact exit codes", async () => {
  const observed: number[] = [];
  await settleFeaSmokeGate(() => Promise.resolve(), (code) => observed.push(code));
  await settleFeaSmokeGate(
    () => Promise.reject(new FeaSmokeGateExit(1)),
    (code) => observed.push(code),
  );
  await settleFeaSmokeGate(
    () => Promise.reject(new FeaSmokeGateExit(2)),
    (code) => observed.push(code),
  );
  assertEquals(observed, [1, 2]);
});

Deno.test("FEA live smoke maps an unexpected error to exit 1", async () => {
  let exitCode: number | undefined;
  await settleFeaSmokeGate(
    () => Promise.reject(new Error("unexpected-test-error")),
    (code) => exitCode = code,
  );
  assertEquals(exitCode, 1);
});

Deno.test("FEA live smoke validates bounded SysON project-list pagination", () => {
  assertEquals(
    validateSysonProjectListProbe({
      projects: [],
      pageInfo: { count: 0, hasNextPage: false, endCursor: null },
    }),
    undefined,
  );
});

Deno.test("FEA live smoke rejects malformed SysON project-list pages", () => {
  assertThrows(
    () => validateSysonProjectListProbe({ pageInfo: {} }),
    Error,
    "no projects array",
  );
  assertThrows(
    () =>
      validateSysonProjectListProbe({
        projects: [{ id: "one", name: "One" }],
        pageInfo: { count: 1, hasNextPage: false, endCursor: "cursor" },
      }),
    Error,
    "unexpectedly matched",
  );
  assertThrows(
    () =>
      validateSysonProjectListProbe({
        projects: [],
        pageInfo: { count: 1, hasNextPage: false, endCursor: null },
      }),
    Error,
    "count is not zero",
  );
  assertThrows(
    () =>
      validateSysonProjectListProbe({
        projects: [],
        pageInfo: { count: 0, hasNextPage: true, endCursor: "cursor" },
      }),
    Error,
    "unexpectedly truncated",
  );
  assertThrows(
    () =>
      validateSysonProjectListProbe({
        projects: [],
        pageInfo: { count: 0, hasNextPage: false, endCursor: "cursor" },
      }),
    Error,
    "returned an endCursor",
  );
});

Deno.test("FEA live smoke source contains no SysON mutation tool call", async () => {
  const source = await Deno.readTextFile(
    new URL("./verify-fea-live-smoke.ts", import.meta.url),
  );
  const sysonCalls = [...source.matchAll(/name:\s*"(syson_[^"]+)"/g)].map(
    (match) => match[1],
  );
  assertEquals(sysonCalls, ["syson_project_list"]);
  assertEquals(source.includes("gate-smoke-readonly-probe-"), true);
  assertEquals(
    source.includes("arguments: { filter: readonlyProbeFilter, first: 1 }"),
    true,
  );
  assertEquals(source.includes("syson_project_create"), false);
  assertEquals(source.includes("syson_project_delete"), false);
});
