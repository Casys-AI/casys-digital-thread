import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ProjectDiscoveryCommandService } from "../domain/project-discovery-command-service.ts";
import {
  DISCOVERY_OPERATOR_INTENT_HEADER,
  DISCOVERY_OPERATOR_INTENT_VALUE,
  executeProjectDiscoveryOperatorCommand,
  parseProjectDiscoveryOperatorCommand,
  ProjectDiscoveryCommandHttpError,
  readProjectDiscoveryOperatorCommand,
} from "./project-discovery-command-http.ts";
import { FileProjectDiscoveryRevisionStore } from "./project-discovery-store.ts";

const NOW = "2026-08-02T04:30:00.000Z";

Deno.test("discovery browser command accepts a bounded human answer without source impersonation", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-discovery-http-" });
  try {
    const store = new FileProjectDiscoveryRevisionStore(directory);
    const service = new ProjectDiscoveryCommandService(store, () => NOW);
    await service.start(
      { kind: "agent", actorId: "guide" },
      {
        commandId: "start-1",
        discoveryId: "drone",
        issuedAt: NOW,
        intent: "Build a drone.",
      },
    );
    await service.proposeQuestion(
      { kind: "agent", actorId: "guide" },
      {
        commandId: "question-1",
        discoveryId: "drone",
        expectedRevision: 1,
        issuedAt: NOW,
        question: {
          id: "mission",
          prompt: "What should the drone do?",
          whyItMatters: "Mission determines the architecture.",
          recommendation: {
            value: "inspection",
            rationale: "A bounded first use.",
            confidence: "medium",
          },
          options: [{
            value: "inspection",
            label: "Inspection",
            consequences: "Prioritise stability.",
          }],
          allowUnknown: true,
          risk: "reversible",
          evidenceNeeded: [],
        },
      },
    );

    const request = commandRequest({
      schemaVersion: "project-discovery-command/1.0",
      commandId: "answer-1",
      discoveryId: "drone",
      expectedRevision: 2,
      issuedAt: NOW,
      actor: { id: "reviewer" },
      command: {
        type: "answer.record",
        answer: {
          id: "answer-mission-1",
          questionId: "mission",
          kind: "unknown",
        },
      },
    });
    const parsed = await readProjectDiscoveryOperatorCommand(request);
    const snapshot = await executeProjectDiscoveryOperatorCommand(
      service,
      store,
      parsed,
    );
    assertEquals(snapshot.revision, 3);
    assertEquals(snapshot.answers[0]?.source, {
      kind: "human",
      reference: "same-origin Discovery Workbench",
    });
    assertEquals(snapshot.answers[0]?.recordedBy, {
      id: "reviewer",
      origin: "human",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("discovery browser parser rejects hidden source and unknown values", () => {
  assertThrows(
    () =>
      parseProjectDiscoveryOperatorCommand({
        schemaVersion: "project-discovery-command/1.0",
        commandId: "answer-1",
        discoveryId: "drone",
        expectedRevision: 2,
        issuedAt: NOW,
        actor: { id: "reviewer" },
        command: {
          type: "answer.record",
          answer: {
            id: "answer-1",
            questionId: "mission",
            kind: "unknown",
            value: "invented",
            source: { kind: "tool", reference: "forged" },
          },
        },
      }),
    ProjectDiscoveryCommandHttpError,
  );
});

Deno.test("discovery browser command requires explicit same-origin loopback intent", async () => {
  const body = JSON.stringify({
    schemaVersion: "project-discovery-command/1.0",
    commandId: "answer-1",
    discoveryId: "drone",
    expectedRevision: 2,
    issuedAt: NOW,
    actor: { id: "reviewer" },
    command: {
      type: "answer.record",
      answer: { id: "answer-1", questionId: "mission", kind: "unknown" },
    },
  });
  await assertRejects(
    () =>
      readProjectDiscoveryOperatorCommand(
        new Request(
          "http://127.0.0.1:5174/api/project-discoveries/drone/commands",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          },
        ),
      ),
    ProjectDiscoveryCommandHttpError,
    "same-origin",
  );
});

function commandRequest(body: unknown): Request {
  const origin = "http://127.0.0.1:5174";
  return new Request(`${origin}/api/project-discoveries/drone/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      [DISCOVERY_OPERATOR_INTENT_HEADER]: DISCOVERY_OPERATOR_INTENT_VALUE,
    },
    body: JSON.stringify(body),
  });
}
