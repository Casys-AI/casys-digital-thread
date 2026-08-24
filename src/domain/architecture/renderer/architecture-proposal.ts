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

import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  exactRecord,
  PROPOSAL_PARAMETER_SLUG_BODY,
} from "../../kernel/case-validation.ts";

// ── Operation identity ───────────────────────────────────────────────────────

export const MODEL_WRITE_ARCHITECTURE_OPERATION = {
  id: "model.write-architecture",
  version: "1",
} as const;

// ── Proposal types ───────────────────────────────────────────────────────────

/** One reviewed PartUsage occurrence and the PartDefinition it targets. */
export interface ArchitectureComponent {
  /**
   * PascalCase SysML identifier for the target part definition, e.g. "Motor".
   * Several occurrences may intentionally share this name.
   */
  readonly name: string;
  /**
   * camelCase SysML usage identifier, e.g. "wing". Must differ from `name` to
   * prevent the `Motor`/`motor` definition-versus-occurrence ambiguity.
   */
  readonly usageName: string;
  /** Name of the parent component (another name or system.name). */
  readonly parentName: string;
}

/** One reviewed AttributeUsage owned by a PartDefinition. */
export interface ArchitectureAttribute {
  /** camelCase SysML identifier, e.g. "thickness". */
  readonly name: string;
  /** PartDefinition that owns the attribute (system.name or a component name). */
  readonly parentName: string;
}

/** Parsed, hierarchy-typed representation of the human-reviewed MRTR proposal. */
export interface ArchitectureProposal {
  readonly packageName: string;
  readonly system: { readonly name: string };
  readonly components: readonly ArchitectureComponent[];
  readonly attributes?: readonly ArchitectureAttribute[];
}

// ── Error types ──────────────────────────────────────────────────────────────

export type ArchitectureProposalParseErrorCode =
  | "empty_proposal"
  | "missing_package"
  | "missing_system"
  | "unknown_key"
  | "invalid_identifier"
  | "invalid_slug"
  | "invalid_usage_identifier"
  | "usage_same_as_name"
  | "non_string_value"
  | "duplicate_usage"
  | "duplicate_attribute"
  | "missing_parent"
  | "missing_attribute_parent"
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
/** Slug is the shared proposal-parameter grammar, not a SysML identifier. */
const COMPONENT_KEY = new RegExp(
  `^component\\.(${PROPOSAL_PARAMETER_SLUG_BODY})\\.(name|usage|parent)$`,
);
const ATTRIBUTE_KEY = new RegExp(
  `^attribute\\.(${PROPOSAL_PARAMETER_SLUG_BODY})\\.(name|parent)$`,
);
const COMPONENT_KEY_SHAPE = /^component\.(.+)\.(name|usage|parent)$/;
const ATTRIBUTE_KEY_SHAPE = /^attribute\.(.+)\.(name|parent)$/;

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
  const attributeFields = new Map<string, { name?: string; parent?: string }>();

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

    const attributeMatch = ATTRIBUTE_KEY.exec(param.key);
    if (attributeMatch) {
      const slug = attributeMatch[1]!;
      const field = attributeMatch[2]!;
      const entry = attributeFields.get(slug) ?? {};
      if (field === "name") entry.name = value;
      else entry.parent = value;
      attributeFields.set(slug, entry);
      continue;
    }
    rejectMalformedArchitectureSlug(param.key, "attribute", ATTRIBUTE_KEY_SHAPE);

    const match = COMPONENT_KEY.exec(param.key);
    if (match) {
      const [, slug, field] = match;
      if (!componentFields.has(slug!)) {
        componentFields.set(slug!, {});
      }
      const entry = componentFields.get(slug!)!;
      if (field === "name") entry.name = value;
      else if (field === "usage") entry.usage = value;
      else entry.parent = value;
      continue;
    }
    rejectMalformedArchitectureSlug(param.key, "component", COMPONENT_KEY_SHAPE);

    throw new ArchitectureProposalParseError(
      "unknown_key",
      `Unknown architecture parameter key "${param.key}". Allowed keys: architecture.package, system.name, component.<slug>.(name|usage|parent), attribute.<slug>.(name|parent).`,
      { key: param.key },
    );
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

  const components: ArchitectureComponent[] = [];

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

  // A PartUsage name is scoped by its owning PartDefinition. Reusing `motor`
  // under LeftWing and RightWing is valid; declaring it twice under LeftWing is
  // not, regardless of whether both rows target the same PartDefinition.
  const occurrenceKeys = new Set<string>();
  for (const component of components) {
    const key = `${component.parentName}\u0000${component.usageName}`;
    if (occurrenceKeys.has(key)) {
      throw new ArchitectureProposalParseError(
        "duplicate_usage",
        `Duplicate usage "${component.usageName}" under parent "${component.parentName}" in the proposal.`,
        { parentName: component.parentName, usageName: component.usageName },
      );
    }
    occurrenceKeys.add(key);
  }

  detectCycles(systemName, components);

  const definitionNames = new Set<string>([
    systemName,
    ...components.map((component) => component.name),
  ]);
  const attributes: ArchitectureAttribute[] = [];
  const attributeNames = new Set<string>();
  for (const [slug, fields] of attributeFields) {
    if (!fields.name || !fields.name.trim()) {
      throw new ArchitectureProposalParseError(
        "invalid_identifier",
        `Attribute "${slug}" is missing its "name" field.`,
        { slug },
      );
    }
    if (!SYSML_USAGE_IDENTIFIER.test(fields.name)) {
      throw new ArchitectureProposalParseError(
        "invalid_identifier",
        `Attribute "${slug}" name "${fields.name}" is not a valid SysML usage identifier (^[a-z][A-Za-z0-9_]*$).`,
        { slug, value: fields.name },
      );
    }
    const parentName = fields.parent ?? systemName;
    if (!definitionNames.has(parentName)) {
      throw new ArchitectureProposalParseError(
        "missing_attribute_parent",
        `Attribute "${fields.name}" references unknown parent "${parentName}".`,
        { name: fields.name, parent: parentName },
      );
    }
    if (attributeNames.has(fields.name)) {
      throw new ArchitectureProposalParseError(
        "duplicate_attribute",
        `Duplicate attribute "${fields.name}" in the proposal.`,
        { name: fields.name },
      );
    }
    attributeNames.add(fields.name);
    attributes.push({ name: fields.name, parentName });
  }

  return {
    packageName,
    system: { name: systemName },
    components,
    attributes,
  };
}

