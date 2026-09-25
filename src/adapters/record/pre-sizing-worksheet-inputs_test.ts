import { assertEquals, assertRejects } from "@std/assert";
import { persistAgentResourceText } from "../../testing/agent-resource-test-support.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  PRE_SIZING_WORKSHEET_AUTHOR_KIND,
  PRE_SIZING_WORKSHEET_RECORDING_STATUS,
  PRE_SIZING_WORKSHEET_SCHEMA,
  preSizingWorksheetClaimId,
  type PreSizingWorksheetProposal,
  type PreSizingWorksheetQuantity,
  type PreSizingWorksheetSource,
  RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
} from "../../domain/record/pre-sizing-worksheet.ts";
import { resolvePreSizingWorksheetInputs } from "./pre-sizing-worksheet-inputs.ts";

const AT = "2026-09-13T10:00:00.000Z";
const PROJECT = "project:worksheets";
const OPERATION =
  `${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.id}@${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.version}`;

Deno.test("worksheet inputs resolve a first revision against an empty basis", async () => {
  const root = await Deno.makeTempDir({ prefix: "worksheet-inputs-rev1-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "Hover current per motor.",
    });
    const sources = agentSources(persisted.reference);
    const resolved = await resolvePreSizingWorksheetInputs({
      projectId: PROJECT,
      base: emptyThread(),
      proposal: proposal({ sources }),
      dependencies: { captures: emptyCaptures(), resources: persisted.reopen },
    });
    assertEquals(
      resolved.claim.id,
      await preSizingWorksheetClaimId(PROJECT, "hover-power"),
    );
    assertEquals(resolved.claim.revision, 1);
    assertEquals(resolved.threadSourceArtifacts, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("worksheet inputs refuse a second first revision for one claim", async () => {
  const root = await Deno.makeTempDir({ prefix: "worksheet-inputs-dup1-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "Hover current per motor.",
    });
    const sources = agentSources(persisted.reference);
    const claimId = await preSizingWorksheetClaimId(PROJECT, "hover-power");
    const sealed = sealedWorksheet({
      claimId,
      worksheetId: "hover-power",
      revision: 1,
      title: "Hover power",
      quantities: quantities(),
      sources,
    });
    await assertRejects(
      () =>
        resolvePreSizingWorksheetInputs({
          projectId: PROJECT,
          base: threadWith(sealed.artifact),
          proposal: proposal({ sources }),
          dependencies: {
            captures: capturesOf(sealed),
            resources: persisted.reopen,
          },
        }),
      EngineeringProjectCommandError,
      "exact current worksheet head",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("worksheet inputs resolve a changed successor of the exact head", async () => {
  const root = await Deno.makeTempDir({ prefix: "worksheet-inputs-rev2-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "Hover current per motor.",
    });
    const sources = agentSources(persisted.reference);
    const claimId = await preSizingWorksheetClaimId(PROJECT, "hover-power");
    const sealed = sealedWorksheet({
      claimId,
      worksheetId: "hover-power",
      revision: 1,
      title: "Hover power",
      quantities: quantities(),
      sources,
    });
    const resolved = await resolvePreSizingWorksheetInputs({
      projectId: PROJECT,
      base: threadWith(sealed.artifact),
      proposal: proposal({
        revision: 2,
        title: "Hover power, revised",
        sources,
        predecessor: {
          artifactId: sealed.artifact.id,
          fingerprint: sealed.artifact.fingerprint,
          producerRunId: "run:rev1",
        },
      }),
      dependencies: { captures: capturesOf(sealed), resources: persisted.reopen },
    });
    assertEquals(resolved.claim.revision, 2);
    assertEquals(resolved.claim.predecessor?.artifactId, sealed.artifact.id);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("worksheet inputs refuse an identical successor and a stale branch", async () => {
  const root = await Deno.makeTempDir({ prefix: "worksheet-inputs-repeat-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "Hover current per motor.",
    });
    const sources = agentSources(persisted.reference);
    const claimId = await preSizingWorksheetClaimId(PROJECT, "hover-power");
    const first = sealedWorksheet({
      claimId,
      worksheetId: "hover-power",
      revision: 1,
      title: "Hover power",
      quantities: quantities(),
      sources,
    });
    const base = threadWith(first.artifact);
    const dependencies = {
      captures: capturesOf(first),
      resources: persisted.reopen,
    };
    await assertRejects(
      () =>
        resolvePreSizingWorksheetInputs({
          projectId: PROJECT,
          base,
          proposal: proposal({
            revision: 2,
            title: "Hover power",
            sources,
            predecessor: {
              artifactId: first.artifact.id,
              fingerprint: first.artifact.fingerprint,
              producerRunId: "run:rev1",
            },
          }),
          dependencies,
        }),
      EngineeringProjectCommandError,
      "no new record would be written",
    );
    const second = sealedWorksheet({
      claimId,
      worksheetId: "hover-power",
      revision: 2,
      title: "Hover power, revised",
      quantities: quantities(),
      sources,
    });
    await assertRejects(
      () =>
        resolvePreSizingWorksheetInputs({
          projectId: PROJECT,
          base: threadWith(first.artifact, second.artifact),
          proposal: proposal({
            revision: 2,
            title: "Hover power, branched",
            sources,
            predecessor: {
              artifactId: first.artifact.id,
              fingerprint: first.artifact.fingerprint,
              producerRunId: "run:rev1",
            },
          }),
          dependencies: {
            captures: capturesOf(first, second),
            resources: persisted.reopen,
          },
        }),
      EngineeringProjectCommandError,
      "exact current worksheet head",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("worksheet inputs surface a missing Thread source as invalid input", async () => {
  const root = await Deno.makeTempDir({ prefix: "worksheet-inputs-missing-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "Hover current per motor.",
    });
    await assertRejects(
      () =>
        resolvePreSizingWorksheetInputs({
          projectId: PROJECT,
          base: emptyThread(),
          proposal: proposal({
            sources: [{
              kind: "thread-artifact",
              artifactId: "no-such-artifact",
              fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
              producerRunId: "run:nowhere",
            }],
          }),
          dependencies: {
            captures: emptyCaptures(),
            resources: persisted.reopen,
          },
        }),
      EngineeringProjectCommandError,
      "absent, archived, or ambiguous",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function quantities(): PreSizingWorksheetQuantity[] {
  return [{
    id: "hover-current",
    label: "Hover current per motor",
    value: "3.25",
    unit: "A",
    sourceIndex: 0,
  }];
}

function agentSources(
  resourceRef: AgentResourceReference,
): PreSizingWorksheetSource[] {
  return [{ kind: "agent-resource", resourceRef }];
}

function proposal(input: {
  readonly revision?: number;
  readonly title?: string;
  readonly sources: PreSizingWorksheetSource[];
  readonly quantities?: PreSizingWorksheetQuantity[];
  readonly predecessor?: PreSizingWorksheetProposal["predecessor"];
}): PreSizingWorksheetProposal {
  return {
    worksheetId: "hover-power",
    revision: input.revision ?? 1,
    title: input.title ?? "Hover power",
    quantities: input.quantities ?? quantities(),
    sources: input.sources,
    ...(input.predecessor ? { predecessor: input.predecessor } : {}),
  };
}

function sealedWorksheet(input: {
  readonly claimId: string;
  readonly worksheetId: string;
  readonly revision: number;
  readonly title: string;
  readonly quantities: PreSizingWorksheetQuantity[];
  readonly sources: PreSizingWorksheetSource[];
}): { readonly artifact: ThreadArtifact; readonly text: string } {
  const fingerprint = {
    algorithm: "sha256" as const,
    digest: `${input.revision}`.repeat(64).slice(0, 64),
  };
  const artifact: ThreadArtifact = {
    id: `pre-sizing-worksheet-${fingerprint.digest}`,
    name: `Pre-sizing worksheet ${input.worksheetId} r${input.revision}`,
    kind: "document",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://pre-sizing-worksheet/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: OPERATION,
      runId: `run:rev${input.revision}`,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
  };
  const text = JSON.stringify({
    schemaVersion: PRE_SIZING_WORKSHEET_SCHEMA,
    operation: { ...RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION },
    mode: "documentary-evidence",
    recording: {
      status: PRE_SIZING_WORKSHEET_RECORDING_STATUS,
      authorKind: PRE_SIZING_WORKSHEET_AUTHOR_KIND,
    },
    projectId: PROJECT,
    trustedRunId: `run:rev${input.revision}`,
    linkedAt: AT,
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread:basis",
      revision: 1,
      subjectId: PROJECT,
    },
    claim: {
      id: input.claimId,
      revision: input.revision,
      worksheetId: input.worksheetId,
    },
    title: input.title,
    quantities: input.quantities,
    sources: input.sources,
    decision: {
      decisionId: "decision:test",
      inputFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    },
    parameters: [],
  });
  return { artifact, text };
}

function capturesOf(
  ...sealed: readonly { readonly artifact: ThreadArtifact; readonly text: string }[]
) {
  const texts = new Map(
    sealed.map((item) => [item.artifact.fingerprint.digest, item.text]),
  );
  return {
    read: (fingerprint: { readonly digest: string }) =>
      Promise.resolve(texts.get(fingerprint.digest)),
  };
}

function emptyCaptures() {
  return { read: () => Promise.resolve(undefined) };
}

function threadWith(...artifacts: ThreadArtifact[]): ThreadSnapshot {
  return { ...emptyThread(), artifacts };
}

function emptyThread(): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "thread:inputs",
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
      id: "change:inputs",
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
