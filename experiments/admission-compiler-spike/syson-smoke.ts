/**
 * Ephemeral native SysON smoke for the admission-compiler experiment.
 *
 * This runner owns every provider-facing choice: endpoint, tool names, model
 * names and SysML bytes. It creates one UUID-named project, proves exact native
 * SysML identities by readback, then deletes the project. It never writes the
 * Digital Thread or state/local.
 *
 * Run explicitly with:
 *   deno run --allow-net=127.0.0.1:3009 \
 *     experiments/admission-compiler-spike/syson-smoke.ts
 */

import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  ARCHITECTURE_FEATURE_TYPING_AQL,
  extractArchitectureStructure,
} from "../../src/adapters/architecture/renderer/architecture-structure-extractor.ts";
import { extractAndVerifyOracleRequirements } from "../../src/adapters/extractors/syson-requirements-extractor.ts";
import {
  type OracleRequirement,
  renderTargetedOracleRequirementsSysml,
} from "../../src/domain/kernel/proof-case.ts";
import {
  type ArchitectureProposal,
  renderArchitectureSysmlWithManifest,
} from "../../src/domain/architecture/renderer/architecture-proposal.ts";

const SYSON_ENDPOINT = "http://127.0.0.1:3009/mcp";
const PROJECT_NAME_PREFIX = "admission-syson-smoke-";
const MODEL_NAME = "AdmissionSmokeModel";
const PACKAGE_NAME = "GenericSupport";
const SYSTEM_NAME = "GenericSupportSystem";
const COMPONENT_NAME = "SupportBlock";
const USAGE_NAME = "supportBlock";
const DISPLACEMENT_REQUIREMENT: OracleRequirement = Object.freeze({
  id: "support_block_max_displacement",
  name: "SupportBlock maximum displacement limit",
  metric: "support_block_max_displacement",
  operator: "<=",
  limit: Object.freeze({ value: 2, unit: "mm" }),
});
// The production renderer only admits live-qualified pressure unit Pa. This is
// exactly 100 MPa, but the native round-trip remains honestly recorded as Pa.
const VON_MISES_REQUIREMENT: OracleRequirement = Object.freeze({
  id: "support_block_max_von_mises",
  name: "SupportBlock maximum von Mises stress limit",
  metric: "support_block_max_von_mises",
  operator: "<=",
  limit: Object.freeze({ value: 100_000_000, unit: "Pa" }),
});
const REQUIREMENTS: readonly OracleRequirement[] = Object.freeze([
  DISPLACEMENT_REQUIREMENT,
  VON_MISES_REQUIREMENT,
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ARCHITECTURE: ArchitectureProposal = Object.freeze({
  packageName: PACKAGE_NAME,
  system: Object.freeze({ name: SYSTEM_NAME }),
  components: Object.freeze([Object.freeze({
    name: COMPONENT_NAME,
    usageName: USAGE_NAME,
    parentName: SYSTEM_NAME,
  })]),
});

export interface SysonSmokeCompiledInput {
  readonly architecture: ArchitectureProposal;
  readonly requirements: readonly OracleRequirement[];
}

const DEFAULT_COMPILED_INPUT: SysonSmokeCompiledInput = Object.freeze({
  architecture: ARCHITECTURE,
  requirements: REQUIREMENTS,
});

export interface SysonSmokeProjectIdentity {
  readonly id: string;
  readonly name: string;
  readonly editingContextId: string;
}

export interface SysonSmokeArchitectureEvidence {
  readonly documentId: string;
  readonly documentName: string;
  readonly rootPackageId: string;
  readonly rootPackageLabel: string;
  readonly architecturePackageId: string;
  readonly systemPartDefinitionId: string;
  readonly supportBlockPartDefinitionId: string;
  readonly supportBlockPartUsageId: string;
  readonly supportBlockPartUsageTargetId: string;
}

export interface SysonSmokeRequirementEvidence {
  readonly requirementUsageId: string;
  readonly subjectReferenceUsageId: string;
  readonly subjectTargetPartDefinitionId: string;
  readonly criteria: readonly SysonSmokeRequirementCriterionEvidence[];
}

export interface SysonSmokeRequirementCriterionEvidence {
  readonly constraintUsageId: string;
  readonly requirementId: string;
  readonly metric: string;
  readonly operator: "<=";
  readonly limitValue: number;
  readonly unit: "mm" | "Pa";
}

export interface SysonSmokeUntrustedProjectIdentity {
  readonly expectedName: string;
  readonly returnedId?: string;
  readonly returnedName?: string;
  readonly returnedEditingContextId?: string;
}

export type SysonSmokeCleanup =
  | {
    readonly status: "not-created";
    readonly deleteAttempts: 0;
    readonly preReadVerified: false;
    readonly postconditionVerified: false;
  }
  | {
    readonly status: "create-dispatched-identity-untrusted";
    readonly outcome: "unknown";
    readonly deleteAttempts: 0;
    readonly preReadVerified: false;
    readonly postconditionVerified: false;
    readonly residualIdentity: SysonSmokeUntrustedProjectIdentity;
    readonly message: string;
  }
  | {
    readonly status: "deleted-and-absent";
    readonly deleteAttempts: 1;
    readonly preReadVerified: true;
    readonly postconditionVerified: true;
  }
  | {
    readonly status: "failed";
    readonly deleteAttempts: 0 | 1;
    readonly preReadVerified: boolean;
    readonly postconditionVerified: false;
    readonly residualIdentity: SysonSmokeProjectIdentity;
    readonly message: string;
  };

export interface SysonSmokeResult {
  readonly schemaVersion: "syson-native-smoke/0.1";
  readonly status: "passed" | "failed";
  readonly endpoint: typeof SYSON_ENDPOINT;
  readonly projectName: string;
  readonly project?: SysonSmokeProjectIdentity;
  readonly architecture?: SysonSmokeArchitectureEvidence;
  readonly requirement?: SysonSmokeRequirementEvidence;
  readonly failure?: {
    readonly phase: "native-smoke" | "cleanup";
    readonly message: string;
  };
  readonly cleanup: SysonSmokeCleanup;
}

/**
 * Exact provider identities that downstream smoke work may consume while the
 * ephemeral SysON project still exists.
 */
export interface EphemeralSysonAnchor {
  readonly project: SysonSmokeProjectIdentity;
  readonly architecture: SysonSmokeArchitectureEvidence;
  readonly requirements: SysonSmokeRequirementEvidence;
}

export type EphemeralSysonAnchorConsumer<T> = (
  anchor: EphemeralSysonAnchor,
) => T | Promise<T>;

export interface EphemeralSysonAnchorRun<T> {
  readonly result: SysonSmokeResult;
  /** Present only when both the consumer and the mandatory cleanup succeeded. */
  readonly useResult?: T;
}

export interface SysonSmokeTestSeam {
  /** Test-only transport seam. The production entry point always uses localhost. */
  readonly client: McpToolClient;
  /** Test-only deterministic UUID seam. */
  readonly uuid: string;
}

/**
 * Execute one bounded smoke. No retries are performed, including cleanup.
 *
 * The optional argument is deliberately a test seam, not a caller-facing
 * provider API: the executable entry point accepts no command-line arguments.
 */
export async function runSysonSmoke(
  testSeam?: SysonSmokeTestSeam,
): Promise<SysonSmokeResult> {
  return (await withEphemeralSysonAnchor(
    () => undefined,
    DEFAULT_COMPILED_INPUT,
    testSeam,
  )).result;
}

/**
 * Establish a native SysON anchor, invoke one bounded consumer before cleanup,
 * then prove deletion. Consumer failure never skips cleanup. A cleanup failure
 * suppresses the consumer value so callers cannot treat the run as admitted.
 */
export async function withEphemeralSysonAnchor<T>(
  use: EphemeralSysonAnchorConsumer<T>,
  compiledInput: SysonSmokeCompiledInput,
  testSeam?: SysonSmokeTestSeam,
): Promise<EphemeralSysonAnchorRun<T>> {
  const admittedInput = validateCompiledInput(compiledInput);
  const client = testSeam?.client ?? new HttpMcpToolClient({
    mcpUrl: SYSON_ENDPOINT,
    timeoutMs: 60_000,
  });
  const uuid = testSeam?.uuid ?? crypto.randomUUID();
  if (!UUID.test(uuid)) {
    throw new TypeError("The SysON smoke UUID seam must be an exact UUID.");
  }

  const projectName = `${PROJECT_NAME_PREFIX}${uuid}`;
  let project: SysonSmokeProjectIdentity | undefined;
  let architecture: SysonSmokeArchitectureEvidence | undefined;
  let requirement: SysonSmokeRequirementEvidence | undefined;
  let smokeFailure: string | undefined;
  let useResult: T | undefined;
  let useSucceeded = false;
  let createDispatched = false;
  let createResponse: Readonly<Record<string, unknown>> | undefined;

  try {
    createDispatched = true;
    const created = await client.callTool({
      name: "syson_project_create",
      arguments: { name: projectName },
    });
    const createdResponse = created.structuredContent;
    createResponse = createdResponse;
    project = parseCreatedProject(createdResponse, projectName);

    const readback = await client.callTool({
      name: "syson_project_get",
      arguments: { project_id: project.id },
    });
    assertProjectReadback(readback.structuredContent, project);

    const model = await client.callTool({
      name: "syson_model_create",
      arguments: {
        editing_context_id: project.editingContextId,
        name: MODEL_NAME,
        create_root_package: true,
      },
    });
    const root = parseCreatedModel(model.structuredContent);

    const rootReadback = await client.callTool({
      name: "syson_element_get",
      arguments: {
        editing_context_id: project.editingContextId,
        element_id: root.id,
      },
    });
    assertRootReadback(rootReadback.structuredContent, root);

    const rendered = renderArchitectureSysmlWithManifest(
      admittedInput.architecture,
    );
    const inserted = await client.callTool({
      name: "syson_element_insert_sysml",
      arguments: {
        editing_context_id: project.editingContextId,
        parent_id: root.id,
        sysml_text: rendered.sourceText,
      },
    });
    assertInsertAcknowledgement(
      inserted.structuredContent,
      root.id,
      rendered.sourceText,
    );

    const structure = await extractArchitectureStructure(
      client,
      project.editingContextId,
      root.id,
      admittedInput.architecture.packageName,
    );
    architecture = assertExactArchitecture(
      structure,
      root,
      admittedInput.architecture,
    );
    requirement = await insertAndVerifySupportBlockRequirement(
      client,
      project.editingContextId,
      architecture.supportBlockPartDefinitionId,
      admittedInput.architecture.components[0]!.name,
      admittedInput.requirements,
    );
    const anchor: EphemeralSysonAnchor = Object.freeze({
      project,
      architecture,
      requirements: requirement,
    });
    useResult = await use(anchor);
    useSucceeded = true;
  } catch (error) {
    smokeFailure = errorMessage(error);
  }

  const cleanup = project
    ? await cleanEphemeralProject(client, project)
    : createDispatched
    ? untrustedCreateCleanup(projectName, createResponse, smokeFailure)
    : {
      status: "not-created",
      deleteAttempts: 0,
      preReadVerified: false,
      postconditionVerified: false,
    } as const;

  const cleanupFailure = cleanup.status === "failed" ||
      cleanup.status === "create-dispatched-identity-untrusted"
    ? cleanup.message
    : undefined;
  const failed = smokeFailure !== undefined || cleanupFailure !== undefined;

  const failure = failed
    ? cleanupFailure
      ? {
        phase: "cleanup" as const,
        message: smokeFailure
          ? `Native smoke or anchor consumer failed: ${smokeFailure}; cleanup also failed: ${cleanupFailure}`
          : cleanupFailure,
      }
      : { phase: "native-smoke" as const, message: smokeFailure! }
    : undefined;

  const result: SysonSmokeResult = {
    schemaVersion: "syson-native-smoke/0.1",
    status: failed ? "failed" : "passed",
    endpoint: SYSON_ENDPOINT,
    projectName,
    ...(project ? { project } : {}),
    ...(architecture ? { architecture } : {}),
    ...(requirement ? { requirement } : {}),
    ...(failure ? { failure } : {}),
    cleanup,
  };
  return Object.freeze({
    result: Object.freeze(result),
    ...(!failed && useSucceeded ? { useResult } : {}),
  });
}

function validateCompiledInput(value: unknown): SysonSmokeCompiledInput {
  if (!isRecord(value)) {
    throw new TypeError("SysON compiled input must be an exact object.");
  }
  exactKeys(value, ["architecture", "requirements"], "SysON compiled input");
  if (!isRecord(value.architecture)) {
    throw new TypeError("SysON compiled input architecture must be an exact object.");
  }
  const architecture = value.architecture;
  exactKeys(
    architecture,
    ["packageName", "system", "components"],
    "SysON compiled input architecture",
  );
  if (!isRecord(architecture.system)) {
    throw new TypeError("SysON compiled input architecture.system must be an object.");
  }
  exactKeys(
    architecture.system,
    ["name"],
    "SysON compiled input architecture.system",
  );
  if (!Array.isArray(architecture.components) || architecture.components.length !== 1) {
    throw new TypeError(
      "SysON compiled input must contain exactly one bounded SupportBlock component.",
    );
  }
  const component = architecture.components[0];
  if (!isRecord(component)) {
    throw new TypeError("SysON compiled input component must be an exact object.");
  }
  exactKeys(
    component,
    ["name", "usageName", "parentName"],
    "SysON compiled input component",
  );
  const packageName = nonEmptyString(
    architecture.packageName,
    "SysON compiled input architecture.packageName",
  );
  const systemName = nonEmptyString(
    architecture.system.name,
    "SysON compiled input architecture.system.name",
  );
  const componentName = nonEmptyString(
    component.name,
    "SysON compiled input component.name",
  );
  const usageName = nonEmptyString(
    component.usageName,
    "SysON compiled input component.usageName",
  );
  const parentName = nonEmptyString(
    component.parentName,
    "SysON compiled input component.parentName",
  );
  if (
    packageName !== PACKAGE_NAME || systemName !== SYSTEM_NAME ||
    componentName !== COMPONENT_NAME || usageName !== USAGE_NAME ||
    parentName !== SYSTEM_NAME
  ) {
    throw new TypeError(
      "SysON compiled input architecture is outside the bounded GenericSupport/SupportBlock profile.",
    );
  }

  if (!Array.isArray(value.requirements) || value.requirements.length !== 2) {
    throw new TypeError(
      "SysON compiled input must contain exactly two bounded mechanical requirements.",
    );
  }
  const expectedRequirements = [
    DISPLACEMENT_REQUIREMENT,
    VON_MISES_REQUIREMENT,
  ] as const;
  const requirements = value.requirements.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new TypeError(
        `SysON compiled input requirements[${index}] must be an exact object.`,
      );
    }
    exactKeys(
      candidate,
      ["id", "name", "metric", "operator", "limit"],
      `SysON compiled input requirements[${index}]`,
    );
    const id = nonEmptyString(
      candidate.id,
      `SysON compiled input requirements[${index}].id`,
    );
    const name = nonEmptyString(
      candidate.name,
      `SysON compiled input requirements[${index}].name`,
    );
    const metric = nonEmptyString(
      candidate.metric,
      `SysON compiled input requirements[${index}].metric`,
    );
    if (!isRecord(candidate.limit)) {
      throw new TypeError(
        `SysON compiled input requirements[${index}].limit must be an exact object.`,
      );
    }
    exactKeys(
      candidate.limit,
      ["value", "unit"],
      `SysON compiled input requirements[${index}].limit`,
    );
    const limitValue = candidate.limit.value;
    const limitUnit = nonEmptyString(
      candidate.limit.unit,
      `SysON compiled input requirements[${index}].limit.unit`,
    );
    const operator = candidate.operator;
    const expected = expectedRequirements[index]!;
    if (
      id !== expected.id || name !== expected.name || metric !== expected.metric ||
      operator !== expected.operator ||
      limitValue !== expected.limit.value || limitUnit !== expected.limit.unit
    ) {
      throw new TypeError(
        `SysON compiled input requirements[${index}] is outside the ordered bounded mechanical profile.`,
      );
    }
    return Object.freeze({
      id,
      name,
      metric,
      operator: operator as OracleRequirement["operator"],
      limit: Object.freeze({
        value: limitValue,
        unit: limitUnit,
      }),
    });
  });

  return Object.freeze({
    architecture: Object.freeze({
      packageName,
      system: Object.freeze({ name: systemName }),
      components: Object.freeze([Object.freeze({
        name: componentName,
        usageName,
        parentName,
      })]),
    }),
    requirements: Object.freeze(requirements),
  });
}

