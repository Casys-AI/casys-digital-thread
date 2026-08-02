import { assertEquals, assertThrows } from "@std/assert";
import type { ProjectDiscoverySnapshot } from "./project-discovery.ts";
import {
  collectProjectDiscoveryIssues,
  validateProjectDiscoverySnapshot,
} from "./project-discovery-validation.ts";

Deno.test("ProjectDiscoverySnapshot validation is exact, immutable and independent from ThreadSnapshot", () => {
  const snapshot = validateProjectDiscoverySnapshot(initialFixture());

  assertEquals(snapshot.status, "discovering");
  assertEquals(snapshot.intent.statement, "Build a useful product.");
  assertEquals(Object.isFrozen(snapshot), true);
  assertEquals(Object.isFrozen(snapshot.intent), true);

  const untrusted = {
    ...initialFixture(),
    threadSnapshots: [{ snapshotId: "latest", revision: 1 }],
  };
  const issues = collectProjectDiscoveryIssues(untrusted);
  assertEquals(
    issues.some((item) =>
      item.code === "unsupported_field" && item.path === "$.threadSnapshots"
    ),
    true,
  );
});

Deno.test("ProjectDiscoverySnapshot requires a complete immutable command ledger", () => {
  const incomplete = {
    ...initialFixture(),
    revision: 2,
    previous: { snapshotId: "discovery:r1", revision: 1 },
  };

  const issues = collectProjectDiscoveryIssues(incomplete);
  assertEquals(
    issues.some((item) => item.code === "incomplete_command_ledger"),
    true,
  );
  assertEquals(
    issues.some((item) => item.code === "missing_current_receipt"),
    true,
  );
});

Deno.test("ProjectDiscoverySnapshot rejects a brief without explicit market, jurisdiction, compliance and verification context", () => {
  const invalid = {
    ...initialFixture(),
    status: "awaiting-review",
    brief: {
      id: "brief-1",
      objective: "A bounded objective.",
      missionScenarios: ["Nominal mission"],
      successCriteria: ["Measured success"],
      constraints: [],
      exclusions: [],
      assumptions: [],
      openQuestions: [],
      proposedAt: "2026-08-02T10:01:00.000Z",
      proposedBy: { id: "agent:test", origin: "agent" },
    },
    review: {
      briefId: "brief-1",
      status: "pending",
      inputFingerprint: fingerprint("b"),
      requestedAt: "2026-08-02T10:01:00.000Z",
    },
  };

  assertThrows(
    () => validateProjectDiscoverySnapshot(invalid),
    Error,
    "complianceTargets",
  );
});

function initialFixture(): ProjectDiscoverySnapshot {
  return {
    schemaVersion: "1.0",
    id: "discovery:r1",
    discoveryId: "discovery-1",
    revision: 1,
    generatedAt: "2026-08-02T10:00:00.000Z",
    status: "discovering",
    intent: {
      statement: "Build a useful product.",
      capturedAt: "2026-08-02T10:00:00.000Z",
      capturedBy: { id: "agent:test", origin: "agent" },
    },
    questions: [],
    answers: [],
    commandReceipts: [{
      commandId: "start-1",
      type: "discovery.start",
      actor: { id: "agent:test", origin: "agent" },
      issuedAt: "2026-08-02T09:59:00.000Z",
      appliedAt: "2026-08-02T10:00:00.000Z",
      requestFingerprint: fingerprint("a"),
      resultingSnapshot: { snapshotId: "discovery:r1", revision: 1 },
    }],
  };
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}
