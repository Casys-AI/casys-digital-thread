import { assertRejects } from "@std/assert";
import { persistAgentResourceText } from "../../testing/agent-resource-test-support.ts";
import { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { FileAgentResourceStore } from "../resource/file-agent-resource-store.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { reopenExactCaptureSources } from "./documentary-clause-response-history.ts";

const AT = "2026-09-13T10:00:00.000Z";

Deno.test("history reopens a valid agent-resource source against its signed identity", async () => {
  const root = await Deno.makeTempDir({ prefix: "clause-history-valid-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "Bench evidence does not claim outdoor use.",
    });
    await reopenExactCaptureSources(
      agentSources(persisted.reference),
      emptyThread(),
      persisted.reopen,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("history surfaces unavailable when an agent-resource source is missing", async () => {
  const root = await Deno.makeTempDir({ prefix: "clause-history-missing-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "source",
    });
    const missing = new ReopenAgentResource(
      new FileAgentResourceStore(`${root}/empty`),
    );
    await assertRejects(
      () =>
        reopenExactCaptureSources(
          agentSources(persisted.reference),
          emptyThread(),
          missing,
        ),
      TypeError,
      "not present in draft CAS",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("history surfaces unavailable when an agent-resource source is tampered", async () => {
  const root = await Deno.makeTempDir({ prefix: "clause-history-tamper-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "source",
    });
    const digest = persisted.reference.fingerprint.digest;
    await Deno.writeFile(`${root}/${digest}`, new Uint8Array([9, 9, 9, 9]));
    await assertRejects(
      () =>
        reopenExactCaptureSources(
          agentSources(persisted.reference),
          emptyThread(),
          persisted.reopen,
        ),
      TypeError,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function agentSources(resourceRef: AgentResourceReference) {
  return [{ kind: "agent-resource" as const, resourceRef }];
}

function emptyThread(): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "thread:history",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "subject",
      name: "Test",
      kind: "system",
      version: "1",
      modelArtifactId: "model",
    },
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change:history",
      name: "base",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}
