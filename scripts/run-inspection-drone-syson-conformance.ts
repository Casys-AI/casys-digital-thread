import {
  INSPECTION_DRONE_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
  requireEmptyInspectionDroneArchitectureRoot,
  validateInspectionDroneArchitectureInsertion,
  validateInspectionDroneArchitectureReadback,
} from "../src/domain/inspection-drone-architecture.ts";
import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../src/adapters/http-mcp-tool-client.ts";

/**
 * A deliberately opt-in parser/translator check for the reviewed r3 SysML
 * fragment. This is not part of the normal test suite: an actual invocation
 * creates a disposable SysON project and performs one bounded insertion.
 *
 * Default (safe, no MCP client is instantiated):
 *
 *   deno run scripts/run-inspection-drone-syson-conformance.ts
 *
 * A future, separately authorized invocation must provide all three
 * acknowledgements below. The resulting report says only whether the deployed
 * provider accepted and exposed the fixed syntax; it never certifies a drone,
 * CAD model, physics, cost, compliance, or flight behaviour.
 */

const ACKNOWLEDGEMENT = "CREATE_DISPOSABLE_SYSON_PROJECT";
const DISPOSABLE_PREFIX = /^disposable-[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;
const PROJECT_NAME_SUFFIX = /^[a-z0-9]{8,32}$/;
const MODEL_NAME = "InspectionDroneArchitectureConformance";
const ROOT_PACKAGE_NAME = "InspectionDroneArchitectureConformanceRoot";

const PART_USAGE_LABELS = [
  "airframe",
  "energy",
  "propulsion",
  "avionicsAndFlightControl",
  "cameraPayload",
] as const;

const REQUIREMENT_LABELS = [
  "controlledVisualInspection",
  "cameraPayloadProvision",
  "modifiableArchitecture",
  "evidenceDrivenVerification",
] as const;

export type InspectionDroneSysonConformanceStatus =
  | "confirmation-required"
  | "passed"
  | "inconclusive";

export interface InspectionDroneSysonConformanceReport {
  readonly schemaVersion: "inspection-drone-syson-conformance/1.0";
  readonly status: InspectionDroneSysonConformanceStatus;
  readonly statement: string;
  readonly engineeringEvidence: "none";
  readonly fixedOperation: {
    readonly id: typeof INSPECTION_DRONE_ARCHITECTURE_OPERATION.id;
    readonly version: typeof INSPECTION_DRONE_ARCHITECTURE_OPERATION.version;
  };
  readonly requiredAcknowledgement: {
    readonly executeFlag: "--execute";
    readonly acknowledgement: `--acknowledge=${typeof ACKNOWLEDGEMENT}`;
    readonly disposablePrefix: "--disposable-project-prefix=disposable-...";
    readonly endpoint: "--mcp-url=http(s)://.../mcp";
  };
  readonly project?: {
    readonly name: string;
    readonly id: string;
  };
  readonly mutation: {
    readonly disposableProjectCreationAttempted: boolean;
    readonly modelCreationAttempted: boolean;
    readonly fixedRecipeInsertionAttempted: boolean;
    readonly fixedRecipeInsertionAcknowledged: boolean;
    readonly cleanup:
      "not-attempted; retain the disposable project for operator inspection";
  };
  readonly assertions: readonly string[];
  readonly nextStep: string;
  readonly failure?: string;
}

export interface RunInspectionDroneSysonConformanceOptions {
  readonly args?: readonly string[];
  /** Test seam only. Normal invocations construct the server-owned HTTP client. */
  readonly client?: McpToolClient;
  /** Test seam proving confirmation-required mode never constructs a client. */
  readonly createClient?: (mcpUrl: string) => McpToolClient;
  readonly now?: () => Date;
  /** Test seam only; this token is appended to an explicitly disposable prefix. */
  readonly uniqueSuffix?: () => string;
}

interface ParsedArguments {
  readonly execute: boolean;
  readonly acknowledgement: string | undefined;
  readonly disposableProjectPrefix: string | undefined;
  readonly mcpUrl: string | undefined;
}

interface ConfirmedRunArguments {
  readonly disposableProjectPrefix: string;
  readonly mcpUrl: string;
}

interface ProviderProject {
  readonly id: string;
  readonly name: string;
  readonly editingContextId: string;
}

interface ProviderModel {
  readonly documentId: string;
  readonly documentName: string;
  readonly documentKind: string;
  readonly rootPackageId: string;
}

interface ChildElement {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

/**
 * Run only when all explicit acknowledgement flags are present. In every
 * other case this returns a non-mutating explanation and does not construct
 * or call an MCP client.
 */
export async function runInspectionDroneSysonConformance(
  options: RunInspectionDroneSysonConformanceOptions = {},
): Promise<InspectionDroneSysonConformanceReport> {
  const parsed = parseArguments(options.args ?? Deno.args);
  const confirmed = confirmedArguments(parsed);
  if (!confirmed) return confirmationRequiredReport(parsed);

  const now = options.now ?? (() => new Date());
  const suffix = suffixToken(options.uniqueSuffix?.() ?? crypto.randomUUID());
  const projectName = `${confirmed.disposableProjectPrefix}-${
    timestampToken(now())
  }-${suffix}`;
  const mutation = {
    disposableProjectCreationAttempted: false,
    modelCreationAttempted: false,
    fixedRecipeInsertionAttempted: false,
    fixedRecipeInsertionAcknowledged: false,
    cleanup:
      "not-attempted; retain the disposable project for operator inspection" as const,
  };
  const assertions: string[] = [];
  let project: ProviderProject | undefined;
  const client = options.client ?? (options.createClient ?? createHttpClient)(
    confirmed.mcpUrl,
  );

  try {
    mutation.disposableProjectCreationAttempted = true;
    project = parseProject(
      (await client.callTool({
        name: "syson_project_create",
        arguments: { name: projectName },
      })).structuredContent,
      projectName,
    );
    assertions.push("A new explicitly disposable SysON project was acknowledged.");

    mutation.modelCreationAttempted = true;
    const model = parseModel(
      (await client.callTool({
        name: "syson_model_create",
        arguments: {
          editing_context_id: project.editingContextId,
          name: MODEL_NAME,
          create_root_package: true,
          root_package_name: ROOT_PACKAGE_NAME,
        },
      })).structuredContent,
      MODEL_NAME,
    );
    assertions.push("A new SysML model root was returned as a structured result.");

    const rootPreflight = await children(
      client,
      project.editingContextId,
      model.rootPackageId,
    );
    requireEmptyInspectionDroneArchitectureRoot({
      rootPackageId: model.rootPackageId,
      rootChildrenResult: rootPreflight,
    });
    assertions.push("The disposable model root was empty before the fixed insertion.");

    // This assignment intentionally happens before awaiting the write: a
    // transport failure after dispatch must never be reported as a clean no-op.
    mutation.fixedRecipeInsertionAttempted = true;
    const insertion = await client.callTool({
      name: "syson_element_insert_sysml",
      arguments: {
        editing_context_id: project.editingContextId,
        parent_id: model.rootPackageId,
        sysml_text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
      },
    });
    await validateInspectionDroneArchitectureInsertion({
      rootPackageId: model.rootPackageId,
      insertionResult: insertion.structuredContent,
    });
    mutation.fixedRecipeInsertionAcknowledged = true;
    assertions.push("SysON acknowledged the exact fixed r3 SysML recipe once.");

    const rootReadback = await children(
      client,
      project.editingContextId,
      model.rootPackageId,
    );
    const architecturePackage = onlyArchitecturePackage(
      model.rootPackageId,
      rootReadback,
    );
    const architectureReadback = await children(
      client,
      project.editingContextId,
      architecturePackage.id,
    );
    const readback = await validateInspectionDroneArchitectureReadback({
      rootPackageId: model.rootPackageId,
      insertionResult: insertion.structuredContent,
      rootChildrenResult: rootReadback,
      architectureChildrenResult: architectureReadback,
    });
    assertions.push(
      "The architecture package and its fixed direct declarations were read back with expected SysML kinds.",
    );

    const inspectionDrone = readback.declarations.find((element) =>
      element.label === "InspectionDrone"
    );
    const requirements = readback.declarations.find((element) =>
      element.label === "Requirements"
    );
    if (!inspectionDrone || !requirements) {
      throw new TypeError(
        "The fixed direct declaration set did not expose InspectionDrone and Requirements.",
      );
    }

    const partUsages = parseChildren(
      await children(client, project.editingContextId, inspectionDrone.id),
      inspectionDrone.id,
    );
    requireExactChildren(partUsages, PART_USAGE_LABELS, "PartUsage");
    assertions.push(
      "The InspectionDrone definition exposed five named PartUsage elements.",
    );

    const requirementUsages = parseChildren(
      await children(client, project.editingContextId, requirements.id),
      requirements.id,
    );
    requireExactChildren(requirementUsages, REQUIREMENT_LABELS, "RequirementUsage");
    assertions.push(
      "The Requirements package exposed four named RequirementUsage elements.",
    );

    return passedReport(project, mutation, assertions);
  } catch (error) {
    return inconclusiveReport(project, mutation, assertions, error);
  }
}

function createHttpClient(mcpUrl: string): McpToolClient {
  return new HttpMcpToolClient({ mcpUrl, timeoutMs: 30_000 });
}

function parseArguments(values: readonly string[]): ParsedArguments {
  let execute = false;
  let acknowledgement: string | undefined;
  let disposableProjectPrefix: string | undefined;
  let mcpUrl: string | undefined;
  for (const value of values) {
    if (value === "--execute") {
      execute = true;
      continue;
    }
    if (value.startsWith("--acknowledge=")) {
      acknowledgement = uniqueArgument(
        acknowledgement,
        value.slice("--acknowledge=".length),
        "--acknowledge",
      );
      continue;
    }
    if (value.startsWith("--disposable-project-prefix=")) {
      disposableProjectPrefix = uniqueArgument(
        disposableProjectPrefix,
        value.slice("--disposable-project-prefix=".length),
        "--disposable-project-prefix",
      );
      continue;
    }
    if (value.startsWith("--mcp-url=")) {
      mcpUrl = uniqueArgument(
        mcpUrl,
        value.slice("--mcp-url=".length),
        "--mcp-url",
      );
      continue;
    }
    throw new TypeError(`Unsupported argument: ${value}`);
  }
  return { execute, acknowledgement, disposableProjectPrefix, mcpUrl };
}

function confirmedArguments(
  parsed: ParsedArguments,
): ConfirmedRunArguments | undefined {
  if (
    !parsed.execute || parsed.acknowledgement !== ACKNOWLEDGEMENT ||
    !parsed.disposableProjectPrefix || !parsed.mcpUrl
  ) {
    return undefined;
  }
  if (!DISPOSABLE_PREFIX.test(parsed.disposableProjectPrefix)) {
    throw new TypeError(
      "--disposable-project-prefix must start with disposable- and contain only lowercase letters, digits, and hyphens.",
    );
  }
  const endpoint = new URL(parsed.mcpUrl);
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    endpoint.pathname !== "/mcp" || endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" || endpoint.hash !== "" || !isLoopbackHost(endpoint.hostname)
  ) {
    throw new TypeError(
      "--mcp-url must be a credential-free loopback http(s) URL ending exactly in /mcp; this harness cannot target a remote provider.",
    );
  }
  return {
    disposableProjectPrefix: parsed.disposableProjectPrefix,
    mcpUrl: endpoint.toString(),
  };
}

function confirmationRequiredReport(
  parsed: ParsedArguments,
): InspectionDroneSysonConformanceReport {
  const missing = [
    parsed.execute ? undefined : "--execute",
    parsed.acknowledgement === ACKNOWLEDGEMENT
      ? undefined
      : `--acknowledge=${ACKNOWLEDGEMENT}`,
    parsed.disposableProjectPrefix
      ? undefined
      : "--disposable-project-prefix=disposable-...",
    parsed.mcpUrl ? undefined : "--mcp-url=http(s)://.../mcp",
  ].filter((value): value is string => value !== undefined);
  return {
    schemaVersion: "inspection-drone-syson-conformance/1.0",
    status: "confirmation-required",
    statement:
      "No provider call was made. This harness is intentionally inert until a separately authorized disposable SysON conformance run is explicitly acknowledged.",
    engineeringEvidence: "none",
    fixedOperation: INSPECTION_DRONE_ARCHITECTURE_OPERATION,
    requiredAcknowledgement: acknowledgementInstructions(),
    mutation: noMutation(),
    assertions: [],
    nextStep: `To opt in after separate authorization, provide: ${missing.join(", ")}.`,
  };
}

function passedReport(
  project: ProviderProject,
  mutation: InspectionDroneSysonConformanceReport["mutation"],
  assertions: readonly string[],
): InspectionDroneSysonConformanceReport {
  return {
    schemaVersion: "inspection-drone-syson-conformance/1.0",
    status: "passed",
    statement:
      "The deployed SysON parser/translator accepted and exposed the fixed bounded r3 fragment in a disposable project. This is syntax and model-tree conformance only, not engineering evidence.",
    engineeringEvidence: "none",
    fixedOperation: INSPECTION_DRONE_ARCHITECTURE_OPERATION,
    requiredAcknowledgement: acknowledgementInstructions(),
    project: { id: project.id, name: project.name },
    mutation,
    assertions: [...assertions],
    nextStep:
      "Review the retained disposable project, then record the conformance decision separately before authorizing any production r3 run.",
  };
}

function inconclusiveReport(
  project: ProviderProject | undefined,
  mutation: InspectionDroneSysonConformanceReport["mutation"],
  assertions: readonly string[],
  error: unknown,
): InspectionDroneSysonConformanceReport {
  return {
    schemaVersion: "inspection-drone-syson-conformance/1.0",
    status: "inconclusive",
    statement:
      "The disposable SysON conformance sequence did not complete. It establishes no parser/translator pass and no engineering evidence.",
    engineeringEvidence: "none",
    fixedOperation: INSPECTION_DRONE_ARCHITECTURE_OPERATION,
    requiredAcknowledgement: acknowledgementInstructions(),
    ...(project ? { project: { id: project.id, name: project.name } } : {}),
    mutation,
    assertions: [...assertions],
    failure: error instanceof Error ? error.message : String(error),
    nextStep:
      "Do not retry against a production project. Inspect the retained disposable project and its provider state before any separately reviewed recovery or re-run.",
  };
}

function acknowledgementInstructions(): InspectionDroneSysonConformanceReport[
  "requiredAcknowledgement"
] {
  return {
    executeFlag: "--execute",
    acknowledgement: `--acknowledge=${ACKNOWLEDGEMENT}`,
    disposablePrefix: "--disposable-project-prefix=disposable-...",
    endpoint: "--mcp-url=http(s)://.../mcp",
  };
}

function noMutation(): InspectionDroneSysonConformanceReport["mutation"] {
  return {
    disposableProjectCreationAttempted: false,
    modelCreationAttempted: false,
    fixedRecipeInsertionAttempted: false,
    fixedRecipeInsertionAcknowledged: false,
    cleanup: "not-attempted; retain the disposable project for operator inspection",
  };
}

async function children(
  client: McpToolClient,
  editingContextId: string,
  elementId: string,
): Promise<Readonly<Record<string, unknown>>> {
  return (await client.callTool({
    name: "syson_element_children",
    arguments: {
      editing_context_id: editingContextId,
      element_id: elementId,
    },
  })).structuredContent;
}

function parseProject(value: unknown, expectedName: string): ProviderProject {
  const root = closedRecord(value, ["id", "name", "editingContextId"], "project");
  const project = {
    id: identifier(root.id, "project.id"),
    name: identifier(root.name, "project.name"),
    editingContextId: identifier(root.editingContextId, "project.editingContextId"),
  };
  if (project.name !== expectedName) {
    throw new TypeError(
      "project.name did not exactly match the disposable project name.",
    );
  }
  return project;
}

function parseModel(value: unknown, expectedName: string): ProviderModel {
  const root = closedRecord(
    value,
    [
      "documentId",
      "documentName",
      "documentKind",
      "rootPackageId",
      "rootPackageLabel",
    ],
    "model",
    ["rootPackageLabel"],
  );
  const model = {
    documentId: identifier(root.documentId, "model.documentId"),
    documentName: identifier(root.documentName, "model.documentName"),
    documentKind: identifier(root.documentKind, "model.documentKind"),
    rootPackageId: identifier(root.rootPackageId, "model.rootPackageId"),
  };
  if (model.documentName !== expectedName) {
    throw new TypeError(
      "model.documentName did not exactly match the fixed model name.",
    );
  }
  return model;
}

function onlyArchitecturePackage(
  rootPackageId: string,
  result: unknown,
): ChildElement {
  const children = parseChildren(result, rootPackageId);
  if (children.length !== 1) {
    throw new TypeError("The post-insert root must expose exactly one child.");
  }
  const architecture = children[0]!;
  if (
    architecture.label !== "InspectionDroneArchitecture" ||
    semanticKind(architecture.kind) !== "Package"
  ) {
    throw new TypeError(
      "The post-insert root child must be the InspectionDroneArchitecture SysML Package.",
    );
  }
  return architecture;
}

function parseChildren(value: unknown, expectedParentId: string): ChildElement[] {
  const root = closedRecord(value, ["parentId", "children", "count"], "children");
  if (root.parentId !== expectedParentId) {
    throw new TypeError("children.parentId did not exactly match the queried element.");
  }
  if (!Array.isArray(root.children)) {
    throw new TypeError("children.children must be an array.");
  }
  if (!Number.isSafeInteger(root.count) || root.count !== root.children.length) {
    throw new TypeError("children.count must exactly equal children.children.length.");
  }
  const children = root.children.map((value, index) => {
    const child = closedRecord(value, ["id", "kind", "label"], `children[${index}]`);
    return {
      id: identifier(child.id, `children[${index}].id`),
      kind: identifier(child.kind, `children[${index}].kind`),
      label: identifier(child.label, `children[${index}].label`),
    };
  });
  if (new Set(children.map((child) => child.id)).size !== children.length) {
    throw new TypeError("children.children must not contain duplicate IDs.");
  }
  return children;
}

function requireExactChildren(
  children: readonly ChildElement[],
  expectedLabels: readonly string[],
  expectedKind: "PartUsage" | "RequirementUsage",
): void {
  const labels = children.map((child) => child.label);
  if (
    labels.length !== expectedLabels.length ||
    new Set(labels).size !== labels.length ||
    expectedLabels.some((label) => !labels.includes(label))
  ) {
    throw new TypeError(
      `Expected exactly ${expectedLabels.join(", ")} as ${expectedKind} children.`,
    );
  }
  if (children.some((child) => semanticKind(child.kind) !== expectedKind)) {
    throw new TypeError(`Expected every named child to be a SysML ${expectedKind}.`);
  }
}

function semanticKind(
  value: string,
): "Package" | "PartUsage" | "RequirementUsage" | undefined {
  if (value === "sysml::Package") return "Package";
  if (value === "sysml::PartUsage") return "PartUsage";
  if (value === "sysml::RequirementUsage") return "RequirementUsage";
  try {
    const uri = new URL(value);
    if (
      uri.protocol !== "siriuscomponents:" || uri.hostname !== "semantic" ||
      uri.searchParams.get("domain") !== "sysml"
    ) {
      return undefined;
    }
    const entity = uri.searchParams.get("entity");
    return entity === "Package" || entity === "PartUsage" ||
        entity === "RequirementUsage"
      ? entity
      : undefined;
  } catch {
    return undefined;
  }
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const permitted = [...keys].sort();
  if (
    actual.some((key) => !permitted.includes(key)) ||
    keys.filter((key) => !optional.includes(key)).some((key) => !(key in record))
  ) {
    throw new TypeError(`${path} has an unexpected structured-result shape.`);
  }
  return record;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function timestampToken(value: Date): string {
  if (Number.isNaN(value.valueOf())) {
    throw new TypeError("now returned an invalid date.");
  }
  return value.toISOString().replace(/[-:.TZ]/g, "").toLowerCase();
}

function suffixToken(value: string): string {
  const normalized = value.replace(/-/g, "").toLowerCase();
  if (!PROJECT_NAME_SUFFIX.test(normalized)) {
    throw new TypeError("uniqueSuffix must contain 8-32 lowercase letters or digits.");
  }
  return normalized;
}

function uniqueArgument(
  existing: string | undefined,
  value: string,
  flag: string,
): string {
  if (existing !== undefined) throw new TypeError(`${flag} may appear only once.`);
  return value;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]";
}

if (import.meta.main) {
  const report = await runInspectionDroneSysonConformance();
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "inconclusive") Deno.exitCode = 1;
}
