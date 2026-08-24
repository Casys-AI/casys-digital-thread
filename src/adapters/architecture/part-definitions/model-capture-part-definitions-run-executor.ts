/** Read-only, exact successor capture for a generic architecture tip. */
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  archivedRefKeys,
  type ContentFingerprint,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
  PART_DEFINITIONS_CAPTURE_STATEMENT,
} from "../../../domain/architecture/part-definitions/part-definitions-capture.ts";
import { parseSysonModelSeedCapture } from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  type ExactArchitectureCapture,
  extractPartDefinitionsFromCapture,
  parseExactArchitectureCapture,
} from "../renderer/architecture-capture.ts";
import {
  parseExactPartDefinitionsCapture,
  PART_DEFINITIONS_CAPTURE_KIND,
  PART_DEFINITIONS_CAPTURE_SCHEMA,
  PART_DEFINITIONS_CAPTURE_SCOPE,
  toArchitectureCapturePartDefinitions,
} from "./part-definitions-capture.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  FileCaptureStore,
  PART_DEFINITIONS_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";
import { extractPartDefinitionStructures } from "../renderer/architecture-structure-extractor.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import type { FilePartDefinitionsPublicationStore } from "./file-part-definitions-publication-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";
import {
  assertArchitectureArtifactNotRemoved,
  findArchitectureArtifact,
} from "../renderer/model-write-architecture-run-executor.ts";
import {
  assertThreadSnapshotLineageIntact,
  ThreadSnapshotLineageIntegrityError,
} from "../../shared/stores/thread-snapshot-lineage.ts";

type CaptureInputs = Readonly<{
  base: ThreadSnapshot;
  tip: ThreadArtifact;
  architecture: ExactArchitectureCapture;
  seedArtifact: ThreadArtifact;
  editingContextId: string;
  rootPackageId: string;
}>;

export interface ModelCapturePartDefinitionsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ModelCapturePartDefinitionsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly captures: FileCaptureStore<"part-definitions-capture">;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly publications: FilePartDefinitionsPublicationStore;
}

/**
 * SysON is read-only, but a durable publication record bridges the local
 * snapshot-save to project-attachment boundary. It is append-only and lets a
 * crash resume without a second provider read.
 */