function rejectMalformedArchitectureSlug(
  key: string,
  kind: "component" | "attribute",
  shape: RegExp,
): void {
  const match = shape.exec(key);
  if (!match) return;
  const slug = match[1]!;
  throw new ArchitectureProposalParseError(
    "invalid_slug",
    `${kind === "component" ? "Component" : "Attribute"} slug "${slug}" in key ` +
      `"${key}" is not a valid proposal parameter slug (^[A-Za-z0-9][A-Za-z0-9_-]*$). ` +
      "Dots and colons are refused because they make the dotted key grammar ambiguous.",
    { key, slug },
  );
}

function detectCycles(
  systemName: string,
  components: readonly ArchitectureComponent[],
): void {
  const childrenByParent = new Map<string, Set<string>>();
  for (const component of components) {
    const children = childrenByParent.get(component.parentName) ?? new Set<string>();
    children.add(component.name);
    childrenByParent.set(component.parentName, children);
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (name: string): void => {
    if (active.has(name)) {
      throw new ArchitectureProposalParseError(
        "cycle_detected",
        `Cycle detected in component hierarchy at "${name}".`,
        { component: name },
      );
    }
    if (visited.has(name)) return;
    active.add(name);
    for (const child of childrenByParent.get(name) ?? []) {
      if (child === systemName) {
        throw new ArchitectureProposalParseError(
          "cycle_detected",
          `Cycle detected in component hierarchy at "${child}".`,
          { component: child },
        );
      }
      visit(child);
    }
    active.delete(name);
    visited.add(name);
  };

  for (
    const name of [
      systemName,
      ...components.flatMap((component) => [component.parentName, component.name]),
    ]
  ) visit(name);
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
export interface SysmlSourceSpan {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

export type SysmlArchitectureSourceSelector =
  | { readonly kind: "full-package"; readonly packageName: string }
  | {
    readonly kind: "part-def";
    readonly packageName: string;
    readonly componentName: string;
  }
  | {
    readonly kind: "usage";
    readonly packageName: string;
    readonly componentName: string;
    readonly usageName: string;
    readonly parentName: string;
  }
  | {
    readonly kind: "attribute";
    readonly packageName: string;
    readonly parentName: string;
    readonly attributeName: string;
  };

export interface RenderedArchitectureSysmlEntry {
  readonly kind: "package" | "part-definition" | "part-usage" | "attribute";
  readonly selector: SysmlArchitectureSourceSelector;
  readonly packageName: string;
  readonly parentName?: string;
  readonly definitionName?: string;
  /** The legacy renderer emits the system definition as a block even when empty. */
  readonly bodyStyle?: "block" | "empty";
  readonly usageName?: string;
  readonly targetName?: string;
  readonly attributeName?: string;
  readonly span: SysmlSourceSpan;
}

export interface RenderedArchitectureSysmlManifest {
  readonly schemaVersion: "rendered-architecture-sysml-manifest/1.0";
  readonly selector: SysmlArchitectureSourceSelector;
  readonly entries: readonly RenderedArchitectureSysmlEntry[];
}

export interface RenderedArchitectureSysml {
  readonly sourceText: string;
  readonly manifest: RenderedArchitectureSysmlManifest;
}

/**
 * Render one server-owned SysML write form and simultaneously attest the exact
 * constructs it emitted. This is deliberately a renderer/source-map pair, not
 * a parser for arbitrary SysML text.
 */
export function renderArchitectureSysmlWithManifest(
  proposal: ArchitectureProposal,
  selector: SysmlArchitectureSourceSelector = {
    kind: "full-package",
    packageName: proposal.packageName,
  },
): RenderedArchitectureSysml {
  const normalized = normalizeSysmlSelector(proposal, selector);
  const output: Array<{
    readonly text: string;
    readonly entry?: Omit<RenderedArchitectureSysmlEntry, "span">;
  }> = [];
  const add = (
    text: string,
    entry?: Omit<RenderedArchitectureSysmlEntry, "span">,
  ): void => {
    output.push({ text, entry });
  };

  if (normalized.kind === "part-def") {
    add(`part def ${normalized.componentName} {}`, {
      kind: "part-definition",
      selector: normalized,
      packageName: normalized.packageName,
      definitionName: normalized.componentName,
      bodyStyle: "empty",
    });
  } else if (normalized.kind === "usage") {
    add(`part ${normalized.usageName} : ${normalized.componentName};`, {
      kind: "part-usage",
      selector: normalized,
      packageName: normalized.packageName,
      parentName: normalized.parentName,
      usageName: normalized.usageName,
      targetName: normalized.componentName,
    });
  } else if (normalized.kind === "attribute") {
    add(`attribute ${normalized.attributeName};`, {
      kind: "attribute",
      selector: normalized,
      packageName: normalized.packageName,
      parentName: normalized.parentName,
      attributeName: normalized.attributeName,
    });
  } else {
    add(`package ${proposal.packageName} {`, {
      kind: "package",
      selector: normalized,
      packageName: proposal.packageName,
    });
    const definitionNames = [
      proposal.system.name,
      ...[...new Set(proposal.components.map((component) => component.name))]
        .filter((name) => name !== proposal.system.name),
    ];
    for (const definitionName of definitionNames) {
      const usages = proposal.components.filter((component) =>
        component.parentName === definitionName
      );
      const attributes = proposalAttributes(proposal).filter((attribute) =>
        attribute.parentName === definitionName
      );
      if (
        usages.length === 0 && attributes.length === 0 &&
        definitionName !== proposal.system.name
      ) {
        add(`  part def ${definitionName} {}`, {
          kind: "part-definition",
          selector: normalized,
          packageName: proposal.packageName,
          definitionName,
          bodyStyle: "empty",
        });
        continue;
      }
      add(`  part def ${definitionName} {`, {
        kind: "part-definition",
        selector: normalized,
        packageName: proposal.packageName,
        definitionName,
        bodyStyle: "block",
      });
      for (const usage of usages) {
        add(`    part ${usage.usageName} : ${usage.name};`, {
          kind: "part-usage",
          selector: normalized,
          packageName: proposal.packageName,
          parentName: definitionName,
          usageName: usage.usageName,
          targetName: usage.name,
        });
      }
      for (const attribute of attributes) {
        add(`    attribute ${attribute.name};`, {
          kind: "attribute",
          selector: normalized,
          packageName: proposal.packageName,
          parentName: definitionName,
          attributeName: attribute.name,
        });
      }
      add("  }");
    }
    add("}");
  }
  const sourceText = output.map((line) => line.text).join("\n");
  const entries = output.flatMap((line, index) =>
    line.entry
      ? [{
        ...line.entry,
        span: {
          start: { line: index + 1, column: 0 },
          end: { line: index + 1, column: line.text.length },
        },
      }]
      : []
  );
  return Object.freeze({
    sourceText,
    manifest: Object.freeze({
      schemaVersion: "rendered-architecture-sysml-manifest/1.0",
      selector: normalized,
      entries: Object.freeze(entries),
    }),
  });
}

/** Reconstruct solely from the attested manifest; reject any altered bytes. */
export function validateRenderedArchitectureSysml(
  value: unknown,
): RenderedArchitectureSysml {
  const rendered = exactRecord(value, ["sourceText", "manifest"], "$renderedSysml");
  if (typeof rendered.sourceText !== "string" || rendered.sourceText.length === 0) {
    throw new TypeError("$renderedSysml.sourceText must be non-empty text.");
  }
  const manifest = parseRenderedArchitectureManifest(rendered.manifest);
  const expected = sourceFromManifest(manifest);
  if (rendered.sourceText !== expected) {
    throw new TypeError(
      "Rendered SysML source does not exactly match its attested manifest.",
    );
  }
  return Object.freeze({ sourceText: rendered.sourceText, manifest });
}

/** Legacy full-package renderer: intentionally byte-identical to its predecessor. */
export function renderArchitectureSysml(proposal: ArchitectureProposal): string {
  return renderArchitectureSysmlWithManifest(proposal).sourceText;
}

function normalizeSysmlSelector(
  proposal: ArchitectureProposal,
  selector: SysmlArchitectureSourceSelector,
): SysmlArchitectureSourceSelector {
  if (selector.packageName !== proposal.packageName) {
    throw new TypeError(
      "SysML source selector must name the proposal package exactly.",
    );
  }
  if (selector.kind === "full-package") return Object.freeze({ ...selector });
  if (selector.kind === "part-def") {
    const definitions = new Set([
      proposal.system.name,
      ...proposal.components.map((c) => c.name),
    ]);
    if (!definitions.has(selector.componentName)) {
      throw new TypeError(
        "SysML part-definition selector is not declared by proposal.",
      );
    }
    return Object.freeze({ ...selector });
  }
  if (selector.kind === "attribute") {
    if (
      !proposalAttributes(proposal).some((attribute) =>
        attribute.name === selector.attributeName &&
        attribute.parentName === selector.parentName
      )
    ) {
      throw new TypeError(
        "SysML attribute selector is not one exact proposal attribute.",
      );
    }
    return Object.freeze({ ...selector });
  }
  if (
    !proposal.components.some((component) =>
      component.name === selector.componentName &&
      component.usageName === selector.usageName &&
      component.parentName === selector.parentName
    )
  ) throw new TypeError("SysML usage selector is not one exact proposal occurrence.");
  return Object.freeze({ ...selector });
}

function parseRenderedArchitectureManifest(
  value: unknown,
): RenderedArchitectureSysmlManifest {
  const raw = exactRecord(
    value,
    ["schemaVersion", "selector", "entries"],
    "$renderedSysml.manifest",
  );
  if (raw.schemaVersion !== "rendered-architecture-sysml-manifest/1.0") {
    throw new TypeError("Unsupported rendered SysML manifest schema.");
  }
  const selector = parseArchitectureSysmlSelector(
    raw.selector,
    "$renderedSysml.manifest.selector",
  );
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    throw new TypeError("Rendered SysML manifest must contain entries.");
  }
  const entries = raw.entries.map((entry, index) =>
    parseRenderedEntry(entry, `$renderedSysml.manifest.entries[${index}]`, selector)
  );
  return Object.freeze({
    schemaVersion: "rendered-architecture-sysml-manifest/1.0",
    selector,
    entries: Object.freeze(entries),
  });
}

export function parseArchitectureSysmlSelector(
  value: unknown,
  path: string,
): SysmlArchitectureSourceSelector {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (record?.kind === "full-package") {
    const raw = exactRecord(value, ["kind", "packageName"], path);
    return Object.freeze({
      kind: "full-package",
      packageName: sysmlName(raw.packageName, `${path}.packageName`),
    });
  }
  if (record?.kind === "part-def") {
    const raw = exactRecord(value, ["kind", "packageName", "componentName"], path);
    return Object.freeze({
      kind: "part-def",
      packageName: sysmlName(raw.packageName, `${path}.packageName`),
      componentName: sysmlName(raw.componentName, `${path}.componentName`),
    });
  }
  if (record?.kind === "attribute") {
    const raw = exactRecord(value, [
      "kind",
      "packageName",
      "parentName",
      "attributeName",
    ], path);
    return Object.freeze({
      kind: "attribute",
      packageName: sysmlName(raw.packageName, `${path}.packageName`),
      parentName: sysmlName(raw.parentName, `${path}.parentName`),
      attributeName: sysmlUsageName(raw.attributeName, `${path}.attributeName`),
    });
  }
  const raw = exactRecord(value, [
    "kind",
    "packageName",
    "componentName",
    "usageName",
    "parentName",
  ], path);
  if (raw.kind !== "usage") {
    throw new TypeError(`${path}.kind must name a registered write form.`);
  }
  return Object.freeze({
    kind: "usage",
    packageName: sysmlName(raw.packageName, `${path}.packageName`),
    componentName: sysmlName(raw.componentName, `${path}.componentName`),
    usageName: sysmlUsageName(raw.usageName, `${path}.usageName`),
    parentName: sysmlName(raw.parentName, `${path}.parentName`),
  });
}

function parseRenderedEntry(
  value: unknown,
  path: string,
  selector: SysmlArchitectureSourceSelector,
): RenderedArchitectureSysmlEntry {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!record) throw new TypeError(`${path} must be an object.`);
  const fields = ["kind", "selector", "packageName", "span"];
  if (record.kind === "part-definition") fields.push("definitionName", "bodyStyle");
  if (record.kind === "part-usage") {
    fields.push("parentName", "usageName", "targetName");
  }
  if (record.kind === "attribute") {
    fields.push("parentName", "attributeName");
  }
  const raw = exactRecord(value, fields, path);
  const entrySelector = parseArchitectureSysmlSelector(
    raw.selector,
    `${path}.selector`,
  );
  if (deterministicJson(entrySelector) !== deterministicJson(selector)) {
    throw new TypeError(`${path}.selector must equal manifest selector.`);
  }
  const packageName = sysmlName(raw.packageName, `${path}.packageName`);
  if (packageName !== selector.packageName) {
    throw new TypeError(`${path}.packageName must equal selector packageName.`);
  }
  const span = parseSysmlSpan(raw.span, `${path}.span`);
  if (raw.kind === "package") return { kind: "package", selector, packageName, span };
  if (raw.kind === "part-definition") {
    if (raw.bodyStyle !== "block" && raw.bodyStyle !== "empty") {
      throw new TypeError(`${path}.bodyStyle is unsupported.`);
    }
    return {
      kind: "part-definition",
      selector,
      packageName,
      definitionName: sysmlName(raw.definitionName, `${path}.definitionName`),
      bodyStyle: raw.bodyStyle,
      span,
    };
  }
  if (raw.kind === "attribute") {
    return {
      kind: "attribute",
      selector,
      packageName,
      parentName: sysmlName(raw.parentName, `${path}.parentName`),
      attributeName: sysmlUsageName(raw.attributeName, `${path}.attributeName`),
      span,
    };
  }
  if (raw.kind !== "part-usage") throw new TypeError(`${path}.kind is unsupported.`);
  return {
    kind: "part-usage",
    selector,
    packageName,
    parentName: sysmlName(raw.parentName, `${path}.parentName`),
    usageName: sysmlUsageName(raw.usageName, `${path}.usageName`),
    targetName: sysmlName(raw.targetName, `${path}.targetName`),
    span,
  };
}

function parseSysmlSpan(value: unknown, path: string): SysmlSourceSpan {
  const raw = exactRecord(value, ["start", "end"], path);
  const point = (value: unknown, pointPath: string) => {
    const raw = exactRecord(value, ["line", "column"], pointPath);
    const line = raw.line;
    const column = raw.column;
    if (
      typeof line !== "number" || !Number.isSafeInteger(line) || line < 1 ||
      typeof column !== "number" || !Number.isSafeInteger(column) || column < 0
    ) throw new TypeError(`${pointPath} is invalid.`);
    return { line, column };
  };
  const start = point(raw.start, `${path}.start`);
  const end = point(raw.end, `${path}.end`);
  if (end.line < start.line || (end.line === start.line && end.column < start.column)) {
    throw new TypeError(`${path}.end precedes start.`);
  }
  return { start, end };
}

function sourceFromManifest(manifest: RenderedArchitectureSysmlManifest): string {
  const entries = manifest.entries;
  if (manifest.selector.kind === "part-def") {
    if (
      entries.length !== 1 || entries[0]?.kind !== "part-definition" ||
      entries[0].definitionName !== manifest.selector.componentName
    ) throw new TypeError("Part-definition manifest is not exact.");
    if (entries[0].bodyStyle !== "empty") {
      throw new TypeError("Part-definition manifest must use the empty write form.");
    }
    const sourceText = `part def ${manifest.selector.componentName} {}`;
    assertManifestSpans(sourceText, entries);
    return sourceText;
  }
  if (manifest.selector.kind === "usage") {
    if (
      entries.length !== 1 || entries[0]?.kind !== "part-usage" ||
      entries[0].usageName !== manifest.selector.usageName ||
      entries[0].targetName !== manifest.selector.componentName ||
      entries[0].parentName !== manifest.selector.parentName
    ) throw new TypeError("Usage manifest is not exact.");
    const sourceText =
      `part ${manifest.selector.usageName} : ${manifest.selector.componentName};`;
    assertManifestSpans(sourceText, entries);
    return sourceText;
  }
  if (manifest.selector.kind === "attribute") {
    if (
      entries.length !== 1 || entries[0]?.kind !== "attribute" ||
      entries[0].attributeName !== manifest.selector.attributeName ||
      entries[0].parentName !== manifest.selector.parentName
    ) throw new TypeError("Attribute manifest is not exact.");
    const sourceText = `attribute ${manifest.selector.attributeName};`;
    assertManifestSpans(sourceText, entries);
    return sourceText;
  }
  if (entries[0]?.kind !== "package") {
    throw new TypeError("Full-package manifest must start with package.");
  }
  const lines = [`package ${manifest.selector.packageName} {`];
  let index = 1;
  const definitionNames = new Set<string>();
  const usageNamesByParent = new Set<string>();
  const usageTargetNames = new Set<string>();
  while (index < entries.length) {
    const definition = entries[index];
    if (definition?.kind !== "part-definition") {
      throw new TypeError("Full-package manifest has invalid entry order.");
    }
    if (definitionNames.has(definition.definitionName!)) {
      throw new TypeError(
        "Full-package manifest has duplicate PartDefinition entries.",
      );
    }
    definitionNames.add(definition.definitionName!);
    index += 1;
    const usages: RenderedArchitectureSysmlEntry[] = [];
    while (
      entries[index]?.kind === "part-usage" &&
      entries[index]?.parentName === definition.definitionName
    ) usages.push(entries[index++]!);
    const attributes: RenderedArchitectureSysmlEntry[] = [];
    while (
      entries[index]?.kind === "attribute" &&
      entries[index]?.parentName === definition.definitionName
    ) attributes.push(entries[index++]!);
    if (
      (usages.length > 0 || attributes.length > 0) &&
      definition.bodyStyle !== "block"
    ) {
      throw new TypeError(
        "A PartDefinition with usages or attributes must use the block write form.",
      );
    }
    for (const usage of usages) {
      const identity = deterministicJson({
        parentName: usage.parentName,
        usageName: usage.usageName,
      });
      if (usageNamesByParent.has(identity)) {
        throw new TypeError(
          "Full-package manifest has duplicate scoped PartUsage entries.",
        );
      }
      usageNamesByParent.add(identity);
      usageTargetNames.add(usage.targetName!);
    }
    if (
      usages.length === 0 && attributes.length === 0 &&
      definition.bodyStyle === "empty"
    ) {
      lines.push(`  part def ${definition.definitionName} {}`);
    } else {
      lines.push(`  part def ${definition.definitionName} {`);
      for (const usage of usages) {
        lines.push(`    part ${usage.usageName} : ${usage.targetName};`);
      }
      for (const attribute of attributes) {
        lines.push(`    attribute ${attribute.attributeName};`);
      }
      lines.push("  }");
    }
  }
  for (const targetName of usageTargetNames) {
    if (!definitionNames.has(targetName)) {
      throw new TypeError("Full-package manifest usage target has no PartDefinition.");
    }
  }
  lines.push("}");
  const sourceText = lines.join("\n");
  assertManifestSpans(sourceText, manifest.entries);
  return sourceText;
}

function assertManifestSpans(
  sourceText: string,
  entries: readonly RenderedArchitectureSysmlEntry[],
): void {
  const lines = sourceText.split("\n");
  let nextLine = 0;
  const expectedSpans = entries.map((entry) => {
    const needle = entry.kind === "package"
      ? `package ${entry.packageName} {`
      : entry.kind === "part-definition"
      ? `part def ${entry.definitionName}`
      : entry.kind === "attribute"
      ? `attribute ${entry.attributeName};`
      : `part ${entry.usageName} : ${entry.targetName};`;
    const offset = lines.slice(nextLine).findIndex((line) =>
      line.trimStart().startsWith(needle)
    );
    if (offset < 0) {
      throw new TypeError("Rendered SysML manifest entry does not occur in order.");
    }
    const lineIndex = nextLine + offset;
    nextLine = lineIndex + 1;
    return {
      start: { line: lineIndex + 1, column: 0 },
      end: { line: lineIndex + 1, column: lines[lineIndex]!.length },
    };
  });
  if (
    deterministicJson(expectedSpans) !==
      deterministicJson(entries.map((entry) => entry.span))
  ) {
    throw new TypeError("Rendered SysML manifest spans do not match source.");
  }
}

function sysmlName(value: unknown, path: string): string {
  if (typeof value !== "string" || !SYSML_IDENTIFIER.test(value)) {
    throw new TypeError(`${path} must be a SysML identifier.`);
  }
  return value;
}

function sysmlUsageName(value: unknown, path: string): string {
  if (typeof value !== "string" || !SYSML_USAGE_IDENTIFIER.test(value)) {
    throw new TypeError(`${path} must be a SysML usage identifier.`);
  }
  return value;
}

function proposalAttributes(
  proposal: ArchitectureProposal,
): readonly ArchitectureAttribute[] {
  return proposal.attributes ?? [];
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
  /** Provider-owned PartUsage identity, captured rather than reconstructed. */
  readonly id?: string;
  /** Exact provider semantic kind, e.g. sysml::PartUsage. */
  readonly kind?: string;
  /** SysML usage identifier, e.g. "wing" (lower-camelCase). */
  readonly label: string;
  /** Label of the PartDef this usage types, e.g. "Wing". */
  readonly targetLabel: string;
  /** Provider-owned typed PartDefinition identity returned by the closed AQL. */
  readonly targetId?: string;
  /** Exact semantic kind returned by the closed AQL. */
  readonly targetKind?: string;
}

/** A reviewed AttributeUsage child extracted from a PartDef. */
export interface ExistingAttribute {
  readonly id?: string;
  readonly kind?: string;
  readonly label: string;
}

/** A PartDef element extracted from the live SysON model. */
export interface ExistingPartDef {
  readonly id: string;
  /** Exact provider semantic kind, e.g. sysml::PartDefinition. */
  readonly kind?: string;
  readonly label: string;
  /** Child usages with their type targets. */
  readonly usages: readonly ExistingPartUsage[];
  readonly attributes?: readonly ExistingAttribute[];
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
    readonly code: "mistyped_usage";
    readonly componentName: string;
    readonly message: string;
  }
  | {
    readonly code: "ambiguous_usage";
    readonly componentName: string;
    readonly message: string;
  }
  | {
    readonly code: "ambiguous_attribute";
    readonly attributeName: string;
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
 * "attribute" — enrichment mode: insert one `attribute <name>;` under the
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
  }
  | {
    readonly kind: "attribute";
    readonly attributeName: string;
    readonly parentName: string;
  };

/** Selector for one planned SysML write. The adapter capture reuses this. */
export function architectureWriteSelector(
  item: InsertionItem,
  packageName: string,
): SysmlArchitectureSourceSelector {
  if (item.kind === "full-package") {
    return { kind: "full-package", packageName };
  }
  if (item.kind === "part-def") {
    return { kind: "part-def", packageName, componentName: item.componentName };
  }
  if (item.kind === "attribute") {
    return {
      kind: "attribute",
      packageName,
      parentName: item.parentName,
      attributeName: item.attributeName,
    };
  }
  return {
    kind: "usage",
    packageName,
    componentName: item.componentName,
    usageName: item.usageName,
    parentName: item.parentName,
  };
}

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
 * items in topological order (parents before children). PartUsage names are
 * local to their parent PartDefinition; the same name under another parent is
 * an independent occurrence and is not a conflict.
 *
 * An empty `toInsert` with no conflicts means all components are already adopted.
 * The executor must reject this as `invalid_transition`. A current plan with
 * nothing to insert is a fail-closed no-op, not a no-provider reseal.
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

  const toInsert: InsertionItem[] = [];
  const adopted: AdoptedItem[] = [];
  const conflicts: ArchitectureInsertionConflict[] = [];

  // Definitions and occurrences have distinct identities. Insert each target
  // PartDefinition at most once, then plan every reviewed PartUsage occurrence.
  for (const name of topologicalPartDefinitionOrder(proposal)) {
    if (!partDefByLabel.has(name)) {
      toInsert.push({ kind: "part-def", componentName: name });
    }
  }

  for (const component of proposal.components) {
    const existingPartDef = partDefByLabel.get(component.name);
    const parentPartDef = partDefByLabel.get(component.parentName);
    const usagesWithProposedName = parentPartDef
      ? parentPartDef.usages.filter((usage) => usage.label === component.usageName)
      : [];
    if (usagesWithProposedName.length > 1) {
      conflicts.push({
        code: "ambiguous_usage",
        componentName: component.name,
        message:
          `Usage "${component.usageName}" appears ${usagesWithProposedName.length} times ` +
          `under "${component.parentName}". A unique parent→usage→target relationship ` +
          "is required before this architecture run can proceed.",
      });
      continue;
    }

    if (parentPartDef) {
      // Finding 2 — adoption requires both the correct usage label AND the
      // correct target PartDef (targetLabel). A usage "wing" that types "Motor"
      // is NOT a conformant adoption of component Wing.
      const existingUsage = usagesWithProposedName[0];
      if (existingUsage?.targetLabel === component.name) {
        if (!existingPartDef) {
          conflicts.push({
            code: "mistyped_usage",
            componentName: component.name,
            message: `Usage "${component.usageName}" under "${component.parentName}" ` +
              `targets "${component.name}", but that PartDefinition is absent from ` +
              "the architecture package. Manual model repair is required.",
          });
          continue;
        }
        // Both PartDef and usage under correct parent exist, typed correctly → adopted.
        adopted.push({
          componentName: component.name,
          existingPartDefId: existingPartDef.id,
        });
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
          componentName: component.name,
          message: `Usage "${component.usageName}" under "${component.parentName}" ` +
            `types "${existingUsage.targetLabel}" instead of proposed "${component.name}". ` +
            `A FeatureTyping correction requires a separate model operation before ` +
            `this architecture run can proceed.`,
        });
        continue;
      }
      // Usage is simply absent → insert it.
      toInsert.push({
        kind: "usage",
        componentName: component.name,
        usageName: component.usageName,
        parentName: component.parentName,
      });
    } else {
      // Parent PartDef doesn't exist in the model yet (it's a new component).
      // We'll insert the parent first (it appears before this in topological order).
      // Insert usage too.
      toInsert.push({
        kind: "usage",
        componentName: component.name,
        usageName: component.usageName,
        parentName: component.parentName,
      });
    }
  }

  for (const attribute of proposalAttributes(proposal)) {
    const parentPartDef = partDefByLabel.get(attribute.parentName);
    const existing = (parentPartDef?.attributes ?? []).filter((item) =>
      item.label === attribute.name
    );
    if (existing.length > 1) {
      conflicts.push({
        code: "ambiguous_attribute",
        attributeName: attribute.name,
        message: `Attribute "${attribute.name}" appears ${existing.length} times ` +
          `under "${attribute.parentName}". A unique name is required.`,
      });
      continue;
    }
    if (existing.length === 1) continue;
    toInsert.push({
      kind: "attribute",
      attributeName: attribute.name,
      parentName: attribute.parentName,
    });
  }

  return { mode: "enrichment", toInsert, adopted, conflicts };
}

/**
 * Return unique PartDefinition names in deterministic topological order.
 * Reusing one definition for several occurrences never duplicates its insertion.
 */
function topologicalPartDefinitionOrder(
  proposal: ArchitectureProposal,
): readonly string[] {
  const order: string[] = [proposal.system.name];
  const added = new Set<string>([proposal.system.name]);
  const parentsByName = new Map<string, Set<string>>();
  for (const component of proposal.components) {
    const parents = parentsByName.get(component.name) ?? new Set<string>();
    parents.add(component.parentName);
    parentsByName.set(component.name, parents);
  }

  function visit(name: string): void {
    if (added.has(name)) return;
    for (const parentName of parentsByName.get(name) ?? []) {
      if (!added.has(parentName)) visit(parentName);
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
