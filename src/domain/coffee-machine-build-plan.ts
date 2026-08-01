/**
 * Strict, transport-independent geometry plan for the first CoffeeMachine build.
 *
 * The plan binds exact SysON identities to a small reviewed template language.
 * It never accepts Python, expressions, labels, or inferred component matches.
 */

export type CoffeeMachineBuildPlanSchemaVersion = "coffee-machine-build-plan/1.0";

export type CoffeeMachineBuildTemplateId =
  | "enclosure-shell-v1"
  | "hollow-box-v1"
  | "solid-box-v1"
  | "cylinder-v1"
  | "thin-panel-v1"
  | "tray-v1";

export type CoffeeMachineLengthUnit = "mm" | "cm" | "m" | "in";

export type CoffeeMachineSourceUnitBinding =
  | {
    sourceUnit: CoffeeMachineLengthUnit;
    targetUnit: "mm";
    scaleToTarget: 1 | 10 | 1000 | 25.4;
  }
  | {
    sourceUnit: "deg";
    targetUnit: "deg";
    scaleToTarget: 1;
  };

export interface CoffeeMachineSourceAttribute {
  /** Exact SysON AttributeUsage id. */
  id: string;
  value: number;
  unitBinding: CoffeeMachineSourceUnitBinding;
}

export interface CoffeeMachineTemplateBinding {
  parameter: string;
  /** Exact source attribute id; labels are never consulted. */
  attributeId: string;
}

export interface CoffeeMachineBuildComponent {
  id: string;
  /** Exact SysON PartUsage id. */
  partUsageId: string;
  templateId: CoffeeMachineBuildTemplateId;
  bindings: CoffeeMachineTemplateBinding[];
  placement: {
    /** Exact AttributeUsage ids resolved to the XYZ centre in millimetres. */
    translationAttributeIds: [string, string, string];
    /** Exact AttributeUsage ids resolved to intrinsic XYZ quarter-turns. */
    rotationAttributeIds: [string, string, string];
  };
}

export interface CoffeeMachineBuildPlanInput {
  schemaVersion: CoffeeMachineBuildPlanSchemaVersion;
  id: string;
  editingContextId: string;
  rootPartDefinitionId: string;
  /** Hash of the exact SysON read capture from which the input was assembled. */
  sourceFingerprint: ContentFingerprint;
  /** Exactly ten reviewed PartUsage ids, independent from labels. */
  partUsageIds: string[];
  sourceAttributes: CoffeeMachineSourceAttribute[];
  envelopeMm: {
    min: [number, number, number];
    max: [number, number, number];
  };
  components: CoffeeMachineBuildComponent[];
}

export interface ContentFingerprint {
  algorithm: "sha256";
  digest: string;
}

export interface CoffeeMachineBuildPlan extends CoffeeMachineBuildPlanInput {
  fingerprints: {
    source: ContentFingerprint;
    /** Hash of canonical JSON for the plan input, excluding this field. */
    plan: ContentFingerprint;
    /** Hash of the exact UTF-8 build123d script. */
    script: ContentFingerprint;
  };
}

export interface CompiledCoffeeMachineBuildPlan {
  plan: CoffeeMachineBuildPlan;
  script: string;
}

const TEMPLATE_PARAMETERS: Record<CoffeeMachineBuildTemplateId, string[]> = {
  "enclosure-shell-v1": [
    "size_x",
    "size_y",
    "size_z",
    "wall_thickness",
  ],
  "hollow-box-v1": [
    "size_x",
    "size_y",
    "size_z",
    "wall_thickness",
  ],
  "solid-box-v1": ["size_x", "size_y", "size_z"],
  "cylinder-v1": ["diameter", "height"],
  "thin-panel-v1": ["size_x", "size_y", "thickness"],
  "tray-v1": ["size_x", "size_y", "size_z", "wall_thickness"],
};

const TEMPLATE_IDS = Object.keys(
  TEMPLATE_PARAMETERS,
) as CoffeeMachineBuildTemplateId[];
const MIN_DIMENSION_MM = 0.1;
const MAX_DIMENSION_MM = 2000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Validate, normalize, compile and fingerprint an untrusted plan input.
 * Equivalent inputs produce byte-identical scripts and hashes regardless of
 * source array order.
 */
