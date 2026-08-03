import { assertEquals } from "@std/assert";
import type { ProjectDiscoverySnapshot } from "../domain/project-discovery.ts";
import { isProjectDiscoverySnapshot } from "./src/project/discovery-contract.ts";
import { buildProjectDiscoveryView } from "./src/project/discovery-model.ts";

const DIGEST = "a".repeat(64);

const DISCOVERY: ProjectDiscoverySnapshot = {
  schemaVersion: "1.0",
  id: "discovery-snapshot-1",
  discoveryId: "drone-discovery",
  revision: 1,
  generatedAt: "2026-08-02T09:00:00Z",
  status: "discovering",
  intent: {
    statement: "Build a drone that can be manufactured at a known cost.",
    capturedAt: "2026-08-02T08:58:00Z",
    capturedBy: { id: "reviewer", origin: "human" },
  },
  questions: [
    {
      id: "usage",
      prompt: "Where and how will the drone be used?",
      whyItMatters: "The mission shapes range, payload and the evidence needed later.",
      recommendation: {
        value: "inspection",
        rationale: "Inspection is a bounded first mission that can be tested safely.",
        confidence: "medium",
      },
      options: [
        {
          value: "inspection",
          label: "Outdoor inspection",
          consequences: "Prioritises stability, range and a useful camera payload.",
        },
        {
          value: "indoor",
          label: "Indoor operation",
          consequences: "Prioritises compact dimensions and obstacle tolerance.",
        },
      ],
      allowUnknown: true,
      risk: "material",
      evidenceNeeded: ["Target operating environment"],
      proposedAt: "2026-08-02T08:59:00Z",
      proposedBy: { id: "guide-agent", origin: "agent" },
    },
    {
      id: "production-volume",
      prompt: "How many units should the first build cover?",
      whyItMatters: "Volume changes manufacturing choices and cost confidence.",
      recommendation: {
        value: "prototype",
        rationale: "A prototype batch exposes unknowns before committing tooling.",
        confidence: "high",
      },
      options: [
        {
          value: "prototype",
          label: "One to five prototypes",
          consequences: "Favours adaptable fabrication over dedicated tooling.",
        },
      ],
      allowUnknown: true,
      risk: "reversible",
      evidenceNeeded: ["Expected first-year quantity"],
      proposedAt: "2026-08-02T08:59:30Z",
      proposedBy: { id: "guide-agent", origin: "agent" },
    },
  ],
  answers: [
    {
      id: "answer-usage-1",
      questionId: "usage",
      kind: "unknown",
      source: { kind: "human", reference: "discovery workbench" },
      recordedAt: "2026-08-02T09:00:00Z",
      recordedBy: { id: "reviewer", origin: "human" },
    },
  ],
  commandReceipts: [{
    commandId: "command-1",
    type: "discovery.start",
    actor: { id: "reviewer", origin: "human" },
    issuedAt: "2026-08-02T08:58:00Z",
    appliedAt: "2026-08-02T09:00:00Z",
    requestFingerprint: { algorithm: "sha256", digest: DIGEST },
    resultingSnapshot: { snapshotId: "discovery-snapshot-1", revision: 1 },
  }],
};

