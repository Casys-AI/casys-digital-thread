import type { McpToolCall, McpToolClient } from "./http-mcp-tool-client.ts";
import {
  SysonCoffeeMachineBuildObserver,
  type SysonCoffeeMachineBuildSourceCapture,
} from "./syson-coffee-machine-build-observer.ts";
import {
  type CoffeeMachineBuildComponent,
  type CoffeeMachineBuildPlan,
  type CoffeeMachineBuildTemplateId,
  type CoffeeMachineSourceUnitBinding,
  compileCoffeeMachineBuildPlan,
} from "../domain/coffee-machine-build-plan.ts";

export const COFFEE_MACHINE_BUILD_DECLARATION_SCHEMA =
  "coffee-machine-build-declaration/1.0" as const;
export const COFFEE_MACHINE_BUILD_RUN_SCHEMA = "coffee-machine-build-run/1.0" as const;

export interface CoffeeMachineBuildSourceBinding {
  /** Exact SysON AttributeUsage id. */
  id: string;
  unitBinding: CoffeeMachineSourceUnitBinding;
}

/**
 * Reviewed workspace declaration. Values deliberately do not belong here:
 * they are observed from the exact SysON identities for every run.
 */
export interface CoffeeMachineBuildDeclaration {
  schemaVersion: typeof COFFEE_MACHINE_BUILD_DECLARATION_SCHEMA;
  id: string;
  editingContextId: string;
  rootPartDefinitionId: string;
  partUsageIds: string[];
  sourceBindings: CoffeeMachineBuildSourceBinding[];
  envelopeMm: {
    min: [number, number, number];
    max: [number, number, number];
  };
  components: CoffeeMachineBuildComponent[];
}

export interface CoffeeMachineBuildExportFile {
  format: "step" | "gltf" | "stl";
  path: string;
  bytes: number;
  sha256: string;
}

export interface CoffeeMachineBuildExportResult {
  schemaVersion: "1.0";
  kind: "export";
  metrics: JsonObject;
  files: CoffeeMachineBuildExportFile[];
}

export interface CoffeeMachineBuildRunCapture {
  schemaVersion: typeof COFFEE_MACHINE_BUILD_RUN_SCHEMA;
  capturedAt: string;
  sourceCapture: SysonCoffeeMachineBuildSourceCapture;
  compiledPlan: {
    plan: CoffeeMachineBuildPlan;
    script: string;
  };
  toolCall: {
    name: "build123d_export";
    arguments: {
      script: string;
      formats: ["step", "gltf", "stl"];
      name: string;
      timeout_ms: 120000;
    };
  };
  result: CoffeeMachineBuildExportResult;
}