export async function compileCoffeeMachineBuildPlan(
  value: unknown,
): Promise<CompiledCoffeeMachineBuildPlan> {
  const input = validateBuildPlanInput(value);
  const script = renderBuild123dScript(input);
  const planDigest = await sha256(canonicalJson(input));
  const scriptDigest = await sha256(script);
  return {
    plan: {
      ...input,
      fingerprints: {
        source: structuredClone(input.sourceFingerprint),
        plan: fingerprint(planDigest),
        script: fingerprint(scriptDigest),
      },
    },
    script,
  };
}

/**
 * Revalidate a persisted plan and prove that both embedded hashes still match
 * the deterministic compiler output.
 */
export async function verifyCoffeeMachineBuildPlan(
  value: unknown,
): Promise<CompiledCoffeeMachineBuildPlan> {
  const root = record(value, "$plan");
  exactKeys(root, [...INPUT_KEYS, "fingerprints"], "$plan");
  const fingerprints = validateFingerprints(
    root.fingerprints,
    "$plan.fingerprints",
  );
  const input = Object.fromEntries(
    INPUT_KEYS.map((key) => [key, root[key]]),
  );
  const compiled = await compileCoffeeMachineBuildPlan(input);
  if (fingerprints.source.digest !== compiled.plan.fingerprints.source.digest) {
    throw new Error("$plan.fingerprints.source does not match sourceFingerprint.");
  }
  if (fingerprints.plan.digest !== compiled.plan.fingerprints.plan.digest) {
    throw new Error("$plan.fingerprints.plan does not match canonical plan bytes.");
  }
  if (fingerprints.script.digest !== compiled.plan.fingerprints.script.digest) {
    throw new Error("$plan.fingerprints.script does not match compiled script bytes.");
  }
  return compiled;
}

const INPUT_KEYS = [
  "schemaVersion",
  "id",
  "editingContextId",
  "rootPartDefinitionId",
  "sourceFingerprint",
  "partUsageIds",
  "sourceAttributes",
  "envelopeMm",
  "components",
] as const;

