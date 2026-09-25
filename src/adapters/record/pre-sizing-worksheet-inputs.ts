/** Recross pre-sizing worksheet inputs against one exact Thread basis. */
import type { AgentResourceExactReopener } from "../../application/ports/out/resource/agent-resource-exact-reopener.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  parsePreSizingWorksheetCapture,
  type PreSizingWorksheetCapture,
  preSizingWorksheetClaimId,
  type PreSizingWorksheetProposal,
  RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
} from "../../domain/record/pre-sizing-worksheet.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";

export interface PreSizingWorksheetInputDependencies {
  readonly captures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly resources: AgentResourceExactReopener;
}

export interface ResolvedPreSizingWorksheetInputs {
  readonly claim: PreSizingWorksheetCapture["claim"];
  readonly threadSourceArtifacts: readonly ThreadArtifact[];
}

export async function resolvePreSizingWorksheetInputs(input: {
  readonly projectId: string;
  readonly base: ThreadSnapshot;
  readonly proposal: PreSizingWorksheetProposal;
  readonly dependencies: PreSizingWorksheetInputDependencies;
}): Promise<ResolvedPreSizingWorksheetInputs> {
  const { projectId, base, proposal, dependencies } = input;
  const archived = archivedRefKeys(base);
  const threadSourceArtifacts: ThreadArtifact[] = [];
  for (const source of proposal.sources) {
    if (source.kind === "agent-resource") {
      try {
        await dependencies.resources.reopenExact(source.resourceRef);
      } catch (error) {
        reject(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    const matches = base.artifacts.filter((artifact) =>
      artifact.id === source.artifactId &&
      !archived.has(`artifact:${artifact.id}`)
    );
    if (matches.length !== 1) {
      reject(
        `Thread artifact ${source.artifactId} is absent, archived, or ambiguous on the worksheet basis.`,
      );
    }
    const artifact = matches[0]!;
    if (
      !fingerprintsEqual(artifact.fingerprint, source.fingerprint) ||
      artifact.producer.runId !== source.producerRunId
    ) {
      reject("The worksheet Thread source does not match its sealed identity.");
    }
    threadSourceArtifacts.push(artifact);
  }
  const claim = {
    id: await preSizingWorksheetClaimId(projectId, proposal.worksheetId),
    revision: proposal.revision,
    worksheetId: proposal.worksheetId,
  } as const;
  if (proposal.predecessor) {
    await assertPredecessorChain({
      base,
      proposal,
      predecessor: proposal.predecessor,
      captures: dependencies.captures,
      claimId: claim.id,
    });
    return {
      claim: { ...claim, predecessor: proposal.predecessor },
      threadSourceArtifacts,
    };
  }
  if (proposal.revision !== 1) {
    reject(
      "A pre-sizing worksheet without a predecessor must seal revision 1.",
    );
  }
  await assertLinearClaimHead({
    base,
    captures: dependencies.captures,
    claimId: claim.id,
    revision: 1,
  });
  return { claim, threadSourceArtifacts };
}

async function assertPredecessorChain(input: {
  readonly base: ThreadSnapshot;
  readonly proposal: PreSizingWorksheetProposal;
  readonly predecessor: NonNullable<PreSizingWorksheetProposal["predecessor"]>;
  readonly captures: PreSizingWorksheetInputDependencies["captures"];
  readonly claimId: string;
}): Promise<void> {
  const { base, proposal, predecessor, captures, claimId } = input;
  const archived = archivedRefKeys(base);
  const matches = base.artifacts.filter((artifact) =>
    artifact.id === predecessor.artifactId &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    reject(
      "The worksheet predecessor is absent, archived, or ambiguous on its basis.",
    );
  }
  const artifact = matches[0]!;
  if (
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !==
      `${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.id}@${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.version}` ||
    artifact.producer.runId !== predecessor.producerRunId ||
    !fingerprintsEqual(artifact.fingerprint, predecessor.fingerprint)
  ) {
    reject("The worksheet predecessor does not match its sealed identity.");
  }
  const text = await captures.read(predecessor.fingerprint);
  if (text === undefined) {
    reject("The worksheet predecessor capture is unavailable.");
  }
  const prior = parsePreSizingWorksheetCapture(JSON.parse(text));
  if (
    prior.claim.worksheetId !== proposal.worksheetId ||
    prior.claim.revision !== proposal.revision - 1
  ) {
    reject(
      "The worksheet predecessor must be the same worksheet at exactly revision minus one.",
    );
  }
  if (
    prior.title === proposal.title &&
    deterministicJson(prior.quantities) ===
      deterministicJson(proposal.quantities) &&
    deterministicJson(prior.sources) === deterministicJson(proposal.sources)
  ) {
    reject(
      "This worksheet repeats the same exact title, quantities and sources; no new record would be written.",
    );
  }
  await assertLinearClaimHead({
    base,
    captures,
    claimId,
    revision: proposal.revision,
  });
}

/**
 * One claim keeps one linear history: any sealed record at or past the
 * proposed revision means the proposal branches from a stale predecessor.
 */
async function assertLinearClaimHead(input: {
  readonly base: ThreadSnapshot;
  readonly captures: PreSizingWorksheetInputDependencies["captures"];
  readonly claimId: string;
  readonly revision: number;
}): Promise<void> {
  const { base, captures, claimId, revision } = input;
  const archived = archivedRefKeys(base);
  const operation =
    `${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.id}@${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.version}`;
  for (const artifact of base.artifacts) {
    if (
      artifact.producer.serverId !== "digital-thread" ||
      artifact.producer.tool !== operation ||
      archived.has(`artifact:${artifact.id}`)
    ) {
      continue;
    }
    const text = await captures.read(artifact.fingerprint);
    if (text === undefined) {
      reject(`The sealed worksheet capture ${artifact.id} is unavailable.`);
    }
    const sealed = parsePreSizingWorksheetCapture(JSON.parse(text));
    if (sealed.claim.id === claimId && sealed.claim.revision >= revision) {
      reject(
        "The proposal does not name the exact current worksheet head; seal a successor of the latest revision instead.",
      );
    }
  }
}

function reject(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}
