import { assertEquals, assertThrows } from "@std/assert";
import { applyThreadSnapshotExtension } from "../../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import {
  materializeErpNextCoffeeMachineBomDetailExtension,
  materializeErpNextCoffeeMachineBomExtension,
} from "./erpnext-coffee-machine-extension.ts";

Deno.test("ERPNext CoffeeMachine extension preserves provider identity and observed values", async () => {
  const extension = await materializeErpNextCoffeeMachineBomExtension(capture());

  assertEquals(extension.subjectId, "erpnext-item-CASYS-CM01");
  assertEquals(extension.providerSubject, {
    provider: "erpnext",
    kind: "item",
    id: "CASYS-CM01",
  });
  assertEquals(extension.artifacts.map((artifact) => artifact.kind), [
    "bom",
    "evidence",
  ]);
  assertEquals(
    extension.observations.map((observation) => ({
      metric: observation.metric,
      quantity: observation.quantity,
    })),
    [
      {
        metric: "bom_quantity_per_finished_good",
        quantity: { value: 1, unit: "Nos" },
      },
      {
        metric: "erpnext_bin_rows_returned",
        quantity: { value: 0, unit: "1" },
      },
    ],
  );
  assertEquals(extension.requirements, []);
  assertEquals(extension.evaluations, []);
  assertEquals(extension.violations, []);
});

Deno.test("ERPNext extension attaches only after an explicit subject identity mapping", async () => {
  const extension = await materializeErpNextCoffeeMachineBomExtension(capture());
  const linked = applyThreadSnapshotExtension(providerSubjectRoot(), extension);
  assertEquals(linked.revision, 2);
  assertEquals(linked.artifacts.length, 3);
  assertEquals(linked.observations.length, 2);

  assertThrows(
    () => applyThreadSnapshotExtension(bracketRoot(), extension),
    Error,
    "targets erpnext-item-CASYS-CM01",
  );
});

Deno.test("ERPNext BOM detail extension fingerprints the exact component rows", async () => {
  const extension = await materializeErpNextCoffeeMachineBomDetailExtension(
    capture(),
    { sourceUri: "state/local/capture.json" },
  );
  assertEquals(extension.artifacts.length, 1);
  assertEquals(extension.artifacts[0].producer.tool, "erpnext_bom_get");
  assertEquals(extension.artifacts[0].uri, "state/local/capture.json#bomDetail");
  assertEquals(extension.artifacts[0].id.startsWith("erpnext-bom-detail-"), true);
  assertEquals(extension.name, "Capture ERPNext BOM detail with 1 component rows");
});

function providerSubjectRoot(): ThreadSnapshot {
  return root("erpnext-item-CASYS-CM01", "Coffee Machine CM-01");
}

function bracketRoot(): ThreadSnapshot {
  return root("coffee-machine-support-bracket", "CoffeeMachine support bracket");
}

function root(subjectId: string, subjectName: string): ThreadSnapshot {
  const at = "2026-08-01T04:59:00.000Z";
  const artifactId = "workspace-declared-subject-identity";
  const digest = "a".repeat(64);
  return {
    schemaVersion: "1.0",
    id: `${subjectId}:r1`,
    revision: 1,
    generatedAt: at,
    subject: {
      id: subjectId,
      name: subjectName,
      kind: "assembly",
      version: "1",
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "workspace-subject-declaration",
      name: "Workspace-declared subject identity",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "create-workspace-subject-identity",
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded the subject identity declaration.",
        afterFingerprint: { algorithm: "sha256", digest },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Workspace subject identity declaration",
      kind: "document",
      version: "1",
      fingerprint: { algorithm: "sha256", digest },
      producer: {
        serverId: "workspace",
        tool: "identity_manifest_read",
        runId: "workspace-subject-declaration",
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "identity-declaration-created",
      relation: "changes",
      from: { kind: "change", id: "create-workspace-subject-identity" },
      to: { kind: "artifact", id: artifactId },
      rationale: "The declaration is captured as the subject model artifact.",
    }],
    proposedActions: [],
  };
}

function capture() {
  return {
    schemaVersion: "erpnext-coffee-machine-bom/2.0",
    capturedAt: "2026-08-01T05:00:00.000Z",
    itemCode: "CASYS-CM01",
    itemName: "Coffee Machine CM-01",
    providerSubject: { provider: "erpnext", kind: "item", id: "CASYS-CM01" },
    bom: {
      tool: "erpnext_bom_list",
      arguments: { item: "CASYS-CM01", is_active: true, is_default: true, limit: 2 },
      structuredContent: {
        doctype: "BOM",
        count: 1,
        data: [{
          name: "BOM-CASYS-CM01-001",
          item: "CASYS-CM01",
          item_name: "Coffee Machine CM-01",
          quantity: 1,
          uom: "Nos",
          is_active: 1,
          is_default: 1,
          total_cost: 0,
        }],
      },
    },
    bomDetail: {
      tool: "erpnext_bom_get",
      arguments: { name: "BOM-CASYS-CM01-001" },
      structuredContent: {
        data: {
          name: "BOM-CASYS-CM01-001",
          item: "CASYS-CM01",
          items: [{
            idx: 1,
            item_code: "CASYS-CM01-ENC",
            item_name: "CM-01 Enclosure",
            qty: 1,
            uom: "Nos",
          }],
        },
      },
    },
    stock: {
      tool: "erpnext_stock_balance",
      arguments: { item_code: "CASYS-CM01", limit: 50 },
      structuredContent: { doctype: "Bin", count: 0, data: [] },
    },
  };
}