export class ModelCapturePartDefinitionsRunExecutor {
  constructor(
    private readonly d: ModelCapturePartDefinitionsRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ModelCapturePartDefinitionsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw denied(
        "Only an authenticated agent can capture generic PartDefinitions.",
      );
    }
    const initial = await this.project(command.projectId);
    const initialRun = requireRun(initial, command.runId);
    shape(initial, initialRun);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(initialRun),
      async () => {
        let claimed = false;
        let persisted = false;
        let publicationPersisted = false;
        let publicationAttempted = false;
        try {
          let project = await this.project(command.projectId);
          let run = requireRun(project, command.runId);
          if (run.status === "completed") {
            const durable = await this.d.publications.read(
              project.project.id,
              run.id,
            );
            if (!durable) {
              throw denied(
                "A completed PartDefinitions run has no durable publication record to verify or repair.",
              );
            }
            return await this.resumePublication(origin, command, project, run);
          }
          await assertThreadWriteBasisAvailable(project, run);
          if (run.status === "publishing" || run.status === "running") {
            const durable = await this.d.publications.read(
              project.project.id,
              run.id,
            );
            if (durable) {
              return await this.resumePublication(
                origin,
                command,
                project,
                run,
              );
            }
          }
          if (run.status === "publishing") {
            return await this.resumePublication(origin, command, project, run);
          }
          await this.inputs(project, run);
          await this.d.commands.claimRun(origin, {
            ...command,
            commandId: step(command.commandId, "claim"),
            summary: "Started the read-only generic PartDefinitions capture.",
          });
          claimed = true;
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          claim(project, run, origin);
          const input = await this.inputs(project, run);
          const sealed = extractPartDefinitionsFromCapture(input.architecture);
          const live = await extractPartDefinitionStructures(
            this.d.syson,
            input.editingContextId,
            sealed.map((part) => ({ id: part.id, label: part.label })),
          );
          const mapped = toArchitectureCapturePartDefinitions(live);
          if (deterministicJson(mapped) !== deterministicJson(sealed)) {
            throw denied(
              "Live SysON parent→usage→target does not match the sealed architecture PartDefinitions.",
            );
          }
          const capturedAt = requiredStart(run);
          const record = buildRecord(input, run, capturedAt, sealed);
          const fingerprint = await sha256Fingerprint(record);
          const text = deterministicJson(record);
          await this.d.captures.save(fingerprint, text);
          if (await this.d.captures.read(fingerprint) !== text) {
            throw new Error(
              "The persisted PartDefinitions capture did not read back exactly.",
            );
          }
          const artifact = partDefinitionArtifact(
            fingerprint,
            run.id,
            capturedAt,
            input.tip.id,
            this.d.captures.uriFor(fingerprint),
          );
          const snapshot = materialize(
            input.base,
            artifact,
            input.tip,
            capturedAt,
            input.architecture.scopeRoot.id,
          );
          publicationAttempted = true;
          await this.d.publications.save({
            schemaVersion: "part-definitions-publication/1.0",
            projectId: command.projectId,
            runId: run.id,
            fingerprint,
            snapshot,
          });
          publicationPersisted = true;
          await this.d.snapshots.save(snapshot);
          persisted = true;
          const readback = await freshSnapshot(this.d.snapshots, snapshot.id);
          if (
            !readback ||
            deterministicJson(readback) !== deterministicJson(snapshot)
          ) {
            throw new Error(
              "The persisted PartDefinitions snapshot did not read back exactly.",
            );
          }
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          if (run.status === "running") {
            await this.d.commands.publishRun(origin, {
              ...command,
              commandId: step(command.commandId, "publish"),
              expectedRevision: project.revision,
              summary: "Publishing the verified generic PartDefinitions capture.",
            });
          }
          project = await this.project(command.projectId);
          run = requireRun(project, command.runId);
          if (run.status === "publishing") {
            await this.d.commands.completeRun(origin, {
              ...command,
              commandId: step(command.commandId, "complete"),
              expectedRevision: project.revision,
              summary:
                "Recorded the exact generic PartDefinitions product-structure capture.",
              resultSnapshot: snapshotRef(snapshot),
              evidenceRefs: [
                currentPartDefinitionsEvidenceRef(
                  snapshot,
                  artifact,
                  input.tip.id,
                ),
              ],
            });
          }
          return complete(await this.project(command.projectId), command);
        } catch (error) {
          const recoveredPublication = publicationAttempted && !publicationPersisted
            ? await this.d.publications.read(command.projectId, command.runId)
              .catch(
                () => undefined,
              )
            : undefined;
          if (
            claimed && !persisted && !publicationPersisted &&
            !recoveredPublication
          ) {
            await this.fail(origin, command);
          }
          throw error;
        }
      },
    );
  }

  private async resumePublication(
    origin: EngineeringProjectCommandOrigin,
    command: ModelCapturePartDefinitionsRunExecutorCommand,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<EngineeringProjectSnapshot> {
    shape(project, run);
    const publication = await this.d.publications.read(
      project.project.id,
      run.id,
    );
    if (!publication) {
      throw denied(
        "The publishing PartDefinitions run has no durable exact publication record; it will not re-query SysON.",
      );
    }
    const input = await this.inputs(project, run);
    const basis = requireBasis(run);
    if (
      basis.kind !== "thread-snapshot" ||
      publication.snapshot.subject.id !== basis.subjectId ||
      publication.snapshot.revision !== basis.revision + 1 ||
      publication.snapshot.previous?.snapshotId !== basis.snapshotId ||
      publication.snapshot.previous.revision !== basis.revision
    ) {
      throw denied(
        "The durable PartDefinitions publication does not advance the exact run basis.",
      );
    }
    const capture = await this.d.captures.read(publication.fingerprint);
    if (!capture) {
      throw denied(
        "The publishing PartDefinitions run has no exact durable capture; it will not re-query SysON.",
      );
    }
    const expected = await reconstructPublication(input, run, capture);
    if (
      deterministicJson(expected.fingerprint) !==
        deterministicJson(publication.fingerprint) ||
      deterministicJson(expected.snapshot) !==
        deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The durable PartDefinitions publication does not reconstruct from the exact capture and run.",
      );
    }
    let persisted = await freshSnapshot(
      this.d.snapshots,
      publication.snapshot.id,
    );
    if (!persisted) {
      await this.d.snapshots.save(publication.snapshot);
      persisted = await freshSnapshot(
        this.d.snapshots,
        publication.snapshot.id,
      );
    }
    if (
      !persisted ||
      deterministicJson(persisted) !== deterministicJson(publication.snapshot)
    ) {
      throw denied(
        "The publishing PartDefinitions run has no exact durable capture and snapshot pair; it will not re-query SysON.",
      );
    }
    const artifact = partDefinitionArtifact(
      publication.fingerprint,
      run.id,
      requiredStart(run),
      input.tip.id,
      this.d.captures.uriFor(publication.fingerprint),
    );
    if (run.status === "completed") {
      const expectedResult = snapshotRef(publication.snapshot);
      const expectedEvidence = [{
        snapshotId: publication.snapshot.id,
        snapshotRevision: publication.snapshot.revision,
        kind: "artifact" as const,
        id: artifact.id,
      }];
      if (
        deterministicJson(run.resultSnapshot) !==
          deterministicJson(expectedResult) ||
        deterministicJson(run.evidenceRefs) !==
          deterministicJson(expectedEvidence)
      ) {
        throw denied(
          "The completed PartDefinitions run does not attach the exact durable publication evidence.",
        );
      }
      return complete(project, command);
    }
    if (run.status === "running") {
      await this.d.commands.publishRun(origin, {
        ...command,
        commandId: step(command.commandId, "publish"),
        expectedRevision: project.revision,
        summary: "Publishing the verified generic PartDefinitions capture.",
      });
      project = await this.project(command.projectId);
      run = requireRun(project, command.runId);
    }
    if (run.status !== "publishing") throw unexpectedStatus(run, "publishing");
    await this.d.commands.completeRun(origin, {
      ...command,
      commandId: step(command.commandId, "complete"),
      expectedRevision: project.revision,
      summary: "Recorded the exact generic PartDefinitions product-structure capture.",
      resultSnapshot: snapshotRef(publication.snapshot),
      evidenceRefs: [{
        snapshotId: publication.snapshot.id,
        snapshotRevision: publication.snapshot.revision,
        kind: "artifact",
        id: artifact.id,
      }],
    });
    return complete(await this.project(command.projectId), command);
  }

  private async inputs(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<CaptureInputs> {
    const basis = requireBasis(run);
    const base = await exactSnapshot(this.d.snapshots, basis);
    try {
      await assertThreadSnapshotLineageIntact(base, this.d.snapshots);
    } catch (error) {
      if (error instanceof ThreadSnapshotLineageIntegrityError) {
        throw denied(
          `The PartDefinitions basis ThreadSnapshot has an invalid predecessor lineage: ${error.message}`,
        );
      }
      throw error;
    }
    await assertArchitectureArtifactNotRemoved(base, this.d.snapshots);
    let tip: ThreadArtifact | undefined;
    try {
      tip = findArchitectureArtifact(base);
    } catch (error) {
      if (error instanceof EngineeringProjectCommandError) throw error;
      throw error;
    }
    if (!tip) {
      throw denied(
        "The current ThreadSnapshot has no generic architecture capture tip.",
      );
    }
    const item = project.workItems.find((candidate) => candidate.id === run.workItemId);
    const binding = item?.operation?.bindings[0];
    if (
      binding?.name !== "architecture" ||
      binding.source.kind !== "thread-entity" ||
      deterministicJson(binding.source.reference) !==
        deterministicJson({
          snapshotId: base.id,
          snapshotRevision: base.revision,
          kind: "artifact",
          id: tip.id,
        })
    ) {
      throw denied(
        "The run does not bind the exact current generic architecture tip.",
      );
    }
    const text = await this.d.architectureCaptures.read(tip.fingerprint);
    if (!text) {
      throw denied(
        "The exact content-addressed architecture capture is not readable.",
      );
    }
    let architecture: ExactArchitectureCapture;
    try {
      architecture = parseExactArchitectureCapture(JSON.parse(text));
    } catch (error) {
      throw denied(
        `The architecture capture is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (deterministicJson(architecture) !== text) {
      throw denied(
        "The architecture capture did not round-trip to its stored bytes.",
      );
    }
    if (architecture.trustedRunId !== tip.producer.runId) {
      throw denied(
        "The architecture capture trustedRunId does not match its Thread artifact producer.",
      );
    }
    if (
      tip.uri !==
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${tip.fingerprint.digest}` ||
      tip.id !== `architecture-${tip.fingerprint.digest}`
    ) {
      throw denied(
        "The architecture artifact does not have the exact generic identity.",
      );
    }
    const already = base.artifacts.filter((artifact) =>
      artifact.uri?.startsWith(PART_DEFINITIONS_CAPTURE_URI_PREFIX) &&
      artifact.inputArtifactIds.includes(tip.id)
    );
    if (already.length > 0) {
      throw denied("The same architecture artifact cannot be captured twice.");
    }

    const seedBytes = await this.d.seedCaptures.read(
      architecture.seed.fingerprint,
    );
    if (!seedBytes) {
      throw denied(
        "The SysON seed capture referenced by the architecture capture is not durably readable.",
      );
    }
    let seedRecord: unknown;
    let seedCapture: ReturnType<typeof parseSysonModelSeedCapture>;
    try {
      seedRecord = JSON.parse(seedBytes);
      seedCapture = parseSysonModelSeedCapture(seedRecord);
    } catch (error) {
      throw denied(
        `The SysON seed capture is not a valid canonical seed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const seedFingerprint = await sha256Fingerprint(seedRecord);
    if (
      deterministicJson(seedFingerprint) !==
        deterministicJson(architecture.seed.fingerprint)
    ) {
      throw denied(
        "The SysON seed capture bytes do not hash to the fingerprint named by the architecture capture.",
      );
    }
    const seedArtifact = one(
      base.artifacts.filter((candidate) =>
        candidate.id === architecture.seed.artifactId
      ),
      "architecture capture seed artifact",
    );
    if (
      seedArtifact.producer.tool !== "syson_model_create" ||
      seedArtifact.uri?.startsWith(
          "casys://syson-model-seed-capture/sha256/",
        ) !==
        true ||
      seedCapture.trustedRunId !== seedArtifact.producer.runId
    ) {
      throw denied(
        "The architecture capture seed is not the exact SysON model-seed artifact on this snapshot.",
      );
    }
    if (seedCapture.lineage.baseSnapshot.subjectId !== base.subject.id) {
      throw denied(
        "The SysON model-seed capture does not name this subject's documentary baseline.",
      );
    }
    return {
      base,
      tip,
      architecture,
      seedArtifact,
      editingContextId: seedCapture.normalizedResults.project.editingContextId,
      rootPackageId: seedCapture.normalizedResults.rootPackage.id,
    };
  }

  private async project(id: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.d.projects.get(id);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${id} does not exist.`,
      );
    }
    return project;
  }

  private async fail(
    origin: EngineeringProjectCommandOrigin,
    command: ModelCapturePartDefinitionsRunExecutorCommand,
  ): Promise<void> {
    try {
      const p = await this.project(command.projectId);
      const r = requireRun(p, command.runId);
      if (
        r.status === "running" && r.claimedBy?.origin === origin.kind &&
        r.claimedBy.id === origin.actorId
      ) {
        await this.d.commands.failRun(origin, {
          ...command,
          commandId: step(command.commandId, "fail"),
          expectedRevision: p.revision,
          summary: "PartDefinitions capture stopped before publication.",
          code: "model-capture-part-definitions-not-published",
          message:
            "The read-only PartDefinitions capture did not publish technical evidence.",
        });
      }
    } catch { /* original refusal wins */ }
  }
}

async function reconstructPublication(
  input: CaptureInputs,
  run: EngineeringAgentRun,
  text: string,
): Promise<
  Readonly<{ fingerprint: ContentFingerprint; snapshot: ThreadSnapshot }>
> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw denied("The durable PartDefinitions capture is not JSON.");
  }
  let parsed;
  try {
    parsed = parseExactPartDefinitionsCapture(raw);
  } catch (error) {
    throw denied(
      `The durable PartDefinitions capture is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const sealed = extractPartDefinitionsFromCapture(input.architecture);
  const expected = buildRecord(input, run, requiredStart(run), sealed);
  if (deterministicJson(parsed) !== deterministicJson(expected)) {
    throw denied(
      "The durable PartDefinitions capture does not attest this exact operation and run.",
    );
  }
  const fingerprint = await sha256Fingerprint(expected);
  const artifact = partDefinitionArtifact(
    fingerprint,
    run.id,
    requiredStart(run),
    input.tip.id,
    `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
  );
  return {
    fingerprint,
    snapshot: materialize(
      input.base,
      artifact,
      input.tip,
      requiredStart(run),
      input.architecture.scopeRoot.id,
    ),
  };
}

