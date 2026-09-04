/**
 * Tests for the generic `model.write-architecture@1` executor.
 *
 * Test coverage:
 *   - Happy path initial mode: full SysML package insertion, valid snapshot.
 *   - Happy path enrichment mode: incremental insertion, idempotent on second call.
 *   - Refusal: non-agent origin.
 *   - Refusal: no human approval (only agent-approved decision).
 *   - Refusal: WAL dispatched (unknown insertion outcome).
 *   - Cliquet: ancestor had architecture artifact, current basis does not.
 *   - findArchitectureArtifact: URI-prefix predicate.
 *   - assertArchitectureArtifactNotRemoved: direct unit test.
 *
 * Every test that publishes a snapshot calls validateThreadSnapshot implicitly
 * through the executor (and asserted via the returned project's resultSnapshot).
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  architectureWriteSelector,
  type InsertionItem,
  parseArchitectureProposalParameters,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  FileCaptureStore,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../shared/stores/engineering-project-store.ts";
import {
  type EngineeringProjectRunLease,
  FileEngineeringProjectRunLease,
} from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  architectureWritePlanDigest,
  FileArchitectureAttemptStore,
} from "./file-architecture-attempt-store.ts";
import { RenderedArchitectureSysmlAnalyzer } from "./rendered-architecture-sysml-analyzer.ts";
import { SysmlSourceAnalysisCaptureService } from "./sysml-source-analysis-capture.ts";
import { FileSysonModelSeedAttemptStore } from "../seed/file-syson-model-seed-attempt-store.ts";
import { FileThreadSnapshotStore } from "../../shared/stores/file-thread-snapshot-store.ts";
import { ApprovedBriefBaselineRunExecutor } from "../../project/approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../../testing/approved-brief-source-analysis-fixture.ts";
import { SysonModelSeedRunExecutor } from "../seed/syson-model-seed-run-executor.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import {
  ArchitectureArtifactRemovedError,
  assertArchitectureArtifactNotRemoved,
  findArchitectureArtifact,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  ModelWriteArchitectureRunExecutor,
} from "./model-write-architecture-run-executor.ts";
import {
  ARCHITECTURE_FEATURE_TYPING_AQL,
  ArchitectureStructureExtractionError,
} from "./architecture-structure-extractor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../project/engineering-project-initial-baseline-evidence-validator.ts";
import { resolveGenericProductStructureCatalog } from "./product-structure-catalog.ts";
import type {
  EngineeringDecisionProposalParameter,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../shared/stores/live-thread-update-store.ts";
import {
  passthroughCapabilityRuntimeConnection,
  recordingCapabilityRuntimeSession,
  successfulCapabilityRuntimeFor,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT = { kind: "agent" as const, actorId: "mcp:paired-chat@1" };
const HUMAN = {
  kind: "human" as const,
  actorId: "mcp-elicitation:paired-chat@1",
};
const PROJECT_ID = "project:drone-v4-test";

// MRTR proposal parameters for a DroneV4 architecture.
const DRONE_PROPOSAL_PARAMS = [
  { key: "architecture.package", label: "Package name", value: "DroneV4" },
  { key: "system.name", label: "System name", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing name", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  { key: "component.wing.parent", label: "Wing parent", value: "DroneSystem" },
];

const DRONE_ENRICHMENT_PARAMS = [
  { key: "architecture.package", label: "Package name", value: "DroneV4" },
  { key: "system.name", label: "System name", value: "DroneSystem" },
  { key: "component.motor.name", label: "Motor name", value: "Motor" },
  { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  {
    key: "component.motor.parent",
    label: "Motor parent",
    value: "DroneSystem",
  },
];

const DRONE_ATTRIBUTE_PARAMS = [
  ...DRONE_PROPOSAL_PARAMS,
  { key: "attribute.thickness.name", label: "Thickness", value: "thickness" },
  {
    key: "attribute.thickness.parent",
    label: "Thickness parent",
    value: "DroneSystem",
  },
];

const SCOPED_HOMONYM_PROPOSAL_PARAMS = [
  { key: "architecture.package", label: "Package name", value: "DroneV4" },
  { key: "system.name", label: "System name", value: "DroneSystem" },
  { key: "component.leftWing.name", label: "Left wing", value: "LeftWing" },
  { key: "component.leftWing.usage", label: "Left wing", value: "leftWing" },
  { key: "component.rightWing.name", label: "Right wing", value: "RightWing" },
  { key: "component.rightWing.usage", label: "Right wing", value: "rightWing" },
  { key: "component.leftMotor.name", label: "Motor type", value: "Motor" },
  { key: "component.leftMotor.usage", label: "Left motor", value: "motor" },
  { key: "component.leftMotor.parent", label: "Parent", value: "LeftWing" },
  { key: "component.rightMotor.name", label: "Motor type", value: "Motor" },
  { key: "component.rightMotor.usage", label: "Right motor", value: "motor" },
  { key: "component.rightMotor.parent", label: "Parent", value: "RightWing" },
];

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Helper to build a ctx-prefixed command input. */
function ctx(
  commandId: string,
  revision: number,
  projectId = PROJECT_ID,
): {
  commandId: string;
  projectId: string;
  expectedRevision: number;
  issuedAt: string;
} {
  return {
    commandId,
    projectId,
    expectedRevision: revision,
    issuedAt: "2026-08-08T12:00:00.000Z",
  };
}

/**
 * Minimal SysON mock for the seed operation.
 * Matches the real seed tool response shapes.
 */
class SeedSyson implements McpToolClient {
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        `callToolTextResult not implemented by SeedSyson (${call.name})`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_project_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          id: "syson-project-drone",
          name: "DroneV4",
          editingContextId: "editing-context-drone",
        },
      });
    }
    if (call.name === "syson_model_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          documentId: "document-drone",
          documentName: "DroneV4",
          documentKind: "Document",
          rootPackageId: "root-pkg-drone",
          rootPackageLabel: "New Package",
        },
      });
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "read",
        structuredContent: {
          id: "root-pkg-drone",
          kind: "sysml::Package",
          label: "New Package",
        },
      });
    }
    return Promise.reject(new Error(`Unexpected seed tool: ${call.name}`));
  }
}

/**
 * SysON mock for the generic architecture executor — initial mode.
 *
 * Phase 3b uses syson_query_aql (not syson_element_children) to resolve the
 * FeatureTyping target. syson_element_children on a PartUsage returns a
 * FeatureTyping node with label "FeatureTyping" (the relation's own display name
 * in SysON), not the name of the typed PartDef. The AQL expression projects
 * through .type to return the actual typed PartDefinition element.
 *
 * Call sequence:
 *  1. children(root-pkg-drone)         → empty (preflight: package absent)
 *  2. insert_sysml(root-pkg-drone)     → { inserted: true }
 *  3. children(root-pkg-drone)         → has DroneV4 package (post-insert lookup)
 *  4. children(arch-pkg-001)           → DroneSystem + Wing part-defs
 *  5. children(sys-def-001)            → wing usage
 *  6. syson_query_aql(wing-usage-001)  → Wing               [Phase 3b AQL]
 *  7. children(wing-def-001)           → empty
 *  8. children(root-pkg-drone)         → same as 3 (verification re-extraction)
 *  9. children(arch-pkg-001)           → same as 4
 * 10. children(sys-def-001)            → same as 5
 * 11. syson_query_aql(wing-usage-001)  → Wing               [Phase 3b AQL]
 * 12. children(wing-def-001)           → same as 7
 */
class InitialArchSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #childrenCallCount = 0;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        `callToolTextResult not implemented by InitialArchSyson (${call.name})`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_insert_sysml") {
      // Any insertion: acknowledge with the requested parentId.
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }

    if (call.name === "syson_element_children") {
      this.#childrenCallCount++;
      const elementId = call.arguments?.element_id as string;

      if (elementId === "root-pkg-drone") {
        // First call = preflight (package absent), others = post-insert / verify
        if (this.#childrenCallCount === 1) {
          return Promise.resolve({
            text: "empty",
            structuredContent: { parentId: elementId, children: [], count: 0 },
          });
        }
        return Promise.resolve({
          text: "root-with-package",
          structuredContent: {
            parentId: elementId,
            children: [{
              id: "arch-pkg-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=Package",
              label: "DroneV4",
            }],
            count: 1,
          },
        });
      }

      if (elementId === "arch-pkg-001") {
        return Promise.resolve({
          text: "package-contents",
          structuredContent: {
            parentId: elementId,
            children: [
              {
                id: "sys-def-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                label: "DroneSystem",
              },
              {
                id: "wing-def-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                label: "Wing",
              },
            ],
            count: 2,
          },
        });
      }

      if (elementId === "sys-def-001") {
        return Promise.resolve({
          text: "system-usages",
          structuredContent: {
            parentId: elementId,
            children: [{
              id: "wing-usage-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
              label: "wing",
            }],
            count: 1,
          },
        });
      }

      // Wing def: no usages
      return Promise.resolve({
        text: "no-usages",
        structuredContent: { parentId: elementId, children: [], count: 0 },
      });
    }

    // Phase 3b: AQL resolves the FeatureTyping target for "wing" usage → "Wing".
    if (call.name === "syson_query_aql") {
      const objectId = call.arguments?.object_id as string;
      const expression = call.arguments?.expression;
      if (
        objectId === "wing-usage-001" &&
        expression === ARCHITECTURE_FEATURE_TYPING_AQL
      ) {
        return Promise.resolve({
          text: "feature-typing-aql",
          structuredContent: {
            objectId,
            expression,
            type: "objects",
            results: [{
              id: "wing-def-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: "Wing",
            }],
            count: 1,
          },
        });
      }
    }

    return Promise.reject(
      new Error(`Unexpected tool call in InitialArchSyson: ${call.name}`),
    );
  }
}

/**
 * Real-provider regression: the full package ACK retains only its Package and
 * system PartDefinition. Subsequent exact per-item calls complete the graph.
 */
class PrefixOnlyInitialArchSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #packageInserted = false;
  #wingDefinitionInserted = false;
  #wingUsageInserted = false;
  #wingTypingLinked = false;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        `callToolTextResult not implemented by PrefixOnlyInitialArchSyson (${call.name})`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_insert_sysml") {
      const parentId = call.arguments?.parent_id as string;
      const source = call.arguments?.sysml_text as string;
      if (parentId === "root-pkg-drone" && source.startsWith("package DroneV4")) {
        this.#packageInserted = true;
      } else if (parentId === "arch-pkg-001" && source === "part def Wing {}") {
        this.#wingDefinitionInserted = true;
      } else {
        return Promise.reject(
          new Error(`Unexpected prefix-recovery insertion: ${parentId} ${source}`),
        );
      }
      return Promise.resolve({
        text: "inserted",
        structuredContent: { inserted: true, parentId },
      });
    }
    if (call.name === "syson_element_create") {
      const parentId = call.arguments?.parent_id as string;
      if (
        parentId === "sys-def-001" &&
        call.arguments?.child_type === "SysMLv2EditService-PartUsage" &&
        call.arguments?.name === "wing"
      ) {
        this.#wingUsageInserted = true;
        return Promise.resolve({
          text: "usage",
          structuredContent: {
            id: "wing-usage-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: "wing",
          },
        });
      }
      if (
        parentId === "wing-usage-001" &&
        call.arguments?.child_type === "SysMLv2EditService-FeatureTyping" &&
        call.arguments?.name === "Wing"
      ) {
        return Promise.resolve({
          text: "typing",
          structuredContent: {
            id: "wing-typing-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=FeatureTyping",
            label: "Wing",
          },
        });
      }
    }
    if (call.name === "syson_element_children") {
      const parentId = call.arguments?.element_id as string;
      if (parentId === "root-pkg-drone") {
        const children = this.#packageInserted
          ? [{
            id: "arch-pkg-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=Package",
            label: "DroneV4",
          }]
          : [];
        return Promise.resolve({
          text: "root",
          structuredContent: { parentId, children, count: children.length },
        });
      }
      if (parentId === "arch-pkg-001") {
        const children = [{
          id: "sys-def-001",
          kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
          label: "DroneSystem",
        }];
        if (this.#wingDefinitionInserted) {
          children.push({
            id: "wing-def-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "Wing",
          });
        }
        return Promise.resolve({
          text: "package",
          structuredContent: { parentId, children, count: children.length },
        });
      }
      if (parentId === "sys-def-001") {
        const children = this.#wingUsageInserted
          ? [{
            id: "wing-usage-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: "wing",
          }]
          : [];
        return Promise.resolve({
          text: "system",
          structuredContent: { parentId, children, count: children.length },
        });
      }
      return Promise.resolve({
        text: "leaf",
        structuredContent: { parentId, children: [], count: 0 },
      });
    }
    if (call.name === "syson_query_aql") {
      const objectId = call.arguments?.object_id;
      const expression = call.arguments?.expression;
      if (objectId === "wing-def-001" && expression === "aql:self.elementId") {
        return Promise.resolve({
          text: "semantic id",
          structuredContent: {
            objectId,
            expression,
            type: "string",
            result: "wing-semantic-id",
          },
        });
      }
      if (
        objectId === "wing-typing-001" &&
        typeof expression === "string" &&
        expression.includes("e.elementId = 'wing-semantic-id'")
      ) {
        this.#wingTypingLinked = true;
        return Promise.resolve({
          text: "linked",
          structuredContent: { objectId, expression, type: "void", result: null },
        });
      }
      if (
        objectId === "wing-usage-001" &&
        expression === ARCHITECTURE_FEATURE_TYPING_AQL &&
        this.#wingTypingLinked
      ) {
        return Promise.resolve({
          text: "typing",
          structuredContent: {
            objectId,
            expression,
            type: "objects",
            results: [{
              id: "wing-def-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: "Wing",
            }],
            count: 1,
          },
        });
      }
    }
    return Promise.reject(
      new Error(`Unexpected prefix-recovery tool: ${call.name}`),
    );
  }
}

/** Final readback reuses the Wing PartDefinition id for the wing PartUsage. */
class CrossKindSemanticIdCollisionInitialArchSyson extends InitialArchSyson {
  override async callTool(call: McpToolCall): Promise<McpToolResult> {
    if (
      call.name === "syson_query_aql" &&
      call.arguments?.object_id === "wing-def-001"
    ) {
      this.calls.push(structuredClone(call));
      return {
        text: "feature-typing-aql",
        structuredContent: {
          objectId: "wing-def-001",
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
          type: "objects",
          results: [{
            id: "wing-def-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "Wing",
          }],
          count: 1,
        },
      };
    }

    const result = await super.callTool(call);
    if (
      call.name !== "syson_element_children" ||
      call.arguments?.element_id !== "sys-def-001"
    ) return result;
    const content = result.structuredContent as {
      parentId: string;
      children: Record<string, unknown>[];
    };
    const children = content.children.map((child) => ({
      ...child,
      id: "wing-def-001",
    }));
    return {
      ...result,
      structuredContent: { ...content, children, count: children.length },
    };
  }
}

/** Initial readback with two locally-scoped `motor` usages sharing one Motor type. */
class ScopedHomonymInitialArchSyson extends InitialArchSyson {
  #rootReads = 0;

  override callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_insert_sysml") {
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }
    if (call.name === "syson_element_children") {
      const elementId = call.arguments?.element_id as string;
      if (elementId === "root-pkg-drone") {
        this.#rootReads++;
        const children = this.#rootReads === 1 ? [] : [{
          id: "arch-pkg-001",
          kind: "siriusComponents://semantic?domain=sysml&entity=Package",
          label: "DroneV4",
        }];
        return Promise.resolve({
          text: "root",
          structuredContent: {
            parentId: elementId,
            children,
            count: children.length,
          },
        });
      }
      if (elementId === "arch-pkg-001") {
        const labels = [
          ["sys-def-001", "DroneSystem"],
          ["left-wing-def-001", "LeftWing"],
          ["right-wing-def-001", "RightWing"],
          ["motor-def-001", "Motor"],
        ];
        const children = labels.map(([id, label]) => ({
          id,
          kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
          label,
        }));
        return Promise.resolve({
          text: "definitions",
          structuredContent: {
            parentId: elementId,
            children,
            count: children.length,
          },
        });
      }
      const usagesByParent: Record<
        string,
        Array<{ id: string; label: string }>
      > = {
        "sys-def-001": [
          { id: "left-wing-usage-001", label: "leftWing" },
          { id: "right-wing-usage-001", label: "rightWing" },
        ],
        "left-wing-def-001": [{ id: "left-motor-usage-001", label: "motor" }],
        "right-wing-def-001": [{ id: "right-motor-usage-001", label: "motor" }],
        "motor-def-001": [],
      };
      const children = (usagesByParent[elementId] ?? []).map((usage) => ({
        ...usage,
        kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
      }));
      return Promise.resolve({
        text: "usages",
        structuredContent: {
          parentId: elementId,
          children,
          count: children.length,
        },
      });
    }
    if (call.name === "syson_query_aql") {
      const objectId = call.arguments?.object_id as string;
      const targets: Record<string, { id: string; label: string }> = {
        "left-wing-usage-001": { id: "left-wing-def-001", label: "LeftWing" },
        "right-wing-usage-001": {
          id: "right-wing-def-001",
          label: "RightWing",
        },
        "left-motor-usage-001": { id: "motor-def-001", label: "Motor" },
        "right-motor-usage-001": { id: "motor-def-001", label: "Motor" },
      };
      const target = targets[objectId];
      if (target) {
        return Promise.resolve({
          text: "feature-typing",
          structuredContent: {
            objectId,
            expression: ARCHITECTURE_FEATURE_TYPING_AQL,
            type: "objects",
            results: [{
              ...target,
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            }],
            count: 1,
          },
        });
      }
    }
    return Promise.reject(
      new Error(`Unexpected scoped-homonym tool: ${call.name}`),
    );
  }
}