function validateBuildPlanInput(value: unknown): CoffeeMachineBuildPlanInput {
  const root = record(value, "$planInput");
  exactKeys(root, INPUT_KEYS, "$planInput");
  literal(
    root.schemaVersion,
    "coffee-machine-build-plan/1.0",
    "$planInput.schemaVersion",
  );
  const sourceFingerprint = contentFingerprint(
    root.sourceFingerprint,
    "$planInput.sourceFingerprint",
  );
  const partUsageIds = stringArray(
    root.partUsageIds,
    "$planInput.partUsageIds",
  ).map((id, index) => safeId(id, `$planInput.partUsageIds[${index}]`));
  if (partUsageIds.length !== 10) {
    throw new Error("$planInput.partUsageIds must contain exactly 10 ids.");
  }
  rejectDuplicates(partUsageIds, "$planInput.partUsageIds");

  const sourceAttributes = array(
    root.sourceAttributes,
    "$planInput.sourceAttributes",
  ).map((item, index) =>
    sourceAttribute(item, `$planInput.sourceAttributes[${index}]`)
  );
  rejectDuplicates(
    sourceAttributes.map((attribute) => attribute.id),
    "$planInput.sourceAttributes ids",
  );
  if (sourceAttributes.length === 0) {
    throw new Error("$planInput.sourceAttributes must not be empty.");
  }

  const envelopeMm = envelope(root.envelopeMm, "$planInput.envelopeMm");
  const components = array(root.components, "$planInput.components").map(
    (item, index) => component(item, `$planInput.components[${index}]`),
  );
  if (components.length !== 10) {
    throw new Error("$planInput.components must contain exactly 10 components.");
  }
  rejectDuplicates(
    components.map((item) => item.id),
    "$planInput.components ids",
  );
  rejectDuplicates(
    components.map((item) => item.partUsageId),
    "$planInput.components partUsageIds",
  );
  const declaredPartUsageIds = new Set(partUsageIds);
  for (const [index, item] of components.entries()) {
    if (!declaredPartUsageIds.has(item.partUsageId)) {
      throw new Error(
        `$planInput.components[${index}].partUsageId is not declared by the source read.`,
      );
    }
  }
  if (components.some((item) => !declaredPartUsageIds.has(item.partUsageId))) {
    throw new Error("$planInput.components contains an unknown PartUsage id.");
  }

  const attributes = new Map(
    sourceAttributes.map((attribute) => [attribute.id, attribute]),
  );
  const usedAttributeIds = new Set<string>();
  for (const [index, item] of components.entries()) {
    validateComponentDimensions(
      item,
      attributes,
      usedAttributeIds,
      `$planInput.components[${index}]`,
    );
    validateComponentEnvelope(item, attributes, envelopeMm, index);
  }
  for (const attribute of sourceAttributes) {
    if (!usedAttributeIds.has(attribute.id)) {
      throw new Error(
        `$planInput.sourceAttributes contains unused attribute ${attribute.id}.`,
      );
    }
  }

  return {
    schemaVersion: "coffee-machine-build-plan/1.0",
    id: safeId(root.id, "$planInput.id"),
    editingContextId: safeId(
      root.editingContextId,
      "$planInput.editingContextId",
    ),
    rootPartDefinitionId: safeId(
      root.rootPartDefinitionId,
      "$planInput.rootPartDefinitionId",
    ),
    sourceFingerprint,
    partUsageIds: [...partUsageIds].sort(),
    sourceAttributes: [...sourceAttributes].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    envelopeMm,
    components: [...components].sort((left, right) =>
      left.partUsageId.localeCompare(right.partUsageId) ||
      left.id.localeCompare(right.id)
    ),
  };
}

function sourceAttribute(
  value: unknown,
  path: string,
): CoffeeMachineSourceAttribute {
  const input = record(value, path);
  exactKeys(input, ["id", "value", "unitBinding"], path);
  const binding = record(input.unitBinding, `${path}.unitBinding`);
  exactKeys(
    binding,
    ["sourceUnit", "targetUnit", "scaleToTarget"],
    `${path}.unitBinding`,
  );
  const sourceUnit = oneOf(
    binding.sourceUnit,
    ["mm", "cm", "m", "in", "deg"],
    `${path}.unitBinding.sourceUnit`,
  );
  const expectedScale = sourceUnit === "deg" ? 1 : UNIT_SCALE_TO_MM[sourceUnit];
  const expectedTarget = sourceUnit === "deg" ? "deg" : "mm";
  literal(
    binding.targetUnit,
    expectedTarget,
    `${path}.unitBinding.targetUnit`,
  );
  if (binding.scaleToTarget !== expectedScale) {
    throw new Error(
      `${path}.unitBinding.scaleToTarget must be ${expectedScale} for ${sourceUnit}.`,
    );
  }
  const sourceValue = finiteNumber(input.value, `${path}.value`);
  return {
    id: safeId(input.id, `${path}.id`),
    value: sourceValue,
    unitBinding: sourceUnit === "deg"
      ? { sourceUnit, targetUnit: "deg", scaleToTarget: 1 }
      : {
        sourceUnit,
        targetUnit: "mm",
        scaleToTarget: expectedScale,
      },
  };
}

const UNIT_SCALE_TO_MM: Record<CoffeeMachineLengthUnit, 1 | 10 | 1000 | 25.4> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

