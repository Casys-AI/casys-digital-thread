import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  ProjectDiscoveryCommandService,
} from "../domain/project-discovery-command-service.ts";
import { ProjectDiscoveryHandoffService } from "../domain/project-discovery-handoff-service.ts";
import { FileEngineeringProjectRevisionStore } from "./engineering-project-store.ts";
import {
  DISCOVERY_OPERATOR_INTENT_HEADER,
  DISCOVERY_OPERATOR_INTENT_VALUE,
} from "./project-discovery-command-http.ts";
import {
  executeProjectDiscoveryHandoffOperatorCommand,
  parseProjectDiscoveryHandoffOperatorCommand,
  ProjectDiscoveryHandoffCommandHttpError,
  readProjectDiscoveryHandoffOperatorCommand,
} from "./project-discovery-handoff-command-http.ts";
import { FileProjectDiscoveryRevisionStore } from "./project-discovery-store.ts";

const NOW = "2026-08-02T04:30:00.000Z";

Deno.test("handoff browser command creates a project only from the durable approved brief", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-discovery-handoff-http-" });
  try {
    const discoveries = new FileProjectDiscoveryRevisionStore(
      `${directory}/discoveries`,
    );
    const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
    const discoveryService = new ProjectDiscoveryCommandService(discoveries, () => NOW);
    const approved = await approvedDiscovery(discoveryService);
    const handoff = new ProjectDiscoveryHandoffService(
      discoveries,
      projects,
      () => NOW,
    );
    const parsed = await readProjectDiscoveryHandoffOperatorCommand(commandRequest({
      schemaVersion: "project-discovery-handoff-command/1.0",
      commandId: "create-drone-project",
      discoveryId: "drone",
      expectedDiscoveryRevision: approved.revision,
      issuedAt: NOW,
      actor: { id: "reviewer" },
      command: {
        type: "project.create-from-approved-discovery",
        projectId: "drone-project",
        projectName: "  Deliver a reviewable drone demonstrator.  ",
      },
    }));
    const project = await executeProjectDiscoveryHandoffOperatorCommand(
      handoff,
      parsed,
    );

    assertEquals(project.revision, 1);
    assertEquals(project.project.name, "Deliver a reviewable drone demonstrator.");
    assertEquals(project.threadSnapshots, []);
    assertEquals(project.discoveryHandoff, {
      discoveryId: "drone",
      snapshotId: approved.id,
      revision: approved.revision,
      briefId: approved.brief!.id,
      approvedBriefFingerprint: approved.review!.inputFingerprint,
      approvedAt: approved.review!.decidedAt,
      approvedBy: { id: "reviewer", origin: "human" },
    });
    assertEquals(project.commandReceipts?.[0]?.actor, {
      id: "reviewer",
      origin: "human",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("handoff browser parser refuses a caller-supplied approval fingerprint or technical state", () => {
  assertThrows(
    () =>
      parseProjectDiscoveryHandoffOperatorCommand({
        schemaVersion: "project-discovery-handoff-command/1.0",
        commandId: "create-drone-project",
        discoveryId: "drone",
        expectedDiscoveryRevision: 3,
        issuedAt: NOW,
        actor: { id: "reviewer" },
        inputFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        command: {
          type: "project.create-from-approved-discovery",
          projectId: "drone-project",
          projectName: "Drone demonstrator",
          threadSnapshots: [{ snapshotId: "invented", revision: 1 }],
        },
      }),
    ProjectDiscoveryHandoffCommandHttpError,
  );
});

Deno.test("handoff browser command requires exact same-origin loopback intent", async () => {
  const body = {
    schemaVersion: "project-discovery-handoff-command/1.0",
    commandId: "create-drone-project",
    discoveryId: "drone",
    expectedDiscoveryRevision: 3,
    issuedAt: NOW,
    actor: { id: "reviewer" },
    command: {
      type: "project.create-from-approved-discovery",
      projectId: "drone-project",
      projectName: "Drone demonstrator",
    },
  };
  await assertRejects(
    () =>
      readProjectDiscoveryHandoffOperatorCommand(
        new Request("http://127.0.0.1:5174/api/project-handoffs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    ProjectDiscoveryHandoffCommandHttpError,
    "same-origin",
  );
});

async function approvedDiscovery(service: ProjectDiscoveryCommandService) {
  let discovery = await service.start(
    { kind: "agent", actorId: "guide" },
    {
      commandId: "start-drone-discovery",
      discoveryId: "drone",
      issuedAt: NOW,
      intent: "Build a reviewable drone demonstrator.",
    },
  );
  discovery = await service.proposeBrief(
    { kind: "agent", actorId: "guide" },
    {
      commandId: "propose-drone-brief",
      discoveryId: "drone",
      expectedRevision: discovery.revision,
      issuedAt: NOW,
      brief: {
        id: "drone-brief-v1",
        objective: "Deliver a reviewable drone demonstrator.",
        missionScenarios: ["Fly a controlled demonstration route"],
        successCriteria: ["Record planned verification evidence"],
        constraints: ["No certification claim from discovery"],
        intendedMarkets: ["Initial market unknown"],
        manufacturingJurisdictions: ["Manufacturing location unknown"],
        operatingJurisdictions: ["Operating jurisdiction unknown"],
        complianceTargets: ["Identify applicable rules from authoritative sources"],
        verificationPlan: ["Plan named analysis and test evidence"],
        exclusions: ["Production authorization"],
        assumptions: ["The first flight occurs in a controlled setting"],
        openQuestions: ["Which operating jurisdiction is intended?"],
      },
    },
  );
  return await service.approveBrief(
    { kind: "human", actorId: "reviewer" },
    {
      commandId: "approve-drone-brief",
      discoveryId: "drone",
      expectedRevision: discovery.revision,
      issuedAt: NOW,
      briefId: discovery.brief!.id,
      rationale: "Approved as a project planning basis.",
      inputFingerprint: discovery.review!.inputFingerprint,
    },
  );
}

function commandRequest(body: unknown): Request {
  const origin = "http://127.0.0.1:5174";
  return new Request(`${origin}/api/project-handoffs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      [DISCOVERY_OPERATOR_INTENT_HEADER]: DISCOVERY_OPERATOR_INTENT_VALUE,
    },
    body: JSON.stringify(body),
  });
}
