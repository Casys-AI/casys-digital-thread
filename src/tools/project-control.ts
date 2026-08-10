import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import { deterministicJson } from "../domain/kernel/deterministic-json.ts";
import { assertProposalMatchesOperationGrammar } from "../orchestration/operations/proposal-validation.ts";
import type { RegisteredProjectRunExecutor } from "../adapters/registered-project-run-executor.ts";
import type { EngineeringProjectCommandService } from "../domain/project/engineering-project-command-service.ts";
import type { McpToolClient } from "../adapters/mcp/http-mcp-tool-client.ts";
import type { FileCaptureStore } from "../adapters/captures/file-capture-store.ts";
import type { ProjectReviewIntentStore } from "../adapters/stores/file-project-review-intent-store.ts";
import type {
  ProjectReviewIntent,
  ProjectReviewIntentRecord,
} from "../domain/project/project-review-intent.ts";
import { isApprovalBoundProjectReviewIntent } from "../domain/project/project-review-intent.ts";
import {
  captureGeometryBundleDraft,
  captureGeometryDraft,
  geometryBundleManifestFromDraft,
} from "../adapters/captures/geometry-draft-capture.ts";
import {
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryComponentBinding,
  type GeometryExportFormat,
  type GeometryManifest,
} from "../domain/platform/geometry-proposal.ts";
import {
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  type GeometryBundleExportFormat,
  type GeometryBundleManifest,
  type GeometryBundleOccurrence,
} from "../domain/platform/geometry-bundle.ts";
import type {
  EngineeringBasisRef,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringProjectStartingPoint,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkOwner,
} from "../domain/project/engineering-project.ts";
import type {
  ContentFingerprint,
  ThreadEntityKind,
} from "../domain/thread/thread-snapshot.ts";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * These commands mutate only the durable EngineeringProject aggregate. They do
 * not directly execute an external engineering tool and are not safe for
 * speculative or automatic retries without their durable command id.
 */
const PROJECT_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Same-command retries resume the server-owned local execution safely. */
const PROJECT_EXECUTION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Signed elicitation request state makes same-command retries safe. */
const PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Agent receipt changes only the review-intent outbox, never project truth. */
const REVIEW_INTENT_ACKNOWLEDGEMENT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const REVIEW_INTENT_NO_COMMENT_RATIONALE =
  "Workbench review requested validation without an additional reviewer comment.";

const OBJECT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const;

// Unbounded lists bloat the capture JSON and, once per-part exports are added
// in v2, would multiply provider dispatch time proportionally.
const MAX_GEOMETRY_COMPONENTS_V1 = 32;

const COMMAND_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description:
    "Stable command id. Reuse it verbatim, with identical arguments, when retrying an uncertain call.",
} as const;

const PROJECT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description: "Engineering project identity from project_snapshot.",
} as const;

const EXPECTED_REVISION = {
  type: "integer",
  minimum: 1,
  description:
    "Optimistic EngineeringProject revision from the latest project_snapshot.",
} as const;

const ISSUED_AT = {
  type: "string",
  description:
    "Stable ISO timestamp for this command. Preserve it together with commandId on retry.",
} as const;

const THREAD_ENTITY_KINDS = [
  "artifact",
  "consumption",
  "observation",
  "requirement",
  "evaluation",
  "violation",
  "change",
  "action",
] as const satisfies readonly ThreadEntityKind[];

const THREAD_ENTITY_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    snapshotId: { type: "string", minLength: 1 },
    snapshotRevision: { type: "integer", minimum: 1 },
    kind: { type: "string", enum: THREAD_ENTITY_KINDS },
    id: { type: "string", minLength: 1 },
  },
  required: ["snapshotId", "snapshotRevision", "kind", "id"],
  additionalProperties: false,
} as const;

const OPERATION_BINDING_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    source: {
      oneOf: [
        {
          type: "object",
          properties: { kind: { const: "approved-brief" } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "project-answer" },
            answerId: { type: "string", minLength: 1 },
          },
          required: ["kind", "answerId"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "thread-entity" },
            reference: THREAD_ENTITY_REFERENCE_SCHEMA,
          },
          required: ["kind", "reference"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["name", "source"],
  additionalProperties: false,
} as const;

const OPERATION_REF_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    bindings: {
      type: "array",
      items: OPERATION_BINDING_SCHEMA,
    },
  },
  required: ["id", "version", "bindings"],
  additionalProperties: false,
} as const;

const COMMON_MUTATION_PROPERTIES = {
  commandId: COMMAND_ID,
  projectId: PROJECT_ID,
  expectedRevision: EXPECTED_REVISION,
  issuedAt: ISSUED_AT,
} as const;