/** Stateful readback for a second generic run that enriches the first package. */
class EnrichmentArchSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #motorDefinitionInserted = false;
  #motorUsageInserted = false;
  #motorTypingLinked = false;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`Unexpected text tool: ${call.name}`));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_insert_sysml") {
      const parentId = call.arguments?.parent_id as string;
      const text = call.arguments?.sysml_text as string;
      if (text.startsWith("part def Motor")) {
        this.#motorDefinitionInserted = true;
      }
      return Promise.resolve({
        text: "inserted",
        structuredContent: { inserted: true, parentId },
      });
    }
    if (call.name === "syson_element_create") {
      const parentId = call.arguments?.parent_id;
      if (
        parentId === "sys-def-001" &&
        call.arguments?.child_type === "SysMLv2EditService-PartUsage" &&
        call.arguments?.name === "motor"
      ) {
        this.#motorUsageInserted = true;
        return Promise.resolve({
          text: "usage",
          structuredContent: {
            id: "motor-usage-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: "motor",
          },
        });
      }
      if (
        parentId === "motor-usage-001" &&
        call.arguments?.child_type === "SysMLv2EditService-FeatureTyping" &&
        call.arguments?.name === "Motor"
      ) {
        return Promise.resolve({
          text: "typing",
          structuredContent: {
            id: "motor-typing-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=FeatureTyping",
            label: "Motor",
          },
        });
      }
    }
    if (call.name === "syson_element_children") {
      const elementId = call.arguments?.element_id as string;
      if (elementId === "root-pkg-drone") {
        return Promise.resolve({
          text: "root",
          structuredContent: {
            parentId: elementId,
            children: [{
              id: "arch-pkg-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=Package",
              label: "DroneV4",
            }],
            count: 1,
          },
        });
      }
      if (elementId === "arch-pkg-001") {
        const children = [
          {
            id: "sys-def-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "DroneSystem",
          },
          {
            id: "wing-def-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "Wing",
          },
          ...(this.#motorDefinitionInserted
            ? [{
              id: "motor-def-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: "Motor",
            }]
            : []),
        ];
        return Promise.resolve({
          text: "parts",
          structuredContent: {
            parentId: elementId,
            children,
            count: children.length,
          },
        });
      }
      if (elementId === "sys-def-001") {
        const children = [
          {
            id: "wing-usage-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: "wing",
          },
          ...(this.#motorUsageInserted
            ? [{
              id: "motor-usage-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
              label: "motor",
            }]
            : []),
        ];
        return Promise.resolve({
          text: "system-usages",
          structuredContent: {
            parentId: elementId,
            children,
            count: children.length,
          },
        });
      }
      return Promise.resolve({
        text: "no-usages",
        structuredContent: { parentId: elementId, children: [], count: 0 },
      });
    }
    if (call.name === "syson_query_aql") {
      const usageId = call.arguments?.object_id as string;
      const expression = call.arguments?.expression;
      if (usageId === "motor-def-001" && expression === "aql:self.elementId") {
        return Promise.resolve({
          text: "semantic id",
          structuredContent: {
            objectId: usageId,
            expression,
            type: "string",
            result: "motor-semantic-id",
          },
        });
      }
      if (
        usageId === "motor-typing-001" &&
        typeof expression === "string" &&
        expression.includes("e.elementId = 'motor-semantic-id'")
      ) {
        this.#motorTypingLinked = true;
        return Promise.resolve({
          text: "linked",
          structuredContent: {
            objectId: usageId,
            expression,
            type: "void",
            result: null,
          },
        });
      }
      const motor = usageId === "motor-usage-001";
      if (motor && !this.#motorTypingLinked) {
        return Promise.reject(new Error("Motor typing is not linked."));
      }
      const label = motor ? "Motor" : "Wing";
      return Promise.resolve({
        text: "feature-typing",
        structuredContent: {
          objectId: usageId,
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
          type: "objects",
          results: [{
            id: motor ? "motor-def-001" : "wing-def-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label,
          }],
          count: 1,
        },
      });
    }
    return Promise.reject(new Error(`Unexpected tool: ${call.name}`));
  }
}

class AttributeInitialArchSyson extends InitialArchSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (
      call.name === "syson_element_children" &&
      call.arguments?.element_id === "sys-def-001"
    ) {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "system-features-with-attribute",
        structuredContent: {
          parentId: "sys-def-001",
          children: [{
            id: "wing-usage-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: "wing",
          }, {
            id: "attribute-thickness-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
            label: "thickness",
          }],
          count: 2,
        },
      });
    }
    return super.callTool(call);
  }
}

class ForeignAttributeInitialArchSyson extends InitialArchSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (
      call.name === "syson_element_children" &&
      call.arguments?.element_id === "sys-def-001"
    ) {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "system-features-with-foreign-attribute",
        structuredContent: {
          parentId: "sys-def-001",
          children: [{
            id: "wing-usage-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: "wing",
          }, {
            id: "attribute-foreign-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
            label: "foreignFlag",
          }],
          count: 2,
        },
      });
    }
    return super.callTool(call);
  }
}

class LostInheritedAttributeEnrichmentSyson extends EnrichmentArchSyson {
  #systemReads = 0;

  constructor(private readonly mode: "removed" | "replaced") {
    super();
  }

  override async callTool(call: McpToolCall): Promise<McpToolResult> {
    const result = await super.callTool(call);
    if (
      call.name !== "syson_element_children" ||
      call.arguments?.element_id !== "sys-def-001"
    ) return result;
    this.#systemReads++;
    const content = result.structuredContent as {
      parentId: string;
      children: Record<string, unknown>[];
    };
    const attributes = this.#systemReads === 1
      ? [{
        id: "attribute-thickness-001",
        kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
        label: "thickness",
      }]
      : this.mode === "replaced"
      ? [{
        id: "attribute-thickness-replacement",
        kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
        label: "thickness",
      }]
      : [];
    const children = [...content.children, ...attributes];
    return {
      ...result,
      structuredContent: { ...content, children, count: children.length },
    };
  }
}

class DuplicateInheritedPartDefinitionEnrichmentSyson extends EnrichmentArchSyson {
  #architecturePackageReads = 0;

  override async callTool(call: McpToolCall): Promise<McpToolResult> {
    const result = await super.callTool(call);
    if (
      call.name !== "syson_element_children" ||
      call.arguments?.element_id !== "arch-pkg-001"
    ) return result;
    this.#architecturePackageReads++;
    // Preflight (1) and Phase-B (2) remain coherent.  The post-ack verification
    // readback (3) concurrently duplicates an inherited PartDefinition.
    if (this.#architecturePackageReads < 3) return result;
    const content = result.structuredContent as {
      parentId: string;
      children: Record<string, unknown>[];
    };
    const children = [...content.children, {
      id: "wing-def-duplicate",
      kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
      label: "Wing",
    }];
    return {
      ...result,
      structuredContent: { ...content, children, count: children.length },
    };
  }
}

/**
 * Simulates a concurrent duplicate appearing exactly between the Phase-A
 * PartDefinition ACK and the Phase-B parent-ID readback.  This is the narrow
 * partial-write boundary: no PartUsage has been attempted yet, but SysON has
 * already accepted one non-idempotent mutation.
 */
class PhaseBAmbiguousEnrichmentSyson extends EnrichmentArchSyson {
  #architecturePackageReads = 0;

  override async callTool(call: McpToolCall): Promise<McpToolResult> {
    const result = await super.callTool(call);
    if (
      call.name !== "syson_element_children" ||
      call.arguments?.element_id !== "arch-pkg-001"
    ) return result;
    this.#architecturePackageReads++;
    // Read 1 is the preflight. Read 2 is Phase B, after the Motor part-def
    // insertion was acknowledged and before the Motor usage can be authored.
    if (this.#architecturePackageReads !== 2) return result;
    const content = result.structuredContent as {
      parentId: string;
      children: Record<string, unknown>[];
    };
    const children = [...content.children, {
      id: "motor-def-concurrent-duplicate",
      kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
      label: "Motor",
    }];
    return {
      ...result,
      structuredContent: { ...content, children, count: children.length },
    };
  }
}

class DuplicateInheritedUsageEnrichmentSyson extends EnrichmentArchSyson {
  #systemReads = 0;

