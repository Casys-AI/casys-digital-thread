import { assertEquals, assertRejects } from "@std/assert";
import {
  materializeSysonInventorySubject,
  sysonModelInventoryExtension,
} from "./syson-model-inventory-extension.ts";

Deno.test("SysON inventory remains evidence of a missing criterion, never a requirement", async () => {
  const extension = await sysonModelInventoryExtension(
    capture(),
    "state/local/syson-inventory/capture.json",
    "coffee-machine-cm01",
  );
  assertEquals(
    extension.artifacts[0].name,
    "SysON model inventory · 2 requirements · 0 constraints",
  );
  assertEquals(extension.requirements, []);
  assertEquals(extension.evaluations, []);
  assertEquals(extension.violations, []);
});

Deno.test("SysON inventory rejects a claimed count which differs from captured elements", async () => {
  const value = capture();
  value.inventory.count = 3;
  await assertRejects(
    () => sysonModelInventoryExtension(value, "capture.json", "coffee-machine-cm01"),
    Error,
    "must equal",
  );
});

Deno.test("SysON inventory rejects duplicate model element identities", async () => {
  const value = capture();
  value.inventory.results.push(value.inventory.results[0]);
  value.inventory.count++;
  await assertRejects(
    () => sysonModelInventoryExtension(value, "capture.json", "coffee-machine-cm01"),
    Error,
    "duplicate",
  );
});

Deno.test("SysON inventory can seed the canonical CoffeeMachine system subject", async () => {
  const snapshot = await materializeSysonInventorySubject(
    capture(),
    "capture.json",
    {
      schemaVersion: "1.0",
      authority: "workspace-declared",
      rationale: "Explicit provider identity mapping.",
      subject: {
        id: "coffee-machine-cm01",
        name: "CoffeeMachine CM-01",
        kind: "system",
      },
      bindings: [{ provider: "syson", kind: "project", id: "project-id" }],
    },
  );
  assertEquals(snapshot.subject.id, "coffee-machine-cm01");
  assertEquals(snapshot.subject.modelArtifactId, snapshot.artifacts[0].id);
  assertEquals(snapshot.requirements, []);
});

function capture() {
  return {
    schemaVersion: "captured-syson-model-inventory/1.0",
    capturedAt: "2026-08-01T04:00:00.000Z",
    source: "observed-live-read-only",
    project: {
      id: "project-id",
      name: "Casys CoffeeMachine CM-01",
      editingContextId: "editing-context-id",
    },
    provider: {
      endpoint: "http://127.0.0.1:3009/mcp",
      tool: "syson_search",
    },
    inventory: {
      query: ".*",
      count: 2,
      results: [
        { id: "requirement-a", kind: "entity=RequirementUsage", label: "A" },
        { id: "requirement-b", kind: "entity=RequirementUsage", label: "B" },
      ],
    },
  };
}