export interface CoffeeMachineBuildOrchestratorOptions {
  sysonClient: McpToolClient;
  build123dClient: McpToolClient;
  now?: () => Date;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

const DECLARATION_KEYS = [
  "schemaVersion",
  "id",
  "editingContextId",
  "rootPartDefinitionId",
  "partUsageIds",
  "sourceBindings",
  "envelopeMm",
  "components",
] as const;
const COMPONENT_KEYS = [
  "id",
  "partUsageId",
  "templateId",
  "bindings",
  "placement",
] as const;
const TEMPLATE_PARAMETERS: Record<CoffeeMachineBuildTemplateId, string[]> = {
  "enclosure-shell-v1": ["size_x", "size_y", "size_z", "wall_thickness"],
  "hollow-box-v1": ["size_x", "size_y", "size_z", "wall_thickness"],
  "solid-box-v1": ["size_x", "size_y", "size_z"],
  "cylinder-v1": ["diameter", "height"],
  "thin-panel-v1": ["size_x", "size_y", "thickness"],
  "tray-v1": ["size_x", "size_y", "size_z", "wall_thickness"],
};
const TEMPLATE_IDS = Object.keys(
  TEMPLATE_PARAMETERS,
) as CoffeeMachineBuildTemplateId[];
const FORMAT_ORDER = ["step", "gltf", "stl"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_EXPORT_PATH = /^\/exports\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Read exact SysON values, compile the reviewed plan, then perform one attested
 * build123d export. The orchestrator has no persistence or retry capability.
 */
export class CoffeeMachineBuildOrchestrator {
  readonly #sysonClient: McpToolClient;
  readonly #build123dClient: McpToolClient;
  readonly #now: () => Date;

  constructor(options: CoffeeMachineBuildOrchestratorOptions) {
    this.#sysonClient = options.sysonClient;
    this.#build123dClient = options.build123dClient;
    this.#now = options.now ?? (() => new Date());
  }

  async run(value: unknown): Promise<CoffeeMachineBuildRunCapture> {
    const declaration = validateDeclaration(value);
    const expectedAttributeIds = declaration.sourceBindings.map((binding) =>
      binding.id
    );
    const observer = new SysonCoffeeMachineBuildObserver({
      client: this.#sysonClient,
      editingContextId: declaration.editingContextId,
      rootPartDefinitionId: declaration.rootPartDefinitionId,
      exactAttributeIds: expectedAttributeIds,
      now: this.#now,
    });
    const sourceCapture = await observer.observe();
    assertExactObservedBindings(sourceCapture, expectedAttributeIds);

    const values = new Map(
      sourceCapture.source.reads.map((read) => [
        read.structuredContent.element_id,
        read.structuredContent.value,
      ]),
    );
    const compiledPlan = await compileCoffeeMachineBuildPlan({
      schemaVersion: "coffee-machine-build-plan/1.0",
      id: declaration.id,
      editingContextId: declaration.editingContextId,
      rootPartDefinitionId: declaration.rootPartDefinitionId,
      sourceFingerprint: sourceCapture.sourceFingerprint,
      partUsageIds: declaration.partUsageIds,
      sourceAttributes: declaration.sourceBindings.map((binding) => ({
        id: binding.id,
        value: requiredObservedValue(values, binding.id),
        unitBinding: binding.unitBinding,
      })),
      envelopeMm: declaration.envelopeMm,
      components: declaration.components,
    });

    const name = `coffee-machine-${
      compiledPlan.plan.fingerprints.plan.digest.slice(0, 16)
    }`;
    const toolCall: CoffeeMachineBuildRunCapture["toolCall"] = {
      name: "build123d_export",
      arguments: {
        script: compiledPlan.script,
        formats: ["step", "gltf", "stl"],
        name,
        timeout_ms: 120000,
      },
    };
    const providerResult = await this.#build123dClient.callTool(
      toolCall as McpToolCall,
    );
    const result = normalizeExportResult(providerResult.structuredContent);
    const capture: CoffeeMachineBuildRunCapture = {
      schemaVersion: COFFEE_MACHINE_BUILD_RUN_SCHEMA,
      capturedAt: sourceCapture.capturedAt,
      sourceCapture,
      compiledPlan,
      toolCall,
      result,
    };
    assertJsonValue(capture, "$run");
    return structuredClone(capture);
  }
}

function validateDeclaration(value: unknown): CoffeeMachineBuildDeclaration {
  const root = record(value, "$declaration");
  exactKeys(root, DECLARATION_KEYS, "$declaration");
  literal(
    root.schemaVersion,
    COFFEE_MACHINE_BUILD_DECLARATION_SCHEMA,
    "$declaration.schemaVersion",
  );
  const partUsageIds = stringArray(
    root.partUsageIds,
    "$declaration.partUsageIds",
  ).map((id, index) => uuid(id, `$declaration.partUsageIds[${index}]`));
  if (partUsageIds.length !== 10) {
    throw new TypeError("$declaration.partUsageIds must contain exactly 10 UUIDs.");
  }
  rejectDuplicates(partUsageIds, "$declaration.partUsageIds");

  const sourceBindings = array(
    root.sourceBindings,
    "$declaration.sourceBindings",
  ).map((binding, index) =>
    sourceBinding(binding, `$declaration.sourceBindings[${index}]`)
  );
  if (sourceBindings.length === 0) {
    throw new TypeError("$declaration.sourceBindings must not be empty.");
  }
  rejectDuplicates(
    sourceBindings.map((binding) => binding.id),
    "$declaration.sourceBindings ids",
  );

  const components = array(root.components, "$declaration.components").map(
    (item, index) => component(item, `$declaration.components[${index}]`),
  );
  if (components.length !== 10) {
    throw new TypeError("$declaration.components must contain exactly 10 components.");
  }
  rejectDuplicates(
    components.map((item) => item.id),
    "$declaration.components ids",
  );
  rejectDuplicates(
    components.map((item) => item.partUsageId),
    "$declaration.components partUsageIds",
  );
  assertSameSet(
    components.map((item) => item.partUsageId),
    partUsageIds,
    "$declaration component PartUsage IDs",
  );
  const referencedAttributeIds = components.flatMap((item) => [
    ...item.bindings.map((binding) => binding.attributeId),
    ...item.placement.translationAttributeIds,
    ...item.placement.rotationAttributeIds,
  ]);
  rejectDuplicates(
    referencedAttributeIds,
    "$declaration component attribute references",
  );
  assertSameSet(
    referencedAttributeIds,
    sourceBindings.map((binding) => binding.id),
    "$declaration source binding IDs",
  );

  return {
    schemaVersion: COFFEE_MACHINE_BUILD_DECLARATION_SCHEMA,
    id: safeId(root.id, "$declaration.id"),
    editingContextId: uuid(
      root.editingContextId,
      "$declaration.editingContextId",
    ),
    rootPartDefinitionId: uuid(
      root.rootPartDefinitionId,
      "$declaration.rootPartDefinitionId",
    ),
    partUsageIds: [...partUsageIds].sort(),
    sourceBindings: [...sourceBindings].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    envelopeMm: envelope(root.envelopeMm, "$declaration.envelopeMm"),
    components: [...components].sort((left, right) =>
      left.partUsageId.localeCompare(right.partUsageId) ||
      left.id.localeCompare(right.id)
    ),
  };
}

function sourceBinding(
  value: unknown,
  path: string,
): CoffeeMachineBuildSourceBinding {
  const input = record(value, path);
  exactKeys(input, ["id", "unitBinding"], path);
  const unitBinding = record(input.unitBinding, `${path}.unitBinding`);
  exactKeys(
    unitBinding,
    ["sourceUnit", "targetUnit", "scaleToTarget"],
    `${path}.unitBinding`,
  );
  const sourceUnit = oneOf(
    unitBinding.sourceUnit,
    ["mm", "cm", "m", "in", "deg"] as const,
    `${path}.unitBinding.sourceUnit`,
  );
  const expected = sourceUnit === "deg"
    ? { sourceUnit, targetUnit: "deg" as const, scaleToTarget: 1 as const }
    : {
      sourceUnit,
      targetUnit: "mm" as const,
      scaleToTarget: ({ mm: 1, cm: 10, m: 1000, in: 25.4 } as const)[sourceUnit],
    };
  literal(
    unitBinding.targetUnit,
    expected.targetUnit,
    `${path}.unitBinding.targetUnit`,
  );
  if (unitBinding.scaleToTarget !== expected.scaleToTarget) {
    throw new TypeError(
      `${path}.unitBinding.scaleToTarget must be ${expected.scaleToTarget} for ${sourceUnit}.`,
    );
  }
  return { id: uuid(input.id, `${path}.id`), unitBinding: expected };
}

function component(value: unknown, path: string): CoffeeMachineBuildComponent {
  const input = record(value, path);
  exactKeys(input, COMPONENT_KEYS, path);
  const templateId = oneOf(input.templateId, TEMPLATE_IDS, `${path}.templateId`);
  const bindings = array(input.bindings, `${path}.bindings`).map(
    (value, index) => {
      const binding = record(value, `${path}.bindings[${index}]`);
      exactKeys(
        binding,
        ["parameter", "attributeId"],
        `${path}.bindings[${index}]`,
      );
      return {
        parameter: safeId(
          binding.parameter,
          `${path}.bindings[${index}].parameter`,
        ),
        attributeId: uuid(
          binding.attributeId,
          `${path}.bindings[${index}].attributeId`,
        ),
      };
    },
  );
  rejectDuplicates(
    bindings.map((binding) => binding.parameter),
    `${path}.bindings parameters`,
  );
  const expectedParameters = TEMPLATE_PARAMETERS[templateId];
  assertSameSet(
    bindings.map((binding) => binding.parameter),
    expectedParameters,
    `${path}.bindings parameters`,
  );
  const bindingsByParameter = new Map(
    bindings.map((binding) => [binding.parameter, binding]),
  );
  const placement = record(input.placement, `${path}.placement`);
  exactKeys(
    placement,
    ["translationAttributeIds", "rotationAttributeIds"],
    `${path}.placement`,
  );
  return {
    id: safeId(input.id, `${path}.id`),
    partUsageId: uuid(input.partUsageId, `${path}.partUsageId`),
    templateId,
    bindings: expectedParameters.map((parameter) =>
      bindingsByParameter.get(parameter)!
    ),
    placement: {
      translationAttributeIds: uuidTuple3(
        placement.translationAttributeIds,
        `${path}.placement.translationAttributeIds`,
      ),
      rotationAttributeIds: uuidTuple3(
        placement.rotationAttributeIds,
        `${path}.placement.rotationAttributeIds`,
      ),
    },
  };
}

function envelope(
  value: unknown,
  path: string,
): CoffeeMachineBuildDeclaration["envelopeMm"] {
  const input = record(value, path);
  exactKeys(input, ["min", "max"], path);
  const min = numberTuple3(input.min, `${path}.min`);
  const max = numberTuple3(input.max, `${path}.max`);
  for (let axis = 0; axis < 3; axis++) {
    if (max[axis] <= min[axis]) {
      throw new TypeError(`${path}.max[${axis}] must be greater than min[${axis}].`);
    }
  }
  return { min, max };
}

function assertExactObservedBindings(
  capture: SysonCoffeeMachineBuildSourceCapture,
  expectedAttributeIds: readonly string[],
): void {
  const observedIds = capture.source.exactAttributeIds;
  if (
    observedIds.length !== expectedAttributeIds.length ||
    observedIds.some((id, index) => id !== expectedAttributeIds[index])
  ) {
    throw new Error("SysON exactAttributeIds do not exactly match sourceBindings.");
  }
  const readIds = capture.source.reads.map((read) => read.structuredContent.element_id);
  if (
    readIds.length !== expectedAttributeIds.length ||
    readIds.some((id, index) => id !== expectedAttributeIds[index])
  ) {
    throw new Error("SysON reads do not exactly match sourceBindings.");
  }
}

function requiredObservedValue(values: Map<string, number>, id: string): number {
  const value = values.get(id);
  if (value === undefined) {
    throw new Error(`SysON source capture is missing exact AttributeUsage ${id}.`);
  }
  return value;
}

function normalizeExportResult(value: unknown): CoffeeMachineBuildExportResult {
  const root = record(value, "$export");
  literal(root.schemaVersion, "1.0", "$export.schemaVersion");
  literal(root.kind, "export", "$export.kind");
  const metrics = jsonObject(root.metrics, "$export.metrics");
  const files = array(root.files, "$export.files").map((value, index) => {
    const path = `$export.files[${index}]`;
    const file = record(value, path);
    const format = oneOf(file.format, FORMAT_ORDER, `${path}.format`);
    if (typeof file.path !== "string" || !SAFE_EXPORT_PATH.test(file.path)) {
      throw new TypeError(`${path}.path must be a safe /exports/<filename> path.`);
    }
    if (!Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0) {
      throw new TypeError(`${path}.bytes must be a positive safe integer.`);
    }
    if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) {
      throw new TypeError(`${path}.sha256 must be a lowercase SHA-256 digest.`);
    }
    return {
      format,
      path: file.path,
      bytes: Number(file.bytes),
      sha256: file.sha256,
    };
  });
  if (files.length === 0) {
    throw new TypeError("$export.files must not be empty.");
  }
  rejectDuplicates(
    files.map((file) => file.format),
    "$export.files formats",
  );
  assertSameSet(
    files.map((file) => file.format),
    FORMAT_ORDER,
    "$export.files formats",
  );
  const byFormat = new Map(files.map((file) => [file.format, file]));
  return {
    schemaVersion: "1.0",
    kind: "export",
    metrics,
    files: FORMAT_ORDER.map((format) => byFormat.get(format)!),
  };
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) {
      throw new TypeError(`${path}: unsupported field ${key}.`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) throw new TypeError(`${path}: missing field ${key}.`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => {
    if (typeof item !== "string") {
      throw new TypeError(`${path}[${index}] must be a string.`);
    }
    return item;
  });
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${path} must be a canonical lowercase UUID.`);
  }
  return value;
}

function safeId(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${path} must be a safe stable id.`);
  }
  return value;
}