async function cleanEphemeralProject(
  client: McpToolClient,
  identity: SysonSmokeProjectIdentity,
): Promise<SysonSmokeCleanup> {
  // A failed or mismatched pre-read cannot authorize an irreversible delete.
  try {
    const beforeDelete = await client.callTool({
      name: "syson_project_get",
      arguments: { project_id: identity.id },
    });
    assertProjectReadback(beforeDelete.structuredContent, identity);
  } catch (error) {
    return cleanupFailure(
      identity,
      0,
      false,
      `Cleanup pre-read did not prove the exact project identity; no delete was dispatched: ${
        errorMessage(error)
      }`,
    );
  }

  // Exactly one irreversible call. Any error after dispatch is outcome-unknown;
  // this runner never retries it.
  try {
    const deleted = await client.callTool({
      name: "syson_project_delete",
      arguments: { project_id: identity.id },
    });
    assertDeleteAcknowledgement(deleted.structuredContent, identity.id);
  } catch (error) {
    return cleanupFailure(
      identity,
      1,
      true,
      `The single delete attempt failed or is outcome-unknown; do not retry automatically: ${
        errorMessage(error)
      }`,
    );
  }

  try {
    const listed = await client.callTool({
      name: "syson_project_list",
      arguments: { filter: identity.name, first: 5 },
    });
    assertProjectAbsent(listed.structuredContent, identity);
  } catch (error) {
    return cleanupFailure(
      identity,
      1,
      true,
      `Delete was acknowledged but the filtered absence postcondition was not proven: ${
        errorMessage(error)
      }`,
    );
  }

  return {
    status: "deleted-and-absent",
    deleteAttempts: 1,
    preReadVerified: true,
    postconditionVerified: true,
  };
}

