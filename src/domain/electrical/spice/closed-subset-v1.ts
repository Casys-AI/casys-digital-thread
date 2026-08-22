/**
 * Pure authority for the generic circuit-only SPICE closed subset v1.
 *
 * Named numeric levers are `.param name = <finite-number>` declarations only.
 * Device values, model-card numbers, and `{name}` substitutions are not
 * levers. A source may have zero named levers: an ordinary numeric netlist
 * is admissible. Compilation binds parameter symbols through unique
 * `parameterizes`; it does not apply the CAD `source.no-named-numeric-lever`
 * gate.
 *
 * The future isolated worker owns analysis and `.end`. Agent source that
 * includes those commands is rejected here so a later executor cannot be
 * surprised by caller-owned control.
 */

import {
  parseSpiceCircuitSubset,
  type SpiceCircuitNode,
  type SpiceElementNode,
  type SpiceModelType,
  type SpiceParamNode,
  SpiceParseError,
  type SpiceValue,
} from "./parse.ts";
import { SpiceLexicalError } from "./lexical.ts";

export const SPICE_CIRCUIT_CLOSED_SUBSET_V1_PROFILE_ID =
  "spice-circuit-closed-subset-v1" as const;

export interface AuthorizedSpiceCircuitClosedSubsetV1Source {
  readonly sourceText: string;
  readonly circuitName: string;
  readonly parameters: readonly SpiceParamNode[];
  readonly elements: readonly SpiceElementNode[];
  readonly models: SpiceCircuitNode["models"];
  readonly nodes: readonly string[];
}

const MAX_ELEMENTS = 256;
const MAX_PARAMETERS = 32;
const MAX_MODELS = 32;
const MAX_NODES = 256;
const MODEL_TYPES_BY_ELEMENT: Readonly<
  Record<"D" | "Q" | "M", readonly SpiceModelType[]>
> = {
  D: ["D"],
  Q: ["NPN", "PNP"],
  M: ["NMOS", "PMOS"],
};

/** Authorizes source exactly as parsed; no netlist or analysis is invented. */
export function authorizeSpiceCircuitClosedSubsetV1Source(
  sourceText: string,
): AuthorizedSpiceCircuitClosedSubsetV1Source {
  if (
    typeof sourceText !== "string" || sourceText.length === 0 ||
    sourceText.includes("\0")
  ) {
    fail(
      "The SPICE circuit closed-subset v1 source must be non-empty text without NUL.",
    );
  }
  let circuit: SpiceCircuitNode;
  try {
    circuit = parseSpiceCircuitSubset(sourceText).circuit;
  } catch (error) {
    if (error instanceof SpiceParseError || error instanceof SpiceLexicalError) {
      throw new TypeError(error.message);
    }
    throw error;
  }
  if (circuit.elements.length < 1 || circuit.elements.length > MAX_ELEMENTS) {
    fail("SPICE v1 requires 1 to 256 circuit elements.");
  }
  if (circuit.parameters.length > MAX_PARAMETERS) {
    fail("SPICE v1 permits at most 32 .param declarations.");
  }
  if (circuit.models.length > MAX_MODELS) {
    fail("SPICE v1 permits at most 32 .model cards.");
  }

  exactUniqueNames(
    circuit.elements.map((element) => foldName(element.name)),
    "element names",
  );
  exactUniqueNames(
    circuit.parameters.map((parameter) => foldName(parameter.name)),
    "parameter names",
  );
  exactUniqueNames(
    circuit.models.map((model) => foldName(model.name)),
    "model names",
  );

  const parameterNames = new Set(
    circuit.parameters.map((parameter) => foldName(parameter.name)),
  );
  const inductorNames = new Set(
    circuit.elements.filter((element) => element.type === "L").map((element) =>
      foldName(element.name)
    ),
  );
  const modelsByName = new Map(
    circuit.models.map((model) => [foldName(model.name), model]),
  );
  const nodeOrder: string[] = [];
  const seenNodes = new Set<string>();

  for (const element of circuit.elements) {
    for (const node of element.nodes) {
      const folded = foldName(node.name);
      if (seenNodes.has(folded)) continue;
      seenNodes.add(folded);
      nodeOrder.push(node.name);
    }
    collectValueRefs(element.value, parameterNames);
    for (const named of element.namedValues) {
      collectValueRefs(named.value, parameterNames);
    }
    if (element.type === "K") {
      for (const inductor of element.inductorNames) {
        if (!inductorNames.has(foldName(inductor))) {
          fail("SPICE K may couple only declared inductors.");
        }
      }
    }
    if (element.type === "D" || element.type === "Q" || element.type === "M") {
      const modelName = element.modelName;
      if (modelName === undefined) {
        fail("SPICE semiconductor devices require a .model.");
      }
      const model = modelsByName.get(foldName(modelName));
      if (model === undefined) {
        fail("SPICE semiconductor devices must name a declared .model.");
      }
      if (!MODEL_TYPES_BY_ELEMENT[element.type].includes(model.type)) {
        fail("SPICE device .model type does not match the element.");
      }
    }
  }
  if (nodeOrder.length < 1 || nodeOrder.length > MAX_NODES) {
    fail("SPICE v1 requires 1 to 256 unique nodes.");
  }

  return Object.freeze({
    sourceText,
    circuitName: "circuit",
    parameters: circuit.parameters,
    elements: circuit.elements,
    models: circuit.models,
    nodes: Object.freeze(nodeOrder),
  });
}

function collectValueRefs(
  value: SpiceValue | undefined,
  parameterNames: ReadonlySet<string>,
): void {
  if (value?.kind !== "param-ref") return;
  if (!parameterNames.has(foldName(value.name))) {
    fail("SPICE {name} substitutions may reference only declared .param names.");
  }
}

function exactUniqueNames(names: readonly string[], label: string): void {
  if (new Set(names).size !== names.length) {
    fail(`SPICE v1 ${label} must be unique.`);
  }
}

function foldName(name: string): string {
  return name.toLowerCase();
}

function fail(message: string): never {
  throw new TypeError(message);
}