export interface EngineeringProjectSnapshotReader {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface ProjectControlToolDependencies {
  projects: EngineeringProjectSnapshotReader;
  commands: EngineeringProjectCommandService;
  /** Optional browser-to-agent outbox; it carries no project decision authority. */
  reviewIntents?: ProjectReviewIntentStore;
  /** Optional so focused read-only tests need not construct a trusted executor. */
  runExecutor?: Pick<RegisteredProjectRunExecutor, "execute">;
  /**
   * build123d-backed geometry preview context.  Absent when the build123d
   * provider is not configured; the preview tool returns "unavailable" in
   * that case (D2 — drafts never appear in ThreadSnapshot).
   */
  geometryPreview?: {
    readonly client: McpToolClient;
    readonly draftCaptures: FileCaptureStore<"geometry-draft">;
    /**
     * Exact Docker Compose service that owns the private preview /exports volume.
     * Server-fixed and required: never supplied by an agent and never the trusted
     * shared-volume instance.
     */
    readonly build123dService: "mcp-build123d-sandbox";
    /** Test seam for the Docker copy boundary; production leaves it undefined. */
    readonly materializeAsset?: (
      sha256: string,
      containerPath: string,
    ) => Promise<void>;
    /** Test seam for deterministic provider path assertions. */
    readonly previewRunId?: string;
  };
}

export function registerProjectControlTools(
  app: McpApp,
  dependencies: ProjectControlToolDependencies,
): void {
  app.registerTool(projectSnapshotTool, async (args) => {
    const projectId = requiredString(args.projectId, "projectId");
    const snapshot = await requiredProject(dependencies.projects, projectId);
    const actionableReviewIntents = dependencies.reviewIntents
      ? await actionableProjectReviewIntents(
        dependencies.reviewIntents,
        snapshot,
      )
      : undefined;
    return projectResult(
      `Project ${snapshot.project.name} is at revision ${snapshot.revision}.` +
        (actionableReviewIntents === undefined
          ? ""
          : ` The Workbench review outbox has ${actionableReviewIntents.length} actionable intent${
            actionableReviewIntents.length === 1 ? "" : "s"
          } (${
            actionableReviewIntents.filter((record) => record.state === "pending")
              .length
          } pending agent receipt, ${
            actionableReviewIntents.filter((record) => record.state === "acknowledged")
              .length
          } acknowledged but awaiting a canonical decision); call project_review_intent_list to read the exact action, comment, and receipt before continuing.`),
      snapshot,
    );
  });

  if (dependencies.reviewIntents) {
    app.registerTool(projectReviewIntentListTool, async (args) => {
      const projectId = requiredString(args.projectId, "projectId");
      const snapshot = await requiredProject(dependencies.projects, projectId);
      const records = await actionableProjectReviewIntents(
        dependencies.reviewIntents!,
        snapshot,
      );
      return {
        content: `The Workbench review outbox has ${records.length} actionable intent${
          records.length === 1 ? "" : "s"
        } for project ${projectId} at revision ${snapshot.revision}. An acknowledged record remains actionable until project_decision_approve or project_decision_reject completes through signed MRTR and changes canonical project truth. Each returned intent and acknowledgement is exact; do not paraphrase its comment.`,
        structuredContent: {
          projectId,
          projectRevision: snapshot.revision,
          count: records.length,
          records,
        },
      };
    });

    app.registerTool(projectReviewIntentAcknowledgeTool, async (args, context) => {
      return await handleReviewIntentAcknowledgement(args, context, dependencies);
    });
  }

  app.registerTool(projectPlanPublishTool, async (args, context) => {
    const common = commonMutation(args);
    const snapshot = await dependencies.commands.publishPlan(agentOrigin(context), {
      ...common,
      startingPoint: planStartingPoint(args.startingPoint),
      phases: planPhases(args.phases),
      workItems: planWorkItems(args.workItems),
      requiredDecisions: planDecisions(args.requiredDecisions),
    });
    return projectResult(
      `The agent-published project path is recorded at revision ${snapshot.revision}. It is planning state only: no engineering operation was executed.`,
      snapshot,
    );
  });

  app.registerTool(projectChangeAppendTool, async (args, context) => {
    const common = commonMutation(args);
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const baseSnapshot = declaredProjectHead(current);
    assertDeclaredProjectHead(
      threadSnapshotReference(args.baseSnapshot, "baseSnapshot"),
      baseSnapshot,
    );
    const snapshot = await dependencies.commands.appendChange(agentOrigin(context), {
      ...common,
      baseSnapshot,
      phases: planPhases(args.phases),
      workItems: planWorkItems(args.workItems),
      requiredDecisions: planDecisions(args.requiredDecisions),
    });
    return projectResult(
      `The agent-appended project change is recorded at revision ${snapshot.revision}. It adds only reviewed work anchored to the exact current thread snapshot; no engineering operation was executed.`,
      snapshot,
    );
  });

  if (dependencies.runExecutor) {
    app.registerTool(projectAgentRunExecuteTool, async (args, context) => {
      const common = commonMutation(args);
      const runId = requiredString(args.runId, "runId");
      const snapshot = await dependencies.runExecutor!.execute(
        agentOrigin(context),
        { ...common, runId },
      );
      return projectResult(
        `Agent run ${runId} completed through its registered server-owned executor at project revision ${snapshot.revision}.`,
        snapshot,
      );
    });
  }

  app.registerTool(projectAgentRunQueueTool, async (args, context) => {
    const common = commonMutation(args);
    const workItemId = requiredString(args.workItemId, "workItemId");
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const workItem = requiredQueueWorkItem(current, workItemId);
    const snapshot = await dependencies.commands.queueRun(agentOrigin(context), {
      ...common,
      runId: `run:${common.commandId}`,
      workItemId,
      summary: queueRunSummary(workItem),
      ...queueExecutionBasis(current, workItem),
    });
    return projectResult(
      `Agent queued the reviewed operation ${workItem.operation!.id}@${
        workItem.operation!.version
      } for work item ${workItemId} at project revision ${snapshot.revision}. The server derived the run id, summary and exact basis; no provider or arbitrary execution input was accepted.`,
      snapshot,
    );
  });

  app.registerTool(projectAgentRunCancelTool, async (args, context) => {
    return await handleQueuedRunCancellation(args, context, dependencies);
  });

  app.registerTool(projectDecisionProposeTool, async (args, context) => {
    const common = commonMutation(args);
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const decisionId = requiredString(args.decisionId, "decisionId");
    const proposal = decisionProposal(args.proposal);
    /**
     * Reject an unparsable proposal here rather than at preview or execution:
     * the agent is the caller, so it is the only party that can fix the keys,
     * and nothing should reach a human reviewer that the operation could not
     * read back.
     */
    assertProposalMatchesOperationGrammar(
      current.workItems.find((item) => item.decisionIds.includes(decisionId))
        ?.operation,
      proposal.parameters,
    );
    const snapshot = await dependencies.commands.proposeDecision(
      agentOrigin(context),
      {
        ...common,
        decisionId,
        proposal,
        baseSnapshot: declaredProjectHead(current),
      },
    );
    return projectResult(
      `Decision ${decisionId} now has an agent proposal at project revision ${snapshot.revision}; human approval is still required.`,
      snapshot,
    );
  });

  app.registerTool(projectDecisionApproveTool, async (args, context) => {
    return await handleDecisionElicitation(
      "approve",
      args,
      context,
      dependencies,
    );
  });

  app.registerTool(projectDecisionRejectTool, async (args, context) => {
    return await handleDecisionElicitation(
      "reject",
      args,
      context,
      dependencies,
    );
  });

  app.registerTool(
    projectWorkItemReconcileSuccessorTool,
    async (args, context) => {
      const common = commonMutation(args);
      const failedWorkItemId = requiredString(
        args.failedWorkItemId,
        "failedWorkItemId",
      );
      const failedRunId = requiredString(args.failedRunId, "failedRunId");
      const successorRunId = requiredString(args.successorRunId, "successorRunId");
      const successorRunSnapshot = threadSnapshotReference(
        args.successorRunSnapshot,
        "successorRunSnapshot",
      );
      const successorEvidenceRefs = threadEntityReferenceList(
        args.successorEvidenceRefs,
        "successorEvidenceRefs",
      );
      const rationale = requiredString(args.rationale, "rationale");
      // The MCP surface always uses direct reconciliation: the successor run
      // result is already the project thread head and no separate closeout
      // snapshot is produced. The full closeout path (with successorSnapshot)
      // is only available through the command service directly.
      const snapshot = await dependencies.commands.reconcileWorkItemWithSuccessor(
        agentOrigin(context),
        {
          ...common,
          failedWorkItemId,
          failedRunId,
          successorRunId,
          successorRunSnapshot,
          successorEvidenceRefs,
          rationale,
        },
      );
      return projectResult(
        `Work item ${failedWorkItemId} is now closed as superseded. Its anchoring run ${failedRunId} keeps its durable status (failed, or cancelled before any claim) in history; the successor run ${successorRunId} retains its own evidence at project revision ${snapshot.revision}.`,
        snapshot,
      );
    },
  );

  /**
   * WHY CONDITIONAL — `project_geometry_preview` depends on the build123d MCP
   * provider.  When the provider is not configured (no `build123dMcpUrl` in
   * the server options), advertising the tool would create a "ghost" that
   * always fails: confusing for discovery and inconsistent with AX Principle 1
   * (No Verb Overlap) and 7 (Explicit Over Implicit).  Not registering it at
   * all is the honest contract — agents learn the capability is absent by
   * inspecting `tools/list`, not by calling and receiving an error.
   */

  // Hard bound on components list length.
  // WHY 32 — each component is metadata stored in the draft record and manifest.
  // Regex for a valid SysML part-usage identifier.
  // WHY STRICT — usageName is stored in the manifest and the draft capture, and
  // will be used as part of server-fixed export names in v2.  Restricting to
  // [a-z][A-Za-z0-9_]* prevents accumulation of names that would be
  // impossible to use safely later, and defends against injection if the
  // restriction is ever relaxed without a review.
  const SYSML_USAGE_NAME = /^[a-z][A-Za-z0-9_]*$/;

  if (dependencies.geometryPreview) {
    const geo = dependencies.geometryPreview;
    app.registerTool(projectGeometryPreviewTool, async (args) => {
      const script = requiredString(args.script, "script");
      const architectureSnapshotId = requiredString(
        args.architectureSnapshotId,
        "architectureSnapshotId",
      );
      const architectureSnapshotRevision = positiveInteger(
        args.architectureSnapshotRevision,
        "architectureSnapshotRevision",
      );
      const architectureArtifactDigest = hex64(
        args.architectureArtifactDigest,
        "architectureArtifactDigest",
      );

      const rawFormats = Array.isArray(args.exportFormats)
        ? args.exportFormats
        : ["gltf"];
      const exportFormats = rawFormats.map((f: unknown) => {
        if (f !== "step" && f !== "gltf" && f !== "stl") {
          throw new TypeError(`exportFormats: unknown format ${JSON.stringify(f)}`);
        }
        return f as GeometryExportFormat;
      });

      const rawComponents: unknown[] = Array.isArray(args.components)
        ? args.components
        : [];
      if (rawComponents.length > MAX_GEOMETRY_COMPONENTS_V1) {
        throw new TypeError(
          `components must not exceed ${MAX_GEOMETRY_COMPONENTS_V1} entries ` +
            `(got ${rawComponents.length}).`,
        );
      }
      const components: GeometryComponentBinding[] = rawComponents.map(
        (c: unknown, i: number) => {
          if (!c || typeof c !== "object" || Array.isArray(c)) {
            throw new TypeError(`components[${i}] must be an object`);
          }
          const obj = c as Record<string, unknown>;
          const usageName = requiredString(obj.usageName, `components[${i}].usageName`);
          if (!SYSML_USAGE_NAME.test(usageName)) {
            throw new TypeError(
              `components[${i}].usageName '${usageName}' does not match the ` +
                `required SysML usage pattern [a-z][A-Za-z0-9_]*.`,
            );
          }
          return {
            elementId: requiredString(obj.elementId, `components[${i}].elementId`),
            usageName,
            label: requiredString(obj.label, `components[${i}].label`),
          };
        },
      );
      // SysML usage names are scoped by their owning PartDefinition, so two
      // reviewed occurrences may legitimately share one label. The provider
      // element identity is global and is therefore the only safe list key.
      const seenElementIds = new Set<string>();
      for (let i = 0; i < components.length; i++) {
        const elementId = components[i]!.elementId;
        if (seenElementIds.has(elementId)) {
          throw new TypeError(
            `components contains duplicate elementId '${elementId}' at index ${i}.`,
          );
        }
        seenElementIds.add(elementId);
      }

      const v2Requested = args.partDefinitions !== undefined ||
        args.occurrences !== undefined || args.partExportFormats !== undefined ||
        args.predecessor !== undefined;
      if (components.length > 0 && !v2Requested) {
        throw new TypeError(
          "Component geometry requires the complete v2 partDefinitions and occurrences contract; " +
            "legacy v1 preview is assembly-only.",
        );
      }
      if (v2Requested) {
        if (!Array.isArray(args.partDefinitions) || !Array.isArray(args.occurrences)) {
          throw new TypeError(
            "Geometry bundle v2 requires both partDefinitions and occurrences.",
          );
        }
        if (components.length === 0) {
          throw new TypeError("Geometry bundle v2 requires at least one component.");
        }
        const rawPartFormats = Array.isArray(args.partExportFormats)
          ? args.partExportFormats
          : ["step", "gltf", "stl"];
        const partExportFormats = rawPartFormats.map((format: unknown) => {
          if (format !== "step" && format !== "gltf" && format !== "stl") {
            throw new TypeError(
              `partExportFormats: unknown format ${JSON.stringify(format)}`,
            );
          }
          return format as GeometryBundleExportFormat;
        });
        if (!exportFormats.includes("step") || !partExportFormats.includes("step")) {
          throw new TypeError(
            "Geometry bundle v2 requires authoritative STEP for assembly and PartDefinitions.",
          );
        }
        if (args.partDefinitions.length > MAX_GEOMETRY_COMPONENTS_V1) {
          throw new TypeError(
            `partDefinitions must not exceed ${MAX_GEOMETRY_COMPONENTS_V1} entries.`,
          );
        }
        const partDefinitionScripts = args.partDefinitions.map(
          (candidate: unknown, index: number) => {
            if (
              !candidate || typeof candidate !== "object" || Array.isArray(candidate)
            ) {
              throw new TypeError(`partDefinitions[${index}] must be an object.`);
            }
            const definition = candidate as Record<string, unknown>;
            return {
              elementId: requiredString(
                definition.elementId,
                `partDefinitions[${index}].elementId`,
              ),
              label: requiredString(
                definition.label,
                `partDefinitions[${index}].label`,
              ),
              script: requiredString(
                definition.script,
                `partDefinitions[${index}].script`,
              ),
            };
          },
        );
        const triple = (value: unknown, context: string): [number, number, number] => {
          if (
            !Array.isArray(value) || value.length !== 3 ||
            value.some((part) => typeof part !== "number" || !Number.isFinite(part))
          ) {
            throw new TypeError(
              `${context} must contain exactly three finite numbers.`,
            );
          }
          return [value[0], value[1], value[2]];
        };
        const occurrences: GeometryBundleOccurrence[] = args.occurrences.map(
          (candidate: unknown, index: number) => {
            if (
              !candidate || typeof candidate !== "object" || Array.isArray(candidate)
            ) {
              throw new TypeError(`occurrences[${index}] must be an object.`);
            }
            const occurrence = candidate as Record<string, unknown>;
            if (
              !occurrence.placement || typeof occurrence.placement !== "object" ||
              Array.isArray(occurrence.placement)
            ) {
              throw new TypeError(`occurrences[${index}].placement must be an object.`);
            }
            const placement = occurrence.placement as Record<string, unknown>;
            return {
              usageElementId: requiredString(
                occurrence.usageElementId,
                `occurrences[${index}].usageElementId`,
              ),
              partDefinitionElementId: requiredString(
                occurrence.partDefinitionElementId,
                `occurrences[${index}].partDefinitionElementId`,
              ),
              placement: {
                translationMm: triple(
                  placement.translationMm,
                  `occurrences[${index}].placement.translationMm`,
                ),
                rotationDeg: triple(
                  placement.rotationDeg,
                  `occurrences[${index}].placement.rotationDeg`,
                ),
              },
            };
          },
        );
        let predecessor: GeometryBundleManifest["predecessor"];
        if (args.predecessor !== undefined) {
          if (
            !args.predecessor || typeof args.predecessor !== "object" ||
            Array.isArray(args.predecessor)
          ) {
            throw new TypeError("predecessor must be an object.");
          }
          const rawPredecessor = args.predecessor as Record<string, unknown>;
          predecessor = {
            artifactId: requiredString(
              rawPredecessor.artifactId,
              "predecessor.artifactId",
            ),
            fingerprint: {
              algorithm: "sha256",
              digest: hex64(rawPredecessor.digest, "predecessor.digest"),
            },
          };
        }
        const manifest: GeometryBundleManifest = {
          schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
          architectureBasis: {
            snapshotId: architectureSnapshotId,
            revision: architectureSnapshotRevision,
            artifactFingerprint: {
              algorithm: "sha256",
              digest: architectureArtifactDigest,
            },
          },
          ...(predecessor ? { predecessor } : {}),
          components,
          unitSystem: "mm",
          placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
          exportFormats,
          partExportFormats,
          partDefinitions: partDefinitionScripts.map(({ elementId, label }) => ({
            elementId,
            label,
          })),
          occurrences,
        };
        const draft = await captureGeometryBundleDraft(
          geo.client,
          {
            assemblyScript: script,
            manifest,
            partDefinitionScripts: partDefinitionScripts.map((
              { elementId, script },
            ) => ({
              elementId,
              script,
            })),
          },
          geo.draftCaptures,
          {
            build123dService: geo.build123dService,
            materializeAsset: geo.materializeAsset,
            previewRunId: geo.previewRunId,
          },
        );
        const completedManifest = geometryBundleManifestFromDraft(draft);
        const decisionParams = encodeGeometryDecisionParameters(
          draft.fingerprint.digest,
          completedManifest,
        );
        return {
          content: [{
            type: "text" as const,
            text:
              `Geometry bundle v2 preview completed. Draft digest: ${draft.fingerprint.digest}.\n` +
              `Assembly files: ${draft.assembly.files.length}; PartDefinitions: ` +
              `${draft.partDefinitions.length}; occurrences: ${draft.occurrences.length}.\n` +
              "The human must approve these exact sources, identities, placements and hashes before sealing.",
          }],
          structuredContent: {
            schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
            draftDigest: draft.fingerprint.digest,
            assemblyFiles: draft.assembly.files.map((file) => ({
              format: file.format,
              name: file.name,
              bytes: file.bytes,
              digest: file.fingerprint.digest,
            })),
            partDefinitions: draft.partDefinitions.map((definition) => ({
              elementId: definition.elementId,
              label: definition.label,
              scriptHash: definition.scriptHash.digest,
              files: definition.files.map((file) => ({
                format: file.format,
                name: file.name,
                bytes: file.bytes,
                digest: file.fingerprint.digest,
              })),
            })),
            occurrences: draft.occurrences,
            decisionParameters: decisionParams,
          },
        };
      }

      // Build a manifest without scriptHash/artifactHashes — the draft-capture
      // layer computes those after the build123d_export call.
      const manifest: GeometryManifest = {
        schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
        architectureBasis: {
          snapshotId: architectureSnapshotId,
          revision: architectureSnapshotRevision,
          artifactFingerprint: {
            algorithm: "sha256",
            digest: architectureArtifactDigest,
          },
        },
        components,
        unitSystem: "mm",
        exportFormats,
      };

      const draft = await captureGeometryDraft(
        geo.client,
        { script, manifest },
        geo.draftCaptures,
        {
          build123dService: geo.build123dService,
          materializeAsset: geo.materializeAsset,
          previewRunId: geo.previewRunId,
        },
      );

      // Build the completed manifest for the MRTR proposal.
      const completedManifest: GeometryManifest = {
        ...manifest,
        scriptHash: draft.scriptHash,
        artifactHashes: {
          assemblyFiles: draft.assemblyFiles.map((f) => ({
            format: f.format,
            name: f.name,
            fingerprint: f.fingerprint,
          })),
          partMeshes: draft.partMeshes.map((m) => ({
            semanticKey: m.usageName,
            name: m.name,
            fingerprint: m.fingerprint,
          })),
        },
      };

      const decisionParams = encodeGeometryDecisionParameters(
        draft.fingerprint.digest,
        completedManifest,
      );

      return {
        content: [{
          type: "text" as const,
          text:
            `Geometry preview completed. Draft digest: ${draft.fingerprint.digest}.\n` +
            `Assembly files: ${draft.assemblyFiles.length}, ` +
            `part meshes: ${draft.partMeshes.length}.\n` +
            `The human must approve the MRTR decision before the geometry can be sealed ` +
            `into the evidence thread (design.write-geometry@1).`,
        }],
        structuredContent: {
          draftDigest: draft.fingerprint.digest,
          assemblyFiles: draft.assemblyFiles.map((f) => ({
            format: f.format,
            name: f.name,
            bytes: f.bytes,
            digest: f.fingerprint.digest,
          })),
          partMeshes: draft.partMeshes.map((m) => ({
            usageName: m.usageName,
            name: m.name,
            bytes: m.bytes,
            digest: m.fingerprint.digest,
          })),
          decisionParameters: decisionParams,
        },
      };
    });
  }
}

const FINGERPRINT_SCHEMA = {
  type: "object",
  properties: {
    algorithm: { const: "sha256" },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  required: ["algorithm", "digest"],
  additionalProperties: false,
} as const;

const projectSnapshotTool: MCPTool = {
  name: "project_snapshot",
  description:
    "Read the durable EngineeringProject application state: work, decisions, approvals, agent runs, blockers, exact thread references, and command receipts. When the durable Workbench review outbox is configured, the text also reports its exact actionable count (including acknowledged intents still awaiting canonical decision) and directs the agent to project_review_intent_list. Connected hosts may subscribe to casys://engineering/review-intents for a best-effort resource-update signal, but reconnecting hosts must reread the durable resource or list tool; structuredContent remains the unmodified EngineeringProjectSnapshot. This does not probe or execute engineering tools.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectReviewIntentListTool: MCPTool = {
  name: "project_review_intent_list",
  description:
    `Read the exact actionable review intents submitted from the Workbench for one engineering project. This durable outbox is the recovery truth behind the best-effort casys://engineering/review-intents subscription signal; it is not project truth or decision authority. An acknowledged intent remains listed only while its exact approvalId is the pending approval attempt for the same proposed decision and input fingerprint, so disconnects, unrelated project-revision drift, and agent interruption do not lose it while rejection and reproposal cannot replay it. For each pending intent, first acknowledge receipt with project_review_intent_acknowledge; for pending or acknowledged intents, use project_decision_approve for action=validate or project_decision_reject for action=request-revision, using the list result's current projectRevision as expectedRevision. Pass intent.comment verbatim as rationale. A validate intent without comment uses exactly this deterministic rationale: "${REVIEW_INTENT_NO_COMMENT_RATIONALE}". The existing signed MRTR elicitation retry remains mandatory.`,
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectReviewIntentAcknowledgeTool: MCPTool = {
  name: "project_review_intent_acknowledge",
  description:
    `Acknowledge agent receipt of one exact Workbench review intent after verifying that its approvalId is still the exact pending approval attempt for the same proposed decision, input fingerprint, and requested action. The expectedRevision argument copies the click-time intent exactly; unrelated current-revision drift is allowed. This changes only the durable outbox receipt, never EngineeringProjectSnapshot, and the acknowledged intent remains actionable for interruption-safe replay until canonical truth changes. The result returns machine-readable projectRevision, rationale, and nextTool: pass projectRevision as expectedRevision and rationale verbatim to nextTool. A validate intent without comment uses exactly this deterministic rationale: "${REVIEW_INTENT_NO_COMMENT_RATIONALE}". Only that existing signed MRTR elicitation flow can record the human decision.`,
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      expectedRevision: {
        type: "integer",
        minimum: 1,
        description:
          "Exact project revision observed and stored in the Workbench intent; copy it verbatim. The current head may be newer if the same proposed decision and input fingerprint remain active.",
      },
      intentId: { type: "string", minLength: 1, maxLength: 256 },
      decisionId: { type: "string", minLength: 1 },
      approvalId: { type: "string", minLength: 1, maxLength: 256 },
      inputFingerprint: FINGERPRINT_SCHEMA,
      action: {
        type: "string",
        enum: ["validate", "request-revision"],
      },
    },
    required: [
      "projectId",
      "expectedRevision",
      "intentId",
      "decisionId",
      "approvalId",
      "inputFingerprint",
      "action",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: REVIEW_INTENT_ACKNOWLEDGEMENT_ANNOTATIONS,
};

const projectPlanPublishTool: MCPTool = {
  name: "project_plan_publish",
  description:
    "Publish or revise an unexecuted engineering path from this project's exact human-approved canonical brief. Each work item must cite a reviewed registered operation and state-reference bindings; its displayed title, description and kind are derived from that reviewed operation. This never calls a provider, approves a decision, queues work, or creates technical evidence.",
  inputSchema: mutationSchema({
    startingPoint: {
      type: "string",
      enum: ["idea-or-spec", "existing-cad", "existing-product"],
    },
    phases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
        },
        required: ["id", "name", "description"],
        additionalProperties: false,
      },
    },
    workItems: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          phaseId: { type: "string", minLength: 1 },
          owner: { type: "string", enum: ["human", "agent", "shared"] },
          dependsOnWorkItemIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          decisionIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          operation: OPERATION_REF_SCHEMA,
        },
        required: [
          "id",
          "phaseId",
          "owner",
          "dependsOnWorkItemIds",
          "decisionIds",
          "operation",
        ],
        additionalProperties: false,
      },
    },
    requiredDecisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          phaseId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          question: { type: "string", minLength: 1 },
        },
        required: ["id", "phaseId", "title", "question"],
        additionalProperties: false,
      },
    },
  }, ["startingPoint", "phases", "workItems", "requiredDecisions"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

const THREAD_SNAPSHOT_REF_SCHEMA = {
  type: "object",
  properties: {
    snapshotId: { type: "string", minLength: 1 },
    revision: { type: "integer", minimum: 1 },
    subjectId: { type: "string", minLength: 1 },
  },
  required: ["snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const projectChangeAppendTool: MCPTool = {
  name: "project_change_append",
  description:
    "Append the next bounded, reviewed engineering change after an existing exact ThreadSnapshot. The supplied baseSnapshot must exactly equal the project's current declared thread head; each work item must cite a reviewed registered operation and state-reference bindings. This never revises an existing phase, work item, decision, run or evidence record; it never calls a provider, approves a decision, queues work, or creates technical evidence. It cannot pre-plan later work whose basis does not yet exist.",
  inputSchema: mutationSchema({
    baseSnapshot: THREAD_SNAPSHOT_REF_SCHEMA,
    phases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
        },
        required: ["id", "name", "description"],
        additionalProperties: false,
      },
    },
    workItems: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          phaseId: { type: "string", minLength: 1 },
          owner: { type: "string", enum: ["human", "agent", "shared"] },
          dependsOnWorkItemIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          decisionIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          operation: OPERATION_REF_SCHEMA,
        },
        required: [
          "id",
          "phaseId",
          "owner",
          "dependsOnWorkItemIds",
          "decisionIds",
          "operation",
        ],
        additionalProperties: false,
      },
    },
    requiredDecisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          phaseId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          question: { type: "string", minLength: 1 },
        },
        required: ["id", "phaseId", "title", "question"],
        additionalProperties: false,
      },
    },
  }, ["baseSnapshot", "phases", "workItems", "requiredDecisions"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

const projectDecisionProposeTool: MCPTool = {
  name: "project_decision_propose",
  description:
    "Record an agent-authored concrete proposal for one required engineering decision. This never approves the proposal; approval or rejection requires the paired host's human-facing MCP elicitation flow.",
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_MUTATION_PROPERTIES,
      decisionId: { type: "string", minLength: 1 },
      proposal: {
        type: "object",
        properties: {
          summary: { type: "string", minLength: 1 },
          parameters: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                key: { type: "string", minLength: 1 },
                label: { type: "string", minLength: 1 },
                value: { type: ["string", "number", "boolean"] },
                unit: { type: "string", minLength: 1 },
              },
              required: ["key", "label", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "parameters"],
        additionalProperties: false,
      },
    },
    required: [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      "decisionId",
      "proposal",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

const projectDecisionApproveTool: MCPTool = {
  name: "project_decision_approve",
  description:
    "Ask the paired MCP host to present one exact proposed decision for confirmation. The first call requests elicitation; only a signed retry whose request state verifies and whose response is accepted records approval. The signature protects retry integrity, not user identity; the host is responsible for presenting the request to the person. The agent cannot call the underlying human-authority mutation directly.",
  inputSchema: mutationSchema({
    decisionId: { type: "string", minLength: 1 },
    inputFingerprint: FINGERPRINT_SCHEMA,
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "Concise record of why this proposal reflects the paired conversation; it is shown to the human before confirmation.",
    },
  }, ["decisionId", "inputFingerprint", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

const projectDecisionRejectTool: MCPTool = {
  name: "project_decision_reject",
  description:
    "Ask the paired MCP host to present one exact proposed decision and rejection rationale for confirmation. The first call requests elicitation; only a signed retry whose request state verifies and whose response is accepted records rejection. The signature protects retry integrity, not user identity; the host is responsible for presenting the request to the person. The agent cannot call the underlying human-authority mutation directly.",
  inputSchema: mutationSchema({
    decisionId: { type: "string", minLength: 1 },
    inputFingerprint: FINGERPRINT_SCHEMA,
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "The correction or reason to preserve if the human confirms the rejection.",
    },
  }, ["decisionId", "inputFingerprint", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

const projectAgentRunQueueTool: MCPTool = {
  name: "project_agent_run_queue",
  description:
    "Queue one ready reviewed work item for the agent. The caller supplies only the durable command context and work item id. The server derives the run id, summary and exact approved-brief or thread-snapshot basis from project truth; it accepts no provider, tool arguments, paths, files, result payload or technical evidence.",
  inputSchema: mutationSchema({
    workItemId: { type: "string", minLength: 1 },
  }, ["workItemId"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_EXECUTION_ANNOTATIONS,
};

const projectAgentRunCancelTool: MCPTool = {
  name: "project_agent_run_cancel",
  description:
    "Ask the paired MCP host to present cancellation of one exact queued agent run for human confirmation. The first call requests elicitation; only a signed retry whose request state verifies and whose response is accepted records the human cancellation. A cancelled queued run has not been claimed or executed, and returns its work item to its derived idle state.",
  inputSchema: mutationSchema({
    runId: { type: "string", minLength: 1 },
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "Reason preserved in the human cancellation record and shown before confirmation.",
    },
  }, ["runId", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

const projectAgentRunExecuteTool: MCPTool = {
  name: "project_agent_run_execute",
  description:
    "Execute one agent-queued run through its exact server-owned registered executor. The call accepts no provider, tool arguments, files or result payload. Registered work may record the canonical project brief as a documentary baseline or run an explicitly reviewed engineering operation; it cannot add arbitrary evidence or compliance claims. Reuse the same commandId unchanged to resume an interrupted call safely.",
  inputSchema: mutationSchema({
    runId: { type: "string", minLength: 1 },
  }, ["runId"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_EXECUTION_ANNOTATIONS,
};

const projectWorkItemReconcileSuccessorTool: MCPTool = {
  name: "project_work_item_reconcile_successor",
  description:
    "Close a failed, evidence-free work item by recording that an independently completed successor run has already delivered the equivalent result. Both histories stay intact: the failed run remains failed and the successor retains its own completed work item and evidence. The successor run snapshot must be the current project thread head (direct reconciliation — no separate closeout snapshot is produced). Only valid when the failed work item is in ready status with no evidence.",
  inputSchema: mutationSchema({
    failedWorkItemId: {
      type: "string",
      minLength: 1,
      description: "Id of the work item that failed and must be closed.",
    },
    failedRunId: {
      type: "string",
      minLength: 1,
      description: "Id of the evidence-free failed agent run for that work item.",
    },
    successorRunId: {
      type: "string",
      minLength: 1,
      description:
        "Id of the independently completed successor run that delivered the equivalent result.",
    },
    successorRunSnapshot: THREAD_SNAPSHOT_REF_SCHEMA,
    successorEvidenceRefs: {
      type: "array",
      minItems: 1,
      items: THREAD_ENTITY_REFERENCE_SCHEMA,
      description: "Exact evidence refs from the completed successor run.",
    },
    rationale: {
      type: "string",
      minLength: 1,
      description: "Reason why the successor result closes the original work item.",
    },
  }, [
    "failedWorkItemId",
    "failedRunId",
    "successorRunId",
    "successorRunSnapshot",
    "successorEvidenceRefs",
    "rationale",
  ]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

/**
 * Planning-only tool (D2 decision).
 *
 * WHY PLANNING-ONLY — the preview run calls build123d_export before any
 * human MRTR decision.  The result is saved as a draft (never in
 * ThreadSnapshot) so the human can review the exact bytes they are about to
 * approve.  The `design.write-geometry@1` executor later promotes only the
 * bytes that match the human-signed draftDigest.
 */
const projectGeometryPreviewTool: MCPTool = {
  name: "project_geometry_preview",
  description:
    "Execute a build123d geometry script and save the result as a draft for human review. " +
    "Returns a draftDigest and the MRTR decision parameters that the agent should present " +
    "for human approval before calling design.write-geometry@1. " +
    "Drafts are NEVER written to the evidence ThreadSnapshot (D2).",
  inputSchema: {
    type: "object",
    properties: {
      script: {
        type: "string",
        minLength: 1,
        description:
          "Python build123d script. The variable `result` must assign the assembly shape. " +
          "The script is validated (D4) before dispatch.",
      },
      architectureSnapshotId: {
        type: "string",
        minLength: 1,
        description:
          "ThreadSnapshot ID that carries the SysML architecture artifact (D5).",
      },
      architectureSnapshotRevision: {
        type: "integer",
        minimum: 1,
        description: "Revision of the architecture ThreadSnapshot.",
      },
      architectureArtifactDigest: {
        type: "string",
        pattern: "^[a-f0-9]{64}$",
        description:
          "SHA-256 digest of the architecture artifact in the basis snapshot.",
      },
      predecessor: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            minLength: 1,
            description:
              "Exact active canonical geometry capture artifact replaced by this v2 bundle.",
          },
          digest: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
            description: "Exact SHA-256 of the active predecessor capture.",
          },
        },
        required: ["artifactId", "digest"],
        additionalProperties: false,
        description:
          "Required for a v2 upgrade when the basis already has one active geometry tip; absent only for the first geometry seal.",
      },
      exportFormats: {
        type: "array",
        items: { type: "string", enum: ["step", "gltf", "stl"] },
        minItems: 1,
        uniqueItems: true,
        description: 'Export formats for the assembly call (e.g. ["gltf"]).',
      },
      components: {
        type: "array",
        maxItems: MAX_GEOMETRY_COMPONENTS_V1,
        items: {
          type: "object",
          properties: {
            elementId: {
              type: "string",
              minLength: 1,
              description: "SysON element UUID.",
            },
            usageName: {
              type: "string",
              minLength: 1,
              pattern: "^[a-z][A-Za-z0-9_]*$",
              description: "SysML part-usage label (e.g. driveUnit).",
            },
            label: {
              type: "string",
              minLength: 1,
              description: "Human-readable display label.",
            },
          },
          required: ["elementId", "usageName", "label"],
          additionalProperties: false,
        },
        description:
          "Reviewed PartUsage metadata. When non-empty, the complete v2 partDefinitions and occurrences contract is required.",
      },
      partExportFormats: {
        type: "array",
        items: { type: "string", enum: ["step", "gltf", "stl"] },
        minItems: 1,
        uniqueItems: true,
        description:
          "V2 formats exported independently for every PartDefinition. STEP is mandatory; GLB/STL are presentation derivatives.",
      },
      partDefinitions: {
        type: "array",
        minItems: 1,
        maxItems: MAX_GEOMETRY_COMPONENTS_V1,
        items: {
          type: "object",
          properties: {
            elementId: {
              type: "string",
              minLength: 1,
              description: "Exact SysON PartDefinition identity.",
            },
            label: {
              type: "string",
              minLength: 1,
              description: "Display-only PartDefinition label; never used as identity.",
            },
            script: {
              type: "string",
              minLength: 1,
              description:
                "Independent validated build123d source whose module-level result is exactly this PartDefinition.",
            },
          },
          required: ["elementId", "label", "script"],
          additionalProperties: false,
        },
      },
      occurrences: {
        type: "array",
        minItems: 1,
        maxItems: MAX_GEOMETRY_COMPONENTS_V1,
        items: {
          type: "object",
          properties: {
            usageElementId: {
              type: "string",
              minLength: 1,
              description: "Exact SysON PartUsage identity.",
            },
            partDefinitionElementId: {
              type: "string",
              minLength: 1,
              description: "Exact SysON PartDefinition target identity.",
            },
            placement: {
              type: "object",
              properties: {
                translationMm: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: { type: "number" },
                },
                rotationDeg: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: { type: "number" },
                  description:
                    "Extrinsic XYZ rotations in degrees in the signed right-handed frame.",
                },
              },
              required: ["translationMm", "rotationDeg"],
              additionalProperties: false,
            },
          },
          required: ["usageElementId", "partDefinitionElementId", "placement"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "script",
      "architectureSnapshotId",
      "architectureSnapshotRevision",
      "architectureArtifactDigest",
      "exportFormats",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

async function handleDecisionElicitation(
  action: "approve" | "reject",
  args: Record<string, unknown>,
  context: ToolHandlerContext | undefined,
  dependencies: ProjectControlToolDependencies,
) {
  const common = commonMutation(args);
  const decisionId = requiredString(args.decisionId, "decisionId");
  const inputFingerprint = fingerprintInput(args.inputFingerprint, "inputFingerprint");
  const rationale = requiredString(args.rationale, "rationale");
  const current = await requiredProposedDecision(
    dependencies.projects,
    common.projectId,
    common.expectedRevision,
    decisionId,
    inputFingerprint,
  );
  const confirmation = decisionConfirmationResponse(context);
  if (confirmation === undefined) {
    return decisionConfirmationRequest(current, decisionId, action, rationale);
  }
  if (!confirmation) {
    return projectResult(
      `Decision ${decisionId} was not ${
        action === "approve" ? "approved" : "rejected"
      }. No project state changed; continue the paired conversation.`,
      current,
    );
  }
  const snapshot = action === "approve"
    ? await dependencies.commands.approveDecision(elicitedHumanOrigin(context), {
      ...common,
      decisionId,
      inputFingerprint,
      rationale,
    })
    : await dependencies.commands.rejectDecision(elicitedHumanOrigin(context), {
      ...common,
      decisionId,
      inputFingerprint,
      rationale,
    });
  return projectResult(
    `The paired MCP host reported ${
      action === "approve" ? "approval" : "rejection"
    } of decision ${decisionId} through elicitation at project revision ${snapshot.revision}.`,
    snapshot,
  );
}

async function handleReviewIntentAcknowledgement(
  args: Record<string, unknown>,
  context: ToolHandlerContext | undefined,
  dependencies: ProjectControlToolDependencies,
) {
  const journal = dependencies.reviewIntents;
  if (!journal) {
    throw new TypeError("The Workbench review-intent outbox is not configured.");
  }
  const projectId = requiredString(args.projectId, "projectId");
  const expectedRevision = positiveInteger(
    args.expectedRevision,
    "expectedRevision",
  );
  const intentId = requiredString(args.intentId, "intentId");
  const decisionId = requiredString(args.decisionId, "decisionId");
  const approvalId = requiredString(args.approvalId, "approvalId");
  const inputFingerprint = fingerprintInput(
    args.inputFingerprint,
    "inputFingerprint",
  );
  const action = oneOf(
    args.action,
    ["validate", "request-revision"] as const,
    "action",
  );
  const record = (await journal.list(projectId)).find((candidate) =>
    candidate.intent.intentId === intentId
  );
  if (!record) {
    throw new TypeError(
      `Workbench review intent not found: ${projectId}/${intentId}.`,
    );
  }
  if (!isApprovalBoundProjectReviewIntent(record.intent)) {
    throw new TypeError(
      `Workbench review intent ${intentId} is legacy and has no exact approval binding; it cannot be acknowledged. Submit a new approval-bound intent from the current Workbench preview.`,
    );
  }
  assertExactReviewIntent(
    record.intent,
    {
      projectId,
      expectedRevision,
      decisionId,
      approvalId,
      inputFingerprint,
      action,
    },
  );

  const current = await requiredProject(dependencies.projects, projectId);
  if (!reviewIntentMatchesPendingApproval(current, record.intent)) {
    throw new TypeError(
      `Workbench review intent ${intentId} is stale: approval ${approvalId} is not the exact pending approval attempt for proposed decision ${decisionId} with the same input fingerprint at current project revision ${current.revision}.`,
    );
  }

  const origin = agentOrigin(context);
  const alreadyAcknowledged = record.acknowledgement !== undefined;
  const acknowledged = alreadyAcknowledged ? record : await journal.acknowledge({
    intentId,
    projectId,
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: origin.actorId,
  });
  const rationale = record.intent.comment ?? REVIEW_INTENT_NO_COMMENT_RATIONALE;
  const nextTool = action === "validate"
    ? "project_decision_approve" as const
    : "project_decision_reject" as const;
  return {
    content:
      (alreadyAcknowledged
        ? `Workbench review intent ${intentId} was already acknowledged by ${
          acknowledged.acknowledgement!.acknowledgedBy
        } at ${
          acknowledged.acknowledgement!.acknowledgedAt
        }; no new receipt was written. `
        : `Agent ${origin.actorId} acknowledged Workbench review intent ${intentId}. `) +
      `No EngineeringProjectSnapshot state changed. Continue with ${nextTool} at current revision ${current.revision}; signed MRTR remains required.`,
    structuredContent: {
      projectId,
      projectRevision: current.revision,
      state: "acknowledged",
      record: acknowledged,
      rationale,
      nextTool,
    },
  };
}

type ActionableProjectReviewIntentRecord = ProjectReviewIntentRecord & {
  readonly state: "pending" | "acknowledged";
};

async function actionableProjectReviewIntents(
  journal: ProjectReviewIntentStore,
  snapshot: EngineeringProjectSnapshot,
): Promise<ActionableProjectReviewIntentRecord[]> {
  return (await journal.list(snapshot.project.id)).flatMap((record) => {
    if (
      !isApprovalBoundProjectReviewIntent(record.intent) ||
      !reviewIntentMatchesPendingApproval(snapshot, record.intent)
    ) return [];
    return [{
      ...record,
      state: record.acknowledgement ? "acknowledged" as const : "pending" as const,
    }];
  });
}

function assertExactReviewIntent(
  intent: ProjectReviewIntent,
  expected: Pick<
    ProjectReviewIntent,
    | "projectId"
    | "expectedRevision"
    | "decisionId"
    | "approvalId"
    | "inputFingerprint"
    | "action"
  >,
): void {
  if (
    intent.projectId !== expected.projectId ||
    intent.expectedRevision !== expected.expectedRevision ||
    intent.decisionId !== expected.decisionId ||
    intent.approvalId !== expected.approvalId ||
    intent.action !== expected.action ||
    !sameFingerprint(intent.inputFingerprint, expected.inputFingerprint)
  ) {
    throw new TypeError(
      `Workbench review intent ${intent.intentId} does not match the exact project revision, decision, approval, fingerprint, and action supplied by the agent. Re-list the outbox and copy its fields verbatim.`,
    );
  }
}

function reviewIntentMatchesPendingApproval(
  snapshot: EngineeringProjectSnapshot,
  intent: ProjectReviewIntent,
): boolean {
  const decision = snapshot.decisions.find((candidate) =>
    candidate.id === intent.decisionId
  );
  if (
    !decision || decision.status !== "proposed" || !decision.proposal ||
    !decision.inputFingerprint ||
    !sameFingerprint(decision.inputFingerprint, intent.inputFingerprint)
  ) return false;
  const approval = [...decision.approvalIds].reverse().map((approvalId) =>
    snapshot.approvals.find((candidate) => candidate.id === approvalId)
  ).find((candidate) => candidate?.status === "pending");
  return approval?.id === intent.approvalId &&
    approval.decisionId === decision.id &&
    approval.inputFingerprint !== undefined &&
    sameFingerprint(approval.inputFingerprint, intent.inputFingerprint);
}

function sameFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

async function handleQueuedRunCancellation(
  args: Record<string, unknown>,
  context: ToolHandlerContext | undefined,
  dependencies: ProjectControlToolDependencies,
) {
  const common = commonMutation(args);
  const runId = requiredString(args.runId, "runId");
  const rationale = requiredString(args.rationale, "rationale");
  const current = await requiredQueuedRun(
    dependencies.projects,
    common.projectId,
    common.expectedRevision,
    runId,
  );
  const confirmation = runCancellationConfirmationResponse(context);
  if (confirmation === undefined) {
    return runCancellationConfirmationRequest(current, runId, rationale);
  }
  if (!confirmation) {
    return projectResult(
      `Queued agent run ${runId} was not cancelled. No project state changed; continue the paired conversation.`,
      current,
    );
  }
  const snapshot = await dependencies.commands.cancelQueuedRun(
    elicitedHumanOrigin(context),
    { ...common, runId, rationale },
  );
  return projectResult(
    `The paired MCP host reported human cancellation of queued agent run ${runId} through elicitation at project revision ${snapshot.revision}. No agent claim or execution was recorded.`,
    snapshot,
  );
}

function runCancellationConfirmationRequest(
  snapshot: EngineeringProjectSnapshot,
  runId: string,
  rationale: string,
) {
  const run = snapshot.agentRuns.find((candidate) => candidate.id === runId)!;
  return {
    resultType: "input_required",
    inputRequests: {
      run_cancellation_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `Cancel queued agent run “${run.id}” for work item “${run.workItemId}”? It has not been claimed or executed. Recorded rationale: ${rationale}. Confirm this exact cancellation, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: "Confirm queued-run cancellation",
                description:
                  "I confirm this queued run should be cancelled before any agent claim or execution.",
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function runCancellationConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Queued-run cancellation requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.run_cancellation_confirmation,
    "inputResponses.run_cancellation_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.run_cancellation_confirmation",
  );
  const responseAction = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.run_cancellation_confirmation.action",
  );
  if (responseAction !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.run_cancellation_confirmation.content",
  );
  exactKeys(
    content,
    ["confirmed"],
    [],
    "inputResponses.run_cancellation_confirmation.content",
  );
  return requiredBoolean(
    content.confirmed,
    "inputResponses.run_cancellation_confirmation.content.confirmed",
  );
}

function decisionConfirmationRequest(
  snapshot: EngineeringProjectSnapshot,
  decisionId: string,
  action: "approve" | "reject",
  rationale: string,
) {
  const decision = snapshot.decisions.find((candidate) => candidate.id === decisionId)!;
  const proposal = decision.proposal!;
  const disposition = action === "approve" ? "approve" : "reject";
  const parameters = proposal.parameters.map((parameter) =>
    `${parameter.label}: ${String(parameter.value)}${
      parameter.unit ? ` ${parameter.unit}` : ""
    }`
  ).join("; ");
  /**
   * WHY THE EVIDENCE REFS ARE SPELLED OUT — the approval cryptographically
   * seals the server-stamped inputEvidenceRefs, and executors (e.g.
   * record.archive-lineage@1) refuse to run unless the approved refs equal
   * their bindings exactly. If the elicitation only showed summary and
   * parameters, two proposals targeting different entities could read
   * identically, and the human would seal an exact choice they never saw.
   *
   * WHY CANONICAL JSON — the ref fields are only constrained to be non-empty,
   * so any hand-rolled separator could be forged by an ID that embeds it,
   * letting two different target sets render the same message. JSON escaping
   * makes the rendering injective. The refs are rendered from the decision,
   * never from agent input.
   */
  const evidenceRefs = decision.inputEvidenceRefs.length > 0
    ? deterministicJson(decision.inputEvidenceRefs)
    : "";
  return {
    resultType: "input_required",
    inputRequests: {
      decision_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `The agent proposes to ${disposition} “${decision.title}”. Proposal: ${proposal.summary}${
              parameters ? `. Parameters: ${parameters}` : ""
            }${
              evidenceRefs ? `. Exact evidence targets: ${evidenceRefs}` : ""
            }. Recorded rationale: ${rationale}. Confirm this exact ${disposition} action, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: `Confirm decision ${disposition}`,
                description:
                  `I confirm that the displayed proposal and rationale should be ${
                    action === "approve" ? "approved" : "recorded as rejected"
                  }.`,
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function decisionConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Decision confirmation requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.decision_confirmation,
    "inputResponses.decision_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.decision_confirmation",
  );
  const responseAction = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.decision_confirmation.action",
  );
  if (responseAction !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.decision_confirmation.content",
  );
  exactKeys(
    content,
    ["confirmed"],
    [],
    "inputResponses.decision_confirmation.content",
  );
  return requiredBoolean(
    content.confirmed,
    "inputResponses.decision_confirmation.content.confirmed",
  );
}

async function requiredProposedDecision(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
  expectedRevision: number,
  decisionId: string,
  inputFingerprint: ContentFingerprint,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await requiredProjectRevision(store, projectId, expectedRevision);
  const decision = snapshot.decisions.find((candidate) => candidate.id === decisionId);
  if (
    !decision || decision.status !== "proposed" || !decision.proposal ||
    !decision.inputFingerprint ||
    decision.inputFingerprint.algorithm !== inputFingerprint.algorithm ||
    decision.inputFingerprint.digest !== inputFingerprint.digest
  ) {
    throw new TypeError(
      `Decision ${decisionId} is not the exact proposed decision at project revision ${expectedRevision}.`,
    );
  }
  return snapshot;
}

async function requiredQueuedRun(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
  expectedRevision: number,
  runId: string,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await requiredProjectRevision(store, projectId, expectedRevision);
  const run = snapshot.agentRuns.find((candidate) => candidate.id === runId);
  if (
    !run || run.status !== "queued" || run.startedAt || run.completedAt ||
    run.claimedAt || run.claimedBy || run.waitingForDecisionIds ||
    run.resultSnapshot || run.failure || run.cancellation ||
    run.evidenceRefs.length !== 0
  ) {
    throw new TypeError(
      `Agent run ${runId} is not an unclaimed queued run at project revision ${expectedRevision}.`,
    );
  }
  return snapshot;
}

function requiredQueueWorkItem(
  project: EngineeringProjectSnapshot,
  workItemId: string,
) {
  if (project.schemaVersion === "1.0") {
    throw new TypeError(
      "project_agent_run_queue does not execute historical V1 work.",
    );
  }
  const workItem = project.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem || !workItem.operation) {
    throw new TypeError(
      `Work item ${workItemId} has no registered operation to queue.`,
    );
  }
  return workItem;
}

function queueRunSummary(
  workItem: ReturnType<typeof requiredQueueWorkItem>,
): string {
  return `Execute reviewed operation ${workItem.operation!.id}@${
    workItem.operation!.version
  } for ${workItem.title}.`;
}

function queueExecutionBasis(
  project: EngineeringProjectSnapshot,
  workItem: ReturnType<typeof requiredQueueWorkItem>,
): { readonly basis: EngineeringBasisRef } {
  if (project.threadSnapshots.length === 0) {
    const expectedInitialOperation = "baseline.from-approved-brief";
    if (
      !project.plan ||
      workItem.operation!.id !== expectedInitialOperation ||
      workItem.operation!.version !== "1"
    ) {
      throw new TypeError(
        `Before a documentary baseline exists, this project can queue only ${expectedInitialOperation}@1.`,
      );
    }
    return { basis: structuredClone(project.plan.basis) };
  }
  return {
    basis: {
      kind: "thread-snapshot",
      ...declaredProjectHead(project),
    },
  };
}

function mutationSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...COMMON_MUTATION_PROPERTIES, ...properties },
    required: [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      ...required,
    ],
    additionalProperties: false,
  };
}

function commonMutation(args: Record<string, unknown>) {
  return {
    commandId: requiredString(args.commandId, "commandId"),
    projectId: requiredString(args.projectId, "projectId"),
    expectedRevision: positiveInteger(args.expectedRevision, "expectedRevision"),
    issuedAt: isoDateTime(args.issuedAt, "issuedAt"),
  };
}

function agentOrigin(context?: ToolHandlerContext) {
  const subject = context?.authInfo?.subject?.trim();
  if (subject) return { kind: "agent" as const, actorId: subject };
  const name = context?.clientInfo?.name?.trim();
  const version = context?.clientInfo?.version?.trim();
  return {
    kind: "agent" as const,
    actorId: name
      ? `mcp:${name}${version ? `@${version}` : ""}`
      : "mcp:unidentified-client",
  };
}

/**
 * Domain authority asserted by the paired MCP host after accepted elicitation.
 * Signed requestState proves retry integrity, not the person's identity; the
 * host and its transport authentication remain the trust boundary.
 */
function elicitedHumanOrigin(context?: ToolHandlerContext) {
  const subject = context?.authInfo?.subject?.trim();
  const name = context?.clientInfo?.name?.trim();
  const version = context?.clientInfo?.version?.trim();
  const channel = subject ||
    (name ? `${name}${version ? `@${version}` : ""}` : "client");
  return {
    kind: "human" as const,
    actorId: `mcp-elicitation:${channel}`,
  };
}

async function requiredProject(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await store.get(projectId);
  if (!snapshot) throw new TypeError(`Engineering project not found: ${projectId}.`);
  return snapshot;
}

async function requiredProjectRevision(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
  revision: number,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await store.getRevision(projectId, revision);
  if (!snapshot) {
    throw new TypeError(
      `Engineering project revision not found: ${projectId}@${revision}.`,
    );
  }
  return snapshot;
}

function declaredProjectHead(
  project: EngineeringProjectSnapshot,
): EngineeringThreadSnapshotRef {
  const reference =
    [...project.threadSnapshots].sort((left, right) =>
      right.revision - left.revision ||
      right.snapshotId.localeCompare(left.snapshotId)
    )[0];
  if (!reference) {
    throw new TypeError(
      `Engineering project ${project.project.id} has no exact thread snapshot.`,
    );
  }
  return structuredClone(reference);
}

function threadSnapshotReference(
  value: unknown,
  name: string,
): EngineeringThreadSnapshotRef {
  const record = exactRecord(value, name);
  exactKeys(record, ["snapshotId", "revision", "subjectId"], [], name);
  const snapshotId = requiredString(record.snapshotId, `${name}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${name}.snapshotId cannot use the latest alias`);
  }
  return {
    snapshotId,
    revision: positiveInteger(record.revision, `${name}.revision`),
    subjectId: requiredString(record.subjectId, `${name}.subjectId`),
  };
}

function assertDeclaredProjectHead(
  declared: EngineeringThreadSnapshotRef,
  expected: EngineeringThreadSnapshotRef,
): void {
  if (
    declared.snapshotId !== expected.snapshotId ||
    declared.revision !== expected.revision ||
    declared.subjectId !== expected.subjectId
  ) {
    throw new TypeError(
      `baseSnapshot must exactly equal the current project thread head ${expected.snapshotId}@${expected.revision}.`,
    );
  }
}

function projectResult(content: string, snapshot: EngineeringProjectSnapshot) {
  return {
    content,
    structuredContent: snapshot as unknown as Record<string, unknown>,
  };
}

function decisionProposal(value: unknown): {
  summary: string;
  parameters: Array<{
    key: string;
    label: string;
    value: string | number | boolean;
    unit?: string;
  }>;
} {
  const record = exactRecord(value, "proposal");
  exactKeys(record, ["summary", "parameters"], [], "proposal");
  if (!Array.isArray(record.parameters)) {
    throw new TypeError("proposal.parameters must be an array");
  }
  return {
    summary: requiredString(record.summary, "proposal.summary"),
    parameters: record.parameters.map((item, index) => {
      const parameter = exactRecord(item, `proposal.parameters[${index}]`);
      exactKeys(
        parameter,
        ["key", "label", "value"],
        ["unit"],
        `proposal.parameters[${index}]`,
      );
      const result: {
        key: string;
        label: string;
        value: string | number | boolean;
        unit?: string;
      } = {
        key: requiredString(parameter.key, `proposal.parameters[${index}].key`),
        label: requiredString(
          parameter.label,
          `proposal.parameters[${index}].label`,
        ),
        value: scalar(parameter.value, `proposal.parameters[${index}].value`),
      };
      if (parameter.unit !== undefined) {
        if (typeof result.value !== "number") {
          throw new TypeError(
            `proposal.parameters[${index}].unit is only valid for a numeric value`,
          );
        }
        result.unit = requiredString(
          parameter.unit,
          `proposal.parameters[${index}].unit`,
        );
      }
      return result;
    }),
  };
}

function fingerprintInput(value: unknown, name: string): ContentFingerprint {
  const record = exactRecord(value, name);
  exactKeys(record, ["algorithm", "digest"], [], name);
  if (record.algorithm !== "sha256") {
    throw new TypeError(`${name}.algorithm must be sha256`);
  }
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) {
    throw new TypeError(`${name}.digest must be 64 lowercase hex characters`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function planStartingPoint(value: unknown): EngineeringProjectStartingPoint {
  return oneOf(
    value,
    ["idea-or-spec", "existing-cad", "existing-product"] as const,
    "startingPoint",
  );
}

function planPhases(value: unknown): Array<{
  id: string;
  name: string;
  description: string;
}> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("phases must be a non-empty array");
  }
  return value.map((item, index) => {
    const path = `phases[${index}]`;
    const record = exactRecord(item, path);
    exactKeys(record, ["id", "name", "description"], [], path);
    return {
      id: requiredString(record.id, `${path}.id`),
      name: requiredString(record.name, `${path}.name`),
      description: requiredString(record.description, `${path}.description`),
    };
  });
}

function planWorkItems(value: unknown): Array<{
  id: string;
  phaseId: string;
  owner: EngineeringWorkOwner;
  dependsOnWorkItemIds: string[];
  decisionIds: string[];
  operation: EngineeringOperationRef;
}> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("workItems must be a non-empty array");
  }
  return value.map((item, index) => {
    const path = `workItems[${index}]`;
    const record = exactRecord(item, path);
    exactKeys(
      record,
      [
        "id",
        "phaseId",
        "owner",
        "dependsOnWorkItemIds",
        "decisionIds",
        "operation",
      ],
      [],
      path,
    );
    return {
      id: requiredString(record.id, `${path}.id`),
      phaseId: requiredString(record.phaseId, `${path}.phaseId`),
      owner: oneOf(
        record.owner,
        ["human", "agent", "shared"] as const,
        `${path}.owner`,
      ),
      dependsOnWorkItemIds: stringList(
        record.dependsOnWorkItemIds,
        `${path}.dependsOnWorkItemIds`,
      ),
      decisionIds: stringList(record.decisionIds, `${path}.decisionIds`),
      operation: planOperation(record.operation, `${path}.operation`),
    };
  });
}

function planDecisions(value: unknown): Array<{
  id: string;
  phaseId: string;
  title: string;
  question: string;
}> {
  if (!Array.isArray(value)) throw new TypeError("requiredDecisions must be an array");
  return value.map((item, index) => {
    const path = `requiredDecisions[${index}]`;
    const record = exactRecord(item, path);
    exactKeys(record, ["id", "phaseId", "title", "question"], [], path);
    return {
      id: requiredString(record.id, `${path}.id`),
      phaseId: requiredString(record.phaseId, `${path}.phaseId`),
      title: requiredString(record.title, `${path}.title`),
      question: requiredString(record.question, `${path}.question`),
    };
  });
}

function planOperation(value: unknown, path: string): EngineeringOperationRef {
  const record = exactRecord(value, path);
  exactKeys(record, ["id", "version", "bindings"], [], path);
  if (!Array.isArray(record.bindings)) {
    throw new TypeError(`${path}.bindings must be an array`);
  }
  return {
    id: requiredString(record.id, `${path}.id`),
    version: requiredString(record.version, `${path}.version`),
    bindings: record.bindings.map((binding, index) =>
      planOperationBinding(binding, `${path}.bindings[${index}]`)
    ),
  };
}

function planOperationBinding(
  value: unknown,
  path: string,
): EngineeringOperationInputBinding {
  const record = exactRecord(value, path);
  exactKeys(record, ["name", "source"], [], path);
  const name = requiredString(record.name, `${path}.name`);
  const source = exactRecord(record.source, `${path}.source`);
  const kind = requiredString(source.kind, `${path}.source.kind`);
  switch (kind) {
    case "approved-brief":
      exactKeys(source, ["kind"], [], `${path}.source`);
      return { name, source: { kind } };
    case "project-answer":
      exactKeys(source, ["kind", "answerId"], [], `${path}.source`);
      return {
        name,
        source: {
          kind,
          answerId: requiredString(source.answerId, `${path}.source.answerId`),
        },
      };
    case "thread-entity":
      exactKeys(source, ["kind", "reference"], [], `${path}.source`);
      return {
        name,
        source: {
          kind,
          reference: threadEntityReference(
            source.reference,
            `${path}.source.reference`,
          ),
        },
      };
    default:
      throw new TypeError(
        `${path}.source.kind must be approved-brief, project-answer or thread-entity`,
      );
  }
}

function threadEntityReference(
  value: unknown,
  name: string,
): EngineeringThreadEntityRef {
  const record = exactRecord(value, name);
  exactKeys(record, ["snapshotId", "snapshotRevision", "kind", "id"], [], name);
  const kind = requiredString(record.kind, `${name}.kind`);
  if (!THREAD_ENTITY_KINDS.includes(kind as ThreadEntityKind)) {
    throw new TypeError(`${name}.kind must be a ThreadSnapshot entity kind`);
  }
  return {
    snapshotId: requiredString(record.snapshotId, `${name}.snapshotId`),
    snapshotRevision: positiveInteger(
      record.snapshotRevision,
      `${name}.snapshotRevision`,
    ),
    kind: kind as ThreadEntityKind,
    id: requiredString(record.id, `${name}.id`),
  };
}

function threadEntityReferenceList(
  value: unknown,
  name: string,
): EngineeringThreadEntityRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty array`);
  }
  return value.map((item, index) => threadEntityReference(item, `${name}[${index}]`));
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}

function exactRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(`${name} has unsupported field(s): ${extras.join(", ")}`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing field(s): ${missing.join(", ")}`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function hex64(value: unknown, name: string): string {
  const s = requiredString(value, name);
  if (!/^[a-f0-9]{64}$/.test(s)) {
    throw new TypeError(`${name} must be a 64-char lowercase hex SHA-256`);
  }
  return s;
}

function isoDateTime(value: unknown, name: string): string {
  const result = requiredString(value, name);
  const parsed = parseIsoDateTime(result);
  if (parsed === undefined) {
    throw new TypeError(`${name} must be an ISO date-time`);
  }
  return new Date(parsed).toISOString();
}

function parseIsoDateTime(value: string): number | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value)
  ) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scalar(value: unknown, name: string): string | number | boolean {
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "boolean"
  ) throw new TypeError(`${name} must be a string, finite number or boolean`);
  if (typeof value === "string" && value.trim() === "") {
    throw new TypeError(`${name} must not be empty`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new TypeError(`${name} must be one of ${choices.join(", ")}`);
  }
  return value as T[number];
}