function parseCreatedProject(
  value: Readonly<Record<string, unknown>>,
  expectedName: string,
): SysonSmokeProjectIdentity {
  exactKeys(value, ["id", "name", "editingContextId"], "syson_project_create");
  const id = nonEmptyString(value.id, "syson_project_create.id");
  if (!UUID.test(id)) {
    throw new TypeError(
      "syson_project_create.id must be a UUID safe for exact cleanup.",
    );
  }
  const name = nonEmptyString(value.name, "syson_project_create.name");
  const editingContextId = nonEmptyString(
    value.editingContextId,
    "syson_project_create.editingContextId",
  );
  if (name !== expectedName) {
    throw new TypeError(
      "syson_project_create.name did not preserve the UUID project name.",
    );
  }
  return Object.freeze({ id, name, editingContextId });
}

function assertProjectReadback(
  value: Readonly<Record<string, unknown>>,
  expected: SysonSmokeProjectIdentity,
): void {
  exactKeys(
    value,
    ["id", "name", "natures", "editingContextId"],
    "syson_project_get",
  );
  if (
    value.id !== expected.id || value.name !== expected.name ||
    value.editingContextId !== expected.editingContextId ||
    !Array.isArray(value.natures)
  ) {
    throw new TypeError("syson_project_get did not return the exact created identity.");
  }
}