function component(value: unknown, path: string): CoffeeMachineBuildComponent {
  const input = record(value, path);
  exactKeys(
    input,
    ["id", "partUsageId", "templateId", "bindings", "placement"],
    path,
  );
  const templateId = oneOf(input.templateId, TEMPLATE_IDS, `${path}.templateId`);
  const rawBindings = array(input.bindings, `${path}.bindings`).map(
    (item, index) => templateBinding(item, `${path}.bindings[${index}]`),
  );
  rejectDuplicates(
    rawBindings.map((binding) => binding.parameter),
    `${path}.bindings parameters`,
  );
  const expectedParameters = TEMPLATE_PARAMETERS[templateId];
  const bindingsByParameter = new Map(
    rawBindings.map((binding) => [binding.parameter, binding]),
  );
  if (
    rawBindings.length !== expectedParameters.length ||
    rawBindings.some((binding) => !expectedParameters.includes(binding.parameter))
  ) {
    throw new Error(
      `${path}.bindings must contain exactly: ${expectedParameters.join(", ")}.`,
    );
  }
  const placementInput = record(input.placement, `${path}.placement`);
  exactKeys(
    placementInput,
    ["translationAttributeIds", "rotationAttributeIds"],
    `${path}.placement`,
  );
  return {
    id: safeId(input.id, `${path}.id`),
    partUsageId: safeId(input.partUsageId, `${path}.partUsageId`),
    templateId,
    bindings: expectedParameters.map((parameter) =>
      bindingsByParameter.get(parameter)!
    ),
    placement: {
      translationAttributeIds: idTuple3(
        placementInput.translationAttributeIds,
        `${path}.placement.translationAttributeIds`,
      ),
      rotationAttributeIds: idTuple3(
        placementInput.rotationAttributeIds,
        `${path}.placement.rotationAttributeIds`,
      ),
    },
  };
}

function templateBinding(
  value: unknown,
  path: string,
): CoffeeMachineTemplateBinding {
  const input = record(value, path);
  exactKeys(input, ["parameter", "attributeId"], path);
  return {
    parameter: safeId(input.parameter, `${path}.parameter`),
    attributeId: safeId(input.attributeId, `${path}.attributeId`),
  };
}

function envelope(
  value: unknown,
  path: string,
): CoffeeMachineBuildPlanInput["envelopeMm"] {
  const input = record(value, path);
  exactKeys(input, ["min", "max"], path);
  const min = tuple3(input.min, `${path}.min`);
  const max = tuple3(input.max, `${path}.max`);
  for (let axis = 0; axis < 3; axis++) {
    if (max[axis] <= min[axis]) {
      throw new Error(`${path}.max[${axis}] must be greater than min[${axis}].`);
    }
  }
  return { min, max };
}

function validateComponentDimensions(
  component: CoffeeMachineBuildComponent,
  attributes: Map<string, CoffeeMachineSourceAttribute>,
  usedAttributeIds: Set<string>,
  path: string,
): void {
  const dimensions = resolvedDimensions(component, attributes, path);
  for (const binding of component.bindings) usedAttributeIds.add(binding.attributeId);
  for (const [parameter, value] of Object.entries(dimensions)) {
    if (value < MIN_DIMENSION_MM || value > MAX_DIMENSION_MM) {
      throw new Error(
        `${path}.${parameter} must be within ${MIN_DIMENSION_MM}..${MAX_DIMENSION_MM} mm.`,
      );
    }
  }
  switch (component.templateId) {
    case "enclosure-shell-v1":
    case "hollow-box-v1":
      requireWallFits(dimensions, ["size_x", "size_y", "size_z"], path);
      break;
    case "tray-v1":
      requireWallFits(dimensions, ["size_x", "size_y"], path);
      if (dimensions.wall_thickness >= dimensions.size_z) {
        throw new Error(`${path}.wall_thickness must be smaller than size_z.`);
      }
      break;
    case "thin-panel-v1":
      if (dimensions.thickness > Math.min(dimensions.size_x, dimensions.size_y)) {
        throw new Error(`${path}.thickness exceeds the panel span.`);
      }
      break;
    case "solid-box-v1":
    case "cylinder-v1":
      break;
  }
  resolvedPlacement(component, attributes, usedAttributeIds, path);
}

function requireWallFits(
  dimensions: Record<string, number>,
  axes: string[],
  path: string,
): void {
  if (axes.some((axis) => 2 * dimensions.wall_thickness >= dimensions[axis])) {
    throw new Error(`${path}.wall_thickness leaves no interior cavity.`);
  }
}