const REVIEWABLE_DISCOVERY: ProjectDiscoverySnapshot = {
  ...DISCOVERY,
  status: "awaiting-review",
  answers: [
    {
      id: "answer-usage-reviewed",
      questionId: "usage",
      kind: "provided",
      value: "inspection",
      source: { kind: "human", reference: "discovery workbench" },
      recordedAt: "2026-08-02T09:01:00Z",
      recordedBy: { id: "reviewer", origin: "human" },
    },
    {
      id: "answer-volume-reviewed",
      questionId: "production-volume",
      kind: "provided",
      value: "prototype",
      source: { kind: "human", reference: "discovery workbench" },
      recordedAt: "2026-08-02T09:02:00Z",
      recordedBy: { id: "reviewer", origin: "human" },
    },
  ],
  brief: {
    id: "brief-1",
    objective: "Validate a manufacturable inspection-drone prototype.",
    missionScenarios: ["Outdoor visual inspection"],
    successCriteria: ["A reviewable build cost and verified flight envelope"],
    constraints: ["Prototype batch of no more than five units"],
    intendedMarkets: ["European Union"],
    manufacturingJurisdictions: ["France"],
    operatingJurisdictions: ["France"],
    complianceTargets: ["Candidate EU unmanned-aircraft operating path"],
    verificationPlan: ["Structural simulation and controlled flight tests"],
    exclusions: ["Passenger transport"],
    assumptions: ["Visual-line-of-sight operation"],
    openQuestions: [],
    proposedAt: "2026-08-02T09:03:00Z",
    proposedBy: { id: "guide-agent", origin: "agent" },
  },
  review: {
    briefId: "brief-1",
    status: "pending",
    inputFingerprint: { algorithm: "sha256", digest: DIGEST },
    requestedAt: "2026-08-02T09:04:00Z",
  },
};

Deno.test("discovery browser guard accepts the domain contract", () => {
  assertEquals(isProjectDiscoverySnapshot(structuredClone(DISCOVERY)), true);
  assertEquals(
    isProjectDiscoverySnapshot(structuredClone(REVIEWABLE_DISCOVERY)),
    true,
  );
});

Deno.test("discovery browser guard rejects malformed and invented answers", () => {
  const malformed = structuredClone(DISCOVERY) as unknown as {
    questions: Array<Record<string, unknown>>;
  };
  delete malformed.questions[0]!.whyItMatters;
  assertEquals(isProjectDiscoverySnapshot(malformed), false);

  const invented = structuredClone(DISCOVERY) as unknown as {
    answers: Array<Record<string, unknown>>;
  };
  invented.answers[0]!.value = "quietly assumed";
  assertEquals(isProjectDiscoverySnapshot(invented), false);
});

Deno.test("discovery view advances after an explicit unknown without hiding it", () => {
  const view = buildProjectDiscoveryView(DISCOVERY);

  assertEquals(view.activeQuestion?.id, "production-volume");
  assertEquals(view.progress.clarified, 0);
  assertEquals(view.progress.open, 1);
  assertEquals(view.progress.label, "0 topics clarified · 1 open");
  assertEquals(view.progress.phaseLabel, "Current question");
});

Deno.test("discovery view honors answer supersession and exposes one next question", () => {
  const answered: ProjectDiscoverySnapshot = {
    ...structuredClone(DISCOVERY),
    answers: [
      ...DISCOVERY.answers,
      {
        id: "answer-usage-2",
        questionId: "usage",
        kind: "provided",
        value: "inspection",
        source: { kind: "human", reference: "discovery workbench" },
        supersedesAnswerId: "answer-usage-1",
        recordedAt: "2026-08-02T09:01:00Z",
        recordedBy: { id: "reviewer", origin: "human" },
      },
      {
        id: "answer-volume-1",
        questionId: "production-volume",
        kind: "provided",
        value: "prototype",
        source: { kind: "human", reference: "discovery workbench" },
        recordedAt: "2026-08-02T09:02:00Z",
        recordedBy: { id: "reviewer", origin: "human" },
      },
    ],
  };

  const view = buildProjectDiscoveryView(answered);
  assertEquals(view.activeQuestion, undefined);
  assertEquals(view.progress.clarified, 2);
  assertEquals(view.progress.open, 0);
  assertEquals(view.progress.phaseLabel, "Agent preparing the next question");
});

Deno.test("discovery view exposes a brief as a conversation record", () => {
  const view = buildProjectDiscoveryView(REVIEWABLE_DISCOVERY);

  assertEquals(view.activeQuestion, undefined);
  assertEquals(view.statusLabel, "Brief ready to discuss");
  assertEquals(view.progress.label, "2 topics clarified · 0 open");
  assertEquals(view.progress.phaseLabel, "Discovery pass complete");
});