function parseCreatedModel(
  value: Readonly<Record<string, unknown>>,
): {
  readonly documentId: string;
  readonly documentName: string;
  readonly id: string;
  readonly label: string;
} {
  exactKeys(
    value,
    ["documentId", "documentName", "documentKind", "rootPackageId", "rootPackageLabel"],
    "syson_model_create",
  );
  const documentId = nonEmptyString(
    value.documentId,
    "syson_model_create.documentId",
  );
  const documentName = nonEmptyString(
    value.documentName,
    "syson_model_create.documentName",
  );
  nonEmptyString(value.documentKind, "syson_model_create.documentKind");
  const rootPackageLabel = nonEmptyString(
    value.rootPackageLabel,
    "syson_model_create.rootPackageLabel",
  );
  return Object.freeze({
    documentId,
    documentName,
    id: nonEmptyString(value.rootPackageId, "syson_model_create.rootPackageId"),
    label: rootPackageLabel,
  });
}

function assertRootReadback(
  value: Readonly<Record<string, unknown>>,
  expected: { readonly id: string; readonly label: string },
): void {
  exactKeys(value, ["id", "kind", "label", "iconURLs"], "syson_element_get");
  if (
    value.id !== expected.id || value.label !== expected.label ||
    typeof value.kind !== "string" || !value.kind.includes("Package") ||
    !Array.isArray(value.iconURLs)
  ) {
    throw new TypeError(
      "syson_element_get did not return the exact created root Package.",
    );
  }
}

