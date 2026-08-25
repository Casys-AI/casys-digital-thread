import { assertEquals } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  briefSourceIdFor,
  PROJECT_BRIEF_SOURCE_ANALYSIS_PROFILE,
  ProjectBriefSourceAnalyzer,
} from "./project-brief-source-analyzer.ts";

const V2_BRIEF = {
  contractVersion: "2.0" as const,
  briefId: "project-a:brief",
  id: "brief-snapshot-2",
  revision: 2,
  previous: { snapshotId: "brief-snapshot-1", revision: 1 },
  items: [
    {
      id: "objective",
      kind: "objective",
      statement: "Keep the water hot.",
      sourceRefs: [{ kind: "intent", reference: "conversation:1" }],
    },
    {
      id: "mission",
      kind: "mission-scenario",
      statement: "Heat water during a nominal beverage cycle.",
      sourceRefs: [{ kind: "intent", reference: "conversation:1" }],
    },
    {
      id: "gate-thermal",
      kind: "success-criterion",
      statement: "Temperature must remain stable.",
      sourceRefs: [{ kind: "document", reference: "spec:thermal" }],
      dependsOnItemIds: ["objective"],
    },
  ],
  proposedAt: "2026-08-11T09:00:00.000Z",
  proposedBy: { id: "agent:planner", origin: "agent" as const },
};

Deno.test("ProjectBriefSourceAnalyzer promotes only explicit V2 gate dependencies", async () => {
  const sourceText = deterministicJson(V2_BRIEF);
  const sourceId = await briefSourceIdFor(
    V2_BRIEF.briefId,
    V2_BRIEF.id,
    V2_BRIEF.revision,
  );
  const bundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText,
  });

  assertEquals(bundle.policy, {
    profile: PROJECT_BRIEF_SOURCE_ANALYSIS_PROFILE,
    status: "passed",
    findings: [],
  });
  assertEquals(
    bundle.symbols.map(({ kind, name }) => ({ kind, name })).sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    [
      { kind: "brief-item", name: "gate-thermal" },
      { kind: "brief-item", name: "mission" },
      { kind: "brief-item", name: "objective" },
    ],
  );
  assertEquals(
    bundle.symbols.every((symbol) => /^brief-item:[a-f0-9]{64}$/.test(symbol.id)),
    true,
  );
  assertEquals(
    bundle.dependencies.map(({ kind, fromSymbolId, toSymbolId }) => ({
      kind,
      fromSymbolId,
      toSymbolId,
    })),
    [{
      kind: "declared-dependency",
      fromSymbolId: bundle.symbols.find((symbol) => symbol.name === "objective")!.id,
      toSymbolId: bundle.symbols.find((symbol) => symbol.name === "gate-thermal")!.id,
    }],
  );
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.source.fingerprint.digest === "f".repeat(64), false);
});

Deno.test("ProjectBriefSourceAnalyzer keeps a project-command actor id opaque", async () => {
  const brief = {
    ...V2_BRIEF,
    proposedBy: { id: "mcp:paired-chat@1", origin: "agent" as const },
  };
  const sourceId = await briefSourceIdFor(brief.briefId, brief.id, brief.revision);
  const bundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: deterministicJson(brief),
  });
  assertEquals(bundle.policy.status, "passed");
  for (const actorId of ["", " agent "]) {
    const rejected = await new ProjectBriefSourceAnalyzer().analyze({
      sourceId,
      role: "brief",
      language: "plain-text",
      sourceText: deterministicJson({
        ...brief,
        proposedBy: { id: actorId, origin: "agent" },
      }),
    });
    assertEquals(rejected.policy.status, "rejected");
  }
});

Deno.test("ProjectBriefSourceAnalyzer leaves historical V1 gates unresolved", async () => {
  const v1 = structuredClone(V2_BRIEF) as Record<string, unknown>;
  delete v1.contractVersion;
  const items = v1.items as Array<Record<string, unknown>>;
  for (const item of items) delete item.dependsOnItemIds;
  const sourceId = await briefSourceIdFor("project-a:brief", "brief-snapshot-2", 2);
  const bundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: deterministicJson(v1),
  });

  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.dependencies, []);
  assertEquals(bundle.unresolvedConstructs.map(({ kind }) => kind), [
    "brief-v1-gate-dependencies",
  ]);
});

Deno.test("ProjectBriefSourceAnalyzer rejects non-canonical or invalid V2 gate declarations", async () => {
  const sourceId = await briefSourceIdFor("project-a:brief", "brief-snapshot-2", 2);
  const selfDependent = structuredClone(V2_BRIEF);
  selfDependent.items[1].dependsOnItemIds = ["gate-thermal"];
  const invalid = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: deterministicJson(selfDependent),
  });
  const nonCanonical = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: `${deterministicJson(V2_BRIEF)}\n`,
  });

  assertEquals(invalid.policy.status, "rejected");
  assertEquals(nonCanonical.policy.status, "rejected");
  assertEquals(invalid.symbols, []);
  assertEquals(nonCanonical.dependencies, []);
});

Deno.test("ProjectBriefSourceAnalyzer rejects a structurally inadmissible brief", async () => {
  const sourceId = await briefSourceIdFor("project-a:brief", "brief-snapshot-2", 2);
  const missingSource = structuredClone(V2_BRIEF);
  missingSource.items[0].sourceRefs = [];
  const bundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: deterministicJson(missingSource),
  });
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.symbols, []);
});

Deno.test("ProjectBriefSourceAnalyzer accepts an exact V2 verification authority and refuses another owner", async () => {
  const sourceId = await briefSourceIdFor("project-a:brief", "brief-snapshot-2", 2);
  const admitted = structuredClone(V2_BRIEF) as typeof V2_BRIEF & {
    items: Array<Record<string, unknown>>;
  };
  admitted.items.push({
    id: "verify-assembly",
    kind: "verification-activity",
    statement: "Observe the exact assembly integrity method.",
    sourceRefs: [{ kind: "document", reference: "method:assembly" }],
    dependsOnItemIds: ["gate-thermal"],
    verificationAuthority: { id: "assembly-integrity", version: "1.0" },
  });
  const passed = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: deterministicJson(admitted),
  });
  assertEquals(passed.policy.status, "passed");

  const wrongOwner = structuredClone(admitted);
  wrongOwner.items[2]!.verificationAuthority = {
    id: "assembly-integrity",
    version: "1.0",
  };
  const rejected = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId,
    role: "brief",
    language: "plain-text",
    sourceText: deterministicJson(wrongOwner),
  });
  assertEquals(rejected.policy.status, "rejected");
});

Deno.test("brief source identity is injective across delimiter-bearing ids", async () => {
  const left = await briefSourceIdFor("x", "y:snapshot:z", 2);
  const right = await briefSourceIdFor("x:snapshot:y", "z", 2);
  assertEquals(left === right, false);
});
