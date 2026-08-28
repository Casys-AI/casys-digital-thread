import {
  flattenEngineeringCapabilityRequirements,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import type { EngineeringOperationRef } from "../../domain/project/engineering-project.ts";
import type { RegisteredEngineeringOperation } from "./operation-contract.ts";

/**
 * Behave is a route projection only. Runtime capability demand remains on the
 * main operation registry and is never restated here.
 */
export const BEHAVE_FOUNDATION_OPERATION_ROUTES = Object.freeze(
  [
    { id: "architecture.seed-syson-model", version: "2" },
    { id: "model.write-architecture", version: "1" },
    { id: "model.write-requirements", version: "1" },
    { id: "design.write-geometry", version: "1" },
    { id: "verify.run-fea-static-proof", version: "3" },
  ] as const satisfies readonly Pick<EngineeringOperationRef, "id" | "version">[],
);

export function listBehaveFoundationOperations(
  operations: readonly RegisteredEngineeringOperation[],
): readonly RegisteredEngineeringOperation[] {
  const byKey = new Map(
    operations.map((operation) => [operationKey(operation), operation]),
  );
  return Object.freeze(BEHAVE_FOUNDATION_OPERATION_ROUTES.map((route) => {
    const operation = byKey.get(operationKey(route));
    if (!operation) {
      throw new TypeError(
        `Behave route ${route.id}@${route.version} is not registered.`,
      );
    }
    return operation;
  }));
}

export function behaveFoundationCapabilityRequirements(
  operations: readonly RegisteredEngineeringOperation[],
): readonly RequiredEngineeringCapability[] {
  const requirements: RequiredEngineeringCapability[] = [];
  for (const operation of listBehaveFoundationOperations(operations)) {
    if (operation.runtimeDemand.kind === "none") continue;
    requirements.push(...operation.runtimeDemand.capabilities);
  }
  return Object.freeze(flattenEngineeringCapabilityRequirements(requirements));
}

function operationKey(
  operation: Pick<EngineeringOperationRef, "id" | "version">,
): string {
  return `${operation.id}@${operation.version}`;
}