function assertInsertAcknowledgement(
  value: Readonly<Record<string, unknown>>,
  parentId: string,
  sourceText: string,
): void {
  exactKeys(value, ["inserted", "parentId", "text"], "syson_element_insert_sysml");
  if (
    value.inserted !== true || value.parentId !== parentId || value.text !== sourceText
  ) {
    throw new TypeError(
      "syson_element_insert_sysml did not acknowledge the exact rendered bytes.",
    );
  }
}

function assertExactArchitecture(
  structure: Awaited<ReturnType<typeof extractArchitectureStructure>>,
  model: {
    readonly documentId: string;
    readonly documentName: string;
    readonly id: string;
    readonly label: string;
  },
  expected: ArchitectureProposal,
): SysonSmokeArchitectureEvidence {
  if (!structure || structure.packageLabel !== expected.packageName) {
    throw new TypeError("SysON readback is missing the exact architecture package.");
  }
  if (structure.partDefs.length !== 2) {
    throw new TypeError("SysON readback must contain exactly two PartDefinitions.");
  }
  const expectedComponent = expected.components[0]!;
  const system = structure.partDefs.find((part) => part.label === expected.system.name);
  const support = structure.partDefs.find((part) =>
    part.label === expectedComponent.name
  );
  if (
    !system || !support || support.usages.length !== 0 || system.usages.length !== 1
  ) {
    throw new TypeError(
      "SysON readback does not match GenericSupportSystem/SupportBlock.",
    );
  }
  const usage = system.usages[0]!;
  const usageId = nonEmptyString(usage.id, "SysON SupportBlock PartUsage id");
  const usageTargetId = nonEmptyString(
    usage.targetId,
    "SysON SupportBlock FeatureTyping target id",
  );
  if (
    usage.label !== expectedComponent.usageName || usageTargetId !== support.id ||
    usage.targetLabel !== expectedComponent.name
  ) {
    throw new TypeError(
      "The SupportBlock PartUsage is not typed by the exact SupportBlock ID.",
    );
  }
  const ids = [structure.packageId, system.id, support.id, usageId];
  if (ids.some((id) => id.trim() === "") || new Set(ids).size !== ids.length) {
    throw new TypeError(
      "SysON architecture identities must be non-empty and pairwise distinct.",
    );
  }
  return Object.freeze({
    documentId: model.documentId,
    documentName: model.documentName,
    rootPackageId: model.id,
    rootPackageLabel: model.label,
    architecturePackageId: structure.packageId,
    systemPartDefinitionId: system.id,
    supportBlockPartDefinitionId: support.id,
    supportBlockPartUsageId: usageId,
    supportBlockPartUsageTargetId: usageTargetId,
  });
}