  override async callTool(call: McpToolCall): Promise<McpToolResult> {
    const result = await super.callTool(call);
    if (
      call.name !== "syson_element_children" ||
      call.arguments?.element_id !== "sys-def-001"
    ) return result;
    this.#systemReads++;
    // The initial preflight is coherent.  Only the post-ack verification adds
    // a second, homonymous inherited occurrence with a distinct provider id.
    if (this.#systemReads < 2) return result;
    const content = result.structuredContent as {
      parentId: string;
      children: Record<string, unknown>[];
    };
    const children = [...content.children, {
      id: "wing-usage-duplicate",
      kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
      label: "wing",
    }];
    return {
      ...result,
      structuredContent: { ...content, children, count: children.length },
    };
  }
}

// ── Master fixture ────────────────────────────────────────────────────────────

interface ArchFixture {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: FileThreadSnapshotStore;
  readonly seedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly archCaptures: FileCaptureStore<"architecture-capture">;
  readonly archAttempts: FileArchitectureAttemptStore;
  readonly sysmlSourceCaptures: FileCaptureStore<"sysml-source-capture">;
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisCaptureService;
  readonly seedDecisionInputFp: ContentFingerprint;
  readonly queued: { readonly revision: number; readonly runId: string };
}

/**
 * Build a fully initialised fixture with:
 *  - A project that completed the seed run (snapshot with sysml-model seed artifact).
 *  - A change that adds the architecture work item + decision.
 *  - A human-approved MRTR decision with proposal parameters.
 *  - A queued architecture run.
 */
async function queuedArchitectureFixture(
  directory: string,
  proposalParams = DRONE_PROPOSAL_PARAMS,
  prepareParallelSibling = false,
): Promise<ArchFixture> {
  const projects = new FileEngineeringProjectRevisionStore(
    `${directory}/projects`,
  );
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed-captures`,
  });
  const archCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/arch-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(
    `${directory}/seed-attempts`,
  );
  const archAttempts = new FileArchitectureAttemptStore(
    `${directory}/arch-attempts`,
  );
  const sysmlSourceCaptures = new FileCaptureStore({
    ...SYSML_SOURCE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sysml-source-captures`,
  });
  const sourceAnalysisCaptures = new FileCaptureStore({
    ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/source-analysis-captures`,
  });
  const sysmlSourceAnalysis = new SysmlSourceAnalysisCaptureService({
    sourceCaptures: sysmlSourceCaptures,
    analysisCaptures: sourceAnalysisCaptures,
    frontend: new RenderedArchitectureSysmlAnalyzer(),
  });

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T12:00:00.000Z") + ++tick * 1_000)
      .toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-drone-v4",
    projectId: PROJECT_ID,
    projectName: "DroneV4 test",
    issuedAt: "2026-08-08T11:59:00.000Z",
    intent: "Architecture executor integration test.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Test the generic architecture executor.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Insert a DroneV4 SysML package.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Architecture capture is readable and snapshot validates.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved for integration test.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
  );

  // Publish plan with baseline work item only.
  // wi:seed must be introduced via appendChange so that SysonModelSeedRunExecutor
  // can find exactly one additive planChange that includes the seed work item id.
  project = await commands.publishPlan(AGENT, {
    ...ctx("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Documentary baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "wi:baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });

  // Queue + execute baseline run.
  project = await commands.queueRun(AGENT, {
    ...ctx("queue-baseline", project.revision),
    runId: "run:baseline",
    workItemId: "wi:baseline",
    summary: "Record baseline.",
    basis: project.plan!.basis,
  });
  const afterBaseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-08T12:05:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-baseline",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:05:00.000Z",
    runId: "run:baseline",
  });
  const r1 = afterBaseline.threadSnapshots[0]!;

  // Append seed work item via a dedicated change so requiredPlanningLineage passes.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-seed-change", afterBaseline.revision),
    baseSnapshot: r1,
    phases: [{
      id: "model",
      name: "System model",
      description: "Create the SysON model container.",
    }],
    workItems: [{
      id: "wi:seed",
      phaseId: "model",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:baseline"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });

  // Queue + execute seed run.
  project = await commands.queueRun(AGENT, {
    ...ctx("queue-seed", project.revision),
    runId: "run:seed",
    workItemId: "wi:seed",
    summary: "Create SysON model container.",
    basis: { kind: "thread-snapshot", ...r1 },
  });
  const afterSeed = await new SysonModelSeedRunExecutor({
    projects,
    commands,
    snapshots,
    captures: seedCaptures,
    attempts: seedAttempts,
    capabilityRuntimeConnection: passthroughCapabilityRuntimeConnection(
      new SeedSyson(),
    ),
    lease: new FileEngineeringProjectRunLease(`${directory}/seed-leases`),
    ...successfulCapabilityRuntimeFor(
      PROJECT_ID,
      SYSON_MODEL_SEED_OPERATION,
      "model.author-system",
    ),
    now: () => "2026-08-08T12:10:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-seed",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:10:00.000Z",
    runId: "run:seed",
  });

  const r2 = afterSeed.threadSnapshots.at(-1)!;

  // Append architecture work item + required decision.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-arch-change", afterSeed.revision),
    baseSnapshot: r2,
    phases: [{
      id: "arch",
      name: "Architecture",
      description: "Author the system architecture.",
    }],
    workItems: [{
      id: "wi:architecture",
      phaseId: "arch",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:seed"],
      decisionIds: ["decision:arch-params"],
      operation: {
        ...MODEL_WRITE_ARCHITECTURE_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [{
      id: "decision:arch-params",
      phaseId: "arch",
      title: "Architecture component declaration",
      question: "Which components and package name should be authored into SysON?",
    }],
  });

  // Propose decision with the architecture parameters.
  project = await commands.proposeDecision(AGENT, {
    ...ctx("propose-decision", project.revision),
    decisionId: "decision:arch-params",
    baseSnapshot: r2,
    proposal: {
      summary: "DroneV4 architecture package",
      parameters: proposalParams,
    },
  });
  const decision = project.decisions.find((d) => d.id === "decision:arch-params")!;
  const approval = project.approvals.find((a) =>
    a.decisionId === "decision:arch-params"
  )!;
  const inputFp = decision.inputFingerprint!;

  // Human approves the decision.
  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-decision", project.revision),
    decisionId: "decision:arch-params",
    rationale: "The architecture proposal is correct.",
    inputFingerprint: approval.inputFingerprint!,
  });

  if (prepareParallelSibling) {
    project = await commands.appendChange(AGENT, {
      ...ctx("append-parallel-architecture", project.revision),
      baseSnapshot: r2,
      phases: [{
        id: "arch-parallel",
        name: "Parallel architecture",
        description: "Reviewed sibling sealed to the original architecture basis.",
      }],
      workItems: [{
        id: "wi:architecture-parallel",
        phaseId: "arch-parallel",
        owner: "agent",
        dependsOnWorkItemIds: ["wi:seed"],
        decisionIds: ["decision:arch-parallel"],
        operation: {
          ...MODEL_WRITE_ARCHITECTURE_OPERATION,
          bindings: [{
            name: "approvedBrief",
            source: { kind: "approved-brief" },
          }],
        },
      }],
      requiredDecisions: [{
        id: "decision:arch-parallel",
        phaseId: "arch-parallel",
        title: "Parallel architecture declaration",
        question: "Which reviewed architecture is proposed from the original basis?",
      }],
    });
    project = await commands.proposeDecision(AGENT, {
      ...ctx("propose-parallel-architecture", project.revision),
      decisionId: "decision:arch-parallel",
      baseSnapshot: r2,
      proposal: {
        summary: "Parallel DroneV4 architecture package",
        parameters: proposalParams,
      },
    });
    const parallelApproval = project.approvals.find((candidate) =>
      candidate.decisionId === "decision:arch-parallel"
    );
    assertExists(parallelApproval);
    project = await commands.approveDecision(HUMAN, {
      ...ctx("approve-parallel-architecture", project.revision),
      decisionId: "decision:arch-parallel",
      rationale: "Approved only as a concurrency test sibling.",
      inputFingerprint: parallelApproval.inputFingerprint!,
    });
  }

  // Queue the architecture run.
  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-arch", project.revision),
    runId: "run:architecture",
    workItemId: "wi:architecture",
    summary: "Author the DroneV4 system architecture.",
    basis: { kind: "thread-snapshot", ...r2 },
  });

  return {
    projects,
    commands,
    snapshots,
    seedCaptures,
    archCaptures,
    archAttempts,
    sysmlSourceCaptures,
    sourceAnalysisCaptures,
    sysmlSourceAnalysis,
    seedDecisionInputFp: inputFp,
    queued: { revision: queued.revision, runId: "run:architecture" },
  };
}

/** Build a configured executor for the fixture. */
function makeExecutor(
  fixture: ArchFixture,
  options: {
    syson: McpToolClient;
    directory: string;
    nowStr?: string;
    leaseSubdir?: string;
    snapshots?: ThreadSnapshotStore;
    attempts?: FileArchitectureAttemptStore;
    lease?: EngineeringProjectRunLease;
    captures?: FileCaptureStore<"architecture-capture">;
    sysmlSourceAnalysis?: SysmlSourceAnalysisCaptureService;
    projects?: EngineeringProjectRevisionStore;
    liveUpdates?: LiveThreadUpdateMilestoneJournal;
    capabilityRuntimeSession?: ReturnType<
      typeof recordingCapabilityRuntimeSession
    >;
  },
): ModelWriteArchitectureRunExecutor {
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_WRITE_ARCHITECTURE_OPERATION,
    "model.author-system",
  );
  return new ModelWriteArchitectureRunExecutor({
    projects: options.projects ?? fixture.projects,
    commands: fixture.commands,
    snapshots: options.snapshots ?? fixture.snapshots,
    seedCaptures: fixture.seedCaptures,
    captures: options.captures ?? fixture.archCaptures,
    sysmlSourceAnalysis: options.sysmlSourceAnalysis ??
      fixture.sysmlSourceAnalysis,
    attempts: options.attempts ?? fixture.archAttempts,
    syson: options.syson,
    lease: options.lease ?? new FileEngineeringProjectRunLease(
      `${options.directory}/${options.leaseSubdir ?? "arch-leases"}`,
    ),
    capabilityRuntime: capability.capabilityRuntime,
    capabilityRuntimeSession: options.capabilityRuntimeSession ??
      capability.capabilityRuntimeSession,
    liveUpdates: options.liveUpdates,
    now: () => options.nowStr ?? "2026-08-08T12:15:00.000Z",
  });
}

function replaceStringDeep<T>(value: T, from: string, to: string): T {
  const replace = (candidate: unknown): unknown => {
    if (typeof candidate === "string") return candidate.replaceAll(from, to);
    if (Array.isArray(candidate)) return candidate.map(replace);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate).map(([key, item]) => [key, replace(item)]),
      );
    }
    return candidate;
  };
  return replace(value) as T;
}

function reconciliationProbe(): {
  readonly calls: Array<{ subjectId: string; runId: string }>;
  readonly journal: LiveThreadUpdateMilestoneJournal;
} {
  const calls: Array<{ subjectId: string; runId: string }> = [];
  const journal = {
    reconcileRunOnce(subjectId: string, runId: string) {
      calls.push({ subjectId, runId });
      return Promise.resolve(undefined);
    },
  } as unknown as LiveThreadUpdateMilestoneJournal;
  return { calls, journal };
}

/** Execution command for the queued architecture run. */
function executionCommand(
  fixture: Pick<ArchFixture, "queued">,
): {
  commandId: string;
  projectId: string;
  expectedRevision: number;
  issuedAt: string;
  runId: string;
} {
  return {
    commandId: "agent-author-architecture",
    projectId: PROJECT_ID,
    expectedRevision: fixture.queued.revision,
    issuedAt: "2026-08-08T12:15:00.000Z",
    runId: fixture.queued.runId,
  };
}

async function currentWalInput(
  fixture: Pick<ArchFixture, "sysmlSourceAnalysis">,
  input: {
    readonly runId: string;
    readonly dispatchedAt: string;
    readonly items?: readonly InsertionItem[];
  },
) {
  const proposal = parseArchitectureProposalParameters(DRONE_PROPOSAL_PARAMS);
  const items = input.items ?? [{ kind: "full-package" } as const];
  const sourceAnalyses = await Promise.all(
    items.map((item) =>
      fixture.sysmlSourceAnalysis.capture({
        proposal,
        selector: architectureWriteSelector(item, proposal.packageName),
        runId: input.runId,
        operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
      })
    ),
  );
  return {
    projectId: PROJECT_ID,
    runId: input.runId,
    packageName: proposal.packageName,
    items,
    sourceAnalyses,
    planDigest: await architectureWritePlanDigest({
      packageName: proposal.packageName,
      items,
      sourceAnalyses,
    }),
    dispatchedAt: input.dispatchedAt,
  };
}

async function queuedArchitectureBasisSnapshot(
  fixture: Pick<ArchFixture, "projects" | "snapshots">,
): Promise<ThreadSnapshot> {
  const project = await fixture.projects.get(PROJECT_ID);
  if (!project) throw new Error("Architecture fixture project is missing.");
  const run = project.agentRuns.find((candidate) =>
    candidate.id === "run:architecture"
  );
  if (!run?.basis || run.basis.kind !== "thread-snapshot") {
    throw new Error("Architecture fixture run has no thread-snapshot basis.");
  }
  const snapshot = await fixture.snapshots.get(run.basis.snapshotId);
  if (!snapshot) {
    throw new Error("Architecture fixture basis snapshot is missing.");
  }
  return snapshot;
}

async function queueArchitectureEnrichment(
  fixture: Pick<ArchFixture, "projects" | "commands" | "snapshots">,
  completed: Awaited<ReturnType<ModelWriteArchitectureRunExecutor["execute"]>>,
  options: {
    readonly parameters?: readonly EngineeringDecisionProposalParameter[];
    readonly proposalSummary?: string;
    readonly runSummary?: string;
  } = {},
): Promise<{ readonly revision: number; readonly runId: string }> {
  const firstRun = completed.agentRuns.find((run) => run.id === "run:architecture");
  assertExists(firstRun?.resultSnapshot);
  const base = await fixture.snapshots.get(firstRun.resultSnapshot.snapshotId);
  assertExists(base);
  let project = await fixture.commands.appendChange(AGENT, {
    ...ctx("append-architecture-enrichment", completed.revision),
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    phases: [{
      id: "arch-enrichment",
      name: "Architecture enrichment",
      description: "Add a reviewed component to the generic architecture.",
    }],
    workItems: [{
      id: "wi:architecture-enrichment",
      phaseId: "arch-enrichment",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:architecture"],
      decisionIds: ["decision:arch-enrichment"],
      operation: {
        ...MODEL_WRITE_ARCHITECTURE_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [{
      id: "decision:arch-enrichment",
      phaseId: "arch-enrichment",
      title: "Architecture enrichment declaration",
      question: "Which reviewed component is added to the existing system?",
    }],
  });
  project = await fixture.commands.proposeDecision(AGENT, {
    ...ctx("propose-architecture-enrichment", project.revision),
    decisionId: "decision:arch-enrichment",
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    proposal: {
      summary: options.proposalSummary ?? "Add Motor to DroneV4",
      parameters: options.parameters ?? DRONE_ENRICHMENT_PARAMS,
    },
  });
  const approval = project.approvals.find((candidate) =>
    candidate.decisionId === "decision:arch-enrichment"
  );
  assertExists(approval);
  project = await fixture.commands.approveDecision(HUMAN, {
    ...ctx("approve-architecture-enrichment", project.revision),
    decisionId: "decision:arch-enrichment",
    rationale: "Approved enrichment.",
    inputFingerprint: approval.inputFingerprint!,
  });
  const queued = await fixture.commands.queueRun(AGENT, {
    ...ctx("queue-architecture-enrichment", project.revision),
    runId: "run:architecture-enrichment",
    workItemId: "wi:architecture-enrichment",
    summary: options.runSummary ?? "Add Motor to DroneV4.",
    basis: {
      kind: "thread-snapshot",
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
  });
  return { revision: queued.revision, runId: "run:architecture-enrichment" };
}

/** Queue a distinct reviewed work item deliberately sealed to the same basis. */
async function queueParallelArchitectureSibling(
  fixture: Pick<ArchFixture, "projects" | "commands">,
): Promise<{ readonly revision: number; readonly runId: string }> {
  const project = await fixture.projects.get(PROJECT_ID);
  if (!project) throw new Error("Architecture fixture project is missing.");
  const original = project.agentRuns.find((run) => run.id === "run:architecture");
  if (!original?.basis || original.basis.kind !== "thread-snapshot") {
    throw new Error("Architecture fixture run has no thread-snapshot basis.");
  }
  const basis = original.basis;
  const queued = await fixture.commands.queueRun(AGENT, {
    ...ctx("queue-parallel-architecture", project.revision),
    runId: "run:architecture-parallel",
    workItemId: "wi:architecture-parallel",
    summary: "Attempt a parallel architecture authoring run.",
    basis,
  });
  return { revision: queued.revision, runId: "run:architecture-parallel" };
}

// ── Happy path — initial mode ─────────────────────────────────────────────────

Deno.test(
  "model.write-architecture executor publishes a valid snapshot in initial mode",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-arch-initial-" });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const syson = new InitialArchSyson();
      const executor = makeExecutor(fixture, { syson, directory });

      const result = await executor.execute(AGENT, executionCommand(fixture));

      // Run must be completed.
      const run = result.agentRuns.find((r) => r.id === "run:architecture");
      assertExists(run, "architecture run must exist");
      assertEquals(run.status, "completed");

      // A result snapshot must be recorded.
      assertExists(run.resultSnapshot);
      const snap = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
      assertExists(snap, "architecture snapshot must be stored");

      // The architecture artifact must be present and URI-prefixed.
      const archArtifact = findArchitectureArtifact(snap);
      assertExists(
        archArtifact,
        "architecture artifact must be in the snapshot",
      );
      assertEquals(archArtifact.kind, "sysml-model");
      assertEquals(
        archArtifact.uri?.startsWith("casys://architecture-capture/"),
        true,
      );

      // The capture must be readable.
      const captureText = await fixture.archCaptures.read(
        archArtifact.fingerprint,
      );
      assertExists(captureText, "architecture capture must be readable");
      const captureJson = JSON.parse(captureText) as Record<string, unknown>;
      assertEquals(captureJson.packageName, "DroneV4");
      assertEquals(captureJson.systemName, "DroneSystem");
      assertEquals(captureJson.schemaVersion, "architecture-capture/4.0");
      const scopeRoot = captureJson.scopeRoot as Record<string, unknown>;
      const semanticRoot = captureJson.semanticRoot as Record<string, unknown>;
      assertEquals(scopeRoot.kind, "Package");
      assertEquals(typeof scopeRoot.id, "string");
      assertEquals(semanticRoot.kind, "PartDefinition");
      assertEquals(typeof semanticRoot.id, "string");
      assertEquals(captureJson.package, undefined);
      const sourceAnalyses = captureJson.sourceAnalyses as unknown[];
      assertEquals(sourceAnalyses.length, 4);
      const reopened = await fixture.sysmlSourceAnalysis.reopen(
        sourceAnalyses[0],
      );
      const attempt = await fixture.archAttempts.readRun(
        PROJECT_ID,
        fixture.queued.runId,
      );
      assertEquals(attempt?.schemaVersion, "architecture-write-attempt/3.0");
      assertEquals(
        deterministicJson(
          attempt?.schemaVersion === "architecture-write-attempt/3.0"
            ? attempt.sourceAnalyses
            : undefined,
        ),
        deterministicJson(sourceAnalyses),
      );

      // At least one insert call was made.
      const insertCalls = syson.calls.filter(
        (c) => c.name === "syson_element_insert_sysml",
      );
      assertEquals(insertCalls.length >= 1, true);
      assertEquals(
        insertCalls[0]?.arguments?.sysml_text,
        reopened.source.sourceText,
        "SysON receives only the exact SysML bytes reopened from CAS.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture completes an acknowledged prefix-only initial insertion from presealed statements",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-arch-prefix-" });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const syson = new PrefixOnlyInitialArchSyson();
      const executor = makeExecutor(fixture, { syson, directory });

      const result = await executor.execute(AGENT, executionCommand(fixture));

      assertEquals(
        result.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
        "completed",
      );
      const insertSources = syson.calls.filter((call) =>
        call.name === "syson_element_insert_sysml"
      ).map((call) => call.arguments?.sysml_text);
      assertEquals(insertSources.length, 2);
      assertEquals(
        (insertSources[0] as string).startsWith("package DroneV4"),
        true,
      );
      assertEquals(insertSources[1], "part def Wing {}");
      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_element_create" &&
          call.arguments?.child_type === "SysMLv2EditService-PartUsage" &&
          call.arguments?.name === "wing"
        ),
        true,
      );
      const attempt = await fixture.archAttempts.readRun(
        PROJECT_ID,
        fixture.queued.runId,
      );
      assertEquals(attempt?.status, "completed");
      assertEquals(attempt?.items.length, 4);
      assertEquals(attempt?.sourceAnalyses.length, 4);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects a cross-kind semantic id collision before capture save or snapshot promotion",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-id-collision-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      let snapshotSaveCalls = 0;
      const snapshots: ThreadSnapshotStore = {
        get: (snapshotId) => fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: async (snapshot) => {
          snapshotSaveCalls++;
          await fixture.snapshots.save(snapshot);
        },
      };
      const syson = new CrossKindSemanticIdCollisionInitialArchSyson();

      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory, snapshots }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "repeats a semantic identity",
      );

      assertEquals(snapshotSaveCalls, 0, "no ThreadSnapshot may be promoted");
      let captureFileCount = 0;
      try {
        for await (const entry of Deno.readDir(`${directory}/arch-captures`)) {
          if (entry.isFile) captureFileCount++;
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      assertEquals(captureFileCount, 0, "no architecture capture may be saved");

      const failed = await fixture.projects.get(PROJECT_ID);
      const run = failed?.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertEquals(run?.status, "failed");
      assertEquals(run?.resultSnapshot, undefined);
      assertEquals(run?.evidenceRefs, []);
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture completes with scoped homonyms and a shared PartDefinition",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-occurrences-",
    });
    try {
      const fixture = await queuedArchitectureFixture(
        directory,
        SCOPED_HOMONYM_PROPOSAL_PARAMS,
      );
      const syson = new ScopedHomonymInitialArchSyson();

      const result = await makeExecutor(fixture, { syson, directory }).execute(
        AGENT,
        executionCommand(fixture),
      );

      assertEquals(
        result.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
        "completed",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        false,
      );
      const inserted = syson.calls.find((call) =>
        call.name === "syson_element_insert_sysml"
      )?.arguments?.sysml_text as string;
      assertEquals(inserted.match(/part def Motor/g)?.length, 1);
      assertEquals(inserted.match(/part motor : Motor;/g)?.length, 2);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture quarantines an unreviewed AttributeUsage after the initial ACK",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-foreign-attribute-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson: new ForeignAttributeInitialArchSyson(),
            directory,
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "unreviewed AttributeUsage",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture quarantines when a reviewed AttributeUsage is absent after the initial ACK",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-missing-attribute-",
    });
    try {
      const fixture = await queuedArchitectureFixture(
        directory,
        DRONE_ATTRIBUTE_PARAMS,
      );
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson: new InitialArchSyson(), directory })
            .execute(
              AGENT,
              executionCommand(fixture),
            ),
        EngineeringProjectCommandError,
        "proposal AttributeUsage is absent",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Validated acknowledgement boundary ──────────────────────────────────────

Deno.test(
  "model.write-architecture keeps an invalid initial ACK in outcome-unknown, not post-ACK quarantine",
  async () => {
    class InvalidInitialAckSyson extends InitialArchSyson {
      override callTool(call: McpToolCall): Promise<McpToolResult> {
        if (call.name === "syson_element_insert_sysml") {
          this.calls.push(structuredClone(call));
          return Promise.resolve({
            text: "mismatched parent",
            structuredContent: {
              inserted: true,
              parentId: "not-the-requested-parent",
            },
          });
        }
        return super.callTool(call);
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-invalid-ack-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const syson = new InvalidInitialAckSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "outcome is unknown",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        false,
        "a malformed acknowledgement must not be treated as a validated ACK",
      );
      const failed = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        failed?.agentRuns.find((run) => run.id === fixture.queued.runId)
          ?.failure?.code,
        "model-write-architecture-provider-outcome-unknown",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Happy path — idempotency / WAL completed path ────────────────────────────

Deno.test(
  "model.write-architecture executor is idempotent when the run is already completed",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-idempotent-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const syson = new InitialArchSyson();
      const executor = makeExecutor(fixture, { syson, directory });
      const cmd = executionCommand(fixture);

      // First execution.
      const first = await executor.execute(AGENT, cmd);
      const firstRun = first.agentRuns.find((r) => r.id === "run:architecture");
      assertEquals(firstRun?.status, "completed");
      assertExists(firstRun?.resultSnapshot);
      const firstSnapshot = await fixture.snapshots.get(
        firstRun.resultSnapshot.snapshotId,
      );
      assertExists(firstSnapshot);
      const firstArtifact = firstSnapshot.artifacts.find((artifact) =>
        artifact.producer.runId === "run:architecture"
      );
      assertExists(firstArtifact);
      const firstCapture = await fixture.archCaptures.read(
        firstArtifact.fingerprint,
      );
      assertExists(firstCapture);
      const firstSysonCalls = syson.calls.length;
      const firstSnapshotJson = deterministicJson(firstSnapshot);

      // Second execution with the same command — must return the already-completed project.
      const second = await executor.execute(AGENT, {
        ...cmd,
        expectedRevision: first.revision,
      });
      const secondRun = second.agentRuns.find((r) => r.id === "run:architecture");
      assertEquals(secondRun?.status, "completed");
      assertEquals(secondRun?.resultSnapshot, firstRun.resultSnapshot);
      assertEquals(syson.calls.length, firstSysonCalls);
      assertEquals(
        await fixture.archCaptures.read(firstArtifact.fingerprint),
        firstCapture,
      );
      assertEquals(
        deterministicJson(await fixture.snapshots.get(firstSnapshot.id)),
        firstSnapshotJson,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture completed replay rejects artifact and capture mutations before provider access",
  async () => {
    class MutatedCaptureReadStore extends FileCaptureStore<"architecture-capture"> {
      constructor(
        directory: string,
        private readonly source: FileCaptureStore<"architecture-capture">,
        private readonly mutate: (record: Record<string, unknown>) => void,
      ) {
        super({
          ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/mutated-read-captures`,
        });
      }

