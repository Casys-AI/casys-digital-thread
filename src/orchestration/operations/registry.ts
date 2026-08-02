import type {
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectStartingPoint,
  EngineeringWorkItemKind,
} from "../../domain/engineering-project.ts";

/**
 * Reviewed, code-owned engineering operations.
 *
 * This registry intentionally describes only the safe planning boundary.  It
 * does not reveal provider selection, tool names, or provider arguments.
 */

export type EngineeringOperationBasisKind =
  | "approved-discovery"
  | "thread-snapshot";

export type EngineeringOperationRiskClass = "low" | "consequential";

export type EngineeringOperationBindingSourceKind =
  EngineeringOperationInputBinding["source"]["kind"];

/** One named input the reviewed operation permits in an agent plan. */
export interface RegisteredEngineeringOperationBinding {
  readonly name: string;
  readonly allowedSourceKinds: readonly EngineeringOperationBindingSourceKind[];
}

/** Safe descriptor suitable for a project plan and a human-facing UI. */
export interface RegisteredEngineeringOperation {
  readonly id: string;
  readonly version: string;
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly allowedBasisKinds: readonly EngineeringOperationBasisKind[];
  readonly title: string;
  readonly description: string;
  /** Human-facing work classification derived from the reviewed operation. */
  readonly workItemKind: EngineeringWorkItemKind;
  readonly riskClass: EngineeringOperationRiskClass;
  readonly bindings: readonly RegisteredEngineeringOperationBinding[];
}

/** Input which a plan publisher must resolve against this code-owned registry. */
export interface RegisteredEngineeringOperationInput {
  readonly operation: EngineeringOperationRef;
  readonly basisKind: EngineeringOperationBasisKind;
}

export interface ValidatedRegisteredEngineeringOperationInput {
  readonly operation: RegisteredEngineeringOperation;
  readonly basisKind: EngineeringOperationBasisKind;
  readonly bindings: readonly EngineeringOperationInputBinding[];
}

/**
 * Code-owned boundary used by planning and, later, a trusted executor.
 * Implementations never expose provider selection or provider arguments.
 */
export interface EngineeringOperationRegistry {
  get(
    reference: Pick<EngineeringOperationRef, "id" | "version">,
  ): RegisteredEngineeringOperation | undefined;
  require(
    reference: Pick<EngineeringOperationRef, "id" | "version">,
  ): RegisteredEngineeringOperation;
  getIntake(
    startingPoint: EngineeringProjectStartingPoint,
  ): RegisteredEngineeringOperation | undefined;
  validate(input: unknown): ValidatedRegisteredEngineeringOperationInput;
}

export type EngineeringOperationRegistryErrorCode =
  | "invalid_input"
  | "unknown_operation"
  | "unsupported_basis"
  | "invalid_bindings";

export class EngineeringOperationRegistryError extends Error {
  constructor(
    readonly code: EngineeringOperationRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineeringOperationRegistryError";
  }
}

const OPERATIONS = [
  {
    id: "baseline.from-approved-discovery",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["approved-discovery"],
    title: "Create the engineering baseline",
    description:
      "Create the first reviewable engineering baseline from the approved discovery brief.",
    workItemKind: "define",
    riskClass: "consequential",
    bindings: [{
      name: "approvedDiscovery",
      allowedSourceKinds: ["approved-discovery"],
    }],
  },
  {
    id: "baseline.capture-existing-cad",
    version: "1",
    startingPoint: "existing-cad",
    allowedBasisKinds: ["approved-discovery"],
    title: "Capture the existing CAD baseline",
    description:
      "Resolve and fingerprint the CAD source referenced by the approved discovery.",
    workItemKind: "define",
    riskClass: "consequential",
    bindings: [
      {
        name: "approvedDiscovery",
        allowedSourceKinds: ["approved-discovery"],
      },
      {
        name: "cadSource",
        allowedSourceKinds: ["discovery-answer"],
      },
    ],
  },
  {
    id: "baseline.capture-existing-product",
    version: "1",
    startingPoint: "existing-product",
    allowedBasisKinds: ["approved-discovery"],
    title: "Capture the existing product baseline",
    description:
      "Resolve and fingerprint the product source referenced by the approved discovery.",
    workItemKind: "define",
    riskClass: "consequential",
    bindings: [
      {
        name: "approvedDiscovery",
        allowedSourceKinds: ["approved-discovery"],
      },
      {
        name: "productSource",
        allowedSourceKinds: ["discovery-answer"],
      },
    ],
  },
] as const satisfies readonly RegisteredEngineeringOperation[];