function validateComponentEnvelope(
  component: CoffeeMachineBuildComponent,
  attributes: Map<string, CoffeeMachineSourceAttribute>,
  envelopeMm: CoffeeMachineBuildPlanInput["envelopeMm"],
  index: number,
): void {
  const dimensions = resolvedDimensions(
    component,
    attributes,
    `$planInput.components[${index}]`,
  );
  const path = `$planInput.components[${index}]`;
  const placement = resolvedPlacement(component, attributes, undefined, path);
  const localSize = templateOuterSize(component.templateId, dimensions);
  const half = localSize.map((value) => value / 2) as [number, number, number];
  const matrix = rotationMatrix(placement.rotationDeg);
  const rotatedHalf = [0, 1, 2].map((row) =>
    Math.abs(matrix[row][0]) * half[0] +
    Math.abs(matrix[row][1]) * half[1] +
    Math.abs(matrix[row][2]) * half[2]
  ) as [number, number, number];
  for (let axis = 0; axis < 3; axis++) {
    const componentMin = placement.translationMm[axis] - rotatedHalf[axis];
    const componentMax = placement.translationMm[axis] + rotatedHalf[axis];
    if (componentMin < envelopeMm.min[axis] || componentMax > envelopeMm.max[axis]) {
      throw new Error(
        `$planInput.components[${index}] lies outside envelope on axis ${axis}.`,
      );
    }
  }
}

function resolvedDimensions(
  component: CoffeeMachineBuildComponent,
  attributes: Map<string, CoffeeMachineSourceAttribute>,
  path: string,
): Record<string, number> {
  return Object.fromEntries(component.bindings.map((binding) => {
    const attribute = attributes.get(binding.attributeId);
    if (!attribute) {
      throw new Error(
        `${path}.bindings for ${binding.parameter} references missing attribute ${binding.attributeId}.`,
      );
    }
    if (attribute.unitBinding.targetUnit !== "mm") {
      throw new Error(
        `${path}.bindings for ${binding.parameter} must target mm.`,
      );
    }
    return [
      binding.parameter,
      attribute.value * attribute.unitBinding.scaleToTarget,
    ];
  }));
}

function resolvedPlacement(
  component: CoffeeMachineBuildComponent,
  attributes: Map<string, CoffeeMachineSourceAttribute>,
  usedAttributeIds: Set<string> | undefined,
  path: string,
): {
  translationMm: [number, number, number];
  rotationDeg: [number, number, number];
} {
  const translationMm = component.placement.translationAttributeIds.map(
    (attributeId, axis) => {
      const attribute = requiredPoseAttribute(
        attributeId,
        attributes,
        path,
        "translation",
        axis,
      );
      if (attribute.unitBinding.targetUnit !== "mm") {
        throw new Error(
          `${path}.placement translation axis ${axis} must bind a length attribute targeting mm.`,
        );
      }
      usedAttributeIds?.add(attributeId);
      return attribute.value * attribute.unitBinding.scaleToTarget;
    },
  ) as [number, number, number];
  const rotationDeg = component.placement.rotationAttributeIds.map(
    (attributeId, axis) => {
      const attribute = requiredPoseAttribute(
        attributeId,
        attributes,
        path,
        "rotation",
        axis,
      );
      if (attribute.unitBinding.targetUnit !== "deg") {
        throw new Error(
          `${path}.placement rotation axis ${axis} must bind an angle attribute targeting deg.`,
        );
      }
      usedAttributeIds?.add(attributeId);
      return normalizeQuarterTurn(
        attribute.value * attribute.unitBinding.scaleToTarget,
        `${path}.placement rotation axis ${axis}`,
      );
    },
  ) as [number, number, number];
  return { translationMm, rotationDeg };
}

function requiredPoseAttribute(
  attributeId: string,
  attributes: Map<string, CoffeeMachineSourceAttribute>,
  path: string,
  role: "translation" | "rotation",
  axis: number,
): CoffeeMachineSourceAttribute {
  const attribute = attributes.get(attributeId);
  if (!attribute) {
    throw new Error(
      `${path}.placement ${role} axis ${axis} references missing attribute ${attributeId}.`,
    );
  }
  return attribute;
}

