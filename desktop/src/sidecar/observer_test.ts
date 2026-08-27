import { assertEquals } from "jsr:@std/assert@1.0.14";
import { COMPOSE_UNAVAILABLE_ERROR } from "./contracts.ts";
import { UnavailableComposeObserver } from "./observer.ts";

Deno.test("UnavailableComposeObserver is fail-closed and does not execute Docker", async () => {
  const before = Deno.permissions.querySync({ name: "run" }).state;
  const observed = await new UnavailableComposeObserver().observe([
    { id: "syson" },
    { id: "calculix" },
  ]);
  assertEquals(observed.get("syson"), {
    runtimeAvailable: false,
    present: false,
    error: COMPOSE_UNAVAILABLE_ERROR,
  });
  assertEquals(observed.get("calculix")?.runtimeAvailable, false);
  assertEquals(Deno.permissions.querySync({ name: "run" }).state, before);
});
