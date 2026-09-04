/**
 * Tests for the generic `model.write-requirements@1` executor.
 *
 * Test coverage:
 *   - F3 (selectRequirementsTip): absent / one / retired / ambiguous / enrichment-tip
 *   - assertRequirementsArtifactNotRemoved: pass / throw
 *   - Refusal: non-agent origin.
 *   - Refusal: no exact human-approved MRTR decision (work item has no decisionIds).
 *   - Decision fingerprint: service-owned standard fingerprint.
 *   - Happy path — initial mode: valid snapshot, validateThreadSnapshot implicit.
 *   - WAL idempotence: second call returns already-completed project.
 *   - Cliquet: requirements artifact silently removed from basis.
 *   - D5 ambiguity after insert: quarantine path.
 *   - Enrichment conflict: same metric, different threshold → refusal.
 *   - Enrichment disappeared: prior metric absent from proposal → cliquet refusal.
 *   - Enrichment happy path: delete + reinsert, all metrics verified.
 *
 * Every test that publishes a snapshot calls validateThreadSnapshot implicitly
 * through the executor (step 23 of the sequence).
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectCompletionEvidenceValidator,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  REQUIREMENTS_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../shared/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { FileRequirementsAttemptStore } from "./file-requirements-attempt-store.ts";
import { FileSysonModelSeedAttemptStore } from "../seed/file-syson-model-seed-attempt-store.ts";
import { FileArchitectureAttemptStore } from "../renderer/file-architecture-attempt-store.ts";
import { RenderedArchitectureSysmlAnalyzer } from "../renderer/rendered-architecture-sysml-analyzer.ts";
import { SysmlSourceAnalysisCaptureService } from "../renderer/sysml-source-analysis-capture.ts";
import { FileThreadSnapshotStore } from "../../shared/stores/file-thread-snapshot-store.ts";
import { ApprovedBriefBaselineRunExecutor } from "../../project/approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../../testing/approved-brief-source-analysis-fixture.ts";
import { SysonModelSeedRunExecutor } from "../seed/syson-model-seed-run-executor.ts";
import {
  passthroughCapabilityRuntimeConnection,
  recordingCapabilityRuntimeSession,
  successfulCapabilityRuntimeFor,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import {
  ARCHITECTURE_FEATURE_TYPING_AQL,
} from "../renderer/architecture-structure-extractor.ts";
import {
  findArchitectureArtifact,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  ModelWriteArchitectureRunExecutor,
} from "../renderer/model-write-architecture-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../project/engineering-project-initial-baseline-evidence-validator.ts";
import {
  assertRequirementsArtifactNotRemoved,
  computePriorRequirementsArchiveCascade,
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  ModelWriteRequirementsRunExecutor,
  RequirementsArtifactRemovedError,
  resolveRequirementsPartDefinitionTarget,
  selectRequirementsTip,
} from "./model-write-requirements-run-executor.ts";
import {
  fingerprintRequirementsEnvelope,
  parseRequirementsProposalParameters,
  requirementEntriesToOracleRequirements,
} from "../../../domain/architecture/requirements/requirements-proposal.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import { registerProjectControlTools } from "../../../tools/project-control.ts";

type DeepMutable<T> = T extends readonly (infer Item)[] ? DeepMutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
  : T;

type MutableThreadSnapshot = DeepMutable<ThreadSnapshot>;

/** Build an explicitly mutable corruption fixture without weakening production DTOs. */
function mutableClone<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT = { kind: "agent" as const, actorId: "mcp:paired-chat@1" };
const HUMAN = {
  kind: "human" as const,
  actorId: "mcp-elicitation:paired-chat@1",
};
const PROJECT_ID = "project:drone-reqs-test";

// Architecture proposal (drone with Wing component — used by InitialArchSyson).
const DRONE_ARCH_PARAMS = [
  { key: "architecture.package", label: "Package name", value: "DroneV4" },
  { key: "system.name", label: "System name", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing name", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  { key: "component.wing.parent", label: "Wing parent", value: "DroneSystem" },
];

// Initial requirements proposal: single maxMass constraint.
const WING_REQS_PARAMS_INITIAL = [
  {
    key: "requirements.containerComponent",
    label: "Container",
    value: "Wing",
  },
  {
    key: "requirement.max-mass.name",
    label: "Name",
    value: "Max mass",
  },
  {
    key: "requirement.max-mass.metric",
    label: "Metric",
    value: "maxMass",
  },
  {
    key: "requirement.max-mass.operator",
    label: "Operator",
    value: "<=",
  },
  {
    key: "requirement.max-mass.threshold",
    label: "Threshold",
    value: 5,
    unit: "kg",
  },
];

const ROOT_REQS_PARAMS_INITIAL = WING_REQS_PARAMS_INITIAL.map((parameter) =>
  parameter.key === "requirements.containerComponent"
    ? { ...parameter, value: "DroneSystem" }
    : parameter
);

const UNKNOWN_TARGET_REQS_PARAMS = WING_REQS_PARAMS_INITIAL.map((parameter) =>
  parameter.key === "requirements.containerComponent"
    ? { ...parameter, value: "Tail" }
    : parameter
);

// Enrichment proposal: adds maxForce (new) alongside adopted maxMass.
const WING_REQS_PARAMS_ENRICHMENT = [
  ...WING_REQS_PARAMS_INITIAL,
  {
    key: "requirement.max-force.name",
    label: "Name",
    value: "Max force",
  },
  {
    key: "requirement.max-force.metric",
    label: "Metric",
    value: "maxForce",
  },
  {
    key: "requirement.max-force.operator",
    label: "Operator",
    value: "<=",
  },
  {
    key: "requirement.max-force.threshold",
    label: "Threshold",
    value: 100,
    unit: "Pa",
  },
];

// Conflict proposal: same metric "maxMass" but different threshold (8 vs 5).
const WING_REQS_PARAMS_CONFLICT = [
  {
    key: "requirements.containerComponent",
    label: "Container",
    value: "Wing",
  },
  {
    key: "requirement.max-mass.name",
    label: "Name",
    value: "Max mass",
  },
  {
    key: "requirement.max-mass.metric",
    label: "Metric",
    value: "maxMass",
  },
  {
    key: "requirement.max-mass.operator",
    label: "Operator",
    value: "<=",
  },
  {
    key: "requirement.max-mass.threshold",
    label: "Threshold",
    value: 8,
    unit: "kg",
  },
];

// Disappeared proposal: omits maxMass (cliquet violation against prior capture).
const WING_REQS_PARAMS_DISAPPEARED = [
  {
    key: "requirements.containerComponent",
    label: "Container",
    value: "Wing",
  },
  {
    key: "requirement.max-force.name",
    label: "Name",
    value: "Max force",
  },
  {
    key: "requirement.max-force.metric",
    label: "Metric",
    value: "maxForce",
  },
  {
    key: "requirement.max-force.operator",
    label: "Operator",
    value: "<=",
  },
  {
    key: "requirement.max-force.threshold",
    label: "Threshold",
    value: 100,
    unit: "Pa",
  },
];

// ── SysON mocks ───────────────────────────────────────────────────────────────

/**
 * Minimal SysON mock for the seed operation only.
 * Matches the real seed tool response shapes from SysON 0.5.1.
 */
class SeedSyson implements McpToolClient {
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult not implemented by SeedSyson (${call.name})`),
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
 * SysON mock for the architecture executor — initial DroneV4 package write.
 *
 * Call sequence:
 *  1. children(root-pkg-drone) → empty (preflight)
 *  2. insert_sysml(root-pkg-drone) → { inserted: true }
 *  3. children(root-pkg-drone) → DroneV4 package (post-insert)
 *  4. children(arch-pkg-001) → DroneSystem + Wing
 *  5. children(sys-def-001) → wing usage
 *  6. syson_query_aql(wing-usage-001) → Wing FeatureTyping
 *  7. children(wing-def-001) → empty
 *  8-12. Verification re-extraction (same responses as 3–7)
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

      // Wing def or any unrecognised: empty children.
      return Promise.resolve({
        text: "no-usages",
        structuredContent: { parentId: elementId, children: [], count: 0 },
      });
    }

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
      new Error(
        `Unexpected tool call in InitialArchSyson: ${call.name}`,
      ),
    );
  }
}

/**
 * SysON mock for the initial requirements write.
 *
 * Call sequence:
 *  1. insert_sysml(wing-def-001, native WingRequirements RequirementUsage)
 *  2. children(wing-def-001) → WingRequirements [D5 identity]
 *  3. element_get + children(wing-reqs-elem-001) → native shape
 *  4. query_aql(wing-reqs-subject-001) → exact Wing FeatureTyping
 *  5. constraint_extract(wing-reqs-elem-001) → maxMass predicate
 */
class InitialReqsSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #inserted = false;

  constructor(
    readonly targetId = "wing-def-001",
    readonly targetLabel = "Wing",
    readonly requirementName = "WingRequirements",
  ) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_insert_sysml") {
      this.#inserted = true;
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }

    if (call.name === "syson_element_children") {
      const elementId = call.arguments?.element_id;
      if (elementId === "wing-reqs-elem-001") {
        return Promise.resolve({
          text: "native-requirement-members",
          structuredContent: {
            parentId: elementId,
            children: [
              {
                id: "wing-reqs-subject-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
                label: "target",
              },
              {
                id: "wing-reqs-attribute-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
                label: "maxMass",
              },
              {
                id: "wing-reqs-constraint-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
                label: "max_mass_limit",
              },
            ],
            count: 3,
          },
        });
      }
      if (!this.#inserted) {
        return Promise.resolve({
          text: "empty",
          structuredContent: { parentId: elementId, children: [], count: 0 },
        });
      }
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: elementId,
          children: [{
            id: "wing-reqs-elem-001",
            kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
            label: this.requirementName,
          }],
          count: 1,
        },
      });
    }

    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "requirement",
        structuredContent: {
          id: "wing-reqs-elem-001",
          kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
          label: this.requirementName,
        },
      });
    }

    if (call.name === "syson_query_aql") {
      return Promise.resolve({
        text: "subject typing",
        structuredContent: {
          objectId: "wing-reqs-subject-001",
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
          type: "objects",
          results: [{
            id: this.targetId,
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: this.targetLabel,
          }],
          count: 1,
        },
      });
    }

    if (call.name === "syson_constraint_extract") {
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: [{
            id: "wing-reqs-constraint-001",
            name: "max_mass_limit",
            sourceId: "wing-reqs-constraint-001",
            expression: {
              kind: "binary",
              op: "<=",
              left: { kind: "ref", featurePath: ["maxMass"] },
              right: { kind: "literal", value: 5, unit: "kg" },
            },
          }],
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected tool in InitialReqsSyson: ${call.name}`),
    );
  }
}

/** Same semantic predicate, but the specialized extractor names a foreign child. */
class ForeignExtractedConstraintIdentitySyson extends InitialReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_constraint_extract") {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "foreign constraint identity",
        structuredContent: {
          constraints: [{
            id: "foreign-constraint-001",
            name: "max_mass_limit",
            sourceId: "foreign-constraint-001",
            expression: {
              kind: "binary",
              op: "<=",
              left: { kind: "ref", featurePath: ["maxMass"] },
              right: { kind: "literal", value: 5, unit: "kg" },
            },
          }],
        },
      });
    }
    return super.callTool(call);
  }
}

/** Provider acknowledges text but reads it back as the old detached PartDefinition. */
class DetachedPartDefReadbackSyson extends InitialReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_element_get") {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "detached helper",
        structuredContent: {
          id: "wing-reqs-elem-001",
          kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
          label: "WingRequirements",
        },
      });
    }
    return super.callTool(call);
  }
}

/**
 * SysON mock for the enrichment requirements write (delete + reinsert).
 *
 * Call sequence:
 *  1. syson_element_children(wing-def-001) → prior element [pre-WAL lookup]
 *  2. syson_element_delete(wing-reqs-elem-001) → ok
 *  3. insert_sysml(wing-def-001, native RequirementUsage with both) → ok
 *  4. children(wing-def-001) → new element [D5 identify]
 *  5. native shape + subject FeatureTyping readback
 *  6. constraint_extract(wing-reqs-elem-002) → maxForce + maxMass
 */
class EnrichmentReqsSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #childrenCallCount = 0;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_children") {
      const elementId = call.arguments?.element_id;
      if (elementId === "wing-reqs-elem-001") {
        return Promise.resolve({
          text: "prior-native-requirement-members",
          structuredContent: {
            parentId: elementId,
            children: [
              {
                id: "wing-reqs-subject-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
                label: "target",
              },
              {
                id: "wing-reqs-attribute-mass-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
                label: "maxMass",
              },
              {
                id: "wing-reqs-constraint-001",
                kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
                label: "max_mass_limit",
              },
            ],
            count: 3,
          },
        });
      }
      if (elementId === "wing-reqs-elem-002") {
        return Promise.resolve({
          text: "native-requirement-members",
          structuredContent: {
            parentId: elementId,
            children: [
              {
                id: "wing-reqs-subject-002",
                kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
                label: "target",
              },
              {
                id: "wing-reqs-attribute-force-002",
                kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
                label: "maxForce",
              },
              {
                id: "wing-reqs-attribute-mass-002",
                kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
                label: "maxMass",
              },
              {
                id: "wing-reqs-constraint-force-002",
                kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
                label: "max_force_limit",
              },
              {
                id: "wing-reqs-constraint-mass-002",
                kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
                label: "max_mass_limit",
              },
            ],
            count: 5,
          },
        });
      }
      this.#childrenCallCount++;
      // Pre-WAL lookup (call 1) returns the PRIOR element to be deleted.
      // D5 identify (call 2, after insert) returns the NEW element.
      const id = this.#childrenCallCount === 1
        ? "wing-reqs-elem-001"
        : "wing-reqs-elem-002";
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: [{
            id,
            kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
            label: "WingRequirements",
          }],
          count: 1,
        },
      });
    }

    if (call.name === "syson_element_get") {
      const elementId = call.arguments?.element_id;
      return Promise.resolve({
        text: "requirement",
        structuredContent: {
          id: elementId,
          kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
          label: "WingRequirements",
        },
      });
    }

    if (call.name === "syson_query_aql") {
      const objectId = call.arguments?.object_id;
      return Promise.resolve({
        text: "subject typing",
        structuredContent: {
          objectId,
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
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

    if (call.name === "syson_element_delete") {
      return Promise.resolve({ text: "deleted", structuredContent: {} });
    }

    if (call.name === "syson_element_insert_sysml") {
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }

    if (call.name === "syson_constraint_extract") {
      if (call.arguments?.element_id === "wing-reqs-elem-001") {
        return Promise.resolve({
          text: "prior constraints",
          structuredContent: {
            constraints: [{
              id: "wing-reqs-constraint-001",
              name: "max_mass_limit",
              sourceId: "wing-reqs-constraint-001",
              expression: {
                kind: "binary",
                op: "<=",
                left: { kind: "ref", featurePath: ["maxMass"] },
                right: { kind: "literal", value: 5, unit: "kg" },
              },
            }],
          },
        });
      }
      // Must return BOTH metrics (maxForce sorted before maxMass alphabetically).
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: [
            {
              id: "wing-reqs-constraint-force-002",
              name: "max_force_limit",
              sourceId: "wing-reqs-constraint-force-002",
              expression: {
                kind: "binary",
                op: "<=",
                left: { kind: "ref", featurePath: ["maxForce"] },
                right: { kind: "literal", value: 100, unit: "Pa" },
              },
            },
            {
              id: "wing-reqs-constraint-mass-002",
              name: "max_mass_limit",
              sourceId: "wing-reqs-constraint-mass-002",
              expression: {
                kind: "binary",
                op: "<=",
                left: { kind: "ref", featurePath: ["maxMass"] },
                right: { kind: "literal", value: 5, unit: "kg" },
              },
            },
          ],
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected tool in EnrichmentReqsSyson: ${call.name}`),
    );
  }
}

/**
 * SysON mock that returns TWO elements with the same label after insert.
 * Exercises the D5 ambiguity quarantine path in #identifyByLabelOrFail.
 */
class AmbiguousD5ReqsSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #inserted = false;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_insert_sysml") {
      this.#inserted = true;
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }

    if (call.name === "syson_element_children") {
      if (!this.#inserted) {
        return Promise.resolve({
          text: "empty",
          structuredContent: {
            parentId: call.arguments?.element_id,
            children: [],
            count: 0,
          },
        });
      }
      // Two elements with the same "WingRequirements" label → D5 ambiguous.
      return Promise.resolve({
        text: "ambiguous",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: [
            {
              id: "wing-reqs-elem-a",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: "WingRequirements",
            },
            {
              id: "wing-reqs-elem-b",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: "WingRequirements",
            },
          ],
          count: 2,
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected tool in AmbiguousD5ReqsSyson: ${call.name}`),
    );
  }
}

/**
 * SysON mock for the enrichment foreign-identity test.
 *
 * The pre-WAL children call returns an element whose id is DIFFERENT from
 * "wing-reqs-elem-001" (the id stored in the prior capture).  This exercises
 * the BLOQUANT identity guard added to the enrichment path.
 */
class ForeignElementEnrichmentSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_children") {
      // Returns a FOREIGN element id — does NOT match "wing-reqs-elem-001".
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: [{
            id: "wing-reqs-elem-FOREIGN",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "WingRequirements",
          }],
          count: 1,
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected tool in ForeignElementEnrichmentSyson: ${call.name}`),
    );
  }
}

/**
 * SysON mock for the RÉSERVE 2 delete-fails test.
 *
 * Pre-WAL children call returns the correct element id (matches prior capture).
 * The delete call throws an EngineeringProjectCommandError so the run fails
 * before providerAcknowledged is set — WAL stays "dispatched".
 */
class DeleteFailsEnrichmentSyson extends EnrichmentReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_element_delete") {
      this.calls.push(structuredClone(call));
      return Promise.reject(
        new EngineeringProjectCommandError(
          "invalid_input",
          "syson_element_delete: element not found in editing context.",
        ),
      );
    }
    return super.callTool(call);
  }
}

/**
 * SysON mock for the RÉSERVE 2 delete-success-then-insert-fail test.
 *
 * Delete succeeds; insert throws.  The WAL entry was written as "dispatched"
 * before the delete, so a retry on a re-queued run will see the dispatched
 * entry and raise RequirementsWriteOutcomeUnknownError.
 */
class DeleteSuccessInsertFailEnrichmentSyson extends EnrichmentReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_element_delete") {
      this.calls.push(structuredClone(call));
      return Promise.resolve({ text: "deleted", structuredContent: {} });
    }

    if (call.name === "syson_element_insert_sysml") {
      this.calls.push(structuredClone(call));
      return Promise.reject(
        new EngineeringProjectCommandError(
          "invalid_input",
          "syson_element_insert_sysml: editing context is no longer available.",
        ),
      );
    }
    return super.callTool(call);
  }
}

class StaleThresholdEnrichmentSyson extends EnrichmentReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (
      call.name === "syson_constraint_extract" &&
      call.arguments?.element_id === "wing-reqs-elem-001"
    ) {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "divergent prior constraint",
        structuredContent: {
          constraints: [{
            id: "wing-reqs-constraint-001",
            name: "max_mass_limit",
            sourceId: "wing-reqs-constraint-001",
            expression: {
              kind: "binary",
              op: "<=",
              left: { kind: "ref", featurePath: ["maxMass"] },
              right: { kind: "literal", value: 6, unit: "kg" },
            },
          }],
        },
      });
    }
    return super.callTool(call);
  }
}

/**
 * The live RequirementUsage keeps its captured identity and semantics, while
 * both provider readbacks consistently replace its captured ConstraintUsage
 * UUID. This must fail against the V3 predecessor before WAL or deletion.
 */
class ReplacedPriorConstraintIdentityEnrichmentSyson extends EnrichmentReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (
      call.name === "syson_element_children" &&
      call.arguments?.element_id === "wing-reqs-elem-001"
    ) {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "prior members with replaced constraint identity",
        structuredContent: {
          parentId: "wing-reqs-elem-001",
          children: [
            {
              id: "wing-reqs-subject-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
              label: "target",
            },
            {
              id: "wing-reqs-attribute-mass-001",
              kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
              label: "maxMass",
            },
            {
              id: "wing-reqs-constraint-mass-REPLACED",
              kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
              label: "max_mass_limit",
            },
          ],
          count: 3,
        },
      });
    }
    if (
      call.name === "syson_constraint_extract" &&
      call.arguments?.element_id === "wing-reqs-elem-001"
    ) {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "prior constraint with replaced identity",
        structuredContent: {
          constraints: [{
            id: "wing-reqs-constraint-mass-REPLACED",
            name: "max_mass_limit",
            sourceId: "wing-reqs-constraint-mass-REPLACED",
            expression: {
              kind: "binary",
              op: "<=",
              left: { kind: "ref", featurePath: ["maxMass"] },
              right: { kind: "literal", value: 5, unit: "kg" },
            },
          }],
        },
      });
    }
    return super.callTool(call);
  }
}

class ExistingHomonymInitialSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`Unexpected text call ${call.name}`));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_children") {
      return Promise.resolve({
        text: "existing homonym",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: [{
            id: "untraced-wing-requirements",
            kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
            label: "WingRequirements",
          }],
          count: 1,
        },
      });
    }
    return Promise.reject(new Error(`Unexpected provider mutation ${call.name}`));
  }
}

class WrongPreflightEchoSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`Unexpected text call ${call.name}`));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return Promise.resolve({
      text: "wrong echo",
      structuredContent: { parentId: "wrong-parent", children: [], count: 0 },
    });
  }
}

class WrongPostAckEchoSyson extends InitialReqsSyson {
  #targetChildrenCalls = 0;

  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (
      call.name === "syson_element_children" &&
      call.arguments?.element_id === "wing-def-001"
    ) {
      this.calls.push(structuredClone(call));
      this.#targetChildrenCalls++;
      if (this.#targetChildrenCalls === 1) {
        return Promise.resolve({
          text: "empty",
          structuredContent: {
            parentId: "wing-def-001",
            children: [],
            count: 0,
          },
        });
      }
      return Promise.resolve({
        text: "wrong post-ack echo",
        structuredContent: {
          parentId: "wrong-parent",
          children: [],
          count: 0,
        },
      });
    }
    return super.callTool(call);
  }
}

class WrongAqlEchoSyson extends InitialReqsSyson {
  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_query_aql") {
      this.calls.push(structuredClone(call));
      return Promise.resolve({
        text: "wrong AQL echo",
        structuredContent: {
          objectId: "foreign-subject",
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
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
    return super.callTool(call);
  }
}

// ── Helper: ctx ───────────────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

// ── Master fixture ────────────────────────────────────────────────────────────

interface ReqsFixture {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: FileThreadSnapshotStore;
  readonly seedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly archCaptures: FileCaptureStore<"architecture-capture">;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisCaptureService;
  readonly reqsCaptures: FileCaptureStore<"requirements-capture">;
  readonly reqsAttempts: FileRequirementsAttemptStore;
  readonly queued: { readonly revision: number; readonly runId: string };
  readonly parallel?: { readonly revision: number; readonly runId: string };
}

class RequirementsMcpApp {
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assertExists(handler, `Expected MCP tool ${name} to be registered.`);
    return handler;
  }
}

/**
 * Builds a fully initialised fixture with:
 *   1. A project that completed baseline + seed + architecture runs.
 *   2. An architecture artifact in the thread snapshot (from InitialArchSyson).
 *   3. A queued requirements run proposed through the real MCP tool without
 *      any caller-provided fingerprint, then human-approved.
 */
async function queuedRequirementsFixture(
  directory: string,
  proposalParams: readonly EngineeringDecisionProposalParameter[] =
    WING_REQS_PARAMS_INITIAL,
  includeParallelSibling = false,
): Promise<ReqsFixture> {
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
  const reqsCaptures = new FileCaptureStore({
    ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/reqs-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(
    `${directory}/seed-attempts`,
  );
  const archAttempts = new FileArchitectureAttemptStore(
    `${directory}/arch-attempts`,
  );
  const reqsAttempts = new FileRequirementsAttemptStore(
    `${directory}/reqs-attempts`,
  );

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T12:00:00.000Z") + ++tick * 1_000)
      .toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-drone",
    projectId: PROJECT_ID,
    projectName: "DroneV4 requirements test",
    issuedAt: "2026-08-08T11:59:00.000Z",
    intent: "Requirements executor integration test.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief", project.revision),
    items: [
      {
        id: "objective",
        kind: "objective",
        statement: "Test the generic requirements executor.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement: "Insert Wing requirements into SysON.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      },
      {
        id: "success",
        kind: "success-criterion",
        statement: "Requirements capture readable and snapshot validates.",
        sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
        dependsOnItemIds: [],
      },
    ],
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

  // Baseline run.
  project = await commands.publishPlan(AGENT, {
    ...ctx("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{ id: "baseline", name: "Baseline", description: "Record baseline." }],
    workItems: [{
      id: "wi:baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
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

  // Seed run.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-seed", afterBaseline.revision),
    baseSnapshot: r1,
    phases: [{ id: "model", name: "Model", description: "Create SysON." }],
    workItems: [{
      id: "wi:seed",
      phaseId: "model",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:baseline"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
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

  // Architecture run.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-arch", afterSeed.revision),
    baseSnapshot: r2,
    phases: [{ id: "arch", name: "Architecture", description: "Author arch." }],
    workItems: [{
      id: "wi:architecture",
      phaseId: "arch",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:seed"],
      decisionIds: ["decision:arch-params"],
      operation: {
        ...MODEL_WRITE_ARCHITECTURE_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "decision:arch-params",
      phaseId: "arch",
      title: "Architecture component declaration",
      question: "Which components?",
    }],
  });
  project = await commands.proposeDecision(AGENT, {
    ...ctx("propose-arch-decision", project.revision),
    decisionId: "decision:arch-params",
    baseSnapshot: r2,
    proposal: { summary: "DroneV4 arch", parameters: DRONE_ARCH_PARAMS },
  });
  const archApproval = project.approvals.find((a) =>
    a.decisionId === "decision:arch-params"
  )!;
  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-arch-decision", project.revision),
    decisionId: "decision:arch-params",
    rationale: "Approved.",
    inputFingerprint: archApproval.inputFingerprint!,
  });
  project = await commands.queueRun(AGENT, {
    ...ctx("queue-arch", project.revision),
    runId: "run:architecture",
    workItemId: "wi:architecture",
    summary: "Author DroneV4 architecture.",
    basis: { kind: "thread-snapshot", ...r2 },
  });
  const sysmlSourceAnalysis = new SysmlSourceAnalysisCaptureService({
    sourceCaptures: new FileCaptureStore({
      ...SYSML_SOURCE_CAPTURE_DESCRIPTOR,
      directory: `${directory}/sysml-source-captures`,
    }),
    analysisCaptures: new FileCaptureStore({
      ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
      directory: `${directory}/source-analysis-captures`,
    }),
    frontend: new RenderedArchitectureSysmlAnalyzer(),
  });
  const afterArch = await new ModelWriteArchitectureRunExecutor({
    projects,
    commands,
    snapshots,
    seedCaptures,
    captures: archCaptures,
    sysmlSourceAnalysis,
    attempts: archAttempts,
    syson: new InitialArchSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/arch-leases`),
    ...successfulCapabilityRuntimeFor(
      PROJECT_ID,
      MODEL_WRITE_ARCHITECTURE_OPERATION,
      "model.author-system",
    ),
    now: () => "2026-08-08T12:15:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-arch",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T12:15:00.000Z",
    runId: "run:architecture",
  });

  // Get the architecture result snapshot.
  const archRun = afterArch.agentRuns.find((r) => r.id === "run:architecture")!;
  assertExists(archRun.resultSnapshot, "Architecture run must have a result snapshot");
  const archResultSnapshot = await snapshots.get(
    archRun.resultSnapshot.snapshotId,
  );
  assertExists(archResultSnapshot, "Architecture result snapshot must be readable");

  const archArtifact = findArchitectureArtifact(archResultSnapshot);
  assertExists(archArtifact, "Architecture artifact must exist in result snapshot");

  // Queue requirements run.
  // archBasisRef is used for baseSnapshot (EngineeringThreadSnapshotRef — no kind).
  // archBasis wraps it for queueRun.basis (EngineeringBasisRef — requires kind).
  const archBasisRef = {
    snapshotId: archResultSnapshot.id,
    revision: archResultSnapshot.revision,
    subjectId: archResultSnapshot.subject.id,
  };
  const archBasis = { kind: "thread-snapshot" as const, ...archBasisRef };

  project = await commands.appendChange(AGENT, {
    ...ctx("append-reqs", afterArch.revision),
    baseSnapshot: archBasisRef,
    phases: [{ id: "reqs", name: "Requirements", description: "Author requirements." }],
    workItems: [
      {
        id: "wi:requirements",
        phaseId: "reqs",
        owner: "agent",
        dependsOnWorkItemIds: ["wi:architecture"],
        decisionIds: ["decision:reqs-params"],
        operation: {
          ...MODEL_WRITE_REQUIREMENTS_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      },
      ...(includeParallelSibling
        ? [{
          id: "wi:requirements-parallel",
          phaseId: "reqs",
          owner: "agent" as const,
          dependsOnWorkItemIds: ["wi:architecture"],
          decisionIds: ["decision:reqs-parallel"],
          operation: {
            ...MODEL_WRITE_REQUIREMENTS_OPERATION,
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" as const },
            }],
          },
        }]
        : []),
    ],
    requiredDecisions: [
      {
        id: "decision:reqs-params",
        phaseId: "reqs",
        title: "Requirements declaration",
        question: "Which requirements are proposed for Wing?",
      },
      ...(includeParallelSibling
        ? [{
          id: "decision:reqs-parallel",
          phaseId: "reqs",
          title: "Parallel requirements declaration",
          question: "Which requirements are proposed for Wing?",
        }]
        : []),
    ],
  });
  // WHY THE REGISTERED HANDLER AND NOT commands.proposeDecision DIRECTLY — the
  // defect this fixture exists to prevent was invisible precisely because tests
  // called the service directly with a fingerprint no tool can produce, so the
  // operation was unexecutable through MCP while the suite stayed green. The
  // proposal therefore crosses the real tool boundary. Approval, queue and
  // execution are then driven directly: they are covered by their own cases,
  // and this fixture claims only the boundary that failed.
  const mcp = new RequirementsMcpApp();
  registerProjectControlTools(mcp as unknown as McpApp, { projects, commands });
  await mcp.handler("project_decision_propose")({
    ...ctx("propose-reqs-decision", project.revision),
    decisionId: "decision:reqs-params",
    proposal: { summary: "Wing requirements", parameters: proposalParams },
  }, {
    toolName: "project_decision_propose",
    clientInfo: { name: "paired-chat", version: "1" },
  });
  project = (await projects.get(PROJECT_ID))!;
  if (includeParallelSibling) {
    await mcp.handler("project_decision_propose")({
      ...ctx("propose-reqs-parallel", project.revision),
      decisionId: "decision:reqs-parallel",
      proposal: { summary: "Parallel Wing requirements", parameters: proposalParams },
    }, {
      toolName: "project_decision_propose",
      clientInfo: { name: "paired-chat", version: "1" },
    });
    project = (await projects.get(PROJECT_ID))!;
  }
  const reqsApproval = project.approvals.find((a) =>
    a.decisionId === "decision:reqs-params"
  )!;
  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-reqs-decision", project.revision),
    decisionId: "decision:reqs-params",
    rationale: "Approved Wing requirements.",
    inputFingerprint: reqsApproval.inputFingerprint!,
  });
  if (includeParallelSibling) {
    const parallelApproval = project.approvals.find((approval) =>
      approval.decisionId === "decision:reqs-parallel"
    )!;
    project = await commands.approveDecision(HUMAN, {
      ...ctx("approve-reqs-parallel", project.revision),
      decisionId: "decision:reqs-parallel",
      rationale: "Approved parallel Wing requirements.",
      inputFingerprint: parallelApproval.inputFingerprint!,
    });
  }
  let queued = await commands.queueRun(AGENT, {
    ...ctx("queue-reqs", project.revision),
    runId: "run:requirements",
    workItemId: "wi:requirements",
    summary: "Author Wing requirements.",
    basis: archBasis,
  });
  let parallel: ReqsFixture["parallel"];
  if (includeParallelSibling) {
    queued = await commands.queueRun(AGENT, {
      ...ctx("queue-reqs-parallel", queued.revision),
      runId: "run:requirements-parallel",
      workItemId: "wi:requirements-parallel",
      summary: "Author parallel Wing requirements.",
      basis: archBasis,
    });
    parallel = { revision: queued.revision, runId: "run:requirements-parallel" };
  }

  return {
    projects,
    commands,
    snapshots,
    seedCaptures,
    archCaptures,
    sysmlSourceAnalysis,
    reqsCaptures,
    reqsAttempts,
    queued: { revision: queued.revision, runId: "run:requirements" },
    parallel,
  };
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeExecutor(
  fixture: ReqsFixture,
  options: {
    syson: McpToolClient;
    directory: string;
    nowStr?: string;
    leaseSubdir?: string;
    attempts?: FileRequirementsAttemptStore;
    capabilityRuntimeSession?: ReturnType<
      typeof recordingCapabilityRuntimeSession
    >;
  },
): ModelWriteRequirementsRunExecutor {
  const capability = successfulCapabilityRuntimeFor(
    PROJECT_ID,
    MODEL_WRITE_REQUIREMENTS_OPERATION,
    "model.author-system",
  );
  return new ModelWriteRequirementsRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    seedCaptures: fixture.seedCaptures,
    architectureCaptures: fixture.archCaptures,
    sysmlSourceAnalysis: fixture.sysmlSourceAnalysis,
    captures: fixture.reqsCaptures,
    attempts: options.attempts ?? fixture.reqsAttempts,
    syson: options.syson,
    lease: new FileEngineeringProjectRunLease(
      `${options.directory}/${options.leaseSubdir ?? "reqs-leases"}`,
    ),
    capabilityRuntime: capability.capabilityRuntime,
    capabilityRuntimeSession: options.capabilityRuntimeSession ??
      capability.capabilityRuntimeSession,
    now: () => options.nowStr ?? "2026-08-08T12:20:00.000Z",
  });
}