function buildRecord(
  input: CaptureInputs,
  run: EngineeringAgentRun,
  capturedAt: string,
  partDefinitions: ReturnType<typeof extractPartDefinitionsFromCapture>,
) {
  return {
    schemaVersion: PART_DEFINITIONS_CAPTURE_SCHEMA,
    kind: PART_DEFINITIONS_CAPTURE_KIND,
    scope: PART_DEFINITIONS_CAPTURE_SCOPE,
    statement: PART_DEFINITIONS_CAPTURE_STATEMENT,
    capturedAt,
    trustedRunId: run.id,
    operation: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
    architecture: {
      artifactId: input.tip.id,
      fingerprint: input.tip.fingerprint,
      producerRunId: input.tip.producer.runId,
      uri: input.tip.uri,
      schemaVersion: input.architecture.schemaVersion,
      packageName: input.architecture.packageName,
      systemName: input.architecture.systemName,
      scopeRoot: input.architecture.scopeRoot,
      semanticRoot: input.architecture.semanticRoot,
    },
    seed: {
      artifactId: input.seedArtifact.id,
      fingerprint: input.architecture.seed.fingerprint,
      producerRunId: input.seedArtifact.producer.runId,
      editingContextId: input.editingContextId,
      rootPackageId: input.rootPackageId,
    },
    partDefinitions,
  } as const;
}

