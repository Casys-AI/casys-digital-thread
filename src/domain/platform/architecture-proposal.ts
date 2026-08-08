/**
 * Domain module for the generic `model.write-architecture@1` operation.
 *
 * Pure: no I/O, no Deno.*, no fetch. All logic here is project-agnostic — the
 * word "coffee", "drone" or any product name is a defect in this module.
 *
 * WHY A FLAT PARAMETER GRAMMAR — the proposal lives in an
 * EngineeringDecisionProposal whose parameters field is reviewed and signed by
 * the human operator through MRTR. A flat key/value grammar (`component.<slug>.*`)
 * is relisible without tooling, safe to elicit in a chat interface, and parsed
 * fail-closed into a typed hierarchy on the server side. The agent never supplies
 * SysML text; the renderer here is the only authoritative source.
 */

import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";

// ── Operation identity ───────────────────────────────────────────────────────

export const MODEL_WRITE_ARCHITECTURE_OPERATION = {
  id: "model.write-architecture",
  version: "1",
} as const;

// ── Proposal types ───────────────────────────────────────────────────────────

/** One declared component in the architecture proposal. */
export interface ArchitectureComponent {
  /** PascalCase SysML identifier for the part definition, e.g. "Wing". */
  readonly name: string;
  /**
   * camelCase SysML usage identifier, e.g. "wing". Must differ from `name` to
   * prevent the `DripTray`/`dripTray` ambiguity lesson.
   */
  readonly usageName: string;
  /** Name of the parent component (another name or system.name). */
  readonly parentName: string;
}

/** Parsed, hierarchy-typed representation of the human-reviewed MRTR proposal. */
export interface ArchitectureProposal {
  readonly packageName: string;
  readonly system: { readonly name: string };
  readonly components: readonly ArchitectureComponent[];
}

// ── Error types ──────────────────────────────────────────────────────────────

export type ArchitectureProposalParseErrorCode =
  | "empty_proposal"
  | "missing_package"
  | "missing_system"
  | "unknown_key"
  | "invalid_identifier"
  | "invalid_usage_identifier"
  | "usage_same_as_name"
  | "non_string_value"
  | "duplicate_component"
  | "missing_parent"
  | "cycle_detected";