      override async read(
        fingerprint: ContentFingerprint,
      ): Promise<string | undefined> {
        const text = await this.source.read(fingerprint);
        if (!text) return undefined;
        const record = JSON.parse(text) as Record<string, unknown>;
        this.mutate(record);
        return deterministicJson(record);
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-replay-guard-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.resultSnapshot);
      const resultSnapshot = await fixture.snapshots.get(
        run.resultSnapshot.snapshotId,
      );
      assertExists(resultSnapshot);
      const resultArtifact = resultSnapshot.artifacts.find((artifact) =>
        artifact.producer.runId === fixture.queued.runId &&
        artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
      );
      assertExists(resultArtifact);

      const cases: readonly {
        name: string;
        mutateArtifact?: (artifact: ThreadArtifact) => ThreadArtifact;
        mutateCapture?: (record: Record<string, unknown>) => void;
        mutateSnapshot?: (snapshot: ThreadSnapshot) => ThreadSnapshot;
      }[] = [{
        name: "URI",
        mutateArtifact: (artifact) => ({
          ...artifact,
          uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${"e".repeat(64)}`,
        }),
      }, {
        name: "producer",
        mutateArtifact: (artifact) => ({
          ...artifact,
          producer: { ...artifact.producer, serverId: "untrusted-syson" },
        }),
      }, {
        name: "input",
        mutateArtifact: (artifact) => ({
          ...artifact,
          inputArtifactIds: [
            ...artifact.inputArtifactIds,
            "artifact:unreviewed-extra",
          ],
        }),
      }, {
        name: "schema",
        mutateCapture: (record) => {
          record.schemaVersion = "architecture-capture/forged";
        },
      }, {
        name: "trustedRunId",
        mutateCapture: (record) => {
          record.trustedRunId = "run:forged";
        },
      }, {
        name: "subject",
        mutateSnapshot: (snapshot) => ({
          ...snapshot,
          subject: { ...snapshot.subject, id: "project:foreign" },
        }),
      }, {
        name: "previous",
        mutateSnapshot: (snapshot) => ({
          ...snapshot,
          previous: {
            snapshotId: "snapshot:foreign-basis",
            revision: snapshot.previous?.revision ?? 1,
          },
        }),
      }, {
        name: "historicalRename",
        mutateSnapshot: (snapshot) => ({
          ...snapshot,
          artifacts: snapshot.artifacts.map((artifact) =>
            artifact.producer.tool === "syson_model_create"
              ? { ...artifact, name: "Renamed historical seed" }
              : artifact
          ),
        }),
      }];

      for (const testCase of cases) {
        const artifactMutatedSnapshot: ThreadSnapshot = testCase.mutateArtifact
          ? {
            ...resultSnapshot,
            artifacts: resultSnapshot.artifacts.map((artifact) =>
              artifact.id === resultArtifact.id
                ? testCase.mutateArtifact!(artifact)
                : artifact
            ),
          }
          : resultSnapshot;
        const replaySnapshot = testCase.mutateSnapshot
          ? testCase.mutateSnapshot(artifactMutatedSnapshot)
          : artifactMutatedSnapshot;
        const snapshots: ThreadSnapshotStore = {
          get: (snapshotId) =>
            snapshotId === replaySnapshot.id
              ? Promise.resolve(replaySnapshot)
              : fixture.snapshots.get(snapshotId),
          latest: (subjectId) => fixture.snapshots.latest(subjectId),
          save: (snapshot) => fixture.snapshots.save(snapshot),
        };
        const captures = testCase.mutateCapture
          ? new MutatedCaptureReadStore(
            directory,
            fixture.archCaptures,
            testCase.mutateCapture,
          )
          : fixture.archCaptures;
        const syson = new InitialArchSyson();

        await assertRejects(
          () =>
            makeExecutor(fixture, {
              syson,
              directory,
              snapshots,
              captures,
              leaseSubdir: `replay-${testCase.name}`,
            }).execute(AGENT, {
              ...command,
              expectedRevision: completed.revision,
            }),
          EngineeringProjectCommandError,
          "Completed architecture",
        );
        assertEquals(
          syson.calls,
          [],
          `${testCase.name} must stop before SysON`,
        );
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture completed replay rejects coordinated capture and result rewrites with unchanged MRTR",
  async () => {
    class CoordinatedCaptureReadStore extends FileCaptureStore<"architecture-capture"> {
      constructor(
        directory: string,
        private readonly fingerprint: ContentFingerprint,
        private readonly text: string,
        private readonly source: FileCaptureStore<"architecture-capture">,
      ) {
        super({
          ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/coordinated-captures`,
        });
      }

      override read(
        fingerprint: ContentFingerprint,
      ): Promise<string | undefined> {
        return fingerprint.digest === this.fingerprint.digest
          ? Promise.resolve(this.text)
          : this.source.read(fingerprint);
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-replay-seal-",
    });
    try {
      const fixture = await queuedArchitectureFixture(
        directory,
        DRONE_ATTRIBUTE_PARAMS,
      );
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, {
        syson: new AttributeInitialArchSyson(),
        directory,
      }).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.resultSnapshot);
      assertExists(run.startedAt);
      const resultSnapshot = await fixture.snapshots.get(
        run.resultSnapshot.snapshotId,
      );
      assertExists(resultSnapshot);
      const artifact = resultSnapshot.artifacts.find((candidate) =>
        candidate.producer.runId === run.id &&
        candidate.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
      );
      assertExists(artifact);
      const captureText = await fixture.archCaptures.read(artifact.fingerprint);
      assertExists(captureText);
      const originalCapture = JSON.parse(captureText) as Record<
        string,
        unknown
      >;
      const forgedTime = "2026-08-08T12:16:00.000Z";
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly mutateCapture: (capture: Record<string, unknown>) => void;
        readonly mutateSnapshot?: (snapshot: ThreadSnapshot) => ThreadSnapshot;
      }> = [{
        name: "package",
        mutateCapture: (capture) => {
          capture.packageName = "ForgedDroneV4";
          (capture.scopeRoot as Record<string, unknown>).label = "ForgedDroneV4";
        },
        mutateSnapshot: (snapshot) => ({
          ...snapshot,
          artifacts: snapshot.artifacts.map((candidate) =>
            candidate.producer.runId === run.id
              ? { ...candidate, name: "Architecture: ForgedDroneV4" }
              : candidate
          ),
        }),
      }, {
        name: "system",
        mutateCapture: (capture) => {
          capture.systemName = "Wing";
        },
      }, {
        name: "graph",
        mutateCapture: (capture) => {
          (capture.partDefinitions as Array<Record<string, unknown>>).push({
            id: "forged-extra-def",
            kind: "PartDefinition",
            label: "ForgedExtra",
            usages: [],
          });
        },
      }, {
        name: "attribute",
        mutateCapture: (capture) => {
          delete (capture.partDefinitions as Array<Record<string, unknown>>)[0]
            ?.attributes;
        },
      }, {
        name: "startedAt",
        mutateCapture: (capture) => {
          capture.insertedAt = forgedTime;
        },
        mutateSnapshot: (snapshot) =>
          replaceStringDeep(snapshot, run.startedAt!, forgedTime),
      }];

      for (const testCase of cases) {
        const forgedCapture = structuredClone(originalCapture);
        testCase.mutateCapture(forgedCapture);
        const forgedFingerprint = await sha256Fingerprint(forgedCapture);
        const forgedText = deterministicJson(forgedCapture);
        let forgedSnapshot = replaceStringDeep(
          resultSnapshot,
          artifact.fingerprint.digest,
          forgedFingerprint.digest,
        );
        forgedSnapshot = testCase.mutateSnapshot?.(forgedSnapshot) ??
          forgedSnapshot;
        const forgedProject = replaceStringDeep(
          completed,
          artifact.fingerprint.digest,
          forgedFingerprint.digest,
        );

        let snapshotWrites = 0;
        const snapshots: ThreadSnapshotStore = {
          get: (snapshotId) =>
            snapshotId === forgedSnapshot.id
              ? Promise.resolve(forgedSnapshot)
              : fixture.snapshots.get(snapshotId),
          latest: (subjectId) => fixture.snapshots.latest(subjectId),
          save: (_snapshot) => {
            snapshotWrites++;
            return Promise.reject(
              new Error("unexpected replay snapshot write"),
            );
          },
        };
        let projectWrites = 0;
        const projects: EngineeringProjectRevisionStore = {
          get: (projectId) =>
            projectId === PROJECT_ID
              ? Promise.resolve(forgedProject)
              : Promise.resolve(undefined),
          getRevision: (projectId, revision) =>
            fixture.projects.getRevision(projectId, revision),
          createInitial: (_snapshot) => {
            projectWrites++;
            return Promise.reject(new Error("unexpected replay project write"));
          },
          commit: (_snapshot, _expectedRevision) => {
            projectWrites++;
            return Promise.reject(new Error("unexpected replay project write"));
          },
        };
        const captures = new CoordinatedCaptureReadStore(
          directory,
          forgedFingerprint,
          forgedText,
          fixture.archCaptures,
        );
        const syson = new InitialArchSyson();
        const live = reconciliationProbe();

        await assertRejects(
          () =>
            makeExecutor(fixture, {
              syson,
              directory,
              projects,
              snapshots,
              captures,
              liveUpdates: live.journal,
              leaseSubdir: `coordinated-replay-${testCase.name}`,
            }).execute(AGENT, {
              ...command,
              expectedRevision: completed.revision,
            }),
          EngineeringProjectCommandError,
          "Completed architecture",
        );
        assertEquals(syson.calls, [], `${testCase.name}: provider calls`);
        assertEquals(snapshotWrites, 0, `${testCase.name}: snapshot writes`);
        assertEquals(projectWrites, 0, `${testCase.name}: project writes`);
        assertEquals(live.calls, [], `${testCase.name}: reconciliations`);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture completed replay requires one exact completed WAL acknowledgement",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-replay-wal-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.startedAt);
      const completedAttempt = await fixture.archAttempts.readRun(
        PROJECT_ID,
        run.id,
      );
      if (
        completedAttempt?.status !== "completed" ||
        completedAttempt.schemaVersion !== "architecture-write-attempt/3.0"
      ) {
        throw new Error(
          "Expected the production execution to persist a v3 WAL.",
        );
      }
      const exactWalInput = {
        projectId: completedAttempt.projectId,
        runId: completedAttempt.runId,
        packageName: completedAttempt.packageName,
        items: completedAttempt.items,
        sourceAnalyses: completedAttempt.sourceAnalyses,
        planDigest: completedAttempt.planDigest,
        dispatchedAt: completedAttempt.dispatchedAt,
      };

      const absent = new FileArchitectureAttemptStore(
        `${directory}/wal-absent`,
      );
      const dispatched = new FileArchitectureAttemptStore(
        `${directory}/wal-dispatched`,
      );
      await dispatched.begin(exactWalInput);
      const wrongPackage = new FileArchitectureAttemptStore(
        `${directory}/wal-wrong-package`,
      );
      const wrongPackageInput = exactWalInput;
      await wrongPackage.begin(wrongPackageInput);
      await wrongPackage.complete({
        projectId: wrongPackageInput.projectId,
        runId: wrongPackageInput.runId,
        planDigest: wrongPackageInput.planDigest,
        architecturePackageId: "forged-package-id",
      });

      for (
        const [name, attempts] of [
          ["absent", absent],
          ["dispatched", dispatched],
          ["wrong-package", wrongPackage],
        ] as const
      ) {
        const beforeAttempt = await attempts.readRun(PROJECT_ID, run.id);
        let snapshotWrites = 0;
        const snapshots: ThreadSnapshotStore = {
          get: (snapshotId) => fixture.snapshots.get(snapshotId),
          latest: (subjectId) => fixture.snapshots.latest(subjectId),
          save: (_snapshot) => {
            snapshotWrites++;
            return Promise.reject(
              new Error("unexpected replay snapshot write"),
            );
          },
        };
        const syson = new InitialArchSyson();
        const live = reconciliationProbe();

        await assertRejects(
          () =>
            makeExecutor(fixture, {
              syson,
              directory,
              snapshots,
              attempts,
              liveUpdates: live.journal,
              leaseSubdir: `wal-replay-${name}`,
            }).execute(AGENT, {
              ...command,
              expectedRevision: completed.revision,
            }),
          EngineeringProjectCommandError,
          "Completed architecture evidence is not backed",
        );
        assertEquals(syson.calls, [], `${name}: provider calls`);
        assertEquals(snapshotWrites, 0, `${name}: snapshot writes`);
        assertEquals(live.calls, [], `${name}: reconciliations`);
        assertEquals(
          await attempts.readRun(PROJECT_ID, run.id),
          beforeAttempt,
          `${name}: WAL writes`,
        );
        assertEquals(
          (await fixture.projects.get(PROJECT_ID))?.revision,
          completed.revision,
          `${name}: project writes`,
        );
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture serializes concurrent same-basis siblings before SysON",
  async () => {
    class BarrierInitialArchSyson extends InitialArchSyson {
      readonly insertionEntered = deferred<void>();
      readonly releaseInsertion = deferred<void>();

      override async callTool(call: McpToolCall): Promise<McpToolResult> {
        if (call.name === "syson_element_insert_sysml") {
          this.calls.push(structuredClone(call));
          this.insertionEntered.resolve();
          await this.releaseInsertion.promise;
          return {
            text: "inserted",
            structuredContent: {
              inserted: true,
              parentId: call.arguments?.parent_id,
            },
          };
        }
        return await super.callTool(call);
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-same-basis-",
    });
    try {
      const fixture = await queuedArchitectureFixture(
        directory,
        DRONE_PROPOSAL_PARAMS,
        true,
      );
      const sibling = await queueParallelArchitectureSibling(fixture);
      const syson = new BarrierInitialArchSyson();
      const winner = makeExecutor(fixture, { syson, directory }).execute(
        AGENT,
        {
          ...executionCommand(fixture),
          expectedRevision: sibling.revision,
        },
      );
      await syson.insertionEntered.promise;

      const loser = makeExecutor(fixture, { syson, directory }).execute(AGENT, {
        commandId: "agent-author-architecture-parallel",
        projectId: PROJECT_ID,
        expectedRevision: sibling.revision,
        issuedAt: "2026-08-08T12:16:00.000Z",
        runId: sibling.runId,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      assertEquals(
        syson.calls.length,
        2,
        "the contender must wait on the basis lease, not preflight SysON",
      );

      syson.releaseInsertion.resolve();
      await winner;
      await assertRejects(
        () => loser,
        EngineeringProjectCommandError,
        "Thread write basis is unavailable",
      );
      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        1,
        "only the basis-lease winner may insert into SysON",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture refuses a sequential same-basis sibling after completion",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-stale-basis-",
    });
    try {
      const fixture = await queuedArchitectureFixture(
        directory,
        DRONE_PROPOSAL_PARAMS,
        true,
      );
      const sibling = await queueParallelArchitectureSibling(fixture);
      const winner = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, {
        ...executionCommand(fixture),
        expectedRevision: sibling.revision,
      });
      const blockedSyson = new InitialArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson: blockedSyson, directory }).execute(
            AGENT,
            {
              commandId: "agent-author-architecture-stale-sibling",
              projectId: PROJECT_ID,
              expectedRevision: winner.revision,
              issuedAt: "2026-08-08T12:17:00.000Z",
              runId: sibling.runId,
            },
          ),
        EngineeringProjectCommandError,
        "Thread write basis is unavailable",
      );
      assertEquals(blockedSyson.calls, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture binds the second enrichment completion to its own current tip and replays it exactly",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-enrichment-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const initial = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const queued = await queueArchitectureEnrichment(fixture, initial);
      const syson = new EnrichmentArchSyson();
      const command = {
        commandId: "agent-author-architecture-enrichment",
        projectId: PROJECT_ID,
        expectedRevision: queued.revision,
        issuedAt: "2026-08-08T12:20:00.000Z",
        runId: queued.runId,
      };
      const executor = makeExecutor(fixture, { syson, directory });
      const completed = await executor.execute(AGENT, command);
      const secondRun = completed.agentRuns.find((run) => run.id === queued.runId);
      assertExists(secondRun?.resultSnapshot);
      assertEquals(secondRun.evidenceRefs.length, 1);
      const resultSnapshot = await fixture.snapshots.get(
        secondRun.resultSnapshot.snapshotId,
      );
      assertExists(resultSnapshot);
      const current = resultSnapshot.artifacts.filter((artifact) =>
        artifact.kind === "sysml-model" &&
        artifact.uri?.startsWith("casys://architecture-capture/") &&
        artifact.producer.runId === queued.runId
      );
      assertEquals(current.length, 1);
      assertEquals(secondRun.evidenceRefs[0]?.id, current[0]?.id);
      assertEquals(current[0]?.inputArtifactIds.length, 2);

      const captureText = await fixture.archCaptures.read(
        current[0]!.fingerprint,
      );
      assertExists(captureText);
      const capture = JSON.parse(captureText) as {
        sourceAnalyses: readonly unknown[];
      };
      const insertCalls = syson.calls.filter((call) =>
        call.name === "syson_element_insert_sysml"
      );
      assertEquals(capture.sourceAnalyses.length, 2);
      assertEquals(insertCalls.length, 1);
      for (const [index, reference] of capture.sourceAnalyses.entries()) {
        const reopened = await fixture.sysmlSourceAnalysis.reopen(reference);
        if (index === 0) {
          assertEquals(
            insertCalls[0]?.arguments?.sysml_text,
            reopened.source.sourceText,
            "the PartDefinition insertion must use its exact reopened CAS bytes",
          );
        } else {
          assertEquals(reopened.source.sourceText, "part motor : Motor;");
        }
      }
      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_element_create" &&
          call.arguments?.child_type === "SysMLv2EditService-PartUsage" &&
          call.arguments?.name === "motor"
        ),
        true,
      );

      const insertsBeforeReplay = insertCalls.length;
      const replay = await executor.execute(AGENT, {
        ...command,
        expectedRevision: completed.revision,
      });
      assertEquals(replay.revision, completed.revision);
      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        insertsBeforeReplay,
      );

      const catalog = await resolveGenericProductStructureCatalog(
        resultSnapshot,
        fixture.archCaptures,
        undefined,
        fixture.sysmlSourceAnalysis,
      );
      assertEquals(
        catalog?.components.some((component) => component.label === "Motor"),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects a predecessor package change before lease, WAL, provider, or project mutation",
  async () => {
    class RecordingAttemptStore extends FileArchitectureAttemptStore {
      readonly calls: string[] = [];

      override async begin(
        input: Parameters<FileArchitectureAttemptStore["begin"]>[0],
      ) {
        this.calls.push("begin");
        return await super.begin(input);
      }

      override async readRun(projectId: string, runId: string) {
        this.calls.push("readRun");
        return await super.readRun(projectId, runId);
      }

      override async quarantine(
        input: Parameters<FileArchitectureAttemptStore["quarantine"]>[0],
      ) {
        this.calls.push("quarantine");
        return await super.quarantine(input);
      }

      override async isQuarantined(projectId: string, runId: string) {
        this.calls.push("isQuarantined");
        return await super.isQuarantined(projectId, runId);
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-package-scope-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const initial = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const changedPackageParameters = DRONE_ENRICHMENT_PARAMS.map((parameter) =>
        parameter.key === "architecture.package"
          ? { ...parameter, value: "DroneV4Mechanism" }
          : parameter
      );
      const queued = await queueArchitectureEnrichment(fixture, initial, {
        parameters: changedPackageParameters,
        proposalSummary: "Attempt a second architecture Package.",
        runSummary: "Attempt unsupported multi-package architecture.",
      });
      const syson = new EnrichmentArchSyson();
      const attempts = new RecordingAttemptStore(`${directory}/blocked-attempts`);
      const leaseCalls: Array<{ projectId: string; scope: string }> = [];
      const lease: EngineeringProjectRunLease = {
        async withLease<T>(
          projectId: string,
          scope: string,
          operation: () => Promise<T>,
        ): Promise<T> {
          leaseCalls.push({ projectId, scope });
          return await operation();
        },
      };
      const before = await fixture.projects.get(PROJECT_ID);
      assertExists(before);

      const error = await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson,
            directory,
            attempts,
            lease,
          }).execute(AGENT, {
            commandId: "agent-refuse-package-change",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:20:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
        "predecessor_package_name_changed",
      );
      assertEquals(error.code, "invalid_transition");
      assertEquals(leaseCalls, []);
      assertEquals(syson.calls, []);
      assertEquals(attempts.calls, []);
      assertEquals(
        deterministicJson(await fixture.projects.get(PROJECT_ID)),
        deterministicJson(before),
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

Deno.test(
  "model.write-architecture rejects a transplanted valid seed capture before SysON dispatch",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-seed-subject-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const base = await queuedArchitectureBasisSnapshot(fixture);
      const seed = base.artifacts.find((artifact) =>
        artifact.producer.tool === "syson_model_create"
      );
      assertExists(seed);
      const text = await fixture.seedCaptures.read(seed.fingerprint);
      assertExists(text);
      const capture = JSON.parse(text) as {
        lineage: { baseSnapshot: { subjectId: string } };
      };
      capture.lineage.baseSnapshot.subjectId = "project:foreign";
      const changedFingerprint = await sha256Fingerprint(capture);
      await fixture.seedCaptures.save(
        changedFingerprint,
        deterministicJson(capture),
      );
      const changedSeedId = `syson-model-seed-${changedFingerprint.digest}`;
      const transplanted = {
        ...base,
        artifacts: base.artifacts.map((artifact) =>
          artifact.id === seed.id
            ? {
              ...artifact,
              id: changedSeedId,
              version: changedFingerprint.digest,
              fingerprint: changedFingerprint,
              uri:
                `casys://syson-model-seed-capture/sha256/${changedFingerprint.digest}`,
            }
            : artifact
        ),
        changeSet: {
          ...base.changeSet,
          changes: base.changeSet.changes.map((change) =>
            change.target.kind === "artifact" && change.target.id === seed.id
              ? {
                ...change,
                target: { ...change.target, id: changedSeedId },
                afterFingerprint: changedFingerprint,
              }
              : change
          ),
        },
        provenance: base.provenance.map((link) => ({
          ...link,
          from: link.from.kind === "artifact" && link.from.id === seed.id
            ? { ...link.from, id: changedSeedId }
            : link.from,
          to: link.to.kind === "artifact" && link.to.id === seed.id
            ? { ...link.to, id: changedSeedId }
            : link.to,
        })),
      };
      const snapshots: ThreadSnapshotStore = {
        get: (snapshotId) =>
          snapshotId === base.id
            ? Promise.resolve(transplanted)
            : fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: (snapshot) => fixture.snapshots.save(snapshot),
      };
      const syson = new InitialArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory, snapshots }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "exact r1 documentary baseline",
      );
      assertEquals(syson.calls, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture quarantines a post-ack duplicate inherited PartUsage without attaching evidence",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-duplicate-usage-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const initial = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const queued = await queueArchitectureEnrichment(fixture, initial);
      const syson = new DuplicateInheritedUsageEnrichmentSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(AGENT, {
            commandId: "agent-duplicate-inherited-usage",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:20:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
        "unreviewed PartUsage occurrence",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(PROJECT_ID, queued.runId),
        true,
      );
      const failed = await fixture.projects.get(PROJECT_ID);
      const failedRun = failed?.agentRuns.find((run) => run.id === queued.runId);
      assertEquals(failedRun?.status, "failed");
      assertEquals(failedRun?.resultSnapshot, undefined);
      assertEquals(failedRun?.evidenceRefs, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture quarantines a removed or replaced inherited AttributeUsage",
  async () => {
    for (const mode of ["removed", "replaced"] as const) {
      const directory = await Deno.makeTempDir({
        prefix: `casys-arch-${mode}-attribute-`,
      });
      try {
        const fixture = await queuedArchitectureFixture(
          directory,
          DRONE_ATTRIBUTE_PARAMS,
        );
        const initial = await makeExecutor(fixture, {
          syson: new AttributeInitialArchSyson(),
          directory,
        }).execute(AGENT, executionCommand(fixture));
        const queued = await queueArchitectureEnrichment(fixture, initial);
        await assertRejects(
          () =>
            makeExecutor(fixture, {
              syson: new LostInheritedAttributeEnrichmentSyson(mode),
              directory,
            }).execute(AGENT, {
              commandId: `agent-${mode}-inherited-attribute`,
              projectId: PROJECT_ID,
              expectedRevision: queued.revision,
              issuedAt: "2026-08-08T12:20:00.000Z",
              runId: queued.runId,
            }),
          EngineeringProjectCommandError,
          "predecessor AttributeUsage was replaced",
        );
        assertEquals(
          await fixture.archAttempts.isQuarantined(PROJECT_ID, queued.runId),
          true,
          `${mode}: acknowledged enrichment must be quarantined`,
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "model.write-architecture quarantines a post-ack duplicate inherited PartDefinition without attaching evidence",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-duplicate-inherited-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const initial = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const queued = await queueArchitectureEnrichment(fixture, initial);
      const syson = new DuplicateInheritedPartDefinitionEnrichmentSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(AGENT, {
            commandId: "agent-duplicate-inherited",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:20:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
        "ambiguous PartDefinition",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(PROJECT_ID, queued.runId),
        true,
      );
      const failed = await fixture.projects.get(PROJECT_ID);
      const failedRun = failed?.agentRuns.find((run) => run.id === queued.runId);
      assertEquals(failedRun?.status, "failed");
      assertEquals(failedRun?.resultSnapshot, undefined);
      assertEquals(failedRun?.evidenceRefs, []);
      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        1,
        "only the reviewed PartDefinition text write occurs before the concurrent duplicate is detected",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture quarantines a Phase-B ambiguity after the Phase-A ACK and blocks a same-basis sibling",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-phase-b-post-ack-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const initial = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const queued = await queueArchitectureEnrichment(fixture, initial);
      const partiallyAcknowledged = new PhaseBAmbiguousEnrichmentSyson();

      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson: partiallyAcknowledged,
            directory,
          }).execute(AGENT, {
            commandId: "agent-phase-b-ambiguous",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:20:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
        "ambiguous PartDefinition labels",
      );

      assertEquals(
        partiallyAcknowledged.calls.filter((call) =>
          call.name === "syson_element_insert_sysml"
        ).length,
        1,
        "Phase A acknowledged the PartDefinition before Phase B refused",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(PROJECT_ID, queued.runId),
        true,
      );
      const failed = await fixture.projects.get(PROJECT_ID);
      const failedRun = failed?.agentRuns.find((run) => run.id === queued.runId);
      assertEquals(failedRun?.status, "failed");
      assertEquals(
        failedRun?.failure?.code,
        "model-write-architecture-post-acknowledgement-quarantined",
      );
      assertExists(failedRun?.basis);

      const sibling = await fixture.commands.queueRun(AGENT, {
        ...ctx("queue-phase-b-sibling", failed!.revision),
        runId: "run:architecture-enrichment-sibling",
        workItemId: "wi:architecture-enrichment",
        summary: "Attempt a forbidden same-basis retry after partial ACK.",
        basis: failedRun.basis,
      });
      const blockedSyson = new EnrichmentArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson: blockedSyson, directory }).execute(
            AGENT,
            {
              commandId: "agent-phase-b-sibling",
              projectId: PROJECT_ID,
              expectedRevision: sibling.revision,
              issuedAt: "2026-08-08T12:21:00.000Z",
              runId: "run:architecture-enrichment-sibling",
            },
          ),
        EngineeringProjectCommandError,
        "Thread write basis is unavailable",
      );
      assertEquals(
        blockedSyson.calls,
        [],
        "the same-basis sibling must stop before any provider call",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture blocks same-basis requeues after terminal provider uncertainty",
  async () => {
    const terminalCodes = [
      "model-write-architecture-provider-outcome-unknown",
      "model-write-architecture-post-acknowledgement-quarantined",
      "model-write-architecture-quarantine-write-failed",
    ] as const;
    for (const code of terminalCodes) {
      const directory = await Deno.makeTempDir({
        prefix: "casys-arch-sibling-",
      });
      try {
        const fixture = await queuedArchitectureFixture(directory);
        let project = await fixture.commands.claimRun(AGENT, {
          ...executionCommand(fixture),
          commandId: `claim-${code}`,
          summary: "Claim blocked predecessor.",
        });
        project = await fixture.commands.failRun(AGENT, {
          ...ctx(`fail-${code}`, project.revision),
          runId: fixture.queued.runId,
          summary: "Record terminal provider uncertainty.",
          code,
          message: "No automatic retry is permitted.",
        });
        const failedRun = project.agentRuns.find((run) =>
          run.id === fixture.queued.runId
        );
        assertExists(failedRun?.basis);
        const retry = await fixture.commands.queueRun(AGENT, {
          ...ctx(`queue-retry-${code}`, project.revision),
          runId: `run:retry:${code}`,
          workItemId: "wi:architecture",
          summary: "Attempt same-basis retry.",
          basis: failedRun.basis!,
        });
        const syson = new InitialArchSyson();
        await assertRejects(
          () =>
            makeExecutor(fixture, { syson, directory }).execute(AGENT, {
              commandId: `execute-retry-${code}`,
              projectId: PROJECT_ID,
              expectedRevision: retry.revision,
              issuedAt: "2026-08-08T12:20:00.000Z",
              runId: `run:retry:${code}`,
            }),
          EngineeringProjectCommandError,
          "Thread write basis is unavailable",
        );
        assertEquals(syson.calls, [], `${code} must stop before SysON`);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "model.write-architecture resumes when complete persisted before its caller observed an error",
  async () => {
    class CompleteThenThrowStore extends FileArchitectureAttemptStore {
      override async complete(
        input: Parameters<FileArchitectureAttemptStore["complete"]>[0],
      ): Promise<void> {
        await super.complete(input);
        throw new Error(
          "simulated fsync acknowledgement error after durable rename",
        );
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-complete-readback-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const syson = new InitialArchSyson();
      const executor = makeExecutor(fixture, {
        syson,
        directory,
        attempts: new CompleteThenThrowStore(`${directory}/arch-attempts`),
      });
      const result = await executor.execute(AGENT, executionCommand(fixture));
      assertEquals(
        result.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
        "completed",
      );
      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        1,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture resumes a completed run WAL before live preflight with zero inserts",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-wal-resume-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const command = executionCommand(fixture);
      const claimed = await fixture.commands.claimRun(AGENT, {
        ...command,
        commandId: `${command.commandId}:model-write-architecture:claim`,
        summary: "Started the generic model-write-architecture run.",
      });
      const claimedRun = claimed.agentRuns.find((run) =>
        run.id === fixture.queued.runId
      );
      assertExists(claimedRun?.startedAt);
      const persisted = await currentWalInput(fixture, {
        runId: fixture.queued.runId,
        dispatchedAt: claimedRun.startedAt,
      });
      await fixture.archAttempts.begin(persisted);
      await fixture.archAttempts.complete({
        projectId: persisted.projectId,
        runId: persisted.runId,
        planDigest: persisted.planDigest,
        architecturePackageId: "arch-pkg-001",
      });

      class ReopenProbe extends SysmlSourceAnalysisCaptureService {
        reopenCalls = 0;

        override async reopen(value: unknown) {
          this.reopenCalls++;
          return await super.reopen(value);
        }
      }
      const sourceEvidence = new ReopenProbe({
        sourceCaptures: fixture.sysmlSourceCaptures,
        analysisCaptures: fixture.sourceAnalysisCaptures,
        frontend: new RenderedArchitectureSysmlAnalyzer(),
      });

      const syson = new InitialArchSyson();
      // Consume only the mock's artificial preflight response. The executor
      // itself must begin directly with the completed WAL readback.
      await syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: "editing-context-drone",
          element_id: "root-pkg-drone",
        },
      });
      syson.calls.length = 0;

      const result = await makeExecutor(fixture, {
        syson,
        directory,
        sysmlSourceAnalysis: sourceEvidence,
      }).execute(AGENT, command);
      assertEquals(
        result.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
        "completed",
      );
      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        0,
      );
      assertEquals(
        sourceEvidence.reopenCalls,
        2,
        "completed v3 recovery and completed-evidence replay must each reopen the sealed CAS",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture refuses completed-WAL recovery when the live Package id replaced the pinned id",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-wal-package-pin-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const command = executionCommand(fixture);
      const claimed = await fixture.commands.claimRun(AGENT, {
        ...command,
        commandId: `${command.commandId}:model-write-architecture:claim`,
        summary: "Started the generic model-write-architecture run.",
      });
      const claimedRun = claimed.agentRuns.find((run) =>
        run.id === fixture.queued.runId
      );
      assertExists(claimedRun?.startedAt);
      const persisted = await currentWalInput(fixture, {
        runId: fixture.queued.runId,
        dispatchedAt: claimedRun.startedAt,
      });
      await fixture.archAttempts.begin(persisted);
      await fixture.archAttempts.complete({
        projectId: persisted.projectId,
        runId: persisted.runId,
        planDigest: persisted.planDigest,
        architecturePackageId: "arch-pkg-acknowledged-A",
      });

      const syson = new InitialArchSyson();
      // Consume only the mock's artificial absent-package preflight. Recovery
      // then observes the homonymous replacement package B.
      await syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: "editing-context-drone",
          element_id: "root-pkg-drone",
        },
      });
      syson.calls.length = 0;
      let snapshotSaveCalls = 0;
      const snapshots: ThreadSnapshotStore = {
        get: (snapshotId) => fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: async (snapshot) => {
          snapshotSaveCalls++;
          await fixture.snapshots.save(snapshot);
        },
      };

      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory, snapshots }).execute(
            AGENT,
            command,
          ),
        EngineeringProjectCommandError,
        "does not match the exact architecturePackageId",
      );

      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        0,
      );
      assertEquals(
        snapshotSaveCalls,
        0,
        "replacement Package B must not be promoted",
      );
      let captureFileCount = 0;
      try {
        for await (const entry of Deno.readDir(`${directory}/arch-captures`)) {
          if (entry.isFile) captureFileCount++;
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      assertEquals(captureFileCount, 0);
      const failed = await fixture.projects.get(PROJECT_ID);
      const run = failed?.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertEquals(run?.status, "failed");
      assertEquals(run?.resultSnapshot, undefined);
      assertEquals(run?.evidenceRefs, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects a self-consistent current WAL rendered from another proposal before SysON",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-wal-alternative-proposal-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const command = executionCommand(fixture);
      const claimed = await fixture.commands.claimRun(AGENT, {
        ...command,
        commandId: `${command.commandId}:model-write-architecture:claim`,
        summary: "Started the generic model-write-architecture run.",
      });
      const run = claimed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.startedAt);
      const alternative = parseArchitectureProposalParameters(
        DRONE_PROPOSAL_PARAMS.map((parameter) =>
          parameter.key === "component.wing.name"
            ? { ...parameter, value: "AlternativeWing" }
            : parameter
        ),
      );
      const items = [{ kind: "full-package" as const }];
      const sourceAnalyses = await Promise.all(
        items.map((item) =>
          fixture.sysmlSourceAnalysis.capture({
            proposal: alternative,
            selector: architectureWriteSelector(item, alternative.packageName),
            runId: fixture.queued.runId,
            operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
          })
        ),
      );
      const planDigest = await architectureWritePlanDigest({
        packageName: alternative.packageName,
        items,
        sourceAnalyses,
      });
      await fixture.archAttempts.begin({
        projectId: PROJECT_ID,
        runId: fixture.queued.runId,
        packageName: alternative.packageName,
        items,
        sourceAnalyses,
        planDigest,
        dispatchedAt: run.startedAt,
      });
      await fixture.archAttempts.complete({
        projectId: PROJECT_ID,
        runId: fixture.queued.runId,
        planDigest,
        architecturePackageId: "arch-pkg-alternative",
      });

      const syson = new InitialArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            command,
          ),
        EngineeringProjectCommandError,
        "does not exactly match the signed proposal render",
      );
      assertEquals(syson.calls, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture never preflights or inserts after a dispatched WAL under another plan digest",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-wal-unknown-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      await fixture.archAttempts.begin(
        await currentWalInput(fixture, {
          runId: fixture.queued.runId,
          dispatchedAt: "2026-08-08T12:15:00.000Z",
        }),
      );
      const syson = new InitialArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "outcome is unknown",
      );
      assertEquals(syson.calls.length, 0);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture dispatched WAL never opens a JIT session",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-wal-no-jit-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      await fixture.archAttempts.begin(
        await currentWalInput(fixture, {
          runId: fixture.queued.runId,
          dispatchedAt: "2026-08-08T12:15:00.000Z",
        }),
      );
      const session = recordingCapabilityRuntimeSession();
      const syson = new InitialArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson,
            directory,
            capabilityRuntimeSession: session,
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "outcome is unknown",
      );
      assertEquals(session.events, []);
      assertEquals(syson.calls.length, 0);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture opens JIT before claim and SysON, and keeps the run queued if begin fails",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-jit-order-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const events: string[] = [];
      const session = recordingCapabilityRuntimeSession(async (input) => {
        events.push("begin");
        await input.recheck();
        return {
          lease: { id: "capability-jit-arch" } as never,
          releaseTerminal: () => Promise.resolve(),
          retainForRecovery: () => undefined,
        };
      });
      const syson = new InitialArchSyson();
      const originalInsert = syson.callTool.bind(syson);
      syson.callTool = (call) => {
        events.push(`provider:${call.name}`);
        return originalInsert(call);
      };
      const commands = Object.create(
        fixture.commands,
      ) as typeof fixture.commands;
      commands.claimRun = (origin, command) => {
        events.push("claim");
        return fixture.commands.claimRun(origin, command);
      };
      const executor = new ModelWriteArchitectureRunExecutor({
        projects: fixture.projects,
        commands,
        snapshots: fixture.snapshots,
        seedCaptures: fixture.seedCaptures,
        captures: fixture.archCaptures,
        sysmlSourceAnalysis: fixture.sysmlSourceAnalysis,
        attempts: fixture.archAttempts,
        syson,
        lease: new FileEngineeringProjectRunLease(`${directory}/arch-leases`),
        ...successfulCapabilityRuntimeFor(
          PROJECT_ID,
          MODEL_WRITE_ARCHITECTURE_OPERATION,
          "model.author-system",
        ),
        capabilityRuntimeSession: session,
        now: () => "2026-08-08T12:15:00.000Z",
      });
      await executor.execute(AGENT, executionCommand(fixture));
      assertEquals(events[0], "begin");
      assertEquals(events.includes("claim"), true);
      assertEquals(events.indexOf("begin") < events.indexOf("claim"), true);
      assertEquals(
        events.indexOf("claim") <
          events.findIndex((event) => event.startsWith("provider:")),
        true,
      );

      const failing = recordingCapabilityRuntimeSession(() =>
        Promise.reject(new Error("exact SysON host group unavailable"))
      );
      const fixture2 = await queuedArchitectureFixture(
        `${directory}/second`,
      );
      const syson2 = new InitialArchSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture2, {
            syson: syson2,
            directory: `${directory}/second`,
            capabilityRuntimeSession: failing,
          }).execute(AGENT, executionCommand(fixture2)),
        Error,
        "host group unavailable",
      );
      assertEquals(failing.events, ["begin"]);
      assertEquals(failing.releases, 0);
      assertEquals(failing.retains, 0);
      assertEquals(syson2.calls.length, 0);
      assertEquals(
        (await fixture2.projects.get(PROJECT_ID))?.agentRuns.find((run) =>
          run.id === fixture2.queued.runId
        )?.status,
        "queued",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects reordered v3 WAL items or selectors before CAS reopen and provider access",
  async () => {
    class ReopenProbe extends SysmlSourceAnalysisCaptureService {
      reopenCalls = 0;

      override async reopen(value: unknown) {
        this.reopenCalls++;
        return await super.reopen(value);
      }
    }
    const items = [
      { kind: "part-def", componentName: "Wing" },
      {
        kind: "usage",
        componentName: "Wing",
        usageName: "wing",
        parentName: "DroneSystem",
      },
    ] as const;
    for (const field of ["items", "sourceAnalyses"] as const) {
      const directory = await Deno.makeTempDir({
        prefix: `casys-arch-wal-${field}-tamper-`,
      });
      try {
        const fixture = await queuedArchitectureFixture(directory);
        const persisted = await currentWalInput(fixture, {
          runId: fixture.queued.runId,
          dispatchedAt: "2026-08-08T12:15:00.000Z",
          items,
        });
        await fixture.archAttempts.begin(persisted);
        await fixture.archAttempts.complete({
          projectId: persisted.projectId,
          runId: persisted.runId,
          planDigest: persisted.planDigest,
          architecturePackageId: "arch-pkg-001",
        });

        const [entry] = await Array.fromAsync(
          Deno.readDir(`${directory}/arch-attempts`),
        );
        const path = `${directory}/arch-attempts/${entry!.name}`;
        const record = JSON.parse(await Deno.readTextFile(path)) as Record<
          string,
          unknown
        >;
        record[field] = [
          ...(record[field] as readonly unknown[]),
        ].reverse();
        await Deno.writeTextFile(path, `${deterministicJson(record)}\n`);

        const sourceEvidence = new ReopenProbe({
          sourceCaptures: fixture.sysmlSourceCaptures,
          analysisCaptures: fixture.sourceAnalysisCaptures,
          frontend: new RenderedArchitectureSysmlAnalyzer(),
        });
        const syson = new InitialArchSyson();
        await assertRejects(
          () =>
            makeExecutor(fixture, {
              syson,
              directory,
              sysmlSourceAnalysis: sourceEvidence,
            }).execute(
              AGENT,
              executionCommand(fixture),
            ),
          EngineeringProjectCommandError,
          "outcome is unknown",
        );
        assertEquals(
          syson.calls,
          [],
          `${field} tamper must stop before any provider access`,
        );
        assertEquals(sourceEvidence.reopenCalls, 0);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

// ── Refusal — non-agent origin ────────────────────────────────────────────────

Deno.test(
  "model.write-architecture rejects persisted MRTR summary or parameter mutation before SysON",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-mrtr-seal-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const mutations: ReadonlyArray<[
        string,
        (decision: Record<string, unknown>) => void,
      ]> = [
        ["summary", (decision) => {
          const proposal = decision.proposal as Record<string, unknown>;
          proposal.summary = "Persisted summary changed after approval";
        }],
        ["parameters", (decision) => {
          const proposal = decision.proposal as Record<string, unknown>;
          const parameters = proposal.parameters as Array<
            Record<string, unknown>
          >;
          parameters[0]!.value = "MutatedPackage";
        }],
      ];

      for (const [name, mutate] of mutations) {
        const before = await fixture.projects.get(PROJECT_ID);
        assertExists(before);
        const projects = {
          async get(projectId: string) {
            const project = await fixture.projects.get(projectId);
            if (!project) return undefined;
            const altered = structuredClone(project);
            const decision = altered.decisions.find((candidate) =>
              candidate.id === "decision:arch-params"
            );
            assertExists(decision);
            mutate(decision as unknown as Record<string, unknown>);
            return altered;
          },
          getRevision(projectId: string, revision: number) {
            return fixture.projects.getRevision(projectId, revision);
          },
          createInitial(
            snapshot: Parameters<typeof fixture.projects.createInitial>[0],
          ) {
            return fixture.projects.createInitial(snapshot);
          },
          commit(
            snapshot: Parameters<typeof fixture.projects.commit>[0],
            expectedRevision: number,
          ) {
            return fixture.projects.commit(snapshot, expectedRevision);
          },
        } as unknown as FileEngineeringProjectRevisionStore;
        const syson = new InitialArchSyson();
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, projects }, {
              syson,
              directory,
              leaseSubdir: `mrtr-seal-${name}`,
            }).execute(AGENT, executionCommand(fixture)),
          EngineeringProjectCommandError,
          "decision input fingerprint no longer seals",
        );
        assertEquals(syson.calls, [], name);
        assertEquals(
          await fixture.archAttempts.readRun(PROJECT_ID, fixture.queued.runId),
          undefined,
          name,
        );
        const unchanged = await fixture.projects.get(PROJECT_ID);
        assertEquals(unchanged?.revision, before.revision, name);
        assertEquals(
          unchanged?.agentRuns.find((run) => run.id === fixture.queued.runId)
            ?.status,
          "queued",
          name,
        );
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture executor rejects a non-agent origin",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-human-origin-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const executor = makeExecutor(fixture, {
        syson: {
          callTool: () => Promise.reject(new Error("must not call")),
        } as unknown as McpToolClient,
        directory,
      });

      await assertRejects(
        () => executor.execute(HUMAN, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "Only an authenticated agent",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Refusal — no human approval ───────────────────────────────────────────────

Deno.test(
  "model.write-architecture executor refuses when the MRTR decision has no human approval",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-no-human-",
    });
    try {
      // Build fixture normally — then manually replace the approval's decidedByOrigin
      // by building a project where only an agent approved the decision.
      //
      // Easier approach: build the fixture but replace projects with a tampered snapshot
      // that has the approval decidedByOrigin as "agent".
      //
      // We simulate this by building a full fixture and then directly testing
      // the error path: an executor with the real fixture should succeed, so
      // instead we test the code path where the existing snapshot has an agent
      // approval by checking the refusal message from `requireMrtrApproval`.
      //
      // Actually the simplest approach: use a snapshot store that returns a
      // project where all approvals have `decidedByOrigin = "agent"`.

      // Build and queue, but mutate the project store snapshot to change approval origin.
      const fixture = await queuedArchitectureFixture(directory);

      // Read the latest project snapshot and check that it has the approval.
      const project = await fixture.projects.get(PROJECT_ID);
      assertExists(project, "project must exist");
      const humanApproval = project.approvals.find(
        (a) =>
          a.decisionId === "decision:arch-params" &&
          a.decidedByOrigin === "human",
      );
      assertExists(humanApproval, "human approval must exist in the fixture");

      // The test objective: verify the MRTR check fires when the architecture
      // work item has no decisions attached. requireMrtrApproval iterates over
      // workItem.decisionIds — an empty list causes it to throw immediately with
      // the "human" refusal message, exercising the same guard path.
      //
      // Note: approveDecision(AGENT, ...) is NOT used because the command policy
      // only allows "human" origin to call decision.approve — attempting it would
      // throw permission_denied before the executor is ever reached. The canonical
      // way to exercise this guard is a work item with no decision bindings.

      const directory2 = await Deno.makeTempDir({
        prefix: "casys-arch-no-mrtr-",
      });
      try {
        const projects2 = new FileEngineeringProjectRevisionStore(
          `${directory2}/projects`,
        );
        const snapshots2 = new FileThreadSnapshotStore(
          `${directory2}/snapshots`,
        );
        const baselineCaptures2 = new FileCaptureStore({
          ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
          directory: `${directory2}/baseline-captures`,
        });
        const seedCaptures2 = new FileCaptureStore({
          ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
          directory: `${directory2}/seed-captures`,
        });
        const archCaptures2 = new FileCaptureStore({
          ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
          directory: `${directory2}/arch-captures`,
        });
        const seedAttempts2 = new FileSysonModelSeedAttemptStore(
          `${directory2}/seed-attempts`,
        );
        const archAttempts2 = new FileArchitectureAttemptStore(
          `${directory2}/arch-attempts`,
        );

        let tick2 = 0;
        const now2 = () =>
          new Date(Date.parse("2026-08-08T12:00:00.000Z") + ++tick2 * 1_000)
            .toISOString();
        const briefs2 = new ProjectBriefCommandService(projects2, now2);
        let proj2 = await briefs2.startProject(AGENT, {
          commandId: "start2",
          projectId: PROJECT_ID,
          projectName: "DroneV4 no-mrtr",
          issuedAt: "2026-08-08T11:59:00.000Z",
          intent: "test",
          intentSource: { kind: "human", reference: "conv:test" },
        });
        proj2 = await briefs2.proposeBrief(AGENT, {
          ...ctx("propose-brief2", proj2.revision),
          items: [{
            id: "objective",
            kind: "objective",
            statement: "Test no-MRTR-decision refusal.",
            sourceRefs: [{ kind: "intent", reference: "conv:test" }],
          }, {
            id: "mission",
            kind: "mission-scenario",
            statement: "Insert a DroneV4 SysML package.",
            sourceRefs: [{ kind: "intent", reference: "conv:test" }],
          }, {
            id: "success",
            kind: "success-criterion",
            statement: "Test passes.",
            sourceRefs: [{ kind: "intent", reference: "conv:test" }],
            dependsOnItemIds: [],
          }],
        });
        proj2 = await briefs2.approveBrief(HUMAN, {
          ...ctx("approve-brief2", proj2.revision),
          briefSnapshotId: proj2.framing!.proposedBrief!.id,
          briefRevision: proj2.framing!.proposedBrief!.revision,
          rationale: "Approved.",
          inputFingerprint: proj2.framing!.proposalReview!.inputFingerprint,
        });

        const commands2 = new EngineeringProjectCommandService(
          projects2,
          new ExactThreadCompletionEvidenceValidator(snapshots2),
          now2,
          { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
          new ExactInitialBaselineEvidenceValidator(
            snapshots2,
            baselineCaptures2,
            approvedBriefSourceAnalysisFixture(directory2),
          ),
        );

        proj2 = await commands2.publishPlan(AGENT, {
          ...ctx("publish-plan2", proj2.revision),
          startingPoint: "idea-or-spec",
          phases: [{
            id: "baseline",
            name: "Baseline",
            description: "Record.",
          }],
          workItems: [{
            id: "wi:baseline",
            phaseId: "baseline",
            owner: "agent",
            dependsOnWorkItemIds: [],
            decisionIds: [],
            operation: {
              id: "baseline.from-approved-brief",
              version: "1",
              bindings: [{
                name: "approvedBrief",
                source: { kind: "approved-brief" },
              }],
            },
          }],
          requiredDecisions: [],
        });
        proj2 = await commands2.queueRun(AGENT, {
          ...ctx("queue-baseline2", proj2.revision),
          runId: "run:baseline",
          workItemId: "wi:baseline",
          summary: "baseline",
          basis: proj2.plan!.basis,
        });
        const afterBaseline2 = await new ApprovedBriefBaselineRunExecutor({
          projects: projects2,
          commands: commands2,
          captures: baselineCaptures2,
          ...approvedBriefSourceAnalysisFixture(directory2),
          snapshots: snapshots2,
          lease: new FileEngineeringProjectRunLease(
            `${directory2}/baseline-leases`,
          ),
          now: () => "2026-08-08T12:05:00.000Z",
        }).execute(AGENT, {
          commandId: "agent-baseline2",
          projectId: PROJECT_ID,
          expectedRevision: proj2.revision,
          issuedAt: "2026-08-08T12:05:00.000Z",
          runId: "run:baseline",
        });
        const r12 = afterBaseline2.threadSnapshots[0]!;

        // Introduce wi:seed via appendChange — requiredPlanningLineage requires this.
        proj2 = await commands2.appendChange(AGENT, {
          ...ctx("append-seed2", afterBaseline2.revision),
          baseSnapshot: r12,
          phases: [{ id: "model", name: "Model", description: "Seed." }],
          workItems: [{
            id: "wi:seed",
            phaseId: "model",
            owner: "agent",
            dependsOnWorkItemIds: ["wi:baseline"],
            decisionIds: [],
            operation: {
              ...SYSON_MODEL_SEED_OPERATION,
              bindings: [{
                name: "approvedBrief",
                source: { kind: "approved-brief" },
              }],
            },
          }],
          requiredDecisions: [],
        });
        proj2 = await commands2.queueRun(AGENT, {
          ...ctx("queue-seed2", proj2.revision),
          runId: "run:seed",
          workItemId: "wi:seed",
          summary: "seed",
          basis: { kind: "thread-snapshot", ...r12 },
        });
        const afterSeed2 = await new SysonModelSeedRunExecutor({
          projects: projects2,
          commands: commands2,
          snapshots: snapshots2,
          captures: seedCaptures2,
          attempts: seedAttempts2,
          capabilityRuntimeConnection: passthroughCapabilityRuntimeConnection(
            new SeedSyson(),
          ),
          lease: new FileEngineeringProjectRunLease(
            `${directory2}/seed-leases`,
          ),
          ...successfulCapabilityRuntimeFor(
            PROJECT_ID,
            SYSON_MODEL_SEED_OPERATION,
            "model.author-system",
          ),
          now: () => "2026-08-08T12:10:00.000Z",
        }).execute(AGENT, {
          commandId: "agent-seed2",
          projectId: PROJECT_ID,
          expectedRevision: proj2.revision,
          issuedAt: "2026-08-08T12:10:00.000Z",
          runId: "run:seed",
        });
        const r22 = afterSeed2.threadSnapshots.at(-1)!;

        // Architecture work item with NO decision bindings — requireMrtrApproval
        // iterates over an empty decisionIds and throws the "human" refusal.
        proj2 = await commands2.appendChange(AGENT, {
          ...ctx("append-arch2", afterSeed2.revision),
          baseSnapshot: r22,
          phases: [{
            id: "arch",
            name: "Architecture",
            description: "Author.",
          }],
          workItems: [{
            id: "wi:architecture",
            phaseId: "arch",
            owner: "agent",
            dependsOnWorkItemIds: ["wi:seed"],
            decisionIds: [],
            operation: {
              ...MODEL_WRITE_ARCHITECTURE_OPERATION,
              bindings: [{
                name: "approvedBrief",
                source: { kind: "approved-brief" },
              }],
            },
          }],
          requiredDecisions: [],
        });
        // Queue is possible because there are no pending decisions to resolve.
        const queued2 = await commands2.queueRun(AGENT, {
          ...ctx("queue-arch2", proj2.revision),
          runId: "run:architecture",
          workItemId: "wi:architecture",
          summary: "Author architecture.",
          basis: { kind: "thread-snapshot", ...r22 },
        });

        const executor2 = new ModelWriteArchitectureRunExecutor({
          projects: projects2,
          commands: commands2,
          snapshots: snapshots2,
          seedCaptures: seedCaptures2,
          captures: archCaptures2,
          sysmlSourceAnalysis: new SysmlSourceAnalysisCaptureService({
            sourceCaptures: new FileCaptureStore({
              ...SYSML_SOURCE_CAPTURE_DESCRIPTOR,
              directory: `${directory2}/sysml-source-captures`,
            }),
            analysisCaptures: new FileCaptureStore({
              ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
              directory: `${directory2}/source-analysis-captures`,
            }),
            frontend: new RenderedArchitectureSysmlAnalyzer(),
          }),
          attempts: archAttempts2,
          syson: {
            callTool: () => Promise.reject(new Error("must not call provider")),
          } as unknown as McpToolClient,
          lease: new FileEngineeringProjectRunLease(
            `${directory2}/arch-leases`,
          ),
          ...successfulCapabilityRuntimeFor(
            PROJECT_ID,
            MODEL_WRITE_ARCHITECTURE_OPERATION,
            "model.author-system",
          ),
          now: () => "2026-08-08T12:15:00.000Z",
        });

        await assertRejects(
          () =>
            executor2.execute(AGENT, {
              commandId: "agent-arch2",
              projectId: PROJECT_ID,
              expectedRevision: queued2.revision,
              issuedAt: "2026-08-08T12:15:00.000Z",
              runId: "run:architecture",
            }),
          EngineeringProjectCommandError,
          "human",
        );
      } finally {
        await Deno.remove(directory2, { recursive: true });
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Refusal — empty plan (all adopted) ───────────────────────────────────────

Deno.test(
  "model.write-architecture executor refuses when all proposed components already exist in SysON",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-all-adopted-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);

      // SysON mock returns the package and all components as already present.
      // Phase 3b uses syson_query_aql for FeatureTyping resolution.
      const allAdoptedSyson: McpToolClient = {
        callTool: (call: McpToolCall): Promise<McpToolResult> => {
          if (call.name === "syson_element_children") {
            const id = call.arguments?.element_id as string;
            if (id === "root-pkg-drone") {
              return Promise.resolve({
                text: "root",
                structuredContent: {
                  parentId: id,
                  children: [{
                    id: "arch-pkg-001",
                    kind: "siriusComponents://semantic?domain=sysml&entity=Package",
                    label: "DroneV4",
                  }],
                  count: 1,
                },
              });
            }
            if (id === "arch-pkg-001") {
              return Promise.resolve({
                text: "package",
                structuredContent: {
                  parentId: id,
                  children: [
                    {
                      id: "sys-def-001",
                      kind:
                        "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                      label: "DroneSystem",
                    },
                    {
                      id: "wing-def-001",
                      kind:
                        "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                      label: "Wing",
                    },
                  ],
                  count: 2,
                },
              });
            }
            if (id === "sys-def-001") {
              return Promise.resolve({
                text: "sys-usages",
                structuredContent: {
                  parentId: id,
                  children: [{
                    id: "wing-usage-001",
                    kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
                    label: "wing",
                  }],
                  count: 1,
                },
              });
            }
            return Promise.resolve({
              text: "empty",
              structuredContent: { parentId: id, children: [], count: 0 },
            });
          }
          // Phase 3b: AQL resolves the FeatureTyping target for "wing" → "Wing".
          if (call.name === "syson_query_aql") {
            const objectId = call.arguments?.object_id as string;
            const expression = call.arguments?.expression;
            if (
              objectId === "wing-usage-001" &&
              expression === ARCHITECTURE_FEATURE_TYPING_AQL
            ) {
              return Promise.resolve({
                text: "feature-typing-aql",
                structuredContent: {
                  objectId,
                  expression,
                  type: "objects",
                  results: [{
                    id: "wing-def-001",
                    kind:
                      "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                    label: "Wing",
                  }],
                  count: 1,
                },
              });
            }
          }
          return Promise.reject(
            new Error(`Unexpected tool call in allAdoptedSyson: ${call.name}`),
          );
        },
      } as unknown as McpToolClient;

      const executor = makeExecutor(fixture, {
        syson: allAdoptedSyson,
        directory,
      });

      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "No insertion is needed",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Monotony ratchet unit tests ───────────────────────────────────────────────

Deno.test(
  "findArchitectureArtifact returns the architecture artifact by URI prefix",
  () => {
    const freshness = {
      status: "fresh" as const,
      changedAt: "2026-08-08T12:00:00.000Z",
      invalidatedByChangeIds: [],
    };
    const baseArtifact = {
      id: "model-artifact-base",
      name: "Seed model",
      kind: "sysml-model" as const,
      version: "v1",
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      uri: "casys://syson-model-seed-capture/sha256/" + "a".repeat(64),
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_model_create",
        runId: "run:seed",
      },
      inputArtifactIds: [],
      freshness,
    };
    const archArtifact = {
      id: "architecture-artifact",
      name: "Architecture",
      kind: "sysml-model" as const,
      version: "v1",
      fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
      uri: "casys://architecture-capture/sha256/" + "b".repeat(64),
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:arch",
      },
      inputArtifactIds: [baseArtifact.id],
      freshness,
    };
    const subject = {
      id: "project:test",
      name: "Test",
      kind: "system" as const,
      version: "v1",
      modelArtifactId: "model-artifact-base",
    };
    const changeSet = {
      id: "cs-1",
      name: "Base",
      status: "applied" as const,
      createdAt: "2026-08-08T12:00:00.000Z",
      appliedAt: "2026-08-08T12:00:00.000Z",
      changes: [],
    };

    const noArch: ThreadSnapshot = {
      schemaVersion: "1.0",
      id: "snap-no-arch",
      revision: 1,
      generatedAt: "2026-08-08T12:00:00.000Z",
      subject,
      freshness,
      changeSet,
      artifacts: [baseArtifact],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
    };
    const withArch: ThreadSnapshot = {
      ...noArch,
      id: "snap-with-arch",
      artifacts: [baseArtifact, archArtifact],
    };

    assertEquals(findArchitectureArtifact(noArch), undefined);
    const found = findArchitectureArtifact(withArch);
    assertExists(found);
    assertEquals(found.id, "architecture-artifact");
  },
);

Deno.test(
  "assertArchitectureArtifactNotRemoved raises when an ancestor had the artifact but the current basis does not",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-arch-ratchet-" });
    try {
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);

      const freshness = {
        status: "fresh" as const,
        changedAt: "2026-08-08T12:00:00.000Z",
        invalidatedByChangeIds: [],
      };
      const operation = {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:ratchet-test",
      };
      const changeSet = {
        id: "cs-ratchet",
        name: "Ratchet",
        status: "applied" as const,
        createdAt: "2026-08-08T12:00:00.000Z",
        appliedAt: "2026-08-08T12:00:00.000Z",
        changes: [],
      };
      const subject = {
        id: "project:ratchet",
        name: "Ratchet test",
        kind: "system" as const,
        version: "v1",
        modelArtifactId: "base-model",
      };
      const baseModel = {
        id: "base-model",
        name: "Base",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const archArtifact = {
        id: "arch-artifact-ratchet",
        name: "Architecture",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: "casys://architecture-capture/sha256/" + "b".repeat(64),
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };

      const s1: ThreadSnapshot = {
        schemaVersion: "1.0",
        id: "snap-ratchet-1",
        revision: 1,
        generatedAt: "2026-08-08T12:00:00.000Z",
        subject,
        freshness,
        changeSet,
        artifacts: [baseModel],
        consumptions: [],
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
      };
      const s2: ThreadSnapshot = {
        ...s1,
        id: "snap-ratchet-2",
        revision: 2,
        previous: { snapshotId: "snap-ratchet-1", revision: 1 },
        artifacts: [baseModel, archArtifact],
      };
      const s3: ThreadSnapshot = {
        ...s1,
        id: "snap-ratchet-3",
        revision: 3,
        previous: { snapshotId: "snap-ratchet-2", revision: 2 },
        artifacts: [baseModel], // architecture artifact dropped — ratchet must fire
      };

      await snapshots.save(s1);
      await snapshots.save(s2);

      // s3 (not saved) has no artifact but s2 (ancestor) had it.
      await assertRejects(
        () => assertArchitectureArtifactNotRemoved(s3, snapshots),
        ArchitectureArtifactRemovedError,
        "architecture_artifact_removed",
      );

      // s2 itself has the artifact — no error.
      await assertArchitectureArtifactNotRemoved(s2, snapshots);

      // s1 has no artifact and no ancestor — no error.
      await assertArchitectureArtifactNotRemoved(s1, snapshots);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Capture content integrity ─────────────────────────────────────────────────

Deno.test(
  "model.write-architecture capture fingerprint matches the stored text after execution",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-capture-fp-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const executor = makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      });
      const result = await executor.execute(AGENT, executionCommand(fixture));

      const run = result.agentRuns.find((r) => r.id === "run:architecture")!;
      assertExists(run.resultSnapshot);
      const snap = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
      assertExists(snap);
      const archArtifact = findArchitectureArtifact(snap);
      assertExists(archArtifact);

      const storedText = await fixture.archCaptures.read(
        archArtifact.fingerprint,
      );
      assertExists(storedText);
      // sha256Fingerprint on an object hashes deterministicJson(object), which is
      // the exact bytes that were saved as the capture text. Passing the raw string
      // would add an extra JSON-quoting layer and produce a different hash.
      const recomputedFp = await sha256Fingerprint(JSON.parse(storedText));
      // The stored fingerprint must match the re-computed one.
      assertEquals(
        archArtifact.fingerprint.digest,
        recomputedFp.digest,
        "stored fingerprint must match re-computed fingerprint",
      );
      // The capture text must be round-trip stable (re-serialising the parsed
      // object produces the exact same bytes that were stored).
      const recomputedFromJson = deterministicJson(JSON.parse(storedText));
      assertEquals(
        recomputedFromJson,
        storedText,
        "capture is round-trip stable",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Finding 6: consumption observedFingerprint is recomputed from bytes read ──

Deno.test(
  "model.write-architecture consumption attestation uses the fingerprint computed from bytes read, not the snapshot record",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-consumption-fp-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const executor = makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      });
      const result = await executor.execute(AGENT, executionCommand(fixture));

      const run = result.agentRuns.find((r) => r.id === "run:architecture")!;
      assertExists(run.resultSnapshot);
      const snap = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
      assertExists(snap);

      // The seed artifact's fingerprint (from the snapshot record).
      const seedArtifact = snap.artifacts.find(
        (a) => a.producer.tool === "syson_model_create",
      );
      assertExists(seedArtifact);

      // The consumption should exist and its observedFingerprint must match
      // the fingerprint recomputed from the actual seed capture bytes.
      const consumption = snap.consumptions.find(
        (c) => c.artifactId === seedArtifact.id,
      );
      assertExists(consumption, "consumption for the seed artifact must exist");
      assertEquals(
        consumption.status,
        "verified",
        "consumption must be marked verified",
      );

      // Recompute from the bytes actually stored in the seed capture.
      const seedCaptureText = await fixture.seedCaptures.read(
        seedArtifact.fingerprint,
      );
      assertExists(seedCaptureText, "seed capture must be readable");
      const recomputedFp = await sha256Fingerprint(JSON.parse(seedCaptureText));
      assertEquals(
        consumption.observedFingerprint.digest,
        recomputedFp.digest,
        "observedFingerprint must be the fingerprint recomputed from bytes read, " +
          "not a copy of the snapshot record",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Finding 7: cliquet inert on different-subject lineage ────────────────────

Deno.test(
  "assertArchitectureArtifactNotRemoved is inert when the lineage crosses a subject boundary",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-ratchet-subject-",
    });
    try {
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);

      const freshness = {
        status: "fresh" as const,
        changedAt: "2026-08-08T12:00:00.000Z",
        invalidatedByChangeIds: [],
      };
      const op = {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:cross-subject",
      };
      const changeSet = {
        id: "cs-x",
        name: "cross",
        status: "applied" as const,
        createdAt: "2026-08-08T12:00:00.000Z",
        appliedAt: "2026-08-08T12:00:00.000Z",
        changes: [],
      };

      // Snapshot S1: subject "project:A", HAS architecture artifact.
      const archArtifactA = {
        id: "arch-a",
        name: "Architecture A",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        uri: "casys://architecture-capture/sha256/" + "a".repeat(64),
        producer: op,
        inputArtifactIds: [],
        freshness,
      };
      const s1: ThreadSnapshot = {
        schemaVersion: "1.0",
        id: "snap-x-1",
        revision: 1,
        generatedAt: "2026-08-08T12:00:00.000Z",
        subject: {
          id: "project:A",
          name: "Project A",
          kind: "system",
          version: "v1",
          modelArtifactId: "arch-a",
        },
        freshness,
        changeSet,
        artifacts: [archArtifactA],
        consumptions: [],
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
      };
      await snapshots.save(s1);

      // Snapshot S2: subject "project:B" (DIFFERENT), NO architecture artifact,
      // but its lineage pointer points to S1 (cross-subject reference).
      const baseB = {
        id: "base-b",
        name: "Base B",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        producer: op,
        inputArtifactIds: [],
        freshness,
      };
      const s2: ThreadSnapshot = {
        schemaVersion: "1.0",
        id: "snap-x-2",
        revision: 1,
        generatedAt: "2026-08-08T12:05:00.000Z",
        subject: {
          id: "project:B",
          name: "Project B",
          kind: "system",
          version: "v1",
          modelArtifactId: "base-b",
        },
        freshness,
        changeSet: { ...changeSet, id: "cs-x-b" },
        // Cross-subject lineage pointer: points to S1 (project A's snapshot).
        previous: { snapshotId: "snap-x-1", revision: 1 },
        artifacts: [baseB],
        consumptions: [],
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
      };

      // The ratchet on S2 must be inert because the lineage crosses a subject
      // boundary (project:A → project:B). The architecture artifact in S1 belongs
      // to project:A and must not trigger a ratchet for project:B.
      await assertArchitectureArtifactNotRemoved(s2, snapshots);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Basis lineage integrity before provider dispatch ──────────────────────────

Deno.test(
  "model.write-architecture rejects an architecture merge input before WAL or provider access",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-merge-lineage-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const initial = await makeExecutor(fixture, {
        syson: new InitialArchSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const queued = await queueArchitectureEnrichment(fixture, initial);
      const initialRun = initial.agentRuns.find((run) =>
        run.id === fixture.queued.runId
      );
      assertExists(initialRun?.resultSnapshot);
      const base = await fixture.snapshots.get(
        initialRun.resultSnapshot.snapshotId,
      );
      assertExists(base);
      const seed = base.artifacts.find((artifact) =>
        artifact.producer.tool === "syson_model_create"
      );
      const architectureA = findArchitectureArtifact(base);
      assertExists(seed);
      assertExists(architectureA);

      const digestC = "c".repeat(64);
      const architectureC = {
        ...architectureA,
        id: `architecture-${digestC}`,
        name: "Architecture C",
        version: digestC,
        fingerprint: { algorithm: "sha256" as const, digest: digestC },
        uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digestC}`,
        producer: { ...architectureA.producer, runId: "run:architecture-c" },
        inputArtifactIds: [seed.id],
      };
      const digestB = "d".repeat(64);
      const architectureB = {
        ...architectureA,
        id: `architecture-${digestB}`,
        name: "Architecture B merge",
        version: digestB,
        fingerprint: { algorithm: "sha256" as const, digest: digestB },
        uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digestB}`,
        producer: { ...architectureA.producer, runId: "run:architecture-b" },
        inputArtifactIds: [seed.id, architectureA.id, architectureC.id],
      };
      const inputEvidence = (
        consumer: ThreadArtifact,
        input: ThreadArtifact,
      ) => ({
        consumption: {
          id: `consume-${input.id}-by-${consumer.id}`,
          artifactId: input.id,
          consumer: consumer.producer,
          observedFingerprint: input.fingerprint,
          verifiedAt: base.generatedAt,
          status: "verified" as const,
        },
        provenance: [{
          id: `derived-${consumer.id}-from-${input.id}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: consumer.id },
          to: { kind: "artifact" as const, id: input.id },
          rationale:
            "Synthetic valid merge lineage used to exercise the executor guard.",
        }, {
          id: `uses-consume-${input.id}-by-${consumer.id}`,
          relation: "uses" as const,
          from: {
            kind: "consumption" as const,
            id: `consume-${input.id}-by-${consumer.id}`,
          },
          to: { kind: "artifact" as const, id: input.id },
          rationale: "Synthetic verified consumption for the lineage guard test.",
        }],
      });
      const addedEvidence = [
        inputEvidence(architectureC, seed),
        inputEvidence(architectureB, seed),
        inputEvidence(architectureB, architectureA),
        inputEvidence(architectureB, architectureC),
      ];
      const mergedBasis: ThreadSnapshot = {
        ...base,
        artifacts: [...base.artifacts, architectureC, architectureB],
        consumptions: [
          ...base.consumptions,
          ...addedEvidence.map((item) => item.consumption),
        ],
        provenance: [
          ...base.provenance,
          ...addedEvidence.flatMap((item) => item.provenance),
        ],
      };
      const snapshots: ThreadSnapshotStore = {
        get: (snapshotId) =>
          snapshotId === base.id
            ? Promise.resolve(mergedBasis)
            : fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: (snapshot) => fixture.snapshots.save(snapshot),
      };
      const syson = new EnrichmentArchSyson();

      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory, snapshots }).execute(
            AGENT,
            {
              commandId: "agent-reject-architecture-merge",
              projectId: PROJECT_ID,
              expectedRevision: queued.revision,
              issuedAt: "2026-08-08T12:20:00.000Z",
              runId: queued.runId,
            },
          ),
        EngineeringProjectCommandError,
        "input lineage is not exact",
      );

      assertEquals(
        syson.calls,
        [],
        "invalid lineage must stop before provider access",
      );
      assertEquals(
        await fixture.archAttempts.readRun(PROJECT_ID, queued.runId),
        undefined,
        "invalid lineage must stop before WAL reservation",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects a cross-subject predecessor before any SysON call",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-lineage-subject-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const base = await queuedArchitectureBasisSnapshot(fixture);
      assertExists(base.previous);
      const predecessor = await fixture.snapshots.get(base.previous.snapshotId);
      assertExists(predecessor);

      const foreignPredecessor: ThreadSnapshot = {
        ...predecessor,
        subject: { ...predecessor.subject, id: "project:foreign" },
      };
      const corruptSnapshots: ThreadSnapshotStore = {
        get: (snapshotId) =>
          snapshotId === predecessor.id
            ? Promise.resolve(foreignPredecessor)
            : fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: (snapshot) => fixture.snapshots.save(snapshot),
      };
      const syson = new InitialArchSyson();
      const executor = makeExecutor(fixture, {
        syson,
        directory,
        snapshots: corruptSnapshots,
      });

      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "invalid predecessor lineage",
      );
      assertEquals(syson.calls, [], "invalid lineage must stop before SysON");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects a missing predecessor before any SysON call",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-lineage-missing-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const base = await queuedArchitectureBasisSnapshot(fixture);
      assertExists(base.previous);

      const corruptSnapshots: ThreadSnapshotStore = {
        get: (snapshotId) =>
          snapshotId === base.previous!.snapshotId
            ? Promise.resolve(undefined)
            : fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: (snapshot) => fixture.snapshots.save(snapshot),
      };
      const syson = new InitialArchSyson();
      const executor = makeExecutor(fixture, {
        syson,
        directory,
        snapshots: corruptSnapshots,
      });

      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "invalid predecessor lineage",
      );
      assertEquals(
        syson.calls,
        [],
        "missing predecessor must stop before SysON",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Finding 1: post-insertion verification rejects wrong usage target type ────

Deno.test(
  "model.write-architecture rejects the published snapshot when the verified extraction shows usage typing the wrong PartDef",
  async () => {
    // SysON returns Wing's usage but FeatureTyping says "Motor" — the
    // verification step must detect the type divergence and throw.
    class WrongTypeSyson implements McpToolClient {
      callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
        return Promise.reject(
          new Error(`callToolTextResult not implemented (${call.name})`),
        );
      }
      #childrenCallCount = 0;
      callTool(call: McpToolCall): Promise<McpToolResult> {
        if (call.name === "syson_element_insert_sysml") {
          return Promise.resolve({
            text: "inserted",
            structuredContent: {
              inserted: true,
              parentId: call.arguments?.parent_id,
            },
          });
        }
        if (call.name === "syson_element_children") {
          this.#childrenCallCount++;
          const elementId = call.arguments?.element_id as string;
          if (elementId === "root-pkg-drone") {
            if (this.#childrenCallCount === 1) {
              return Promise.resolve({
                text: "empty",
                structuredContent: {
                  parentId: elementId,
                  children: [],
                  count: 0,
                },
              });
            }
            return Promise.resolve({
              text: "root-with-package",
              structuredContent: {
                parentId: elementId,
                children: [{
                  id: "arch-pkg-001",
                  kind: "siriusComponents://semantic?domain=sysml&entity=Package",
                  label: "DroneV4",
                }],
                count: 1,
              },
            });
          }
          if (elementId === "arch-pkg-001") {
            return Promise.resolve({
              text: "package-contents",
              structuredContent: {
                parentId: elementId,
                children: [
                  {
                    id: "sys-def-001",
                    kind:
                      "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                    label: "DroneSystem",
                  },
                  {
                    id: "wing-def-001",
                    kind:
                      "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                    label: "Wing",
                  },
                ],
                count: 2,
              },
            });
          }
          if (elementId === "sys-def-001") {
            return Promise.resolve({
              text: "system-usages",
              structuredContent: {
                parentId: elementId,
                children: [{
                  id: "wing-usage-001",
                  kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
                  label: "wing",
                }],
                count: 1,
              },
            });
          }
          // Wing def: no usages
          return Promise.resolve({
            text: "no-usages",
            structuredContent: { parentId: elementId, children: [], count: 0 },
          });
        }
        // Phase 3b: AQL resolves "wing" usage type — returns "Motor" (wrong type).
        if (call.name === "syson_query_aql") {
          const objectId = call.arguments?.object_id as string;
          const expression = call.arguments?.expression;
          if (
            objectId === "wing-usage-001" &&
            expression === ARCHITECTURE_FEATURE_TYPING_AQL
          ) {
            return Promise.resolve({
              text: "feature-typing-wrong-aql",
              structuredContent: {
                objectId,
                expression,
                type: "objects",
                results: [{
                  id: "motor-def-001",
                  kind:
                    "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                  label: "Motor",
                }],
                count: 1,
              },
            });
          }
        }
        return Promise.reject(
          new Error(`Unexpected tool call in WrongTypeSyson: ${call.name}`),
        );
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-wrong-type-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const executor = makeExecutor(fixture, {
        syson: new WrongTypeSyson(),
        directory,
      });
      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        // Must mention the wrong type in the error message.
        "Motor",
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        true,
        "an acknowledged structural divergence must create a durable run quarantine",
      );
      const failed = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        failed?.agentRuns.find((run) => run.id === fixture.queued.runId)
          ?.status,
        "failed",
      );
      assertEquals(
        failed?.agentRuns.find((run) => run.id === fixture.queued.runId)
          ?.failure?.code,
        "model-write-architecture-post-acknowledgement-quarantined",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Readback ambiguity: duplicate same-parent usage labels ──────────────────

Deno.test(
  "model.write-architecture quarantines a post-acknowledgement extraction failure",
  async () => {
    class BrokenPostAckReadbackSyson extends InitialArchSyson {
      #rootReads = 0;

      override callTool(call: McpToolCall): Promise<McpToolResult> {
        if (
          call.name === "syson_element_children" &&
          call.arguments?.element_id === "root-pkg-drone"
        ) {
          this.#rootReads++;
          if (this.#rootReads === 2) {
            // The provider already acknowledged the package insertion. Its
            // immediate readback is malformed, so this is an extractor error,
            // not an EngineeringProjectCommandError.
            return Promise.resolve({ text: "broken", structuredContent: {} });
          }
        }
        return super.callTool(call);
      }
    }

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-post-ack-readback-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const syson = new BrokenPostAckReadbackSyson();
      const executor = makeExecutor(fixture, { syson, directory });
      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        ArchitectureStructureExtractionError,
      );
      assertEquals(
        await fixture.archAttempts.isQuarantined(
          PROJECT_ID,
          fixture.queued.runId,
        ),
        true,
      );
      assertEquals(
        (await fixture.projects.get(PROJECT_ID))?.agentRuns.find((run) =>
          run.id === fixture.queued.runId
        )?.status,
        "failed",
      );
      assertEquals(
        syson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        1,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-architecture rejects the readback when a parent has duplicate usage labels",
  async () => {
    const calls: McpToolCall[] = [];
    let rootChildrenCalls = 0;
    const syson: McpToolClient = {
      callToolTextResult: (
        call: McpToolCall,
      ): Promise<Record<string, unknown>> =>
        Promise.reject(new Error(`Unexpected text call: ${call.name}`)),
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        calls.push(structuredClone(call));
        if (call.name === "syson_element_insert_sysml") {
          return Promise.resolve({
            text: "inserted",
            structuredContent: {
              inserted: true,
              parentId: call.arguments?.parent_id,
            },
          });
        }
        if (call.name === "syson_element_children") {
          const elementId = call.arguments?.element_id as string;
          if (elementId === "root-pkg-drone") {
            rootChildrenCalls++;
            if (rootChildrenCalls === 1) {
              return Promise.resolve({
                text: "empty",
                structuredContent: {
                  parentId: elementId,
                  children: [],
                  count: 0,
                },
              });
            }
            return Promise.resolve({
              text: "root-with-package",
              structuredContent: {
                parentId: elementId,
                children: [{
                  id: "arch-pkg-001",
                  kind: "siriusComponents://semantic?domain=sysml&entity=Package",
                  label: "DroneV4",
                }],
                count: 1,
              },
            });
          }
          if (elementId === "arch-pkg-001") {
            return Promise.resolve({
              text: "part-defs",
              structuredContent: {
                parentId: elementId,
                children: [
                  {
                    id: "sys-def-001",
                    kind:
                      "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                    label: "DroneSystem",
                  },
                  {
                    id: "wing-def-001",
                    kind:
                      "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                    label: "Wing",
                  },
                ],
                count: 2,
              },
            });
          }
          if (elementId === "sys-def-001") {
            return Promise.resolve({
              text: "duplicate-wing-usages",
              structuredContent: {
                parentId: elementId,
                children: [
                  {
                    id: "wing-usage-conformant",
                    kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
                    label: "wing",
                  },
                  {
                    id: "wing-usage-mistyped",
                    kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
                    label: "wing",
                  },
                ],
                count: 2,
              },
            });
          }
          return Promise.resolve({
            text: "empty",
            structuredContent: { parentId: elementId, children: [], count: 0 },
          });
        }
        if (call.name === "syson_query_aql") {
          const objectId = call.arguments?.object_id as string;
          const target = objectId === "wing-usage-conformant" ? "Wing" : "Motor";
          return Promise.resolve({
            text: "feature-typing",
            structuredContent: {
              objectId,
              expression: ARCHITECTURE_FEATURE_TYPING_AQL,
              type: "objects",
              results: [{
                id: `${target.toLowerCase()}-def-001`,
                kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                label: target,
              }],
              count: 1,
            },
          });
        }
        return Promise.reject(new Error(`Unexpected tool call: ${call.name}`));
      },
    };

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-readback-duplicate-usage-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const executor = makeExecutor(fixture, { syson, directory });

      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "appears 2 times",
      );
      assertEquals(
        calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        1,
        "initial package insertion is acknowledged once, then readback rejects the ambiguity",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Phase B ambiguity: concurrent duplicate PartDefinition ──────────────────

Deno.test(
  "model.write-architecture stops before Phase C when PartDefinition labels become ambiguous",
  async () => {
    const calls: McpToolCall[] = [];
    let packageChildrenCalls = 0;
    const syson: McpToolClient = {
      callToolTextResult: (
        call: McpToolCall,
      ): Promise<Record<string, unknown>> =>
        Promise.reject(new Error(`Unexpected text call: ${call.name}`)),
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        calls.push(structuredClone(call));
        if (call.name === "syson_element_insert_sysml") {
          return Promise.resolve({
            text: "inserted",
            structuredContent: {
              inserted: true,
              parentId: call.arguments?.parent_id,
            },
          });
        }
        if (call.name !== "syson_element_children") {
          return Promise.reject(
            new Error(`Unexpected tool call: ${call.name}`),
          );
        }
        const elementId = call.arguments?.element_id as string;
        if (elementId === "root-pkg-drone") {
          return Promise.resolve({
            text: "root-with-package",
            structuredContent: {
              parentId: elementId,
              children: [{
                id: "arch-pkg-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=Package",
                label: "DroneV4",
              }],
              count: 1,
            },
          });
        }
        if (elementId === "arch-pkg-001") {
          packageChildrenCalls++;
          const children = packageChildrenCalls === 1
            ? [{
              id: "sys-def-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: "DroneSystem",
            }]
            : [
              {
                id: "sys-def-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                label: "DroneSystem",
              },
              {
                id: "concurrent-sys-def-002",
                kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                label: "DroneSystem",
              },
              {
                id: "wing-def-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
                label: "Wing",
              },
            ];
          return Promise.resolve({
            text: "package-contents",
            structuredContent: {
              parentId: elementId,
              children,
              count: children.length,
            },
          });
        }
        return Promise.resolve({
          text: "no-usages",
          structuredContent: { parentId: elementId, children: [], count: 0 },
        });
      },
    };

    const directory = await Deno.makeTempDir({
      prefix: "casys-arch-phase-b-duplicate-partdef-",
    });
    try {
      const fixture = await queuedArchitectureFixture(directory);
      const executor = makeExecutor(fixture, { syson, directory });

      await assertRejects(
        () => executor.execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "ambiguous PartDefinition labels",
      );
      const insertions = calls.filter((call) =>
        call.name === "syson_element_insert_sysml"
      );
      assertEquals(
        insertions.length,
        1,
        "only the Phase A PartDefinition was written",
      );
      assertEquals(
        insertions.some((call) =>
          String(call.arguments?.sysml_text).startsWith("part wing")
        ),
        false,
        "Phase C must not insert a usage under either homonymous parent",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