function shape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  if (
    operation?.id !== MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.id ||
    operation.version !== MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "architecture"
  ) {
    throw denied(
      "This executor may run only the generic model.capture-part-definitions@1 operation.",
    );
  }
}

function claim(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  shape(project, run);
  if (
    run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) throw unexpectedStatus(run, "running");
}

function complete(
  project: EngineeringProjectSnapshot,
  command: ModelCapturePartDefinitionsRunExecutorCommand,
): EngineeringProjectSnapshot {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw denied(
      "The PartDefinitions run did not complete through this exact command.",
    );
  }
  return project;
}

function denied(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_input", message);
}

function step(commandId: string, action: string): string {
  return `${commandId}:model-capture-part-definitions:${action}`;
}

function partDefinitionArtifact(
  fingerprint: ContentFingerprint,
  runId: string,
  capturedAt: string,
  architectureId: string,
  uri: string,
): ThreadArtifact {
  return {
    id: `part-definitions-${fingerprint.digest}`,
    name: "PartDefinition product structure",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_element_children", runId },
    inputArtifactIds: [architectureId],
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
  };
}

function materialize(
  base: ThreadSnapshot,
  artifact: ThreadArtifact,
  architecture: ThreadArtifact,
  capturedAt: string,
  packageId: string,
): ThreadSnapshot {
  const consumption = {
    id: `consume-${architecture.id}-by-${artifact.id}`,
    artifactId: architecture.id,
    consumer: artifact.producer,
    observedFingerprint: architecture.fingerprint,
    verifiedAt: capturedAt,
    status: "verified" as const,
  };
  const applied = applyThreadSnapshotExtensionIfNew(base, {
    id: `capture-${artifact.id}`,
    name: "Capture the PartDefinition structures from the exact architecture",
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [{
      id: `link-${artifact.id}-derived-from-${architecture.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: architecture.id },
      rationale:
        "The read-only product-structure bundle re-read the exact generic architecture artifact.",
    }, {
      id: `link-${consumption.id}-uses-${architecture.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: architecture.id },
      rationale:
        "The executor used only the architecture artifact attached to the basis.",
    }],
    bindingProofs: [{ provider: "syson", kind: "package", id: packageId }],
  }, { appliedAt: capturedAt });
  if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
    throw new Error(
      "PartDefinitions evidence did not create exactly one descendant snapshot.",
    );
  }
  return applied.snapshot;
}

