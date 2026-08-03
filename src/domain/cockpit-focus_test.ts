import { assertThrows } from "@std/assert";
import {
  COCKPIT_FOCUS_SCHEMA_VERSION,
  validateCockpitFocusSnapshot,
} from "./cockpit-focus.ts";

Deno.test("cockpit focus rejects extra fields at every persisted boundary", () => {
  const base = {
    schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
    workspaceId: "primary",
    revision: 1,
    commandId: "focus-1",
    selectedAt: "2026-08-03T12:00:00.000Z",
    selectedBy: { kind: "agent", actorId: "mcp:test@1" },
    target: { kind: "project", projectId: "drone" },
  };
  assertThrows(
    () => validateCockpitFocusSnapshot({ ...base, injected: true }),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () =>
      validateCockpitFocusSnapshot({
        ...base,
        target: { ...base.target, injected: true },
      }),
    TypeError,
    "unsupported field",
  );
});