async function insertAndVerifySupportBlockRequirement(
  client: McpToolClient,
  editingContextId: string,
  supportBlockPartDefinitionId: string,
  componentName: string,
  requirements: readonly OracleRequirement[],
): Promise<SysonSmokeRequirementEvidence> {
  const requirementName = `${componentName}Requirements`;
  const sourceText = renderTargetedOracleRequirementsSysml(
    requirementName,
    componentName,
    requirements,
  );
  const inserted = await client.callTool({
    name: "syson_element_insert_sysml",
    arguments: {
      editing_context_id: editingContextId,
      parent_id: supportBlockPartDefinitionId,
      sysml_text: sourceText,
    },
  });
  assertInsertAcknowledgement(
    inserted.structuredContent,
    supportBlockPartDefinitionId,
    sourceText,
  );

  const targetChildren = parseProviderChildren(
    (await client.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: supportBlockPartDefinitionId,
      },
    })).structuredContent,
    supportBlockPartDefinitionId,
  );
  const requirementUsages = targetChildren.filter((child) =>
    child.label === requirementName && isEntityKind(child.kind, "RequirementUsage")
  );
  if (requirementUsages.length !== 1) {
    throw new TypeError(
      "SysON readback must contain exactly one named SupportBlock RequirementUsage under the exact SupportBlock PartDefinition.",
    );
  }
  const requirementUsageId = nonEmptyString(
    requirementUsages[0]!.id,
    "SysON SupportBlock RequirementUsage id",
  );

  const requirementReadback = (await client.callTool({
    name: "syson_element_get",
    arguments: {
      editing_context_id: editingContextId,
      element_id: requirementUsageId,
    },
  })).structuredContent;
  if (
    requirementReadback.id !== requirementUsageId ||
    requirementReadback.label !== requirementName ||
    !isEntityKind(requirementReadback.kind, "RequirementUsage")
  ) {
    throw new TypeError(
      "SysON did not read back the exact SupportBlock RequirementUsage identity.",
    );
  }

  const members = parseProviderChildren(
    (await client.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: requirementUsageId,
      },
    })).structuredContent,
    requirementUsageId,
  );
  const subjects = members.filter((child) =>
    child.label === "target" && isEntityKind(child.kind, "ReferenceUsage")
  );
  const attributes = members.filter((child) =>
    isEntityKind(child.kind, "AttributeUsage")
  );
  const constraints = members.filter((child) =>
    isEntityKind(child.kind, "ConstraintUsage")
  );
  if (
    subjects.length !== 1 || attributes.length !== requirements.length ||
    constraints.length !== requirements.length
  ) {
    throw new TypeError(
      "The SupportBlock RequirementUsage must contain exactly one target subject and exactly two attributes and required constraints.",
    );
  }
  const subjectReferenceUsageId = nonEmptyString(
    subjects[0]!.id,
    "SysON requirement subject ReferenceUsage id",
  );
  const criteria = requirements.map((canonical) => {
    const attributeMatches = attributes.filter((child) =>
      child.label === canonical.metric
    );
    const constraintMatches = constraints.filter((child) =>
      child.label === `${canonical.id}_limit`
    );
    if (attributeMatches.length !== 1 || constraintMatches.length !== 1) {
      throw new TypeError(
        `SysON members do not contain the exact attribute and ConstraintUsage for metric "${canonical.metric}".`,
      );
    }
    return Object.freeze({
      constraintUsageId: nonEmptyString(
        constraintMatches[0]!.id,
        `SysON ${canonical.metric} ConstraintUsage id`,
      ),
      requirementId: canonical.id,
      metric: canonical.metric,
      operator: "<=" as const,
      limitValue: canonical.limit.value,
      unit: canonical.limit.unit as "mm" | "Pa",
    });
  });

  const typing = (await client.callTool({
    name: "syson_query_aql",
    arguments: {
      editing_context_id: editingContextId,
      object_id: subjectReferenceUsageId,
      expression: ARCHITECTURE_FEATURE_TYPING_AQL,
    },
  })).structuredContent;
  if (
    typing.objectId !== subjectReferenceUsageId ||
    typing.expression !== ARCHITECTURE_FEATURE_TYPING_AQL ||
    typing.type !== "objects" || typing.count !== 1 ||
    !Array.isArray(typing.results) || typing.results.length !== 1 ||
    !isExactPartDefinition(
      typing.results[0],
      supportBlockPartDefinitionId,
      componentName,
    )
  ) {
    throw new TypeError(
      "The requirement subject is not typed by the exact read-back SupportBlock PartDefinition ID.",
    );
  }

  await extractAndVerifyOracleRequirements(
    client,
    editingContextId,
    requirementUsageId,
    requirements,
  );

  return Object.freeze({
    requirementUsageId,
    subjectReferenceUsageId,
    subjectTargetPartDefinitionId: supportBlockPartDefinitionId,
    criteria: Object.freeze(criteria),
  });
}