function currentPartDefinitionsEvidenceRef(
  snapshot: ThreadSnapshot,
  expected: ThreadArtifact,
  architectureTipId: string,
): EngineeringThreadEntityRef {
  if (
    !isExactCurrentPartDefinitionsEvidence(
      expected,
      expected,
      architectureTipId,
    )
  ) {
    throw denied(
      "The server-built PartDefinitions artifact is not exact current-run evidence.",
    );
  }
  if (archivedRefKeys(snapshot).has(`artifact:${expected.id}`)) {
    throw denied(
      "The expected PartDefinitions evidence is archived and cannot be attached.",
    );
  }
  let found: ThreadArtifact | undefined;
  for (const candidate of snapshot.artifacts) {
    if (candidate.id !== expected.id) continue;
    if (found) {
      throw denied(
        "The successor snapshot contains more than one occurrence of the expected PartDefinitions artifact identity.",
      );
    }
    found = candidate;
  }
  if (!found) {
    throw denied(
      "The successor snapshot does not contain the expected PartDefinitions artifact identity.",
    );
  }
  if (
    !isExactCurrentPartDefinitionsEvidence(found, expected, architectureTipId)
  ) {
    throw denied(
      "The successor snapshot PartDefinitions artifact is not the exact artifact built for this run.",
    );
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: found.id,
  };
}