function uuidTuple3(value: unknown, path: string): [string, string, string] {
  const items = array(value, path);
  if (items.length !== 3) throw new TypeError(`${path} must contain exactly 3 UUIDs.`);
  return items.map((item, index) => uuid(item, `${path}[${index}]`)) as [
    string,
    string,
    string,
  ];
}

function numberTuple3(value: unknown, path: string): [number, number, number] {
  const items = array(value, path);
  if (items.length !== 3) {
    throw new TypeError(`${path} must contain exactly 3 numbers.`);
  }
  return items.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new TypeError(`${path}[${index}] must be a finite number.`);
    }
    return item;
  }) as [number, number, number];
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) throw new TypeError(`${path} must be ${expected}.`);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  expected: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !expected.includes(value)) {
    throw new TypeError(`${path} must be one of ${expected.join(", ")}.`);
  }
  return value as T[number];
}

function rejectDuplicates(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${path} must not contain duplicates.`);
  }
}

function assertSameSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== expectedSet.size ||
    [...actualSet].some((value) => !expectedSet.has(value))
  ) {
    throw new TypeError(`${path} must match exactly.`);
  }
}

function jsonObject(value: unknown, path: string): JsonObject {
  const object = record(value, path);
  assertJsonValue(object, path);
  return structuredClone(object) as JsonObject;
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must be finite JSON.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain plain JSON objects.`);
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} must contain JSON-only values.`);
}