function normalizeQuarterTurn(value: number, path: string): number {
  if (!Number.isInteger(value / 90)) {
    throw new Error(`${path} must resolve to a multiple of 90 deg.`);
  }
  return ((value % 360) + 360) % 360;
}

function templateOuterSize(
  templateId: CoffeeMachineBuildTemplateId,
  dimensions: Record<string, number>,
): [number, number, number] {
  switch (templateId) {
    case "enclosure-shell-v1":
    case "hollow-box-v1":
    case "solid-box-v1":
    case "tray-v1":
      return [dimensions.size_x, dimensions.size_y, dimensions.size_z];
    case "thin-panel-v1":
      return [dimensions.size_x, dimensions.size_y, dimensions.thickness];
    case "cylinder-v1":
      return [dimensions.diameter, dimensions.diameter, dimensions.height];
  }
}

function renderBuild123dScript(input: CoffeeMachineBuildPlanInput): string {
  const attributes = new Map(
    input.sourceAttributes.map((attribute) => [attribute.id, attribute]),
  );
  const lines = [
    "from build123d import Align, Box, Compound, Cylinder, Pos, Rot",
    "",
    "components = []",
  ];
  for (const [index, component] of input.components.entries()) {
    const dimensions = resolvedDimensions(
      component,
      attributes,
      `$plan.components[${index}]`,
    );
    const shape = `shape_${index}`;
    lines.push("", `# ${component.id} <- ${component.partUsageId}`);
    lines.push(...renderTemplate(shape, component.templateId, dimensions));
    const placement = resolvedPlacement(
      component,
      attributes,
      undefined,
      `$plan.components[${index}]`,
    );
    const [rx, ry, rz] = placement.rotationDeg;
    const [x, y, z] = placement.translationMm;
    lines.push(
      `${shape} = Rot(${py(rx)}, ${py(ry)}, ${py(rz)}) * ${shape}`,
      `${shape} = Pos(${py(x)}, ${py(y)}, ${py(z)}) * ${shape}`,
      `${shape}.label = ${pyString(component.id)}`,
      `components.append(${shape})`,
    );
  }
  lines.push(
    "",
    `result = Compound(label=${pyString(input.id)}, children=components)`,
    "",
  );
  return lines.join("\n");
}

function renderTemplate(
  shape: string,
  templateId: CoffeeMachineBuildTemplateId,
  d: Record<string, number>,
): string[] {
  const centered = "align=(Align.CENTER, Align.CENTER, Align.CENTER)";
  switch (templateId) {
    case "solid-box-v1":
      return [
        `${shape} = Box(${py(d.size_x)}, ${py(d.size_y)}, ${
          py(d.size_z)
        }, ${centered})`,
      ];
    case "thin-panel-v1":
      return [
        `${shape} = Box(${py(d.size_x)}, ${py(d.size_y)}, ${
          py(d.thickness)
        }, ${centered})`,
      ];
    case "cylinder-v1":
      return [
        `${shape} = Cylinder(${py(d.diameter / 2)}, ${py(d.height)}, ${centered})`,
      ];
    case "hollow-box-v1":
      return [
        `${shape}_outer = Box(${py(d.size_x)}, ${py(d.size_y)}, ${
          py(d.size_z)
        }, ${centered})`,
        `${shape}_inner = Box(${py(d.size_x - 2 * d.wall_thickness)}, ${
          py(d.size_y - 2 * d.wall_thickness)
        }, ${py(d.size_z - 2 * d.wall_thickness)}, ${centered})`,
        `${shape} = ${shape}_outer - ${shape}_inner`,
      ];
    case "enclosure-shell-v1":
      return renderOpenShell(shape, d, centered, -1);
    case "tray-v1":
      return renderOpenShell(shape, d, centered, 1);
  }
}