/** Structured parse failure — code is stable, message is diagnostic only. */
export class ArchitectureProposalParseError extends Error {
  readonly code: ArchitectureProposalParseErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: ArchitectureProposalParseErrorCode,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ArchitectureProposalParseError";
    this.code = code;
    this.context = context;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const SYSML_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const SYSML_USAGE_IDENTIFIER = /^[a-z][A-Za-z0-9_]*$/;
const COMPONENT_KEY = /^component\.([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z]+)$/;

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a flat list of MRTR-reviewed decision parameters into a typed
 * ArchitectureProposal.
 *
 * Fail-closed: unknown key, non-string value, invalid identifier, duplicate,
 * missing parent, cycle → ArchitectureProposalParseError with a named code.
 * This function does not validate MRTR authority — that is the executor's gate.
 */
export function parseArchitectureProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ArchitectureProposal {
  if (parameters.length === 0) {
    throw new ArchitectureProposalParseError(
      "empty_proposal",
      "The architecture proposal has no parameters.",
    );
  }

  let packageName: string | undefined;
  let systemName: string | undefined;
  const componentFields = new Map<
    string,
    { name?: string; usage?: string; parent?: string }
  >();

  for (const param of parameters) {
    if (typeof param.value !== "string") {
      throw new ArchitectureProposalParseError(
        "non_string_value",
        `Parameter "${param.key}" has a non-string value; all architecture parameters must be strings.`,
        { key: param.key, valueType: typeof param.value },
      );
    }
    const value = param.value;

    if (param.key === "architecture.package") {
      packageName = value;
      continue;
    }
    if (param.key === "system.name") {
      systemName = value;
      continue;
    }

    const match = COMPONENT_KEY.exec(param.key);
    if (!match) {
      throw new ArchitectureProposalParseError(
        "unknown_key",
        `Unknown architecture parameter key "${param.key}". Allowed keys: architecture.package, system.name, component.<slug>.(name|usage|parent).`,
        { key: param.key },
      );
    }

    const [, slug, field] = match;
    if (field !== "name" && field !== "usage" && field !== "parent") {
      throw new ArchitectureProposalParseError(
        "unknown_key",
        `Unknown component field "${field}" in key "${param.key}". Allowed fields: name, usage, parent.`,
        { key: param.key, field },
      );
    }
    if (!componentFields.has(slug!)) {
      componentFields.set(slug!, {});
    }
    const entry = componentFields.get(slug!)!;
    if (field === "name") entry.name = value;
    else if (field === "usage") entry.usage = value;
    else entry.parent = value;
  }

  if (!packageName || !packageName.trim()) {
    throw new ArchitectureProposalParseError(
      "missing_package",
      'Required parameter "architecture.package" is absent or empty.',
    );
  }
  if (!SYSML_IDENTIFIER.test(packageName)) {
    throw new ArchitectureProposalParseError(
      "invalid_identifier",
      `Package name "${packageName}" is not a valid SysML identifier (^[A-Za-z][A-Za-z0-9_]*$).`,
      { value: packageName },
    );
  }

  if (!systemName || !systemName.trim()) {
    throw new ArchitectureProposalParseError(
      "missing_system",
      'Required parameter "system.name" is absent or empty.',
    );
  }
  if (!SYSML_IDENTIFIER.test(systemName)) {
    throw new ArchitectureProposalParseError(
      "invalid_identifier",
      `System name "${systemName}" is not a valid SysML identifier (^[A-Za-z][A-Za-z0-9_]*$).`,
      { value: systemName },
    );
  }

  if (componentFields.size === 0) {
    throw new ArchitectureProposalParseError(
      "empty_proposal",
      "The architecture proposal declares no components.",
    );
  }

  const components: ArchitectureComponent[] = [];
  const componentNames = new Set<string>();

  for (const [slug, fields] of componentFields) {
    if (!fields.name || !fields.name.trim()) {
      throw new ArchitectureProposalParseError(
        "invalid_identifier",
        `Component "${slug}" is missing its "name" field.`,
        { slug },
      );
    }
    if (!SYSML_IDENTIFIER.test(fields.name)) {
      throw new ArchitectureProposalParseError(
        "invalid_identifier",
        `Component "${slug}" name "${fields.name}" is not a valid SysML identifier (^[A-Za-z][A-Za-z0-9_]*$).`,
        { slug, value: fields.name },
      );
    }
    if (!fields.usage || !fields.usage.trim()) {
      throw new ArchitectureProposalParseError(
        "invalid_usage_identifier",
        `Component "${slug}" is missing its "usage" field.`,
        { slug },
      );
    }
    if (!SYSML_USAGE_IDENTIFIER.test(fields.usage)) {
      throw new ArchitectureProposalParseError(
        "invalid_usage_identifier",
        `Component "${slug}" usage "${fields.usage}" is not a valid camelCase SysML usage identifier (^[a-z][A-Za-z0-9_]*$).`,
        { slug, value: fields.usage },
      );
    }
    if (fields.usage === fields.name) {
      throw new ArchitectureProposalParseError(
        "usage_same_as_name",
        `Component "${slug}" usage "${fields.usage}" must differ from its name to avoid SysML ambiguity.`,
        { slug, value: fields.usage },
      );
    }
    if (componentNames.has(fields.name)) {
      throw new ArchitectureProposalParseError(
        "duplicate_component",
        `Duplicate component name "${fields.name}" in the proposal.`,
        { name: fields.name },
      );
    }
    componentNames.add(fields.name);
    components.push({
      name: fields.name,
      usageName: fields.usage,
      parentName: fields.parent ?? systemName,
    });
  }

  // Validate parents: each component's parentName must be the system or another component.
  const allNames = new Set<string>([systemName, ...components.map((c) => c.name)]);
  for (const component of components) {
    if (!allNames.has(component.parentName)) {
      throw new ArchitectureProposalParseError(
        "missing_parent",
        `Component "${component.name}" references unknown parent "${component.parentName}".`,
        { name: component.name, parent: component.parentName },
      );
    }
    if (component.parentName === component.name) {
      throw new ArchitectureProposalParseError(
        "missing_parent",
        `Component "${component.name}" cannot be its own parent.`,
        { name: component.name },
      );
    }
  }

  detectCycles(systemName, components);

  return { packageName, system: { name: systemName }, components };
}

function detectCycles(
  systemName: string,
  components: readonly ArchitectureComponent[],
): void {
  const parentByName = new Map<string, string>(
    components.map((c) => [c.name, c.parentName]),
  );
  for (const component of components) {
    const visited = new Set<string>();
    let current: string | undefined = component.name;
    while (current !== undefined && current !== systemName) {
      if (visited.has(current)) {
        throw new ArchitectureProposalParseError(
          "cycle_detected",
          `Cycle detected in component hierarchy at "${current}".`,
          { component: current },
        );
      }
      visited.add(current);
      current = parentByName.get(current);
    }
  }
}

// ── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render a deterministic SysML v2 package from a parsed proposal.
 *
 * Format: `package <P> { part def <System> { <usages> } part def <Comp> { ... } }`
 * Order: system PartDef first, then components in declaration order.
 * The renderer is pure and deterministic — same input always produces the same
 * SysML text, which is why the insertion fingerprint is computable in advance.
 */
export function renderArchitectureSysml(proposal: ArchitectureProposal): string {
  const lines: string[] = [];
  lines.push(`package ${proposal.packageName} {`);

  const systemUsages = proposal.components.filter(
    (c) => c.parentName === proposal.system.name,
  );
  lines.push(`  part def ${proposal.system.name} {`);
  for (const usage of systemUsages) {
    lines.push(`    part ${usage.usageName} : ${usage.name};`);
  }
  lines.push("  }");

  for (const component of proposal.components) {
    const usages = proposal.components.filter((c) => c.parentName === component.name);
    if (usages.length === 0) {
      lines.push(`  part def ${component.name} {}`);
    } else {
      lines.push(`  part def ${component.name} {`);
      for (const usage of usages) {
        lines.push(`    part ${usage.usageName} : ${usage.name};`);
      }
      lines.push("  }");
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ── Insertion plan ───────────────────────────────────────────────────────────

/**
 * A PartUsage child extracted from a PartDef element.
 *
 * WHY targetLabel IS MANDATORY — the extractor calls syson_element_children on
 * the usage element itself to find the FeatureTyping child that names the typed
 * PartDef. Without targetLabel we cannot distinguish `part wing : Wing` from
 * `part wing : Motor`, which means both adoption and post-insertion verification
 * would silently accept the wrong type.
 */
export interface ExistingPartUsage {
  /** SysML usage identifier, e.g. "wing" (lower-camelCase). */
  readonly label: string;
  /** Label of the PartDef this usage types, e.g. "Wing". */
  readonly targetLabel: string;
}

/** A PartDef element extracted from the live SysON model. */
export interface ExistingPartDef {
  readonly id: string;
  readonly label: string;
  /** Child usages with their type targets. */
  readonly usages: readonly ExistingPartUsage[];
}

/**
 * Raised by planArchitectureInsertion when the live model contains two
 * PartDefs with the same label. This is ambiguous — the planner cannot
 * determine which one corresponds to each proposal component.
 *
 * AX #4: code is stable and machine-parseable.
 */
export class ArchitectureInsertionAmbiguityError extends Error {
  readonly code = "ambiguous_part_def_labels" as const;
  readonly duplicateLabels: readonly string[];

  constructor(duplicateLabels: readonly string[]) {
    super(
      `Ambiguous model: duplicate PartDef labels [${duplicateLabels.join(", ")}]. ` +
        "Stop for review before retrying.",
    );
    this.name = "ArchitectureInsertionAmbiguityError";
    this.duplicateLabels = duplicateLabels;
  }
}

/** Full architecture structure present in the SysON model for this package. */
export interface ExistingArchitectureStructure {
  readonly packageId: string;
  readonly packageLabel: string;
  readonly partDefs: readonly ExistingPartDef[];
}

export interface AdoptedItem {
  readonly componentName: string;
  readonly existingPartDefId: string;
}

/**
 * A named structural conflict that prevents automatic insertion.
 *
 * "same-name-different-parent" — the usage already exists under a different
 *   parent. Insertion would create a duplicate usage name across parents, which
 *   SysON does not allow without an explicit relocation step.
 *
 * "mistyped_usage" — the usage exists under the correct parent but its
 *   FeatureTyping points to the wrong PartDef. Insertion cannot fix a typing;
 *   that requires a separate model operation (rewrite of the FeatureTyping
 *   relationship). Stop the plan and surface this for human review.
 *
 * "ambiguous_usage" — multiple usages with the proposed name already exist
 *   under the same parent. Even if one happens to have the expected type, the
 *   model no longer has a unique parent→usage→target relationship to adopt.
 */
export type ArchitectureInsertionConflict =
  | {
    readonly code: "same-name-different-parent";
    readonly componentName: string;
    readonly message: string;
  }
  | {
    readonly code: "mistyped_usage";
    readonly componentName: string;
    readonly message: string;
  }
  | {
    readonly code: "ambiguous_usage";
    readonly componentName: string;
    readonly message: string;
  };

/**
 * One unit of work the executor must perform.
 *
 * "full-package" — initial mode: insert the complete SysML package text in one
 *   call under the seed's rootPackage element.
 * "part-def" — enrichment mode: insert one empty `part def <name> {}` under the
 *   architecture package element.
 * "usage" — enrichment mode: insert one `part <usageName> : <name>;` under the
 *   named parent's PartDef element.
 */
export type InsertionItem =
  | { readonly kind: "full-package" }
  | { readonly kind: "part-def"; readonly componentName: string }
  | {
    readonly kind: "usage";
    readonly componentName: string;
    readonly usageName: string;
    readonly parentName: string;
  };

export interface ArchitectureInsertionPlan {
  readonly mode: "initial" | "enrichment";
  readonly toInsert: readonly InsertionItem[];
  readonly adopted: readonly AdoptedItem[];
  readonly conflicts: readonly ArchitectureInsertionConflict[];
}

/**
 * Compute the insertion plan for anchoring a proposal against an existing
 * (or absent) SysON architecture structure.
 *
 * Initial mode: the package is absent — one full-package item covers everything.
 * Enrichment mode: diff the proposal against the existing model. Components
 * present and conformant are adopted; new components generate part-def and usage
 * items in topological order (parents before children). A PartDef with the same
 * name but its usage under a different parent is an unresolvable conflict.
 *
 * An empty `toInsert` with no conflicts means all components are already adopted.
 * The executor must reject this as `invalid_transition` — no empty writes.
 */
export function planArchitectureInsertion(
  existing: ExistingArchitectureStructure | undefined,
  proposal: ArchitectureProposal,
): ArchitectureInsertionPlan {
  if (!existing) {
    return {
      mode: "initial",
      toInsert: [{ kind: "full-package" }],
      adopted: [],
      conflicts: [],
    };
  }

  // Finding 5 — fail-closed on duplicate PartDef labels. Two PartDefs with the
  // same label are ambiguous: the planner cannot map each proposal component to
  // the intended element. Stop before any insertion rather than silently adopt
  // or insert the wrong element.
  const labelCounts = new Map<string, number>();
  for (const pd of existing.partDefs) {
    labelCounts.set(pd.label, (labelCounts.get(pd.label) ?? 0) + 1);
  }
  const duplicateLabels = [...labelCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label);
  if (duplicateLabels.length > 0) {
    throw new ArchitectureInsertionAmbiguityError(duplicateLabels);
  }

  const partDefByLabel = new Map<string, ExistingPartDef>(
    existing.partDefs.map((pd) => [pd.label, pd]),
  );

  // Process in topological order: system first, then components (parents first).
  const orderedNames = topologicalOrder(proposal);

  const toInsert: InsertionItem[] = [];
  const adopted: AdoptedItem[] = [];
  const conflicts: ArchitectureInsertionConflict[] = [];

  for (const name of orderedNames) {
    const isSystem = name === proposal.system.name;
    const existingPartDef = partDefByLabel.get(name);

    if (isSystem) {
      if (!existingPartDef) {
        toInsert.push({ kind: "part-def", componentName: name });
      }
      continue;
    }

    // A usage name belongs to exactly one parent in this operation's model
    // contract. Check every existing parent BEFORE deciding whether to adopt a
    // PartDef or to create one: otherwise an absent component PartDef can add a
    // second usage, and an already-conformant local usage can hide a homonym
    // under another parent.
    const component = proposal.components.find(
      (candidate) => candidate.name === name,
    )!;
    const parentPartDef = partDefByLabel.get(component.parentName);
    const conflictingParents = existing.partDefs.filter(
      (pd) =>
        pd.label !== component.parentName &&
        pd.usages.some((usage) => usage.label === component.usageName),
    );
    if (conflictingParents.length > 0) {
      conflicts.push({
        code: "same-name-different-parent",
        componentName: name,
        message: `Component "${name}" usage "${component.usageName}" exists under ` +
          `${conflictingParents.map((parent) => `"${parent.label}"`).join(", ")} ` +
          `instead of the proposed "${component.parentName}".`,
      });
      continue;
    }

    const usagesWithProposedName = parentPartDef
      ? parentPartDef.usages.filter((usage) => usage.label === component.usageName)
      : [];
    if (usagesWithProposedName.length > 1) {
      conflicts.push({
        code: "ambiguous_usage",
        componentName: name,
        message:
          `Usage "${component.usageName}" appears ${usagesWithProposedName.length} times ` +
          `under "${component.parentName}". A unique parent→usage→target relationship ` +
          "is required before this architecture run can proceed.",
      });
      continue;
    }

    if (!existingPartDef) {
      // PartDef doesn't exist → insert it.
      toInsert.push({ kind: "part-def", componentName: name });

      // A matching usage is already occupied under the intended parent. Even
      // though the PartDef is absent, inserting a new usage would create a
      // homonym rather than repair the existing FeatureTyping.
      const existingUsage = usagesWithProposedName[0];
      if (existingUsage) {
        toInsert.pop();
        conflicts.push({
          code: "mistyped_usage",
          componentName: name,
          message: `Usage "${component.usageName}" under "${component.parentName}" ` +
            `already types "${existingUsage.targetLabel}" while proposed PartDef ` +
            `"${name}" is absent. A FeatureTyping correction requires a separate ` +
            "model operation before this architecture run can proceed.",
        });
        continue;
      }
      toInsert.push({
        kind: "usage",
        componentName: name,
        usageName: component.usageName,
        parentName: component.parentName,
      });
      continue;
    }

    // PartDef exists. Adopt or detect conflicts for non-system components.
    if (parentPartDef) {
      // Finding 2 — adoption requires both the correct usage label AND the
      // correct target PartDef (targetLabel). A usage "wing" that types "Motor"
      // is NOT a conformant adoption of component Wing.
      const existingUsage = usagesWithProposedName[0];
      if (existingUsage?.targetLabel === component.name) {
        // Both PartDef and usage under correct parent exist, typed correctly → adopted.
        adopted.push({ componentName: name, existingPartDefId: existingPartDef.id });
        continue;
      }
      // Usage is missing or mis-typed under the correct parent. Diagnose in
      // order of severity: mistyping beats a conflicting parent, which beats
      // a simple absence.

      // BLOQUANT B — a usage with the right name already exists under the
      // correct parent but its FeatureTyping points to the wrong PartDef.
      // Insertion cannot repair a FeatureTyping; it would create a second
      // homonymous usage under the same parent. Surface this as a named
      // conflict so the operator knows a separate model-correction step is
      // required before this architecture run can proceed.
      if (existingUsage) {
        conflicts.push({
          code: "mistyped_usage",
          componentName: name,
          message: `Usage "${component.usageName}" under "${component.parentName}" ` +
            `types "${existingUsage.targetLabel}" instead of proposed "${name}". ` +
            `A FeatureTyping correction requires a separate model operation before ` +
            `this architecture run can proceed.`,
        });
        continue;
      }
      // Usage is simply absent → insert it.
      toInsert.push({
        kind: "usage",
        componentName: name,
        usageName: component.usageName,
        parentName: component.parentName,
      });
    } else {
      // Parent PartDef doesn't exist in the model yet (it's a new component).
      // We'll insert the parent first (it appears before this in topological order).
      // Insert usage too.
      toInsert.push({
        kind: "usage",
        componentName: name,
        usageName: component.usageName,
        parentName: component.parentName,
      });
    }
  }

  return { mode: "enrichment", toInsert, adopted, conflicts };
}

/**
 * Return proposal component names in topological order: parents before children.
 * System is always first, followed by components sorted so a parent always
 * precedes any of its children.
 */
function topologicalOrder(proposal: ArchitectureProposal): readonly string[] {
  const order: string[] = [proposal.system.name];
  const added = new Set<string>([proposal.system.name]);
  const byName = new Map<string, ArchitectureComponent>(
    proposal.components.map((c) => [c.name, c]),
  );

  function visit(name: string): void {
    if (added.has(name)) return;
    const component = byName.get(name);
    if (component && !added.has(component.parentName)) {
      visit(component.parentName);
    }
    if (!added.has(name)) {
      order.push(name);
      added.add(name);
    }
  }

  for (const component of proposal.components) {
    visit(component.name);
  }
  return order;
}