function parseProviderChildren(
  value: unknown,
  expectedParentId: string,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!isRecord(value)) {
    throw new TypeError("syson_element_children returned a non-object response.");
  }
  if (
    value.parentId !== expectedParentId || !Array.isArray(value.children) ||
    !Number.isSafeInteger(value.count) || value.count !== value.children.length
  ) {
    throw new TypeError(
      "syson_element_children did not echo the exact parent and child count.",
    );
  }
  return value.children.map((child, index) => {
    if (!isRecord(child)) {
      throw new TypeError(`syson_element_children child[${index}] is not an object.`);
    }
    nonEmptyString(child.id, `syson_element_children child[${index}].id`);
    nonEmptyString(child.kind, `syson_element_children child[${index}].kind`);
    if (typeof child.label !== "string") {
      throw new TypeError(
        `syson_element_children child[${index}].label must be a string.`,
      );
    }
    return child;
  });
}

function isEntityKind(value: unknown, entity: string): boolean {
  return typeof value === "string" &&
    (value === entity || value.endsWith(`entity=${entity}`));
}

function isExactPartDefinition(
  value: unknown,
  expectedId: string,
  expectedLabel: string,
): boolean {
  return isRecord(value) && value.id === expectedId &&
    value.label === expectedLabel && isEntityKind(value.kind, "PartDefinition");
}