function renderOpenShell(
  shape: string,
  d: Record<string, number>,
  centered: string,
  openingDirection: -1 | 1,
): string[] {
  return [
    `${shape}_outer = Box(${py(d.size_x)}, ${py(d.size_y)}, ${
      py(d.size_z)
    }, ${centered})`,
    `${shape}_inner = Box(${py(d.size_x - 2 * d.wall_thickness)}, ${
      py(d.size_y - 2 * d.wall_thickness)
    }, ${py(d.size_z)}, ${centered})`,
    `${shape}_inner = Pos(0, 0, ${
      py(openingDirection * d.wall_thickness)
    }) * ${shape}_inner`,
    `${shape} = ${shape}_outer - ${shape}_inner`,
  ];
}

function rotationMatrix(rotation: [number, number, number]): number[][] {
  const [x, y, z] = rotation.map(quarterTurn);
  const rx = [[1, 0, 0], [0, x.cos, -x.sin], [0, x.sin, x.cos]];
  const ry = [[y.cos, 0, y.sin], [0, 1, 0], [-y.sin, 0, y.cos]];
  const rz = [[z.cos, -z.sin, 0], [z.sin, z.cos, 0], [0, 0, 1]];
  return multiplyMatrix(rz, multiplyMatrix(ry, rx));
}

function quarterTurn(degrees: number): { cos: number; sin: number } {
  switch (degrees) {
    case 0:
      return { cos: 1, sin: 0 };
    case 90:
      return { cos: 0, sin: 1 };
    case 180:
      return { cos: -1, sin: 0 };
    case 270:
      return { cos: 0, sin: -1 };
    default:
      throw new Error(`Unsupported quarter turn ${degrees}.`);
  }
}

function multiplyMatrix(left: number[][], right: number[][]): number[][] {
  return left.map((row, rowIndex) =>
    right[0].map((_value, columnIndex) =>
      row.reduce(
        (sum, _entry, itemIndex) =>
          sum + left[rowIndex][itemIndex] * right[itemIndex][columnIndex],
        0,
      )
    )
  );
}

function validateFingerprints(
  value: unknown,
  path: string,
): CoffeeMachineBuildPlan["fingerprints"] {
  const input = record(value, path);
  exactKeys(input, ["source", "plan", "script"], path);
  return {
    source: contentFingerprint(input.source, `${path}.source`),
    plan: contentFingerprint(input.plan, `${path}.plan`),
    script: contentFingerprint(input.script, `${path}.script`),
  };
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = record(value, path);
  exactKeys(input, ["algorithm", "digest"], path);
  literal(input.algorithm, "sha256", `${path}.algorithm`);
  if (typeof input.digest !== "string" || !SHA256.test(input.digest)) {
    throw new Error(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return fingerprint(input.digest);
}

function fingerprint(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${
    Object.keys(input).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(input[key])}`
    ).join(",")
  }}`;
}

function py(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : Number(value.toPrecision(15));
  return normalized.toString();
}

function pyString(value: string): string {
  return JSON.stringify(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unexpected.length > 0) {
    throw new Error(`${path} has unsupported field ${unexpected[0]}.`);
  }
  if (missing.length > 0) throw new Error(`${path}.${missing[0]} is required.`);
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${path}[${index}] must be a string.`);
    }
    return item;
  });
}

function tuple3(value: unknown, path: string): [number, number, number] {
  const values = array(value, path);
  if (values.length !== 3) throw new Error(`${path} must contain exactly 3 numbers.`);
  return values.map((item, index) => finiteNumber(item, `${path}[${index}]`)) as [
    number,
    number,
    number,
  ];
}

function idTuple3(value: unknown, path: string): [string, string, string] {
  const values = array(value, path);
  if (values.length !== 3) throw new Error(`${path} must contain exactly 3 ids.`);
  return values.map((item, index) => safeId(item, `${path}[${index}]`)) as [
    string,
    string,
    string,
  ];
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function safeId(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${path} must be a safe stable identifier.`);
  }
  return value;
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`);
}

function oneOf<const T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${path} is unsupported.`);
  }
  return value as T;
}

function rejectDuplicates(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${path} contains duplicate ids.`);
  }
}