function isExactCurrentPartDefinitionsEvidence(
  candidate: ThreadArtifact,
  expected: ThreadArtifact,
  architectureTipId: string,
): boolean {
  const digest = expected.fingerprint.digest;
  if (
    expected.id !== `part-definitions-${digest}` ||
    expected.name !== "PartDefinition product structure" ||
    expected.version !== digest ||
    deterministicJson(expected.fingerprint) !==
      deterministicJson({ algorithm: "sha256", digest }) ||
    expected.uri !== `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    expected.kind !== "sysml-model" ||
    expected.mediaType !== "application/json" ||
    expected.producer.serverId !== "syson" ||
    expected.producer.tool !== "syson_element_children" ||
    expected.inputArtifactIds.length !== 1 ||
    expected.inputArtifactIds[0] !== architectureTipId ||
    expected.freshness.status !== "fresh" ||
    expected.freshness.invalidatedByChangeIds.length !== 0
  ) {
    return false;
  }
  return deterministicJson(candidate) === deterministicJson(expected);
}

function one<T>(values: readonly T[], name: string): T {
  if (values.length !== 1) throw denied(`Expected exactly one ${name}.`);
  return values[0]!;
}

async function exactSnapshot(
  store: ThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw denied(
      "The exact basis ThreadSnapshot required by the PartDefinitions run is not readable.",
    );
  }
  try {
    return validateThreadSnapshot(snapshot);
  } catch (error) {
    throw denied(
      `The basis ThreadSnapshot is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function freshSnapshot(
  store: ThreadSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  const fresh = store as ThreadSnapshotStore & {
    getFresh?: (id: string) => Promise<ThreadSnapshot | undefined>;
  };
  return fresh.getFresh
    ? await fresh.getFresh(snapshotId)
    : await store.get(snapshotId);
}