const OPERATION_BY_KEY = new Map(
  OPERATIONS.map((operation) => [operationKey(operation), operation]),
);

/**
 * Look up an exact reviewed operation revision. Unknown IDs and versions are
 * intentionally indistinguishable from an absent entry.
 */
export function getRegisteredEngineeringOperation(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): RegisteredEngineeringOperation | undefined {
  const operation = OPERATION_BY_KEY.get(operationKey(reference));
  return operation === undefined ? undefined : copyOperation(operation);
}

/**
 * Resolve an exact reviewed operation revision or fail closed.
 *
 * The error deliberately contains no provider implementation detail.
 */
export function requireRegisteredEngineeringOperation(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): RegisteredEngineeringOperation {
  const operation = getRegisteredEngineeringOperation(reference);
  if (operation !== undefined) return operation;
  throw new EngineeringOperationRegistryError(
    "unknown_operation",
    `Unknown registered engineering operation: ${operationLabel(reference)}`,
  );
}

/** Return the one bounded V1 intake operation for a product starting point. */
export function getRegisteredIntakeOperation(
  startingPoint: EngineeringProjectStartingPoint,
): RegisteredEngineeringOperation | undefined {
  const operation = OPERATIONS.find((item) => item.startingPoint === startingPoint);
  return operation === undefined ? undefined : copyOperation(operation);
}

/**
 * Resolve and validate a plan's safe operation declaration.
 *
 * It validates only the reviewed operation contract: exact operation version,
 * basis kind, and declared state-reference bindings. It does not execute an
 * operation or resolve a discovery answer.
 */
export function validateRegisteredEngineeringOperationInput(
  value: unknown,
): ValidatedRegisteredEngineeringOperationInput {
  const input = exactRecord(
    value,
    ["operation", "basisKind"],
    "operation input",
  );
  const referenceRecord = exactRecord(
    input.operation,
    ["id", "version", "bindings"],
    "operation input.operation",
  );
  const reference: Pick<EngineeringOperationRef, "id" | "version"> = {
    id: nonEmptyString(referenceRecord.id, "operation input.operation.id"),
    version: nonEmptyString(
      referenceRecord.version,
      "operation input.operation.version",
    ),
  };
  const basisKind = basisKindValue(input.basisKind, "operation input.basisKind");
  const bindings = bindingsValue(referenceRecord.bindings);
  const operation = requireRegisteredEngineeringOperation(reference);

  if (!operation.allowedBasisKinds.includes(basisKind)) {
    throw new EngineeringOperationRegistryError(
      "unsupported_basis",
      `${operationLabel(reference)} does not accept a ${basisKind} basis`,
    );
  }
  validateBindings(operation, bindings);

  return {
    operation,
    basisKind,
    bindings: bindings.map(copyInputBinding),
  };
}

/** The only V1 registry instance; its entries are intentionally code-owned. */
export const engineeringOperationRegistry: EngineeringOperationRegistry = Object.freeze(
  {
    get: getRegisteredEngineeringOperation,
    require: requireRegisteredEngineeringOperation,
    getIntake: getRegisteredIntakeOperation,
    validate: validateRegisteredEngineeringOperationInput,
  },
);