function assertDeleteAcknowledgement(
  value: Readonly<Record<string, unknown>>,
  projectId: string,
): void {
  exactKeys(value, ["deleted", "projectId"], "syson_project_delete");
  if (value.deleted !== true || value.projectId !== projectId) {
    throw new TypeError(
      "syson_project_delete did not confirm the exact project identity.",
    );
  }
}

function assertProjectAbsent(
  value: Readonly<Record<string, unknown>>,
  identity: SysonSmokeProjectIdentity,
): void {
  exactKeys(value, ["projects", "pageInfo"], "syson_project_list");
  if (!Array.isArray(value.projects) || !isRecord(value.pageInfo)) {
    throw new TypeError(
      "syson_project_list returned an unexpected postcondition shape.",
    );
  }
  const pageInfo = value.pageInfo;
  if (
    typeof pageInfo.count !== "number" ||
    pageInfo.count !== value.projects.length ||
    typeof pageInfo.hasNextPage !== "boolean" || pageInfo.hasNextPage
  ) {
    throw new TypeError(
      "syson_project_list did not return one complete filtered postcondition page.",
    );
  }
  for (const [index, candidate] of value.projects.entries()) {
    if (!isRecord(candidate)) {
      throw new TypeError(`syson_project_list.projects[${index}] is not an object.`);
    }
    exactKeys(
      candidate,
      ["id", "name", "natures"],
      `syson_project_list.projects[${index}]`,
    );
    nonEmptyString(candidate.id, `syson_project_list.projects[${index}].id`);
    nonEmptyString(candidate.name, `syson_project_list.projects[${index}].name`);
    if (!Array.isArray(candidate.natures)) {
      throw new TypeError(
        `syson_project_list.projects[${index}].natures is not an array.`,
      );
    }
  }
  if (
    value.projects.some((candidate) =>
      (candidate as Readonly<Record<string, unknown>>).id === identity.id ||
      (candidate as Readonly<Record<string, unknown>>).name === identity.name
    )
  ) {
    throw new TypeError("The ephemeral project is still visible after delete.");
  }
}

function cleanupFailure(
  residualIdentity: SysonSmokeProjectIdentity,
  deleteAttempts: 0 | 1,
  preReadVerified: boolean,
  message: string,
): SysonSmokeCleanup {
  return {
    status: "failed",
    deleteAttempts,
    preReadVerified,
    postconditionVerified: false,
    residualIdentity,
    message,
  };
}

function untrustedCreateCleanup(
  expectedName: string,
  response: Readonly<Record<string, unknown>> | undefined,
  failure: string | undefined,
): SysonSmokeCleanup {
  const returnedId = optionalNonEmptyString(response?.id);
  const returnedName = optionalNonEmptyString(response?.name);
  const returnedEditingContextId = optionalNonEmptyString(
    response?.editingContextId,
  );
  return {
    status: "create-dispatched-identity-untrusted",
    outcome: "unknown",
    deleteAttempts: 0,
    preReadVerified: false,
    postconditionVerified: false,
    residualIdentity: {
      expectedName,
      ...(returnedId ? { returnedId } : {}),
      ...(returnedName ? { returnedName } : {}),
      ...(returnedEditingContextId ? { returnedEditingContextId } : {}),
    },
    message:
      "syson_project_create was dispatched but no exact trusted cleanup identity was established; no delete was dispatched and manual inspection is required" +
      (failure ? `: ${failure}` : "."),
  };
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(`${path} returned unexpected keys: ${actual.join(", ")}.`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  const result = await runSysonSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") Deno.exitCode = 1;
}