function executionCommand(fixture: Pick<ReqsFixture, "queued">): {
  commandId: string;
  projectId: string;
  expectedRevision: number;
  issuedAt: string;
  runId: string;
} {
  return {
    commandId: "agent-author-requirements",
    projectId: PROJECT_ID,
    expectedRevision: fixture.queued.revision,
    issuedAt: "2026-08-08T12:20:00.000Z",
    runId: fixture.queued.runId,
  };
}

/**
 * Execute the initial requirements run in a fixture, completing it so that the
 * project state machine allows subsequent appendChange calls.
 *
 * Returns the resulting EngineeringProjectSnapshot.
 */
function executeInitialRequirementsRun(
  fixture: ReqsFixture,
  directory: string,
): Promise<EngineeringProjectSnapshot> {
  return makeExecutor(fixture, {
    syson: new InitialReqsSyson(),
    directory,
  }).execute(AGENT, executionCommand(fixture));
}

/**
 * Run the initial requirements executor and queue an enrichment run.
 * Returns the new {revision, runId} for the enrichment run.
 */
async function queueEnrichmentRun(
  fixture: ReqsFixture,
  initialResult: EngineeringProjectSnapshot,
  enrichmentParams = WING_REQS_PARAMS_ENRICHMENT,
): Promise<{ readonly revision: number; readonly runId: string }> {
  const initialRun = initialResult.agentRuns.find((r) => r.id === "run:requirements")!;
  assertExists(initialRun.resultSnapshot, "Initial requirements run must have result");
  const resultSnap = await fixture.snapshots.get(
    initialRun.resultSnapshot.snapshotId,
  );
  assertExists(resultSnap);

  const archArtifact = findArchitectureArtifact(resultSnap);
  assertExists(archArtifact);

  // enrichmentBasisRef: EngineeringThreadSnapshotRef (no kind) for baseSnapshot.
  // enrichmentBasis: EngineeringBasisRef (with kind) for queueRun.basis.
  const enrichmentBasisRef = {
    snapshotId: resultSnap.id,
    revision: resultSnap.revision,
    subjectId: resultSnap.subject.id,
  };
  const enrichmentBasis = { kind: "thread-snapshot" as const, ...enrichmentBasisRef };

  let project = await fixture.commands.appendChange(AGENT, {
    ...ctx("append-reqs-enrichment", initialResult.revision),
    baseSnapshot: enrichmentBasisRef,
    phases: [{
      id: "reqs-enrichment",
      name: "Requirements enrichment",
      description: "Add a new metric to Wing requirements.",
    }],
    workItems: [{
      id: "wi:requirements-enrichment",
      phaseId: "reqs-enrichment",
      owner: "agent",
      dependsOnWorkItemIds: ["wi:requirements"],
      decisionIds: ["decision:reqs-enrichment"],
      operation: {
        ...MODEL_WRITE_REQUIREMENTS_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "decision:reqs-enrichment",
      phaseId: "reqs-enrichment",
      title: "Requirements enrichment declaration",
      question: "Which new metric is added to Wing requirements?",
    }],
  });
  project = await fixture.commands.proposeDecision(AGENT, {
    ...ctx("propose-reqs-enrichment", project.revision),
    decisionId: "decision:reqs-enrichment",
    baseSnapshot: enrichmentBasisRef,
    proposal: {
      summary: "Wing requirements enrichment",
      parameters: enrichmentParams,
    },
  });
  const enrichmentApproval = project.approvals.find((a) =>
    a.decisionId === "decision:reqs-enrichment"
  )!;
  project = await fixture.commands.approveDecision(HUMAN, {
    ...ctx("approve-reqs-enrichment", project.revision),
    decisionId: "decision:reqs-enrichment",
    rationale: "Approved enrichment.",
    inputFingerprint: enrichmentApproval.inputFingerprint!,
  });
  const queued = await fixture.commands.queueRun(AGENT, {
    ...ctx("queue-reqs-enrichment", project.revision),
    runId: "run:requirements-enrichment",
    workItemId: "wi:requirements-enrichment",
    summary: "Add maxForce to Wing requirements.",
    basis: enrichmentBasis,
  });
  return { revision: queued.revision, runId: "run:requirements-enrichment" };
}

// ── F3: selectRequirementsTip unit tests ──────────────────────────────────────

/**
 * Stable model artifact included in every minimalSnapshot so that
 * subject.modelArtifactId passes the validateThreadSnapshot referential check.
 */
const MINIMAL_SNAPSHOT_MODEL_ARTIFACT: ThreadArtifact = {
  id: "model-artifact-test",
  name: "Test model",
  kind: "sysml-model",
  version: "1.0",
  fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
  producer: {
    serverId: "syson",
    tool: "syson_element_insert_sysml",
    runId: "run:seed",
  },
  inputArtifactIds: [],
  freshness: {
    status: "fresh",
    changedAt: "2026-08-08T00:00:00.000Z",
    invalidatedByChangeIds: [],
  },
};

/**
 * Build a minimal ThreadSnapshot for selectRequirementsTip and
 * assertRequirementsArtifactNotRemoved unit tests.
 *
 * Always includes MINIMAL_SNAPSHOT_MODEL_ARTIFACT so that the snapshot
 * satisfies the validateThreadSnapshot referential check on
 * subject.modelArtifactId, making it safe to save to a FileThreadSnapshotStore.
 */
function minimalSnapshot(
  id: string,
  artifacts: ThreadArtifact[],
  archivedIds: string[] = [],
): ThreadSnapshot {
  const changes = archivedIds.map((artifactId) => ({
    id: `archive-${artifactId}`,
    kind: "archived" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: "Archived for test.",
  }));

  return {
    schemaVersion: "1.0",
    id,
    revision: 1,
    generatedAt: "2026-08-08T00:00:00.000Z",
    subject: {
      id: "subject:test",
      name: "Test subject",
      kind: "system" as const,
      version: "1.0",
      modelArtifactId: "model-artifact-test",
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-08T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "cs:test",
      name: "Test changeset",
      status: "applied",
      createdAt: "2026-08-08T00:00:00.000Z",
      appliedAt: "2026-08-08T00:00:00.000Z",
      changes,
    },
    // Always include the model artifact so subject.modelArtifactId resolves.
    artifacts: [MINIMAL_SNAPSHOT_MODEL_ARTIFACT, ...artifacts],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

function makeReqsArtifact(
  id: string,
  component: string,
  digest: string,
  inputArtifactIds: string[] = [],
): ThreadArtifact {
  return {
    id,
    name: `Requirements: ${component}`,
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://requirements-capture/${component}/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:test",
    },
    inputArtifactIds,
    freshness: {
      status: "fresh",
      changedAt: "2026-08-08T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

Deno.test(
  "requirements supersession archives the prior requirement, evaluation, and violation cascade",
  () => {
    const prior = makeReqsArtifact(
      `requirements-Wing-${FAKE_DIGEST_A}`,
      "Wing",
      FAKE_DIGEST_A,
    );
    const freshness = {
      status: "fresh" as const,
      changedAt: "2026-08-08T00:00:00.000Z",
      invalidatedByChangeIds: [],
    };
    const base: ThreadSnapshot = {
      ...minimalSnapshot("snapshot:cascade", [prior]),
      requirements: [{
        id: "requirement:old",
        name: "Old mass limit",
        statement: "maxMass <= 5 kg",
        version: FAKE_DIGEST_A,
        criterion: {
          metric: "maxMass",
          operator: "<=",
          limit: { value: 5, unit: "kg" },
        },
        trace: {
          sourceArtifactId: prior.id,
          elementId: "wing-reqs-elem-001",
          targetArtifactIds: [MINIMAL_SNAPSHOT_MODEL_ARTIFACT.id],
        },
        freshness,
      }],
      evaluations: [{
        id: "evaluation:old",
        name: "Old evaluation",
        requirementId: "requirement:old",
        observationIds: [],
        status: "fail",
        evaluatedAt: "2026-08-08T00:00:00.000Z",
        evaluator: {
          serverId: "casys",
          tool: "evaluate",
          runId: "run:evaluate",
        },
        evidenceArtifactIds: [],
        message: "Failed.",
        freshness,
      }],
      violations: [{
        id: "violation:old",
        name: "Old violation",
        requirementId: "requirement:old",
        evaluationId: "evaluation:old",
        severity: "error",
        status: "open",
        detectedAt: "2026-08-08T00:00:00.000Z",
        observationIds: [],
        evidenceArtifactIds: [],
        summary: "Old failure.",
        freshness,
      }],
    };

    assertEquals(computePriorRequirementsArchiveCascade(base, prior), [
      { kind: "evaluation", id: "evaluation:old" },
      { kind: "requirement", id: "requirement:old" },
      { kind: "violation", id: "violation:old" },
    ]);
  },
);

const FAKE_DIGEST_A = "a".repeat(64);
const FAKE_DIGEST_B = "b".repeat(64);
const FAKE_DIGEST_C = "c".repeat(64);

Deno.test(
  "selectRequirementsTip returns absent when no requirements artifact exists",
  () => {
    const snapshot = minimalSnapshot("snap:1", []);
    const result = selectRequirementsTip(snapshot, "Wing");
    assertEquals(result.kind, "absent");
  },
);

Deno.test(
  "selectRequirementsTip returns absent for a DIFFERENT containerComponent",
  () => {
    const artifact = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
    const snapshot = minimalSnapshot("snap:1", [artifact]);
    const result = selectRequirementsTip(snapshot, "Motor");
    assertEquals(result.kind, "absent");
  },
);

Deno.test(
  "selectRequirementsTip returns one for a single unconsumed active artifact",
  () => {
    const artifact = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
    const snapshot = minimalSnapshot("snap:1", [artifact]);
    const result = selectRequirementsTip(snapshot, "Wing");
    assertEquals(result.kind, "one");
    if (result.kind === "one") assertEquals(result.artifact.id, "reqs-Wing-a");
  },
);

Deno.test(
  "selectRequirementsTip returns retired when the only tip is archived",
  () => {
    const artifact = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
    // Artifact A is archived via the changeSet.
    const snapshot = minimalSnapshot("snap:1", [artifact], ["reqs-Wing-a"]);
    const result = selectRequirementsTip(snapshot, "Wing");
    assertEquals(result.kind, "retired");
  },
);

Deno.test(
  "selectRequirementsTip returns one for the enrichment tip (predecessor consumed)",
  () => {
    // A → B means B consumes A. consumed = {"reqs-Wing-a"}. tips = [B].
    const artifactA = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
    const artifactB = makeReqsArtifact(
      "reqs-Wing-b",
      "Wing",
      FAKE_DIGEST_B,
      ["reqs-Wing-a"], // B inputs A → A is consumed
    );
    const snapshot = minimalSnapshot("snap:1", [artifactA, artifactB]);
    const result = selectRequirementsTip(snapshot, "Wing");
    assertEquals(result.kind, "one");
    if (result.kind === "one") assertEquals(result.artifact.id, "reqs-Wing-b");
  },
);

Deno.test(
  "selectRequirementsTip returns ambiguous when two active unconsumed tips exist",
  () => {
    const artifactA = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
    const artifactB = makeReqsArtifact("reqs-Wing-b", "Wing", FAKE_DIGEST_B);
    const snapshot = minimalSnapshot("snap:1", [artifactA, artifactB]);
    const result = selectRequirementsTip(snapshot, "Wing");
    assertEquals(result.kind, "ambiguous");
  },
);

Deno.test(
  "selectRequirementsTip returns ambiguous when all artifacts are in consumed set",
  () => {
    // A consumed by B; B consumed by C; C consumed by A (cycle, all consumed).
    const artifactA = makeReqsArtifact(
      "reqs-Wing-a",
      "Wing",
      FAKE_DIGEST_A,
      ["reqs-Wing-c"],
    );
    const artifactB = makeReqsArtifact(
      "reqs-Wing-b",
      "Wing",
      FAKE_DIGEST_B,
      ["reqs-Wing-a"],
    );
    const artifactC = makeReqsArtifact(
      "reqs-Wing-c",
      "Wing",
      FAKE_DIGEST_C,
      ["reqs-Wing-b"],
    );
    const snapshot = minimalSnapshot("snap:1", [artifactA, artifactB, artifactC]);
    const result = selectRequirementsTip(snapshot, "Wing");
    assertEquals(result.kind, "ambiguous");
  },
);

Deno.test(
  "requirements target identity is stable for a reused PartDefinition",
  () => {
    const target = resolveRequirementsPartDefinitionTarget(
      [
        {
          id: "system-def",
          label: "System",
          usages: [
            { label: "portWing", targetLabel: "Wing" },
            { label: "starboardWing", targetLabel: "Wing" },
          ],
        },
        { id: "wing-def", label: "Wing" },
      ],
      "Wing",
    );
    // Two usages type wing-def; occurrence count cannot change this explicit
    // type-level identity.
    assertEquals(target, {
      kind: "part-definition",
      label: "Wing",
      elementId: "wing-def",
    });
  },
);

// ── assertRequirementsArtifactNotRemoved unit tests ───────────────────────────

Deno.test(
  "assertRequirementsArtifactNotRemoved passes when no ancestor has requirements",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-cliquet-pass-",
    });
    try {
      const store = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const snapshot = minimalSnapshot("snap:no-reqs", []);
      await store.save(snapshot);
      // No ancestor carries requirements — passes silently.
      await assertRequirementsArtifactNotRemoved(snapshot, "Wing", store);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "assertRequirementsArtifactNotRemoved passes when the basis itself carries the artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-cliquet-has-",
    });
    try {
      const store = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const artifact = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
      const snapshot = minimalSnapshot("snap:has-reqs", [artifact]);
      await store.save(snapshot);
      // Basis itself has the artifact → check passes immediately.
      await assertRequirementsArtifactNotRemoved(snapshot, "Wing", store);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "assertRequirementsArtifactNotRemoved throws RequirementsArtifactRemovedError when ancestor had requirements but basis does not",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-cliquet-throw-",
    });
    try {
      const store = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const artifact = makeReqsArtifact("reqs-Wing-a", "Wing", FAKE_DIGEST_A);
      // Use the default subject (modelArtifactId: "model-artifact-test") so the
      // snapshot passes the validateThreadSnapshot referential check.
      const ancestorSnap: ThreadSnapshot = minimalSnapshot(
        "snap:ancestor",
        [artifact],
      );
      await store.save(ancestorSnap);

      // Basis references the ancestor but DOES NOT carry the requirements artifact.
      // revision must be strictly greater than ancestorSnap.revision so the snapshot
      // passes the $.previous.revision < $.revision invariant.
      const currentSnap: ThreadSnapshot = {
        ...minimalSnapshot("snap:current", []),
        revision: ancestorSnap.revision + 1,
        previous: {
          snapshotId: ancestorSnap.id,
          revision: ancestorSnap.revision,
        },
      };
      await store.save(currentSnap);

      await assertRejects(
        () => assertRequirementsArtifactNotRemoved(currentSnap, "Wing", store),
        RequirementsArtifactRemovedError,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Refusal — non-agent origin ────────────────────────────────────────────────

Deno.test(
  "model.write-requirements executor rejects non-agent origin",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-origin-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson: new InitialReqsSyson(),
            directory,
          }).execute(HUMAN, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "agent origin",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Refusal — no human-approved MRTR decision ─────────────────────────────────

Deno.test(
  "model.write-requirements executor refuses when no exact human-approved MRTR decision is bound",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-no-mrtr-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Execute the initial requirements run so the project's active run is cleared.
      // Without this the state machine rejects appendChange ("run active").
      const initialResult = await executeInitialRequirementsRun(fixture, directory);

      // Add a second requirements work item with NO decision bindings.
      // requireMrtrApproval iterates over decisionIds = [] → 0 candidates → throws.
      //
      // appendChange.baseSnapshot must equal the current project ThreadSnapshot head
      // (the requirements result snapshot after the initial run).
      // queueRun.basis can reference any valid snapshot in the store.
      const archRun = initialResult.agentRuns.find((r) => r.id === "run:architecture")!;
      const archBasis = archRun.basis!;
      if (archBasis.kind !== "thread-snapshot") throw new Error("unexpected");
      const reqsRun = initialResult.agentRuns.find((r) => r.id === "run:requirements")!;
      assertExists(reqsRun.resultSnapshot, "initial requirements run must have result");
      // baseSnapshot requires EngineeringThreadSnapshotRef (no kind field).
      const reqsBasisRef = {
        snapshotId: reqsRun.resultSnapshot.snapshotId,
        revision: reqsRun.resultSnapshot.revision,
        subjectId: archBasis.subjectId,
      };
      let project = await fixture.commands.appendChange(AGENT, {
        ...ctx(
          "append-reqs-no-decision",
          initialResult.revision,
        ),
        baseSnapshot: reqsBasisRef,
        phases: [{ id: "reqs-nd", name: "Requirements-ND", description: "Test." }],
        workItems: [{
          id: "wi:requirements-no-decision",
          phaseId: "reqs-nd",
          owner: "agent",
          dependsOnWorkItemIds: ["wi:architecture"],
          decisionIds: [], // No decisions — will trigger the refusal.
          operation: {
            ...MODEL_WRITE_REQUIREMENTS_OPERATION,
            bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
          },
        }],
        requiredDecisions: [],
      });
      project = await fixture.commands.queueRun(AGENT, {
        ...ctx("queue-reqs-nd", project.revision),
        runId: "run:requirements-no-decision",
        workItemId: "wi:requirements-no-decision",
        summary: "Test no-MRTR refusal.",
        basis: archBasis,
      });
      const noMrtrCmd = {
        commandId: "agent-no-mrtr",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-08T12:20:00.000Z",
        runId: "run:requirements-no-decision",
      };
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson: new InitialReqsSyson(),
            directory,
            leaseSubdir: "no-mrtr-leases",
          }).execute(AGENT, noMrtrCmd),
        EngineeringProjectCommandError,
        "human-approved",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements fails closed on an ambiguous tip before WAL or SysON",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-tip-ambiguous-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const project = await fixture.projects.get(PROJECT_ID);
      const run = project?.agentRuns.find((candidate) =>
        candidate.id === "run:requirements"
      );
      assertExists(run?.basis);
      if (run.basis.kind !== "thread-snapshot") {
        throw new Error("Expected a thread-snapshot basis.");
      }
      const basis = await fixture.snapshots.get(run.basis.snapshotId);
      assertExists(basis);
      const ambiguousBasis: ThreadSnapshot = {
        ...structuredClone(basis),
        artifacts: [
          ...basis.artifacts,
          makeReqsArtifact("reqs-Wing-fork-a", "Wing", FAKE_DIGEST_A),
          makeReqsArtifact("reqs-Wing-fork-b", "Wing", FAKE_DIGEST_B),
        ],
      };
      const ambiguousSnapshots = {
        get(id: string) {
          return id === ambiguousBasis.id
            ? Promise.resolve(structuredClone(ambiguousBasis))
            : fixture.snapshots.get(id);
        },
        latest(subjectId: string) {
          return fixture.snapshots.latest(subjectId);
        },
        save(snapshot: ThreadSnapshot) {
          return fixture.snapshots.save(snapshot);
        },
      } as unknown as FileThreadSnapshotStore;
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/ambiguous-tip-attempts`,
      );
      const syson = new InitialReqsSyson();

      await assertRejects(
        () =>
          makeExecutor(
            { ...fixture, snapshots: ambiguousSnapshots },
            { syson, directory, attempts, leaseSubdir: "ambiguous-tip-leases" },
          ).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "Ambiguous requirements tip",
      );
      assertEquals(syson.calls, []);
      assertEquals(
        await attempts.readRun(PROJECT_ID, "run:requirements"),
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Signed-input envelope derivation ─────────────────────────────────────────

Deno.test(
  "model.write-requirements refuses a target absent from the architecture selected by the signed basis",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-target-divergence-",
    });
    try {
      const fixture = await queuedRequirementsFixture(
        directory,
        UNKNOWN_TARGET_REQS_PARAMS,
      );
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson: new InitialReqsSyson(),
            directory,
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "requirements_envelope_derivation_mismatch",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Service-owned decision fingerprint ───────────────────────────────────────

Deno.test(
  "model.write-requirements rejects persisted MRTR summary or parameter mutation before lifecycle or provider effects",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-mrtr-seal-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const before = await fixture.projects.get(PROJECT_ID);
      assertExists(before);
      const mutations: ReadonlyArray<[
        string,
        (decision: Record<string, unknown>) => void,
      ]> = [
        ["summary", (decision) => {
          const proposal = decision.proposal as Record<string, unknown>;
          proposal.summary = "Persisted requirements summary changed after approval";
        }],
        ["parameters", (decision) => {
          const proposal = decision.proposal as Record<string, unknown>;
          const parameters = proposal.parameters as Array<Record<string, unknown>>;
          parameters[0]!.value = "Persisted parameter changed after approval";
        }],
      ];

      for (const [name, mutate] of mutations) {
        const projects = {
          async get(projectId: string) {
            const project = await fixture.projects.get(projectId);
            if (!project) return undefined;
            const altered = structuredClone(project);
            const decision = altered.decisions.find((candidate) =>
              candidate.id === "decision:reqs-params"
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
        const syson = new InitialReqsSyson();
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, projects }, {
              syson,
              directory,
              leaseSubdir: `mrtr-seal-${name}`,
            }).execute(AGENT, executionCommand(fixture)),
          EngineeringProjectCommandError,
          "requirements_decision_fingerprint_mismatch",
        );
        assertEquals(syson.calls, [], name);
        assertEquals(
          await fixture.reqsAttempts.readRun(PROJECT_ID, fixture.queued.runId),
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
  "model.write-requirements rejects a same-id revision snapshot from another subject before WAL or provider access",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-cross-subject-basis-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const project = await fixture.projects.get(PROJECT_ID);
      const run = project?.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.basis);
      if (run.basis.kind !== "thread-snapshot") {
        throw new Error("Unexpected basis.");
      }
      const basis = run.basis;
      const snapshots = {
        async get(id: string) {
          const snapshot = await fixture.snapshots.get(id);
          if (!snapshot || id !== basis.snapshotId) return snapshot;
          const transplanted = mutableClone(snapshot);
          transplanted.subject.id = "subject:foreign-requirements";
          return transplanted;
        },
        latest(subjectId: string) {
          return fixture.snapshots.latest(subjectId);
        },
        save(snapshot: ThreadSnapshot) {
          return fixture.snapshots.save(snapshot);
        },
      } as unknown as FileThreadSnapshotStore;
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/cross-subject-attempts`,
      );
      const syson = new InitialReqsSyson();
      await assertRejects(
        () =>
          makeExecutor({ ...fixture, snapshots }, {
            syson,
            directory,
            attempts,
            leaseSubdir: "cross-subject-leases",
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "exact identity",
      );
      assertEquals(syson.calls, []);
      assertEquals(
        await attempts.readRun(PROJECT_ID, fixture.queued.runId),
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "decision service ignores an untrusted fingerprint-shaped extra and keeps its canonical fingerprint",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-fp-mismatch-",
    });
    try {
      // Build the fixture with CONFLICT proposal params — same grammar, but
      // the threshold value differs (0.8 vs 0.5 kg). The D1 envelope fingerprint
      // was computed at proposal time using maxMass = 0.5 kg (from INITIAL params).
      // The executor will re-compute from maxMass = 0.5 kg (same params in INITIAL
      // fixture), so we need a different tactic: build the fixture normally but then
      // modify the proposal parameters inside the project to produce a mismatch.
      //
      // Simplest approach: build with the INITIAL params (fingerprint matches 0.5 kg),
      // then run the executor with modified params that hash differently — the executor
      // parses the stored parameters, so the D1 divergence comes from building the
      // fixture with the wrong parameters.
      //
      // We build the fixture with CONFLICT params (threshold 0.8 kg) — this computes
      // a fingerprint that covers maxMass=0.8. But the executor re-reads the stored
      // parameters and re-computes the envelope from them. Since the stored parameters
      // have 0.8 and the target comes from the live arch capture (wing-def-001 / wing),
      // the fingerprint WILL match — this is not the right path.
      //
      // Correct approach: build fixture normally (params → fingerprint F1). Then
      // manually change the project snapshot in the store so that the stored decision's
      // inputFingerprint is a DIFFERENT fingerprint. The executor will re-compute F1
      // from the stored params and check against the tampered fingerprint → mismatch.
      //
      // We use a SEPARATE fixture for this: the fixture is built with INITIAL params
      // whose fingerprint is correct, but we produce a deliberately wrong fingerprint
      // by using CONFLICT params for the proposal but INITIAL params for the fingerprint.
      // Actually, the simplest approach is to build the fixture with a fingerprint that
      // does NOT match what the executor will re-compute.
      //
      // IMPLEMENTATION: Build the fixture where the decision's inputFingerprint was
      // computed using a DIFFERENT set of requirements than what the proposal parameters
      // contain. We can achieve this by using a "bait-and-switch": the fixture builds
      // with a FAKE fingerprint instead of the real envelope fingerprint.

      // Build baseline + seed + architecture in one shot from the helper fixture.
      // The helper has a valid INITIAL-params decision (fingerprint matches 0.5 kg).
      // We then append a TAMPERED decision: parameters are INITIAL (0.5 kg) but the
      // stored inputFingerprint was computed for CONFLICT params (0.8 kg). At execution
      // time the executor re-computes the envelope from the stored parameters (0.5 kg),
      // compares against the stored fingerprint (0.8 kg), and must refuse.
      const helperFixture = await queuedRequirementsFixture(
        `${directory}/helper`,
      );

      // Execute the initial requirements run so the project's active run is cleared
      // before we try to appendChange for the tampered scenario.
      const helperInitialResult = await executeInitialRequirementsRun(
        helperFixture,
        `${directory}/helper`,
      );

      // Re-use the helper fixture's arch result to get arch info.
      const helperArchRun = helperInitialResult.agentRuns.find((r) =>
        r.id === "run:architecture"
      )!;
      assertExists(helperArchRun.resultSnapshot);
      const helperArchSnap = await helperFixture.snapshots.get(
        helperArchRun.resultSnapshot.snapshotId,
      );
      assertExists(helperArchSnap);
      const helperArchArtifact = findArchitectureArtifact(helperArchSnap);
      assertExists(helperArchArtifact);

      // Compute a WRONG fingerprint (using 0.8 kg instead of 0.5 kg).
      const wrongProposal = parseRequirementsProposalParameters(
        WING_REQS_PARAMS_CONFLICT,
      );
      const wrongOracle = requirementEntriesToOracleRequirements(
        wrongProposal.requirements,
      );
      const wrongFp = await fingerprintRequirementsEnvelope({
        target: {
          kind: "part-definition",
          label: "Wing",
          elementId: "wing-def-001",
        },
        architectureBasis: {
          snapshotId: helperArchSnap.id,
          revision: helperArchSnap.revision,
          fingerprint: helperArchArtifact.fingerprint.digest,
        },
        partDefName: "WingRequirements",
        requirements: wrongOracle,
      });

      // Now build the decision in the HELPER fixture with the WRONG fingerprint,
      // but use the INITIAL params (so the executor re-computes a DIFFERENT fingerprint).
      //
      // archBasisRef / archBasis: used for queueRun.basis and for the wrongFp computation.
      //   Both must agree on the same snapshotId so the executor's envelope re-computation
      //   uses the same architectureBasis and the mismatch is caused by the requirement
      //   value, not by a snapshotId divergence.
      // helperReqsBasisRef: the current project ThreadSnapshot head after the initial run.
      //   appendChange and proposeDecision must use the current head, not the older arch snap.
      const archBasisRef = {
        snapshotId: helperArchSnap.id,
        revision: helperArchSnap.revision,
        subjectId: helperArchSnap.subject.id,
      };
      const archBasis = { kind: "thread-snapshot" as const, ...archBasisRef };
      const helperReqsRun = helperInitialResult.agentRuns.find((r) =>
        r.id === "run:requirements"
      )!;
      assertExists(
        helperReqsRun.resultSnapshot,
        "helper initial requirements run must have result",
      );
      const helperReqsBasisRef = {
        snapshotId: helperReqsRun.resultSnapshot.snapshotId,
        revision: helperReqsRun.resultSnapshot.revision,
        subjectId: helperArchSnap.subject.id,
      };

      let project = await helperFixture.commands.appendChange(AGENT, {
        ...ctx("append-reqs-tampered", helperInitialResult.revision),
        baseSnapshot: helperReqsBasisRef,
        phases: [{
          id: "reqs-tampered",
          name: "Tampered requirements",
          description: "Test D1.",
        }],
        workItems: [{
          id: "wi:requirements-tampered",
          phaseId: "reqs-tampered",
          owner: "agent",
          dependsOnWorkItemIds: ["wi:architecture"],
          decisionIds: ["decision:reqs-tampered"],
          operation: {
            ...MODEL_WRITE_REQUIREMENTS_OPERATION,
            bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
          },
        }],
        requiredDecisions: [{
          id: "decision:reqs-tampered",
          phaseId: "reqs-tampered",
          title: "Tampered decision",
          question: "D1 test",
        }],
      });
      // Simulate an old/untyped caller still sending the removed override. The
      // command service must ignore the extra property and seal its canonical input.
      project = await helperFixture.commands.proposeDecision(AGENT, {
        ...ctx("propose-tampered", project.revision),
        decisionId: "decision:reqs-tampered",
        baseSnapshot: archBasisRef,
        ...({ inputFingerprint: wrongFp } as Record<string, unknown>),
        proposal: {
          summary: "Tampered",
          parameters: WING_REQS_PARAMS_INITIAL, // executor re-computes from these
        },
      });
      const tamperedApproval = project.approvals.find((a) =>
        a.decisionId === "decision:reqs-tampered"
      )!;
      project = await helperFixture.commands.approveDecision(HUMAN, {
        ...ctx("approve-tampered", project.revision),
        decisionId: "decision:reqs-tampered",
        rationale: "Approved.",
        inputFingerprint: tamperedApproval.inputFingerprint!,
      });
      const queuedTampered = await helperFixture.commands.queueRun(AGENT, {
        ...ctx("queue-tampered", project.revision),
        runId: "run:requirements-tampered",
        workItemId: "wi:requirements-tampered",
        summary: "Test D1 divergence.",
        basis: archBasis,
      });

      const tamperedFixture = {
        ...helperFixture,
        reqsCaptures: new FileCaptureStore({
          ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
          directory: `${directory}/helper/reqs-captures`,
        }),
        reqsAttempts: new FileRequirementsAttemptStore(
          `${directory}/helper/reqs-attempts`,
        ),
        queued: {
          revision: queuedTampered.revision,
          runId: "run:requirements-tampered",
        },
      };

      assertEquals(
        tamperedApproval.inputFingerprint?.digest === wrongFp.digest,
        false,
      );
      assertEquals(
        tamperedFixture.queued.revision,
        queuedTampered.revision,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Happy path — initial mode ─────────────────────────────────────────────────

Deno.test(
  "model.write-requirements executor publishes a valid snapshot in initial mode",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-initial-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const syson = new InitialReqsSyson();
      const result = await makeExecutor(fixture, { syson, directory }).execute(
        AGENT,
        executionCommand(fixture),
      );

      // Run must be completed.
      const run = result.agentRuns.find((r) => r.id === "run:requirements");
      assertExists(run, "requirements run must exist");
      assertEquals(run.status, "completed");

      // A result snapshot must be recorded.
      assertExists(run.resultSnapshot);
      const snap = await fixture.snapshots.get(run.resultSnapshot.snapshotId);
      assertExists(snap, "requirements snapshot must be stored");

      // The requirements artifact must be present and correctly URI-prefixed.
      const reqsArtifact = snap.artifacts.find((a) =>
        a.kind === "sysml-model" &&
        a.uri?.startsWith("casys://requirements-capture/Wing/")
      );
      assertExists(reqsArtifact, "requirements artifact must be in the snapshot");
      assertEquals(
        reqsArtifact.uri?.startsWith("casys://requirements-capture/Wing/sha256/"),
        true,
      );

      // The capture must be readable and contain the correct schema.
      const captureText = await fixture.reqsCaptures.read(reqsArtifact.fingerprint);
      assertExists(captureText, "requirements capture must be readable");
      const capture = JSON.parse(captureText) as Record<string, unknown>;
      assertEquals(capture.schemaVersion, "requirements-capture/3.0");
      assertEquals(capture.containerComponent, "Wing");
      assertEquals(capture.partDefName, "WingRequirements");
      assertEquals(capture.target, {
        kind: "part-definition",
        label: "Wing",
        elementId: "wing-def-001",
      });
      assertEquals(capture.requirementUsage, {
        id: "wing-reqs-elem-001",
        kind: "RequirementUsage",
      });
      assertEquals(capture.constraintUsages, [{
        requirementId: "maxMass",
        id: "wing-reqs-constraint-001",
        kind: "ConstraintUsage",
        sourceId: "wing-reqs-constraint-001",
      }]);

      // The canonical Thread carries one real TracedRequirement, whose source
      // is the requirements artifact and whose target is the architecture
      // artifact containing the exact PartDefinition identity.
      assertEquals(snap.requirements.length, 1);
      const traced = snap.requirements[0]!;
      assertEquals(traced.criterion.metric, "maxMass");
      assertEquals(traced.trace.sourceArtifactId, reqsArtifact.id);
      assertEquals(traced.trace.elementId, "wing-reqs-elem-001");
      const architectureArtifact = findArchitectureArtifact(snap);
      assertExists(architectureArtifact);
      assertEquals(traced.trace.targetArtifactIds, [architectureArtifact.id]);
      assertEquals(
        snap.provenance.some((link) =>
          link.relation === "traces_to" &&
          link.from.kind === "requirement" && link.from.id === traced.id &&
          link.to.kind === "artifact" && link.to.id === architectureArtifact.id
        ),
        true,
      );

      // The SysON mock must have been called with insert.
      const insertCalls = syson.calls.filter(
        (c) => c.name === "syson_element_insert_sysml",
      );
      assertEquals(insertCalls.length, 1);
      assertEquals(insertCalls[0]!.arguments?.parent_id, "wing-def-001");
      const sysmlText = String(insertCalls[0]!.arguments?.sysml_text);
      assertEquals(sysmlText.startsWith("requirement WingRequirements {"), true);
      assertEquals(sysmlText.includes("subject target : Wing;"), true);
      assertEquals(sysmlText.includes("require constraint maxMass_limit"), true);

      // Provider readback proves RequirementUsage + subject typing + required
      // constraint before the capture or ThreadSnapshot is published.
      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_element_get" &&
          call.arguments?.element_id === "wing-reqs-elem-001"
        ),
        true,
      );
      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_element_children" &&
          call.arguments?.element_id === "wing-reqs-elem-001"
        ),
        true,
      );
      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_query_aql" &&
          call.arguments?.object_id === "wing-reqs-subject-001" &&
          call.arguments?.expression === ARCHITECTURE_FEATURE_TYPING_AQL
        ),
        true,
      );
      const completedAttempt = await fixture.reqsAttempts.readRun(
        PROJECT_ID,
        fixture.queued.runId,
      );
      assertEquals(completedAttempt?.schemaVersion, "requirements-write-attempt/1.1");
      assertEquals(completedAttempt?.status, "completed");
      assertEquals(
        completedAttempt?.result?.requirementsElementId,
        "wing-reqs-elem-001",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements targets a root PartDefinition with no inbound usage",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-root-target-" });
    try {
      const fixture = await queuedRequirementsFixture(
        directory,
        ROOT_REQS_PARAMS_INITIAL,
      );
      const syson = new InitialReqsSyson(
        "sys-def-001",
        "DroneSystem",
        "DroneSystemRequirements",
      );
      const result = await makeExecutor(fixture, { syson, directory }).execute(
        AGENT,
        executionCommand(fixture),
      );
      const run = result.agentRuns.find((candidate) =>
        candidate.id === "run:requirements"
      );
      assertEquals(run?.status, "completed");
      const insert = syson.calls.find((call) =>
        call.name === "syson_element_insert_sysml"
      );
      assertExists(insert);
      assertEquals(insert.arguments?.parent_id, "sys-def-001");
      assertEquals(
        String(insert.arguments?.sysml_text).includes(
          "subject target : DroneSystem;",
        ),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── WAL idempotence ───────────────────────────────────────────────────────────

Deno.test(
  "model.write-requirements executor is idempotent when the run is already completed",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-idempotent-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const syson = new InitialReqsSyson();
      const cmd = executionCommand(fixture);

      // First execution.
      const first = await makeExecutor(fixture, { syson, directory }).execute(
        AGENT,
        cmd,
      );
      assertEquals(
        first.agentRuns.find((r) => r.id === "run:requirements")?.status,
        "completed",
      );

      // Second execution with the same command — must return the already-completed project.
      const second = await makeExecutor(fixture, { syson, directory }).execute(
        AGENT,
        { ...cmd, expectedRevision: first.revision },
      );
      assertEquals(
        second.agentRuns.find((r) => r.id === "run:requirements")?.status,
        "completed",
      );

      // SysON insert should have been called exactly once across both executions.
      const insertCalls = syson.calls.filter(
        (c) => c.name === "syson_element_insert_sysml",
      );
      assertEquals(
        insertCalls.length,
        1,
        "SysON insert must be called exactly once across idempotent re-executions",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Cliquet: requirements artifact silently removed ──────────────────────────

Deno.test(
  "model.write-requirements executor raises cliquet when requirements artifact was silently removed from basis",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-cliquet-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Execute the initial run to produce a snapshot with a requirements artifact.
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      const firstRun = first.agentRuns.find((r) => r.id === "run:requirements")!;
      assertExists(firstRun.resultSnapshot);
      const firstSnap = await fixture.snapshots.get(
        firstRun.resultSnapshot.snapshotId,
      );
      assertExists(firstSnap);

      // Build a "stripped" snapshot that OMITS the requirements artifact.
      // This simulates a rogue write that removed the artifact from the thread.
      // We also strip changeSet.changes and provenance entries that reference the
      // removed artifact so that validateThreadSnapshot accepts the snapshot — the
      // invariant the test exercises is that the executor itself notices the artifact
      // is absent in the ancestors chain, NOT the snapshot validator.
      const removedArtifactIds = new Set(
        firstSnap.artifacts
          .filter((a) => a.uri?.startsWith("casys://requirements-capture/Wing/"))
          .map((a) => a.id),
      );
      const removedRequirementIds = new Set(
        firstSnap.requirements
          .filter((requirement) =>
            removedArtifactIds.has(requirement.trace.sourceArtifactId)
          )
          .map((requirement) => requirement.id),
      );
      const strippedSnap: ThreadSnapshot = {
        ...firstSnap,
        id: "snap:stripped",
        revision: firstSnap.revision + 1,
        previous: {
          snapshotId: firstSnap.id,
          revision: firstSnap.revision,
        },
        artifacts: firstSnap.artifacts.filter(
          (a) => !removedArtifactIds.has(a.id),
        ),
        requirements: firstSnap.requirements.filter(
          (requirement) => !removedRequirementIds.has(requirement.id),
        ),
        changeSet: {
          ...firstSnap.changeSet,
          changes: firstSnap.changeSet.changes.filter(
            (c) =>
              !(c.target.kind === "artifact" && removedArtifactIds.has(c.target.id)) &&
              !(c.target.kind === "requirement" &&
                removedRequirementIds.has(c.target.id)),
          ),
        },
        provenance: firstSnap.provenance.filter(
          (p) =>
            !(p.from.kind === "artifact" && removedArtifactIds.has(p.from.id)) &&
            !(p.to.kind === "artifact" && removedArtifactIds.has(p.to.id)) &&
            !(p.from.kind === "requirement" &&
              removedRequirementIds.has(p.from.id)) &&
            !(p.to.kind === "requirement" && removedRequirementIds.has(p.to.id)),
        ),
      };
      await fixture.snapshots.save(strippedSnap);

      // Queue a second requirements run on the stripped basis — must raise cliquet.
      //
      // strippedBasisRef / strippedBasis: used for queueRun.basis, fp2 computation, and
      //   as the project ThreadSnapshot head after the dummy run completes.  The executor
      //   reads strippedSnap and traverses its ancestors to detect the missing artifact.
      // firstBasisRef: the project's actual ThreadSnapshot head after the initial run.
      //   Used only for the dummy run that registers strippedSnap as a declared snapshot.
      const strippedBasisRef = {
        snapshotId: strippedSnap.id,
        revision: strippedSnap.revision,
        subjectId: strippedSnap.subject.id,
      };
      const strippedBasis = { kind: "thread-snapshot" as const, ...strippedBasisRef };
      const firstBasisRef = {
        snapshotId: firstSnap.id,
        revision: firstSnap.revision,
        subjectId: firstSnap.subject.id,
      };
      const archArtifact = findArchitectureArtifact(strippedSnap);
      assertExists(archArtifact);

      // Register strippedSnap as a declared project ThreadSnapshot by completing a
      // dummy run with a permissive validator.  ExactThreadCompletionEvidenceValidator
      // would reject strippedSnap because every remaining entity is unchanged from
      // firstSnap — this is by design (the missing artifact is the test subject).
      // The invariant under test is the executor-level cliquet, not evidence validation.
      // A permissive validator is the minimal surgical substitution here.
      class PermissiveEvidenceValidator
        implements EngineeringProjectCompletionEvidenceValidator {
        async validate(): Promise<void> {}
      }
      let dummyTick = Date.parse("2026-08-08T13:00:00.000Z");
      const permissiveCommands = new EngineeringProjectCommandService(
        fixture.projects,
        new PermissiveEvidenceValidator(),
        () => new Date(dummyTick += 1_000).toISOString(),
        { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
      );
      // Four-step dummy lifecycle: appendChange + queueRun use fixture.commands (still on
      // the 12:xx clock); claimRun + publishRun likewise.  Only completeRun uses
      // permissiveCommands (jumps the clock to 13:xx).  After that, all commands that
      // write to the project MUST use permissiveCommands to avoid a clock-backward error.
      let projDummy = await fixture.commands.appendChange(AGENT, {
        ...ctx("append-reqs-dummy-stripped", first.revision),
        baseSnapshot: firstBasisRef,
        phases: [{
          id: "dummy-stripped",
          name: "Dummy stripped",
          description: "Dummy run to register strippedSnap as declared.",
        }],
        workItems: [{
          id: "wi:requirements-dummy-stripped",
          phaseId: "dummy-stripped",
          owner: "agent",
          dependsOnWorkItemIds: ["wi:requirements"],
          decisionIds: [],
          operation: {
            ...MODEL_WRITE_REQUIREMENTS_OPERATION,
            bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
          },
        }],
        requiredDecisions: [],
      });
      projDummy = await fixture.commands.queueRun(AGENT, {
        ...ctx("queue-dummy-stripped", projDummy.revision),
        runId: "run:requirements-dummy-stripped",
        workItemId: "wi:requirements-dummy-stripped",
        summary: "Dummy run to register stripped snapshot.",
        basis: { kind: "thread-snapshot" as const, ...firstBasisRef },
      });
      projDummy = await fixture.commands.claimRun(AGENT, {
        ...ctx("claim-dummy-stripped", projDummy.revision),
        runId: "run:requirements-dummy-stripped",
        summary: "Claim dummy stripped run.",
      });
      projDummy = await fixture.commands.publishRun(AGENT, {
        ...ctx("publish-dummy-stripped", projDummy.revision),
        runId: "run:requirements-dummy-stripped",
        summary: "Publish dummy stripped run.",
      });
      // completeRun via permissiveCommands: advances project clock to 13:xx and registers
      // strippedSnap in project.threadSnapshots so queueRun can declare it as a basis.
      const dummyCompleted = await permissiveCommands.completeRun(AGENT, {
        ...ctx("complete-dummy-stripped", projDummy.revision),
        runId: "run:requirements-dummy-stripped",
        summary: "Complete dummy stripped run.",
        resultSnapshot: strippedBasisRef,
        evidenceRefs: [{
          kind: "artifact",
          id: archArtifact.id,
          snapshotId: strippedSnap.id,
          snapshotRevision: strippedSnap.revision,
        }],
      });

      // All commands after completeRun (13:xx clock) must use permissiveCommands so the
      // monotonic-clock check passes.  The executor inherits permissiveCommands via
      // cliquetFixture.commands and uses it for its internal claimRun / failRun calls.
      let proj = await permissiveCommands.appendChange(AGENT, {
        ...ctx("append-reqs-cliquet", dummyCompleted.revision),
        baseSnapshot: strippedBasisRef,
        phases: [{ id: "reqs2", name: "Reqs2", description: "Second attempt." }],
        workItems: [{
          id: "wi:requirements-cliquet",
          phaseId: "reqs2",
          owner: "agent",
          dependsOnWorkItemIds: ["wi:requirements"],
          decisionIds: ["decision:reqs-cliquet"],
          operation: {
            ...MODEL_WRITE_REQUIREMENTS_OPERATION,
            bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
          },
        }],
        requiredDecisions: [{
          id: "decision:reqs-cliquet",
          phaseId: "reqs2",
          title: "Cliquet test",
          question: "Test",
        }],
      });
      proj = await permissiveCommands.proposeDecision(AGENT, {
        ...ctx("propose-cliquet", proj.revision),
        decisionId: "decision:reqs-cliquet",
        // proposeDecision.baseSnapshot must equal queueRun.basis so that
        // requireMrtrApproval can match the approval via sameSnapshotBasis.
        baseSnapshot: strippedBasisRef,
        proposal: {
          summary: "Wing requirements re-attempt",
          parameters: WING_REQS_PARAMS_INITIAL,
        },
      });
      const cliquetApproval = proj.approvals.find((a) =>
        a.decisionId === "decision:reqs-cliquet"
      )!;
      proj = await permissiveCommands.approveDecision(HUMAN, {
        ...ctx("approve-cliquet", proj.revision),
        decisionId: "decision:reqs-cliquet",
        rationale: "Approved.",
        inputFingerprint: cliquetApproval.inputFingerprint!,
      });
      const queuedCliquet = await permissiveCommands.queueRun(AGENT, {
        ...ctx("queue-cliquet", proj.revision),
        runId: "run:requirements-cliquet",
        workItemId: "wi:requirements-cliquet",
        summary: "Cliquet test run.",
        basis: strippedBasis,
      });

      const cliquetFixture = {
        ...fixture,
        // permissiveCommands keeps the 13:xx clock consistent for the executor's
        // internal claimRun and failRun calls after the clock jump from completeRun.
        commands: permissiveCommands,
        queued: {
          revision: queuedCliquet.revision,
          runId: "run:requirements-cliquet",
        },
      };

      // The executor rethrows RequirementsArtifactRemovedError (not wrapped in
      // EngineeringProjectCommandError): the cliquet fires before providerAcknowledged
      // is set, so the raw error propagates after recording the run failure.
      await assertRejects(
        () =>
          makeExecutor(cliquetFixture, {
            syson: new InitialReqsSyson(),
            directory,
            leaseSubdir: "cliquet-leases",
            attempts: new FileRequirementsAttemptStore(
              `${directory}/cliquet-attempts`,
            ),
          }).execute(AGENT, {
            ...executionCommand(cliquetFixture),
            // Use a distinct commandId — the initial run's receipts are keyed on
            // "agent-author-requirements:model-write-requirements:*"; reusing the same
            // prefix with a different runId would trigger command_id_conflict before
            // the cliquet check fires.
            commandId: "agent-author-requirements-cliquet",
          }),
        RequirementsArtifactRemovedError,
        "requirements_artifact_removed",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── D5 ambiguity after insertion ──────────────────────────────────────────────

Deno.test(
  "model.write-requirements executor quarantines when D5 identification is ambiguous after insertion",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-d5-ambig-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const syson = new AmbiguousD5ReqsSyson();

      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "ambiguous",
      );

      // The run must have been quarantined (acknowledged insert + D5 failure).
      const isQuarantined = await fixture.reqsAttempts.isQuarantined(
        PROJECT_ID,
        "run:requirements",
      );
      assertEquals(isQuarantined, true, "run must be quarantined after D5 ambiguity");

      // The project must record the quarantine failure code.
      const project = await fixture.projects.get(PROJECT_ID);
      const failedRun = project?.agentRuns.find(
        (r) => r.id === "run:requirements",
      );
      assertEquals(
        failedRun?.failure?.code,
        "model-write-requirements-post-acknowledgement-quarantined",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements quarantines a non-RequirementUsage provider readback",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-native-shape-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const syson = new DetachedPartDefReadbackSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "not the exact RequirementUsage",
      );
      assertEquals(
        await fixture.reqsAttempts.isQuarantined(PROJECT_ID, "run:requirements"),
        true,
      );
      const project = await fixture.projects.get(PROJECT_ID);
      const failedRun = project?.agentRuns.find((run) => run.id === "run:requirements");
      assertEquals(
        failedRun?.failure?.code,
        "model-write-requirements-post-acknowledgement-quarantined",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "post-insert constraint identities must bijectively match native children before WAL completion or publication",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-constraint-identity-readback-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const command = executionCommand(fixture);
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/identity-readback-attempts`,
      );
      const syson = new ForeignExtractedConstraintIdentitySyson();
      let captureWrites = 0;
      let snapshotWrites = 0;
      const captures = {
        read: fixture.reqsCaptures.read.bind(fixture.reqsCaptures),
        save(fingerprint: ThreadArtifact["fingerprint"], text: string) {
          captureWrites += 1;
          return fixture.reqsCaptures.save(fingerprint, text);
        },
      } as unknown as FileCaptureStore<"requirements-capture">;
      const snapshots = {
        get: fixture.snapshots.get.bind(fixture.snapshots),
        latest: fixture.snapshots.latest.bind(fixture.snapshots),
        save(snapshot: ThreadSnapshot) {
          snapshotWrites += 1;
          return fixture.snapshots.save(snapshot);
        },
      } as unknown as FileThreadSnapshotStore;

      await assertRejects(
        () =>
          makeExecutor({ ...fixture, reqsCaptures: captures, snapshots }, {
            syson,
            directory,
            attempts,
            leaseSubdir: "identity-readback-leases",
          }).execute(AGENT, command),
        EngineeringProjectCommandError,
        "are not bijective",
      );

      assertEquals(
        (await attempts.readRun(PROJECT_ID, fixture.queued.runId))?.status,
        "dispatched",
        "identity divergence must not complete the WAL",
      );
      assertEquals(
        await attempts.isQuarantined(PROJECT_ID, fixture.queued.runId),
        true,
      );
      assertEquals(
        syson.calls.some((call) => call.name === "syson_element_delete"),
        false,
      );
      assertEquals(captureWrites, 0, "no V3 capture may seal a foreign child identity");
      assertEquals(snapshotWrites, 0, "no Thread snapshot may publish the mismatch");
      const project = await fixture.projects.get(PROJECT_ID);
      const failedRun = project?.agentRuns.find((run) =>
        run.id === fixture.queued.runId
      );
      assertEquals(failedRun?.status, "failed");
      assertEquals(failedRun?.resultSnapshot, undefined);
      assertEquals(
        project?.commandReceipts?.some((receipt) =>
          receipt.commandId ===
            `${command.commandId}:model-write-requirements:publish` ||
          receipt.commandId ===
            `${command.commandId}:model-write-requirements:complete`
        ),
        false,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Enrichment mode ───────────────────────────────────────────────────────────

Deno.test(
  "model.write-requirements executor refuses enrichment when a metric threshold conflicts with prior capture",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-conflict-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Execute the initial run.
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      // Queue an enrichment run that proposes maxMass = 0.8 kg (conflicts with 0.5 kg).
      const enrichmentQueued = await queueEnrichmentRun(
        fixture,
        first,
        WING_REQS_PARAMS_CONFLICT,
      );
      const conflictFixture = {
        ...fixture,
        queued: enrichmentQueued,
      };
      const conflictCmd = {
        commandId: "agent-conflict",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };

      await assertRejects(
        () =>
          makeExecutor(conflictFixture, {
            syson: new EnrichmentReqsSyson(),
            directory,
            leaseSubdir: "conflict-leases",
            attempts: new FileRequirementsAttemptStore(
              `${directory}/conflict-attempts`,
            ),
          }).execute(AGENT, conflictCmd),
        EngineeringProjectCommandError,
        "conflict",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements refuses a requirements-capture/1.0 predecessor before enrichment",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-legacy-capture-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const queued = await queueEnrichmentRun(fixture, first);
      const legacyCaptures = {
        async read(fingerprint: ThreadArtifact["fingerprint"]) {
          const text = await fixture.reqsCaptures.read(fingerprint);
          if (!text) return undefined;
          const record = JSON.parse(text) as Record<string, unknown>;
          record.schemaVersion = "requirements-capture/1.0";
          record.target = { usageName: "wing", elementId: "wing-def-001" };
          return JSON.stringify(record);
        },
        save: fixture.reqsCaptures.save.bind(fixture.reqsCaptures),
      } as unknown as FileCaptureStore<"requirements-capture">;
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/legacy-capture-attempts`,
      );
      const syson = new EnrichmentReqsSyson();
      const legacyFixture: ReqsFixture = {
        ...fixture,
        reqsCaptures: legacyCaptures,
        queued,
      };

      await assertRejects(
        () =>
          makeExecutor(legacyFixture, {
            syson,
            directory,
            attempts,
            leaseSubdir: "legacy-capture-leases",
          }).execute(AGENT, {
            commandId: "agent-legacy-capture",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:25:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
        "not exact requirements-capture/3.0 evidence",
      );
      assertEquals(syson.calls, []);
      assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements refuses a requirements-capture/2.0 predecessor before enrichment",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-v2-non-authority-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await executeInitialRequirementsRun(fixture, directory);
      const queued = await queueEnrichmentRun(fixture, first);
      const command = {
        commandId: "agent-v2-non-authority",
        projectId: PROJECT_ID,
        expectedRevision: queued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: queued.runId,
      };
      let captureReads = 0;
      let captureWrites = 0;
      let snapshotWrites = 0;
      const v2Captures = {
        async read(fingerprint: ThreadArtifact["fingerprint"]) {
          const text = await fixture.reqsCaptures.read(fingerprint);
          if (!text) return undefined;
          const record = JSON.parse(text) as Record<string, unknown>;
          record.schemaVersion = "requirements-capture/2.0";
          delete record.requirementUsage;
          delete record.constraintUsages;
          captureReads += 1;
          return deterministicJson(record);
        },
        save(fingerprint: ThreadArtifact["fingerprint"], text: string) {
          captureWrites += 1;
          return fixture.reqsCaptures.save(fingerprint, text);
        },
      } as unknown as FileCaptureStore<"requirements-capture">;
      const snapshots = {
        get: fixture.snapshots.get.bind(fixture.snapshots),
        latest: fixture.snapshots.latest.bind(fixture.snapshots),
        save(snapshot: ThreadSnapshot) {
          snapshotWrites += 1;
          return fixture.snapshots.save(snapshot);
        },
      } as unknown as FileThreadSnapshotStore;
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/v2-non-authority-attempts`,
      );
      const syson = new EnrichmentReqsSyson();

      await assertRejects(
        () =>
          makeExecutor({
            ...fixture,
            queued,
            reqsCaptures: v2Captures,
            snapshots,
          }, {
            syson,
            directory,
            attempts,
            leaseSubdir: "v2-non-authority-leases",
          }).execute(AGENT, command),
        EngineeringProjectCommandError,
        "not exact requirements-capture/3.0 evidence",
      );

      assertEquals(captureReads, 1, "the old capture is read once then rejected");
      assertEquals(
        syson.calls,
        [],
        "an old schema cannot authorize any provider operation",
      );
      assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
      assertEquals(captureWrites, 0);
      assertEquals(snapshotWrites, 0);
      const project = await fixture.projects.get(PROJECT_ID);
      const failedRun = project?.agentRuns.find((run) => run.id === queued.runId);
      assertEquals(failedRun?.status, "failed");
      assertEquals(failedRun?.resultSnapshot, undefined);
      assertEquals(
        project?.commandReceipts?.some((receipt) =>
          receipt.commandId ===
            `${command.commandId}:model-write-requirements:publish` ||
          receipt.commandId ===
            `${command.commandId}:model-write-requirements:complete`
        ),
        false,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements executor refuses enrichment when a prior metric disappears from the proposal",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-disappeared-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Execute the initial run (inserts maxMass).
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      // Queue an enrichment run that omits maxMass — triggers disappeared cliquet.
      const enrichmentQueued = await queueEnrichmentRun(
        fixture,
        first,
        WING_REQS_PARAMS_DISAPPEARED,
      );
      const disappearedFixture = {
        ...fixture,
        queued: enrichmentQueued,
      };
      const disappearedCmd = {
        commandId: "agent-disappeared",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };

      await assertRejects(
        () =>
          makeExecutor(disappearedFixture, {
            syson: new EnrichmentReqsSyson(),
            directory,
            leaseSubdir: "disappeared-leases",
            attempts: new FileRequirementsAttemptStore(
              `${directory}/disappeared-attempts`,
            ),
          }).execute(AGENT, disappearedCmd),
        EngineeringProjectCommandError,
        "cliquet",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements executor publishes a valid snapshot in enrichment mode (delete + reinsert)",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-enrichment-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Execute the initial run (inserts maxMass).
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      // Queue and execute the enrichment run (adds maxForce).
      const enrichmentQueued = await queueEnrichmentRun(fixture, first);
      const enrichmentFixture = {
        ...fixture,
        queued: enrichmentQueued,
      };
      const enrichmentCmd = {
        commandId: "agent-enrichment",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };
      const enrichmentSyson = new EnrichmentReqsSyson();
      const second = await makeExecutor(enrichmentFixture, {
        syson: enrichmentSyson,
        directory,
        leaseSubdir: "enrichment-leases",
        attempts: new FileRequirementsAttemptStore(
          `${directory}/enrichment-attempts`,
        ),
      }).execute(AGENT, enrichmentCmd);

      // The enrichment run must be completed.
      const enrichRun = second.agentRuns.find((r) =>
        r.id === "run:requirements-enrichment"
      );
      assertExists(enrichRun, "enrichment run must exist");
      assertEquals(enrichRun.status, "completed");

      // The result snapshot must have a requirements artifact.
      // The enrichment snapshot carries BOTH the initial artifact (from the base) and the
      // enriched artifact (from the extension). Filter by producer.runId so we read the
      // enriched capture (which contains both metrics) rather than the initial one.
      assertExists(enrichRun.resultSnapshot);
      const snap = await fixture.snapshots.get(enrichRun.resultSnapshot.snapshotId);
      assertExists(snap);
      const reqsArtifact = snap.artifacts.find((a) =>
        a.kind === "sysml-model" &&
        a.uri?.startsWith("casys://requirements-capture/Wing/") &&
        a.producer.runId === "run:requirements-enrichment"
      );
      assertExists(
        reqsArtifact,
        "requirements artifact must be in enrichment snapshot",
      );

      // The capture must contain BOTH metrics.
      const captureText = await fixture.reqsCaptures.read(reqsArtifact.fingerprint);
      assertExists(captureText);
      const capture = JSON.parse(captureText) as Record<string, unknown>;
      const requirements = capture.requirements as Array<{ metric: string }>;
      const metrics = requirements.map((r) => r.metric).sort();
      assertEquals(metrics, ["maxForce", "maxMass"]);

      // The enrichment SysON mock must have called delete before insert.
      const deleteCalls = enrichmentSyson.calls.filter(
        (c) => c.name === "syson_element_delete",
      );
      assertEquals(deleteCalls.length, 1, "enrichment must delete the prior element");
      const deleteCallIndex = enrichmentSyson.calls.findIndex(
        (c) => c.name === "syson_element_delete",
      );
      const insertCallIndex = enrichmentSyson.calls.findIndex(
        (c) => c.name === "syson_element_insert_sysml",
      );
      assertEquals(
        deleteCallIndex < insertCallIndex,
        true,
        "delete must occur before reinsert",
      );
      assertEquals(
        (deleteCalls[0]!.arguments as Record<string, unknown>).element_id,
        "wing-reqs-elem-001",
        "delete must target the prior element id",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "completed enrichment replay succeeds when the signed proposal order differs from WAL render order",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-enrichment-replay-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));
      const enrichmentQueued = await queueEnrichmentRun(fixture, first);
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/enrichment-replay-attempts`,
      );
      const enrichmentCmd = {
        commandId: "agent-enrichment-replay",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };
      const completed = await makeExecutor({
        ...fixture,
        queued: enrichmentQueued,
      }, {
        syson: new EnrichmentReqsSyson(),
        directory,
        leaseSubdir: "enrichment-replay-leases",
        attempts,
      }).execute(AGENT, enrichmentCmd);
      const replaySyson = new EnrichmentReqsSyson();
      const replayed = await makeExecutor({
        ...fixture,
        queued: enrichmentQueued,
      }, {
        syson: replaySyson,
        directory,
        leaseSubdir: "enrichment-replay-leases",
        attempts,
      }).execute(AGENT, {
        ...enrichmentCmd,
        expectedRevision: completed.revision,
      });
      assertEquals(
        replayed.agentRuns.find((run) => run.id === enrichmentQueued.runId)
          ?.status,
        "completed",
      );
      assertEquals(replaySyson.calls, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── BLOQUANT: foreign element identity check ──────────────────────────────────

Deno.test(
  "model.write-requirements executor refuses enrichment when found element id does not match prior capture",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-foreign-elem-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Execute the initial run (stores "wing-reqs-elem-001" in the capture).
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      // Queue an enrichment run.
      const enrichmentQueued = await queueEnrichmentRun(fixture, first);
      const foreignFixture = { ...fixture, queued: enrichmentQueued };
      const foreignCmd = {
        commandId: "agent-foreign",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };

      // ForeignElementEnrichmentSyson returns "wing-reqs-elem-FOREIGN" from the
      // pre-WAL children call.  The prior capture records "wing-reqs-elem-001".
      // The identity guard must fire before any WAL write.
      await assertRejects(
        () =>
          makeExecutor(foreignFixture, {
            syson: new ForeignElementEnrichmentSyson(),
            directory,
            leaseSubdir: "foreign-leases",
            attempts: new FileRequirementsAttemptStore(
              `${directory}/foreign-attempts`,
            ),
          }).execute(AGENT, foreignCmd),
        EngineeringProjectCommandError,
        "foreign_requirements_element",
      );

      // No WAL entry must have been written — the guard fires before WAL begin.
      const attempt = await new FileRequirementsAttemptStore(
        `${directory}/foreign-attempts`,
      ).readRun(PROJECT_ID, enrichmentQueued.runId);
      assertEquals(
        attempt,
        undefined,
        "WAL must not be written when identity guard fires",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── RÉSERVE 1: lineage integrity guard (step 7, before cliquet) ──────────────

Deno.test(
  "model.write-requirements executor refuses when the basis snapshot lineage is not intact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-lineage-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      // Find the basis snapshot (archSnap) and its predecessor reference.
      const project = await fixture.projects.get(PROJECT_ID);
      const reqRun = project?.agentRuns.find((r) => r.id === "run:requirements")!;
      assertExists(reqRun, "requirements run must exist");
      assertExists(reqRun.basis, "requirements run must have a basis");
      if (reqRun.basis.kind !== "thread-snapshot") {
        throw new Error("Unexpected basis kind");
      }
      const basisSnap = await fixture.snapshots.get(reqRun.basis.snapshotId);
      assertExists(basisSnap, "basis snapshot must be in the store");

      // Drop the predecessor of basisSnap so the lineage walk finds a missing entry.
      const droppedId = basisSnap.previous?.snapshotId;
      assertExists(
        droppedId,
        "basis snapshot must have a predecessor to corrupt the lineage",
      );

      // Wrap the snapshot store to hide the predecessor.
      const corruptSnapshots = {
        get(id: string) {
          if (id === droppedId) return Promise.resolve(undefined);
          return fixture.snapshots.get(id);
        },
        latest(subjectId: string) {
          return fixture.snapshots.latest(subjectId);
        },
        save(snap: ThreadSnapshot) {
          return fixture.snapshots.save(snap);
        },
      } as unknown as FileThreadSnapshotStore;

      const corruptFixture: ReqsFixture = { ...fixture, snapshots: corruptSnapshots };

      // The executor must refuse with a lineage integrity error (step 7),
      // which fires BEFORE the cliquet check (step 8).
      await assertRejects(
        () =>
          makeExecutor(corruptFixture, {
            syson: new InitialReqsSyson(),
            directory,
            leaseSubdir: "lineage-leases",
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "lineage",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── RÉSERVE 2: enrichment WAL window ─────────────────────────────────────────

Deno.test(
  "model.write-requirements executor fails before providerAcknowledged when enrichment delete fails",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-delete-fail-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      const enrichmentQueued = await queueEnrichmentRun(fixture, first);
      const deleteFailFixture = { ...fixture, queued: enrichmentQueued };
      const deleteFailCmd = {
        commandId: "agent-delete-fail",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };
      const deleteAttempts = new FileRequirementsAttemptStore(
        `${directory}/delete-fail-attempts`,
      );

      // The delete call throws.  The run fails; providerAcknowledged stays false.
      await assertRejects(
        () =>
          makeExecutor(deleteFailFixture, {
            syson: new DeleteFailsEnrichmentSyson(),
            directory,
            leaseSubdir: "delete-fail-leases",
            attempts: deleteAttempts,
          }).execute(AGENT, deleteFailCmd),
        EngineeringProjectCommandError,
        "not found",
      );

      // The run must be "failed" (recordFailure was called).
      const afterFail = await fixture.projects.get(PROJECT_ID);
      const failedEnrichRun = afterFail?.agentRuns.find(
        (r) => r.id === enrichmentQueued.runId,
      );
      assertEquals(failedEnrichRun?.status, "failed");

      // The WAL entry was created ("dispatched") but never completed.
      // This puts the next executor call (on a re-queued run) into quarantine.
      const attempt = await deleteAttempts.readRun(
        PROJECT_ID,
        enrichmentQueued.runId,
      );
      assertEquals(
        attempt?.status,
        "dispatched",
        "WAL must stay dispatched when delete fails after WAL begin",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements quarantines when enrichment delete succeeds but insert fails",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-insert-fail-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);

      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, executionCommand(fixture));

      const enrichmentQueued = await queueEnrichmentRun(fixture, first);
      const insertFailFixture = { ...fixture, queued: enrichmentQueued };
      const insertFailCmd = {
        commandId: "agent-insert-fail",
        projectId: PROJECT_ID,
        expectedRevision: enrichmentQueued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: enrichmentQueued.runId,
      };
      const insertAttempts = new FileRequirementsAttemptStore(
        `${directory}/insert-fail-attempts`,
      );

      // Delete succeeds and is acknowledged; insert then fails. The dispatched
      // WAL remains outcome-unknown and the run is terminally quarantined.
      await assertRejects(
        () =>
          makeExecutor(insertFailFixture, {
            syson: new DeleteSuccessInsertFailEnrichmentSyson(),
            directory,
            leaseSubdir: "insert-fail-leases",
            attempts: insertAttempts,
          }).execute(AGENT, insertFailCmd),
        EngineeringProjectCommandError,
        "no longer available",
      );

      // The run must be "failed".
      const afterFail = await fixture.projects.get(PROJECT_ID);
      const failedEnrichRun = afterFail?.agentRuns.find(
        (r) => r.id === enrichmentQueued.runId,
      );
      assertEquals(failedEnrichRun?.status, "failed");

      // WAL is still "dispatched" — a safe retry is not possible without
      // operator review (delete happened, insert did not).
      const attempt = await insertAttempts.readRun(
        PROJECT_ID,
        enrichmentQueued.runId,
      );
      assertEquals(
        attempt?.status,
        "dispatched",
        "WAL must stay dispatched when delete succeeded but insert failed",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements executor raises unknown-outcome error when WAL is in dispatched state on entry",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-wal-dispatched-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const dispatchedAttempts = new FileRequirementsAttemptStore(
        `${directory}/dispatched-attempts`,
      );

      // Pre-seed the WAL with "dispatched" status. Host activation and claim
      // are forbidden until a human inspects SysON.
      await dispatchedAttempts.begin({
        projectId: PROJECT_ID,
        runId: "run:requirements",
        planDigest: "pre-seeded-plan-digest",
        dispatchedAt: "2026-08-08T12:10:00.000Z",
      });
      const session = recordingCapabilityRuntimeSession();
      const syson = new InitialReqsSyson();

      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson,
            directory,
            leaseSubdir: "dispatched-leases",
            attempts: dispatchedAttempts,
            capabilityRuntimeSession: session,
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "outcome is unknown",
      );

      assertEquals(session.events, []);
      assertEquals(syson.calls, []);
      const afterFail = await fixture.projects.get(PROJECT_ID);
      const failedRun = afterFail?.agentRuns.find((r) => r.id === "run:requirements");
      assertEquals(failedRun?.status, "queued");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements keeps the run queued when JIT begin fails",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-jit-unavailable-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const session = recordingCapabilityRuntimeSession(() =>
        Promise.reject(new Error("exact SysON host group unavailable"))
      );
      const syson = new InitialReqsSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson,
            directory,
            capabilityRuntimeSession: session,
          }).execute(AGENT, executionCommand(fixture)),
        Error,
        "host group unavailable",
      );
      assertEquals(session.events, ["begin"]);
      assertEquals(session.releases, 0);
      assertEquals(session.retains, 0);
      assertEquals(syson.calls, []);
      assertEquals(
        (await fixture.projects.get(PROJECT_ID))?.agentRuns.find((run) =>
          run.id === fixture.queued.runId
        )?.status,
        "queued",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "model.write-requirements rejects decimal thresholds when the proposal is made, before any run exists",
  async () => {
    // The refusal moved earlier than a queued run: project_decision_propose now
    // parses the proposal with this operation's own grammar, so a decimal
    // threshold never reaches a human reviewer, a work item, or the WAL. The
    // executor keeps its own parse as defence in depth for decisions recorded
    // before that gate existed.
    for (const decimal of [0.5, 1.5]) {
      const directory = await Deno.makeTempDir({ prefix: "casys-reqs-decimal-" });
      try {
        const parameters = WING_REQS_PARAMS_INITIAL.map((parameter) =>
          parameter.key === "requirement.max-mass.threshold"
            ? { ...parameter, value: decimal }
            : parameter
        );
        await assertRejects(
          () => queuedRequirementsFixture(directory, parameters),
          Error,
          "safe integer",
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "initial requirements write refuses an untraced live homonym before WAL or insert",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-homonym-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const syson = new ExistingHomonymInitialSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "foreign_requirements_element",
      );
      assertEquals(
        syson.calls.some((call) => call.name === "syson_element_insert_sysml"),
        false,
      );
      assertEquals(
        await fixture.reqsAttempts.readRun(PROJECT_ID, fixture.queued.runId),
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "children response identity is checked before WAL and after ACK",
  async () => {
    const preflightDirectory = await Deno.makeTempDir({
      prefix: "casys-reqs-wrong-preflight-",
    });
    try {
      const fixture = await queuedRequirementsFixture(preflightDirectory);
      const syson = new WrongPreflightEchoSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory: preflightDirectory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "exactly echo parent",
      );
      assertEquals(
        syson.calls.some((call) => call.name === "syson_element_insert_sysml"),
        false,
      );
      assertEquals(
        await fixture.reqsAttempts.readRun(PROJECT_ID, fixture.queued.runId),
        undefined,
      );
    } finally {
      await Deno.remove(preflightDirectory, { recursive: true });
    }

    for (
      const [name, syson] of [
        ["children", new WrongPostAckEchoSyson()],
        ["AQL", new WrongAqlEchoSyson()],
      ] as const
    ) {
      const directory = await Deno.makeTempDir({
        prefix: `casys-reqs-wrong-${name.toLowerCase()}-`,
      });
      try {
        const fixture = await queuedRequirementsFixture(directory);
        await assertRejects(
          () =>
            makeExecutor(fixture, { syson, directory }).execute(
              AGENT,
              executionCommand(fixture),
            ),
          EngineeringProjectCommandError,
        );
        assertEquals(
          await fixture.reqsAttempts.isQuarantined(PROJECT_ID, fixture.queued.runId),
          true,
        );
        const project = await fixture.projects.get(PROJECT_ID);
        assertEquals(
          project?.agentRuns.find((run) => run.id === fixture.queued.runId)?.failure
            ?.code,
          "model-write-requirements-post-acknowledgement-quarantined",
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "enrichment refuses a live predecessor with a divergent threshold before delete or WAL",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-live-stale-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await executeInitialRequirementsRun(fixture, directory);
      const queued = await queueEnrichmentRun(fixture, first);
      const attempts = new FileRequirementsAttemptStore(`${directory}/stale-attempts`);
      const syson = new StaleThresholdEnrichmentSyson();
      await assertRejects(
        () =>
          makeExecutor({ ...fixture, queued }, {
            syson,
            directory,
            attempts,
            leaseSubdir: "stale-leases",
          }).execute(AGENT, {
            commandId: "agent-stale-live",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:25:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
        "prior_requirements_live_mismatch",
      );
      assertEquals(
        syson.calls.some((call) => call.name === "syson_element_delete"),
        false,
      );
      assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "enrichment refuses a silently replaced V3 ConstraintUsage before WAL, delete, or publication",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-prior-constraint-identity-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await executeInitialRequirementsRun(fixture, directory);
      const queued = await queueEnrichmentRun(fixture, first);
      const command = {
        commandId: "agent-replaced-prior-constraint",
        projectId: PROJECT_ID,
        expectedRevision: queued.revision,
        issuedAt: "2026-08-08T12:25:00.000Z",
        runId: queued.runId,
      };
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/prior-constraint-identity-attempts`,
      );
      const syson = new ReplacedPriorConstraintIdentityEnrichmentSyson();
      let captureWrites = 0;
      let snapshotWrites = 0;
      const captures = {
        read: fixture.reqsCaptures.read.bind(fixture.reqsCaptures),
        save(fingerprint: ThreadArtifact["fingerprint"], text: string) {
          captureWrites += 1;
          return fixture.reqsCaptures.save(fingerprint, text);
        },
      } as unknown as FileCaptureStore<"requirements-capture">;
      const snapshots = {
        get: fixture.snapshots.get.bind(fixture.snapshots),
        latest: fixture.snapshots.latest.bind(fixture.snapshots),
        save(snapshot: ThreadSnapshot) {
          snapshotWrites += 1;
          return fixture.snapshots.save(snapshot);
        },
      } as unknown as FileThreadSnapshotStore;

      await assertRejects(
        () =>
          makeExecutor({ ...fixture, queued, reqsCaptures: captures, snapshots }, {
            syson,
            directory,
            attempts,
            leaseSubdir: "prior-constraint-identity-leases",
          }).execute(AGENT, command),
        EngineeringProjectCommandError,
        "Prior V3 ConstraintUsage identity mismatch",
      );

      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_constraint_extract" &&
          call.arguments?.element_id === "wing-reqs-elem-001"
        ),
        true,
        "the live predecessor must be semantically and structurally re-read",
      );
      assertEquals(
        syson.calls.some((call) =>
          call.name === "syson_element_delete" ||
          call.name === "syson_element_insert_sysml"
        ),
        false,
      );
      assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
      assertEquals(captureWrites, 0);
      assertEquals(snapshotWrites, 0);
      const project = await fixture.projects.get(PROJECT_ID);
      const failedRun = project?.agentRuns.find((run) => run.id === queued.runId);
      assertEquals(failedRun?.status, "failed");
      assertEquals(failedRun?.resultSnapshot, undefined);
      assertEquals(
        project?.commandReceipts?.some((receipt) =>
          receipt.commandId ===
            `${command.commandId}:model-write-requirements:publish` ||
          receipt.commandId ===
            `${command.commandId}:model-write-requirements:complete`
        ),
        false,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "same-basis target siblings serialize and only one run may write a requirements WAL",
  async () => {
    class BarrierInitialReqsSyson extends InitialReqsSyson {
      readonly insertionEntered = deferred<void>();
      readonly releaseInsertion = deferred<void>();

      override async callTool(call: McpToolCall): Promise<McpToolResult> {
        if (call.name === "syson_element_insert_sysml") {
          this.insertionEntered.resolve();
          await this.releaseInsertion.promise;
        }
        return await super.callTool(call);
      }
    }

    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-concurrent-" });
    try {
      const fixture = await queuedRequirementsFixture(
        directory,
        WING_REQS_PARAMS_INITIAL,
        true,
      );
      assertExists(fixture.parallel);
      const winnerSyson = new BarrierInitialReqsSyson();
      const loserSyson = new InitialReqsSyson();
      const winner = makeExecutor(fixture, {
        syson: winnerSyson,
        directory,
      }).execute(AGENT, executionCommand(fixture));
      await winnerSyson.insertionEntered.promise;

      const loser = makeExecutor(fixture, {
        syson: loserSyson,
        directory,
      }).execute(AGENT, {
        commandId: "agent-author-requirements-parallel",
        projectId: PROJECT_ID,
        expectedRevision: fixture.parallel.revision,
        issuedAt: "2026-08-08T12:20:01.000Z",
        runId: fixture.parallel.runId,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      assertEquals(
        (await fixture.reqsAttempts.readRun(PROJECT_ID, fixture.queued.runId))
          ?.status,
        "dispatched",
      );
      assertEquals(loserSyson.calls, []);
      const during = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        during?.agentRuns.find((run) => run.id === fixture.parallel!.runId)?.status,
        "queued",
      );

      winnerSyson.releaseInsertion.resolve();
      await winner;
      await assertRejects(
        () => loser,
        EngineeringProjectCommandError,
        "Thread write basis is unavailable",
      );
      assertEquals(loserSyson.calls, []);
      assertEquals(
        winnerSyson.calls.filter((call) => call.name === "syson_element_insert_sysml")
          .length,
        1,
      );
      assertEquals(
        await fixture.reqsAttempts.readRun(PROJECT_ID, fixture.parallel.runId),
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "delete ACK plus insert failure terminally blocks a new same-basis sibling",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-delete-ack-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await executeInitialRequirementsRun(fixture, directory);
      const queued = await queueEnrichmentRun(fixture, first);
      const attempts = new FileRequirementsAttemptStore(
        `${directory}/delete-ack-attempts`,
      );
      await assertRejects(
        () =>
          makeExecutor({ ...fixture, queued }, {
            syson: new DeleteSuccessInsertFailEnrichmentSyson(),
            directory,
            attempts,
            leaseSubdir: "delete-ack-leases",
          }).execute(AGENT, {
            commandId: "agent-delete-ack",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:25:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
      );
      const failed = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        failed?.agentRuns.find((run) => run.id === queued.runId)?.failure?.code,
        "model-write-requirements-post-acknowledgement-quarantined",
      );

      const failedRun = failed?.agentRuns.find((run) => run.id === queued.runId);
      assertExists(failedRun?.basis);
      const siblingQueued = await fixture.commands.queueRun(AGENT, {
        ...ctx("queue-delete-ack-sibling", failed!.revision),
        runId: "run:requirements-enrichment-sibling",
        workItemId: "wi:requirements-enrichment",
        summary: "Attempt same-basis recovery.",
        basis: failedRun.basis,
      });
      const siblingSyson = new EnrichmentReqsSyson();
      await assertRejects(
        () =>
          makeExecutor({
            ...fixture,
            queued: {
              revision: siblingQueued.revision,
              runId: "run:requirements-enrichment-sibling",
            },
          }, {
            syson: siblingSyson,
            directory,
            attempts,
            leaseSubdir: "delete-ack-leases",
          }).execute(AGENT, {
            commandId: "agent-delete-ack-sibling",
            projectId: PROJECT_ID,
            expectedRevision: siblingQueued.revision,
            issuedAt: "2026-08-08T12:26:00.000Z",
            runId: "run:requirements-enrichment-sibling",
          }),
        EngineeringProjectCommandError,
        "Thread write basis is unavailable",
      );
      assertEquals(siblingSyson.calls, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "completed WAL recovery refuses a different live RequirementUsage identity",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-wal-id-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const proposal = parseRequirementsProposalParameters(WING_REQS_PARAMS_INITIAL);
      const requirements = requirementEntriesToOracleRequirements(
        proposal.requirements,
      );
      const plan = await sha256Fingerprint({
        partDefName: proposal.partDefName,
        target: {
          kind: "part-definition",
          label: "Wing",
          elementId: "wing-def-001",
        },
        requirements,
      });
      await fixture.reqsAttempts.begin({
        projectId: PROJECT_ID,
        runId: fixture.queued.runId,
        planDigest: plan.digest,
        dispatchedAt: "2026-08-08T12:19:00.000Z",
      });
      await fixture.reqsAttempts.complete({
        projectId: PROJECT_ID,
        runId: fixture.queued.runId,
        planDigest: plan.digest,
        requirementsElementId: "wing-reqs-elem-A",
      });
      const syson = new ExistingHomonymInitialSyson();
      await assertRejects(
        () =>
          makeExecutor(fixture, { syson, directory }).execute(
            AGENT,
            executionCommand(fixture),
          ),
        EngineeringProjectCommandError,
        "Refusing to adopt a homonym",
      );
      const project = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        project?.agentRuns.find((run) => run.id === fixture.queued.runId)
          ?.resultSnapshot,
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "architecture captures with non-canonical schema, source analysis, semantics, ids, or predecessor are refused before WAL and SysON",
  async () => {
    const mutations: ReadonlyArray<[
      string,
      (record: Record<string, unknown>) => void,
    ]> = [
      ["legacy schema", (record) => {
        record.schemaVersion = "architecture-capture/1.0";
      }],
      ["missing systemName", (record) => {
        delete record.systemName;
      }],
      ["extra root field", (record) => {
        record.untrusted = true;
      }],
      ["missing current source analyses", (record) => {
        delete record.sourceAnalyses;
      }],
      ["malformed current source analysis", (record) => {
        record.sourceAnalyses = [{ malformed: true }];
      }],
      ["foreign source-analysis run", (record) => {
        const [reference] = record.sourceAnalyses as Array<Record<string, unknown>>;
        reference!.runId = "run:foreign-architecture";
      }],
      ["foreign source-analysis operation", (record) => {
        const [reference] = record.sourceAnalyses as Array<Record<string, unknown>>;
        reference!.operation = { id: "model.write-requirements", version: "1" };
      }],
      ["foreign source-analysis package", (record) => {
        const [reference] = record.sourceAnalyses as Array<Record<string, unknown>>;
        reference!.selector = {
          kind: "full-package",
          packageName: "ForeignPackage",
        };
      }],
      ["wrong PartDefinition kind", (record) => {
        const parts = record.partDefinitions as Array<Record<string, unknown>>;
        parts[0]!.kind = "PartUsage";
      }],
      ["cross-kind id collision", (record) => {
        const parts = record.partDefinitions as Array<Record<string, unknown>>;
        const usages = parts[0]!.usages as Array<Record<string, unknown>>;
        usages[0]!.id = parts[1]!.id;
      }],
      ["predecessor/input mismatch", (record) => {
        record.predecessor = {
          artifactId: `architecture-${"a".repeat(64)}`,
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          producerRunId: "run:foreign-architecture",
        };
      }],
    ];

    for (const [name, mutate] of mutations) {
      const directory = await Deno.makeTempDir({ prefix: "casys-reqs-arch-exact-" });
      try {
        const fixture = await queuedRequirementsFixture(directory);
        const captures = {
          async read(fingerprint: ThreadArtifact["fingerprint"]) {
            const text = await fixture.archCaptures.read(fingerprint);
            if (!text) return undefined;
            const record = JSON.parse(text) as Record<string, unknown>;
            mutate(record);
            return JSON.stringify(record);
          },
        } as unknown as FileCaptureStore<"architecture-capture">;
        const syson = new InitialReqsSyson();
        const attempts = new FileRequirementsAttemptStore(
          `${directory}/arch-exact-attempts`,
        );
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, archCaptures: captures }, {
              syson,
              directory,
              attempts,
              leaseSubdir: "arch-exact-leases",
            }).execute(AGENT, executionCommand(fixture)),
          EngineeringProjectCommandError,
          "architecture",
        );
        assertEquals(syson.calls, [], name);
        assertEquals(
          await attempts.readRun(PROJECT_ID, fixture.queued.runId),
          undefined,
          name,
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "requirements refuses an absent sealed SysML source capture before claim, WAL, or SysON",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-reqs-arch-source-absent-",
    });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const project = await fixture.projects.get(PROJECT_ID);
      assertExists(project);
      const run = project.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      if (!run?.basis || run.basis.kind !== "thread-snapshot") {
        throw new Error("Requirements fixture has no thread-snapshot basis.");
      }
      const basis = await fixture.snapshots.get(run.basis.snapshotId);
      assertExists(basis);
      const architecture = findArchitectureArtifact(basis);
      assertExists(architecture);
      const captureText = await fixture.archCaptures.read(architecture.fingerprint);
      assertExists(captureText);
      const capture = JSON.parse(captureText) as {
        sourceAnalyses: Array<
          { sourceCaptureFingerprint: ThreadArtifact["fingerprint"] }
        >;
      };
      const sourceCapture = new FileCaptureStore({
        ...SYSML_SOURCE_CAPTURE_DESCRIPTOR,
        directory: `${directory}/sysml-source-captures`,
      });
      await Deno.remove(
        sourceCapture.pathFor(capture.sourceAnalyses[0]!.sourceCaptureFingerprint),
      );

      const syson = new InitialReqsSyson();
      const attempts = new FileRequirementsAttemptStore(`${directory}/absent-attempts`);
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson,
            directory,
            attempts,
            leaseSubdir: "absent-source-leases",
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "source-analysis evidence",
      );
      assertEquals(syson.calls, []);
      assertEquals(
        await attempts.readRun(PROJECT_ID, fixture.queued.runId),
        undefined,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "completed replay revalidates its exact capture before returning idempotent success",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-replay-proof-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const command = executionCommand(fixture);
      const first = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, command);
      const unavailableCaptures = {
        read() {
          return Promise.resolve(undefined);
        },
      } as unknown as FileCaptureStore<"requirements-capture">;
      const syson = new InitialReqsSyson();
      await assertRejects(
        () =>
          makeExecutor({ ...fixture, reqsCaptures: unavailableCaptures }, {
            syson,
            directory,
          }).execute(AGENT, { ...command, expectedRevision: first.revision }),
        EngineeringProjectCommandError,
        "not durably readable",
      );
      assertEquals(syson.calls, []);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "completed replay rejects mutated requirement, target, and basis capture fields without SysON calls",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-replay-capture-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, command);
      const mutations: ReadonlyArray<[
        string,
        (record: Record<string, unknown>) => void,
      ]> = [
        ["threshold", (record) => {
          const requirements = record.requirements as Array<Record<string, unknown>>;
          const limit = requirements[0]!.limit as Record<string, unknown>;
          limit.value = 99;
        }],
        ["target", (record) => {
          const target = record.target as Record<string, unknown>;
          target.elementId = "part-definition:foreign";
        }],
        ["architecture basis", (record) => {
          const basis = record.architectureBasis as Record<string, unknown>;
          basis.revision = (basis.revision as number) + 1;
        }],
        ["ConstraintUsage identity", (record) => {
          const constraints = record.constraintUsages as Array<
            Record<string, unknown>
          >;
          constraints[0]!.id = "constraint-usage:rewritten";
          constraints[0]!.sourceId = "constraint-usage:rewritten";
        }],
        ["ConstraintUsage source identity", (record) => {
          const constraints = record.constraintUsages as Array<
            Record<string, unknown>
          >;
          constraints[0]!.sourceId = "constraint-usage:foreign";
        }],
      ];

      for (const [name, mutate] of mutations) {
        const captures = {
          async read(fingerprint: ThreadArtifact["fingerprint"]) {
            const text = await fixture.reqsCaptures.read(fingerprint);
            if (!text) return undefined;
            const record = JSON.parse(text) as Record<string, unknown>;
            mutate(record);
            return JSON.stringify(record);
          },
        } as unknown as FileCaptureStore<"requirements-capture">;
        const syson = new InitialReqsSyson();
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, reqsCaptures: captures }, {
              syson,
              directory,
              leaseSubdir: `replay-capture-${name}`,
            }).execute(AGENT, {
              ...command,
              expectedRevision: completed.revision,
            }),
          EngineeringProjectCommandError,
          "Completed requirements evidence integrity failure",
        );
        assertEquals(syson.calls, [], name);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "completed replay rejects requirement drift and rewritten historical entities in its result snapshot",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-replay-result-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const command = executionCommand(fixture);
      const completed = await makeExecutor(fixture, {
        syson: new InitialReqsSyson(),
        directory,
      }).execute(AGENT, command);
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === fixture.queued.runId
      );
      assertExists(run?.resultSnapshot);
      const mutations: ReadonlyArray<[
        string,
        (snapshot: MutableThreadSnapshot) => void,
      ]> = [
        ["projected threshold", (snapshot) => {
          snapshot.requirements[0]!.criterion.limit.value = 99;
        }],
        ["historical architecture name", (snapshot) => {
          const architecture = snapshot.artifacts.find((artifact) =>
            artifact.id.startsWith("architecture-")
          );
          assertExists(architecture);
          architecture.name = "Rewritten historical architecture";
        }],
      ];

      for (const [name, mutate] of mutations) {
        let snapshotWrites = 0;
        const snapshots = {
          async get(id: string) {
            const snapshot = await fixture.snapshots.get(id);
            if (!snapshot || id !== run.resultSnapshot!.snapshotId) return snapshot;
            const altered = mutableClone(snapshot);
            mutate(altered);
            return altered;
          },
          latest(subjectId: string) {
            return fixture.snapshots.latest(subjectId);
          },
          save(snapshot: ThreadSnapshot) {
            snapshotWrites += 1;
            return fixture.snapshots.save(snapshot);
          },
        } as unknown as FileThreadSnapshotStore;
        const syson = new InitialReqsSyson();
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, snapshots }, {
              syson,
              directory,
              leaseSubdir: `replay-result-${name}`,
            }).execute(AGENT, {
              ...command,
              expectedRevision: completed.revision,
            }),
          EngineeringProjectCommandError,
          "Completed requirements evidence integrity failure",
        );
        assertEquals(snapshotWrites, 0, name);
        assertEquals(syson.calls, [], name);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "prior requirements capture basis and seed anchors are exact before live readback",
  async () => {
    const mutations: ReadonlyArray<[
      string,
      (record: Record<string, unknown>) => void,
    ]> = [
      ["wrong architecture basis", (record) => {
        (record.architectureBasis as Record<string, unknown>).fingerprint = "f".repeat(
          64,
        );
      }],
      ["wrong seed", (record) => {
        (record.seed as Record<string, unknown>).producerRunId = "run:foreign-seed";
      }],
      ["extra root field", (record) => {
        record.agentSuppliedSysml = "requirement Foreign {}";
      }],
      ["missing requirementUsage", (record) => {
        delete record.requirementUsage;
      }],
      ["missing constraintUsages", (record) => {
        delete record.constraintUsages;
      }],
    ];

    for (const [name, mutate] of mutations) {
      const directory = await Deno.makeTempDir({ prefix: "casys-reqs-prior-exact-" });
      try {
        const fixture = await queuedRequirementsFixture(directory);
        const first = await executeInitialRequirementsRun(fixture, directory);
        const queued = await queueEnrichmentRun(fixture, first);
        const captures = {
          async read(fingerprint: ThreadArtifact["fingerprint"]) {
            const text = await fixture.reqsCaptures.read(fingerprint);
            if (!text) return undefined;
            const record = JSON.parse(text) as Record<string, unknown>;
            mutate(record);
            return JSON.stringify(record);
          },
        } as unknown as FileCaptureStore<"requirements-capture">;
        const attempts = new FileRequirementsAttemptStore(
          `${directory}/prior-exact-attempts`,
        );
        const syson = new EnrichmentReqsSyson();
        const error = await assertRejects(
          () =>
            makeExecutor({ ...fixture, queued, reqsCaptures: captures }, {
              syson,
              directory,
              attempts,
              leaseSubdir: "prior-exact-leases",
            }).execute(AGENT, {
              commandId: `agent-prior-exact-${name}`,
              projectId: PROJECT_ID,
              expectedRevision: queued.revision,
              issuedAt: "2026-08-08T12:25:00.000Z",
              runId: queued.runId,
            }),
          EngineeringProjectCommandError,
        );
        assertEquals(
          Object.getPrototypeOf(error),
          EngineeringProjectCommandError.prototype,
          name,
        );
        assertEquals(error.code, "invalid_input", name);
        if (name === "extra root field") {
          assertEquals(
            error.message,
            "The prior requirements capture is not exact requirements-capture/3.0 evidence: " +
              "Requirements capture has non-exact fields.",
          );
        }
        assertEquals(syson.calls, [], name);
        assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "historical architecture trusted run and seed/input lineage are exact before live readback",
  async () => {
    const mutations: ReadonlyArray<[
      string,
      (record: Record<string, unknown>) => void,
    ]> = [
      ["wrong historical trusted run", (record) => {
        record.trustedRunId = "run:foreign-architecture";
      }],
      ["historical seed/input mismatch", (record) => {
        const seed = record.seed as Record<string, unknown>;
        seed.artifactId = `syson-model-seed-${"f".repeat(64)}`;
        seed.fingerprint = { algorithm: "sha256", digest: "f".repeat(64) };
      }],
    ];

    for (const [name, mutate] of mutations) {
      const directory = await Deno.makeTempDir({
        prefix: "casys-reqs-historical-arch-exact-",
      });
      try {
        const fixture = await queuedRequirementsFixture(directory);
        const first = await executeInitialRequirementsRun(fixture, directory);
        const queued = await queueEnrichmentRun(fixture, first);
        let reads = 0;
        const captures = {
          async read(fingerprint: ThreadArtifact["fingerprint"]) {
            const text = await fixture.archCaptures.read(fingerprint);
            if (!text) return undefined;
            reads += 1;
            // The first read validates the active architecture. Mutate only
            // the second read made by #readPriorRequirements so this case
            // specifically exercises historical evidence revalidation.
            if (reads === 1) return text;
            const record = JSON.parse(text) as Record<string, unknown>;
            mutate(record);
            return JSON.stringify(record);
          },
        } as unknown as FileCaptureStore<"architecture-capture">;
        const attempts = new FileRequirementsAttemptStore(
          `${directory}/historical-arch-exact-attempts`,
        );
        const syson = new EnrichmentReqsSyson();
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, queued, archCaptures: captures }, {
              syson,
              directory,
              attempts,
              leaseSubdir: "historical-arch-exact-leases",
            }).execute(AGENT, {
              commandId: `agent-historical-arch-exact-${name}`,
              projectId: PROJECT_ID,
              expectedRevision: queued.revision,
              issuedAt: "2026-08-08T12:25:00.000Z",
              runId: queued.runId,
            }),
          EngineeringProjectCommandError,
          "historical architecture",
        );
        assertEquals(reads, 2, name);
        assertEquals(syson.calls, [], name);
        assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "prior capture requires exact TracedRequirement fields and trace provenance",
  async () => {
    const mutations: ReadonlyArray<[
      string,
      (snapshot: MutableThreadSnapshot) => void,
    ]> = [
      ["name", (snapshot) => {
        snapshot.requirements[0]!.name = "Renamed after publication";
      }],
      ["statement", (snapshot) => {
        snapshot.requirements[0]!.statement = "Rewritten statement.";
      }],
      ["version", (snapshot) => {
        snapshot.requirements[0]!.version = "f".repeat(64);
      }],
      ["freshness", (snapshot) => {
        snapshot.requirements[0]!.freshness.changedAt = "2026-08-08T12:59:59.000Z";
      }],
      ["traces_to link", (snapshot) => {
        const trace = snapshot.provenance.find((link) =>
          link.relation === "traces_to" && link.from.kind === "requirement"
        );
        assertExists(trace);
        trace.rationale = "Rewritten trace provenance.";
      }],
      ["consumption", (snapshot) => {
        const artifact = snapshot.artifacts.find((candidate) =>
          candidate.producer.runId === "run:requirements"
        );
        assertExists(artifact);
        const consumption = snapshot.consumptions.find((candidate) =>
          candidate.consumer.runId === artifact.producer.runId
        );
        assertExists(consumption);
        consumption.verifiedAt = "2026-08-08T12:59:59.000Z";
      }],
      ["uses link", (snapshot) => {
        const artifact = snapshot.artifacts.find((candidate) =>
          candidate.producer.runId === "run:requirements"
        );
        assertExists(artifact);
        const consumption = snapshot.consumptions.find((candidate) =>
          candidate.consumer.runId === artifact.producer.runId
        );
        assertExists(consumption);
        const uses = snapshot.provenance.find((link) =>
          link.relation === "uses" && link.from.kind === "consumption" &&
          link.from.id === consumption.id
        );
        assertExists(uses);
        uses.rationale = "Rewritten consumption provenance.";
      }],
    ];

    for (const [name, mutate] of mutations) {
      const directory = await Deno.makeTempDir({
        prefix: "casys-reqs-thread-projection-",
      });
      try {
        const fixture = await queuedRequirementsFixture(directory);
        const first = await executeInitialRequirementsRun(fixture, directory);
        const queued = await queueEnrichmentRun(fixture, first);
        const project = await fixture.projects.get(PROJECT_ID);
        const run = project?.agentRuns.find((candidate) =>
          candidate.id === queued.runId
        );
        assertExists(run?.basis);
        if (run.basis.kind !== "thread-snapshot") {
          throw new Error("Unexpected basis.");
        }
        const basis = await fixture.snapshots.get(run.basis.snapshotId);
        assertExists(basis);
        const divergent = mutableClone(basis);
        mutate(divergent);
        const snapshots = {
          get(id: string) {
            return id === divergent.id
              ? Promise.resolve(structuredClone(divergent))
              : fixture.snapshots.get(id);
          },
          latest(subjectId: string) {
            return fixture.snapshots.latest(subjectId);
          },
          save(snapshot: ThreadSnapshot) {
            return fixture.snapshots.save(snapshot);
          },
        } as unknown as FileThreadSnapshotStore;
        const attempts = new FileRequirementsAttemptStore(
          `${directory}/projection-attempts`,
        );
        const syson = new EnrichmentReqsSyson();
        await assertRejects(
          () =>
            makeExecutor({ ...fixture, queued, snapshots }, {
              syson,
              directory,
              attempts,
              leaseSubdir: "projection-leases",
            }).execute(AGENT, {
              commandId: `agent-projection-divergent-${name}`,
              projectId: PROJECT_ID,
              expectedRevision: queued.revision,
              issuedAt: "2026-08-08T12:25:00.000Z",
              runId: queued.runId,
            }),
          EngineeringProjectCommandError,
        );
        assertEquals(syson.calls, [], name);
        assertEquals(
          await attempts.readRun(PROJECT_ID, queued.runId),
          undefined,
          name,
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "a unique requirements tip may not merge two requirements predecessors",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-merge-tip-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const first = await executeInitialRequirementsRun(fixture, directory);
      const queued = await queueEnrichmentRun(fixture, first);
      const project = await fixture.projects.get(PROJECT_ID);
      const run = project?.agentRuns.find((candidate) => candidate.id === queued.runId);
      assertExists(run?.basis);
      if (run.basis.kind !== "thread-snapshot") throw new Error("Unexpected basis.");
      const basis = await fixture.snapshots.get(run.basis.snapshotId);
      assertExists(basis);
      const merged = mutableClone(basis);
      const tip = merged.artifacts.find((artifact) =>
        artifact.producer.runId === "run:requirements"
      );
      assertExists(tip);
      const architectureId = tip.inputArtifactIds[0]!;
      const left = mutableClone(makeReqsArtifact(
        `requirements-Wing-${FAKE_DIGEST_B}`,
        "Wing",
        FAKE_DIGEST_B,
      ));
      const right = mutableClone(makeReqsArtifact(
        `requirements-Wing-${FAKE_DIGEST_C}`,
        "Wing",
        FAKE_DIGEST_C,
      ));
      merged.artifacts.push(left, right);
      tip.inputArtifactIds = [architectureId, left.id, right.id];
      merged.provenance.push(
        {
          id: "derived-from-merge-left",
          relation: "derived_from",
          from: { kind: "artifact", id: tip.id },
          to: { kind: "artifact", id: left.id },
          rationale: "Malformed merge fixture.",
        },
        {
          id: "derived-from-merge-right",
          relation: "derived_from",
          from: { kind: "artifact", id: tip.id },
          to: { kind: "artifact", id: right.id },
          rationale: "Malformed merge fixture.",
        },
      );
      const snapshots = {
        get(id: string) {
          return id === merged.id
            ? Promise.resolve(structuredClone(merged))
            : fixture.snapshots.get(id);
        },
        latest(subjectId: string) {
          return fixture.snapshots.latest(subjectId);
        },
        save(snapshot: ThreadSnapshot) {
          return fixture.snapshots.save(snapshot);
        },
      } as unknown as FileThreadSnapshotStore;
      const attempts = new FileRequirementsAttemptStore(`${directory}/merge-attempts`);
      const syson = new EnrichmentReqsSyson();
      await assertRejects(
        () =>
          makeExecutor({ ...fixture, queued, snapshots }, {
            syson,
            directory,
            attempts,
            leaseSubdir: "merge-leases",
          }).execute(AGENT, {
            commandId: "agent-merge-tip",
            projectId: PROJECT_ID,
            expectedRevision: queued.revision,
            issuedAt: "2026-08-08T12:25:00.000Z",
            runId: queued.runId,
          }),
        EngineeringProjectCommandError,
      );
      assertEquals(syson.calls, []);
      assertEquals(await attempts.readRun(PROJECT_ID, queued.runId), undefined);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "legacy completed requirements WAL 1.0 fails closed before provider recovery",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-reqs-wal-legacy-" });
    try {
      const fixture = await queuedRequirementsFixture(directory);
      const attemptsDirectory = `${directory}/legacy-wal-attempts`;
      await Deno.mkdir(attemptsDirectory, { recursive: true });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([PROJECT_ID, fixture.queued.runId])),
      );
      const key = [...new Uint8Array(digest)].map((byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
      await Deno.writeTextFile(
        `${attemptsDirectory}/run-${key}.json`,
        JSON.stringify({
          schemaVersion: "requirements-write-attempt/1.0",
          projectId: PROJECT_ID,
          runId: fixture.queued.runId,
          planDigest: "legacy-plan",
          status: "completed",
          dispatchedAt: "2026-08-08T12:19:00.000Z",
          result: { inserted: "true" },
        }) + "\n",
      );
      const attempts = new FileRequirementsAttemptStore(attemptsDirectory);
      const syson = new InitialReqsSyson();
      const session = recordingCapabilityRuntimeSession();
      await assertRejects(
        () =>
          makeExecutor(fixture, {
            syson,
            directory,
            attempts,
            leaseSubdir: "legacy-wal-leases",
            capabilityRuntimeSession: session,
          }).execute(AGENT, executionCommand(fixture)),
        EngineeringProjectCommandError,
        "outcome is unknown",
      );
      assertEquals(syson.calls, []);
      assertEquals(session.events, []);
      const project = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        project?.agentRuns.find((run) => run.id === fixture.queued.runId)?.status,
        "queued",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