function validateBindings(
  operation: RegisteredEngineeringOperation,
  bindings: readonly EngineeringOperationInputBinding[],
): void {
  const suppliedByName = new Map<string, EngineeringOperationInputBinding>();
  for (const binding of bindings) {
    if (suppliedByName.has(binding.name)) {
      invalidBindings(`binding ${binding.name} is supplied more than once`);
    }
    suppliedByName.set(binding.name, binding);
  }

  const declaredNames = new Set(operation.bindings.map((binding) => binding.name));
  for (const binding of bindings) {
    if (!declaredNames.has(binding.name)) {
      invalidBindings(`binding ${binding.name} is not declared for this operation`);
    }
  }

  for (const declaration of operation.bindings) {
    const binding = suppliedByName.get(declaration.name);
    if (binding === undefined) {
      invalidBindings(`required binding ${declaration.name} is missing`);
    }
    if (!declaration.allowedSourceKinds.includes(binding.source.kind)) {
      invalidBindings(
        `binding ${binding.name} does not accept a ${binding.source.kind} source`,
      );
    }
  }
}

function bindingsValue(value: unknown): EngineeringOperationInputBinding[] {
  if (!Array.isArray(value)) {
    invalidInput("operation input.bindings must be an array");
  }
  return value.map((item, index) => bindingValue(item, index));
}

function bindingValue(
  value: unknown,
  index: number,
): EngineeringOperationInputBinding {
  const path = `operation input.bindings[${index}]`;
  const record = exactRecord(value, ["name", "source"], path);
  const name = nonEmptyString(record.name, `${path}.name`);
  const sourcePath = `${path}.source`;
  const source = object(record.source, sourcePath);
  if (source.kind === "approved-discovery") {
    exactRecord(source, ["kind"], sourcePath);
    return { name, source: { kind: "approved-discovery" } };
  }
  if (source.kind === "discovery-answer") {
    exactRecord(source, ["kind", "answerId"], sourcePath);
    return {
      name,
      source: {
        kind: "discovery-answer",
        answerId: nonEmptyString(source.answerId, `${sourcePath}.answerId`),
      },
    };
  }
  invalidInput(`${sourcePath}.kind must be an approved state-reference source`);
}

function basisKindValue(value: unknown, path: string): EngineeringOperationBasisKind {
  if (value === "approved-discovery" || value === "thread-snapshot") return value;
  invalidInput(`${path} must be an approved basis kind`);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = object(value, path);
  const extras = Object.keys(record).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in record));
  if (extras.length > 0 || missing.length > 0) {
    invalidInput(
      `${path} must contain exactly ${keys.join(", ")}`,
    );
  }
  return record;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  invalidInput(`${path} must be an object`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  invalidInput(`${path} must be a non-empty string`);
}

function invalidInput(message: string): never {
  throw new EngineeringOperationRegistryError("invalid_input", message);
}

function invalidBindings(message: string): never {
  throw new EngineeringOperationRegistryError("invalid_bindings", message);
}

function operationKey(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): string {
  return `${reference.id}@${reference.version}`;
}

function operationLabel(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): string {
  const id = typeof reference.id === "string" ? reference.id : "<invalid-id>";
  const version = typeof reference.version === "string"
    ? reference.version
    : "<invalid-version>";
  return `${id}@${version}`;
}

function copyOperation(
  operation: RegisteredEngineeringOperation,
): RegisteredEngineeringOperation {
  return {
    ...operation,
    allowedBasisKinds: [...operation.allowedBasisKinds],
    bindings: operation.bindings.map((binding) => ({
      ...binding,
      allowedSourceKinds: [...binding.allowedSourceKinds],
    })),
  };
}

function copyInputBinding(
  binding: EngineeringOperationInputBinding,
): EngineeringOperationInputBinding {
  switch (binding.source.kind) {
    case "approved-discovery":
      return { name: binding.name, source: { kind: "approved-discovery" } };
    case "discovery-answer":
      return {
        name: binding.name,
        source: {
          kind: "discovery-answer",
          answerId: binding.source.answerId,
        },
      };
    default:
      throw new Error("Validated operation binding has an unsupported source");
  }
}

/** Injectable V1 validation boundary for project-plan publication. */
export const REGISTERED_ENGINEERING_OPERATION_REGISTRY = Object.freeze({
  validate(
    input: RegisteredEngineeringOperationInput,
  ): ValidatedRegisteredEngineeringOperationInput {
    return validateRegisteredEngineeringOperationInput(input);
  },
});
