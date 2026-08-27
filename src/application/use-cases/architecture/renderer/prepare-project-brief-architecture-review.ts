/**
 * Provider-free compilation of reviewed brief architecture into the canonical
 * `model.write-architecture@1` MRTR parameters.
 *
 * The server owns the parameter envelope: the caller declares the package,
 * the system, optional component occurrences and optional AttributeUsage
 * rows, each citing the exact brief item that states it, and this use case
 * reopens the human-approved
 * canonical brief, checks every declaration against it, and assembles the
 * parameters through the production grammar itself. It writes no project or
 * Thread state, calls no provider, and approves nothing.
 *
 * What it does NOT claim: that a declared name restates its item's prose.
 * The brief carries free-text statements, so no server-side check can prove
 * that transcription without inventing an interpretation. Provenance is
 * therefore recorded field by field and the signing human remains the one who
 * confirms the values against the exact brief items named here.
 */

import type {
  BriefArchitectureAttributeDeclaration,
  BriefArchitectureComponentDeclaration,
  BriefArchitectureDiagnostic,
  BriefArchitectureProvenanceEntry,
  ProjectBriefArchitectureReviewCommand,
  ProjectBriefArchitectureReviewResult,
  ProjectBriefArchitectureReviewUseCase,
} from "../../../ports/in/architecture/renderer/project-brief-architecture-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../project/engineering-project-command-service.ts";
import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  nonEmptyText,
  PROPOSAL_PARAMETER_SLUG,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
} from "../../../../domain/project/engineering-project.ts";
import { parseArchitectureProposalParameters } from "../../../../domain/architecture/renderer/architecture-proposal.ts";
import type {
  ProjectBriefItem,
  ProjectBriefItemKind,
  ProjectBriefRevision,
} from "../../../../domain/project/project-brief.ts";

export type ProjectBriefArchitectureReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "brief_not_approved";

/** Stable application error. Storage paths and internal causes stay internal. */
export class ProjectBriefArchitectureReviewError extends Error {
  constructor(
    readonly code: ProjectBriefArchitectureReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectBriefArchitectureReviewError";
  }
}

export interface PrepareProjectBriefArchitectureReviewDependencies {
  readonly projects: EngineeringProjectRevisionStore;
}

export class PrepareProjectBriefArchitectureReview
  implements ProjectBriefArchitectureReviewUseCase {
  readonly #projects: EngineeringProjectRevisionStore;

  constructor(dependencies: PrepareProjectBriefArchitectureReviewDependencies) {
    this.#projects = dependencies.projects;
  }

  async execute(value: unknown): Promise<ProjectBriefArchitectureReviewResult> {
    let command: ProjectBriefArchitectureReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The brief architecture review request failed exact validation.",
      );
    }

    const project = await this.#projects.get(command.projectId);
    if (!project) {
      throw reviewError(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }

    let briefBasis: EngineeringApprovedBriefBasis;
    try {
      briefBasis = approvedBriefBasisForProject(project);
    } catch {
      throw reviewError(
        "brief_not_approved",
        "The project has no exact human-approved canonical brief to compile from.",
      );
    }
    const brief = project.framing?.currentBrief;
    if (!brief) {
      throw reviewError(
        "brief_not_approved",
        "The project has no exact human-approved canonical brief to compile from.",
      );
    }

    const diagnostics: BriefArchitectureDiagnostic[] = [];
    const provenance: BriefArchitectureProvenanceEntry[] = [];
    const parameters: EngineeringDecisionProposalParameter[] = [];

    bindCitedParameter({
      brief,
      sourceItemId: command.packageSourceItemId,
      slug: null,
      parameter: {
        key: "architecture.package",
        label: "Architecture package",
        value: command.packageName,
      },
      absentMessage: "The approved brief has no item stating the architecture package.",
      diagnostics,
      provenance,
      parameters,
    });
    bindCitedParameter({
      brief,
      sourceItemId: command.systemSourceItemId,
      slug: null,
      parameter: {
        key: "system.name",
        label: "System",
        value: command.systemName,
      },
      absentMessage: "The approved brief has no item stating the architecture system.",
      diagnostics,
      provenance,
      parameters,
    });

    const seenSlugs = new Set<string>();
    for (const component of command.components) {
      if (!PROPOSAL_PARAMETER_SLUG.test(component.slug)) {
        diagnostics.push({
          code: "invalid-component-slug",
          slug: component.slug,
          sourceItemId: component.sourceItemId,
          message: `Component slug "${component.slug}" is not a valid proposal ` +
            "parameter slug (^[A-Za-z0-9][A-Za-z0-9_-]*$). Dots and colons are " +
            "refused because they make the component.<slug>.<field> key grammar ambiguous.",
        });
        continue;
      }
      if (seenSlugs.has(component.slug)) {
        diagnostics.push({
          code: "duplicate-component-slug",
          slug: component.slug,
          sourceItemId: component.sourceItemId,
          message: `Component slug "${component.slug}" is declared more than once; ` +
            "each component must own exactly one slug.",
        });
        continue;
      }
      seenSlugs.add(component.slug);

      const item = resolveItem(brief, component.sourceItemId);
      if (!item) {
        diagnostics.push({
          code: "brief-item-absent",
          slug: component.slug,
          sourceItemId: component.sourceItemId,
          message: `Component "${component.slug}" names brief item ` +
            `"${component.sourceItemId}", which the approved brief does not contain.`,
        });
        continue;
      }
      collectItemDiagnostics(item, component.slug, diagnostics);
      for (const parameter of componentParameters(component)) {
        parameters.push(parameter);
        provenance.push(provenanceFor(parameter.key, item));
      }
    }

    const seenAttributeSlugs = new Set<string>();
    for (const attribute of command.attributes ?? []) {
      if (!PROPOSAL_PARAMETER_SLUG.test(attribute.slug)) {
        diagnostics.push({
          code: "invalid-attribute-slug",
          slug: attribute.slug,
          sourceItemId: attribute.sourceItemId,
          message: `Attribute slug "${attribute.slug}" is not a valid proposal ` +
            "parameter slug (^[A-Za-z0-9][A-Za-z0-9_-]*$). Dots and colons are " +
            "refused because they make the attribute.<slug>.<field> key grammar ambiguous.",
        });
        continue;
      }
      if (seenAttributeSlugs.has(attribute.slug)) {
        diagnostics.push({
          code: "duplicate-attribute-slug",
          slug: attribute.slug,
          sourceItemId: attribute.sourceItemId,
          message: `Attribute slug "${attribute.slug}" is declared more than once; ` +
            "each attribute must own exactly one slug.",
        });
        continue;
      }
      seenAttributeSlugs.add(attribute.slug);

      const item = resolveItem(brief, attribute.sourceItemId);
      if (!item) {
        diagnostics.push({
          code: "brief-item-absent",
          slug: attribute.slug,
          sourceItemId: attribute.sourceItemId,
          message: `Attribute "${attribute.slug}" names brief item ` +
            `"${attribute.sourceItemId}", which the approved brief does not contain.`,
        });
        continue;
      }
      collectItemDiagnostics(item, attribute.slug, diagnostics);
      for (const parameter of attributeParameters(attribute)) {
        parameters.push(parameter);
        provenance.push(provenanceFor(parameter.key, item));
      }
    }

    /**
     * The production parser is the only authority on the envelope: reusing it
     * here means an invalid identifier, an unknown parent or an unknown key is
     * refused by the same code that will refuse it at MRTR time.
     *
     * It runs only on an otherwise clean set. A declaration already refused
     * above contributes no parameter, so parsing a truncated set would report
     * the consequence of that refusal as a second, independent-looking cause.
     */
    if (diagnostics.length === 0) {
      try {
        parseArchitectureProposalParameters(parameters);
      } catch (error) {
        diagnostics.push({
          code: "proposal-grammar-rejected",
          slug: null,
          sourceItemId: null,
          message: `The compiled parameters were refused by the architecture grammar: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    const resolved = diagnostics.length === 0;
    return deepFreeze({
      status: resolved ? "resolved" : "unresolved",
      briefBasis,
      diagnostics,
      provenance,
      ...(resolved ? { decisionParameters: parameters } : {}),
    }) as ProjectBriefArchitectureReviewResult;
  }
}

function resolveItem(
  brief: ProjectBriefRevision,
  itemId: string,
): ProjectBriefItem | undefined {
  return brief.items.find((item) => item.id === itemId);
}

/**
 * An architecture element is not a normative gate, so it is not restricted to
 * `success-criterion` or `verification-activity`. It still cannot be traced to
 * an `exclusion` (explicitly out of scope) or an `open-question` (explicitly
 * undecided): either would invert the meaning of a retained package, system
 * or component. Every cited item must also carry a source reference.
 */
function collectItemDiagnostics(
  item: ProjectBriefItem,
  slug: string | null,
  diagnostics: BriefArchitectureDiagnostic[],
): void {
  if (isNonCommittingBriefKind(item.kind)) {
    diagnostics.push({
      code: "brief-item-not-committing",
      slug,
      sourceItemId: item.id,
      message: `Brief item "${item.id}" has kind ${item.kind}; an exclusion or ` +
        "an open-question cannot state a retained architecture element.",
    });
  }
  if (item.sourceRefs.length === 0) {
    diagnostics.push({
      code: "brief-item-unsourced",
      slug,
      sourceItemId: item.id,
      message: `Brief item "${item.id}" carries no source reference.`,
    });
  }
}

function isNonCommittingBriefKind(kind: ProjectBriefItemKind): boolean {
  return kind === "exclusion" || kind === "open-question";
}

function bindCitedParameter(input: {
  readonly brief: ProjectBriefRevision;
  readonly sourceItemId: string;
  readonly slug: string | null;
  readonly parameter: EngineeringDecisionProposalParameter;
  readonly absentMessage: string;
  readonly diagnostics: BriefArchitectureDiagnostic[];
  readonly provenance: BriefArchitectureProvenanceEntry[];
  readonly parameters: EngineeringDecisionProposalParameter[];
}): void {
  const item = resolveItem(input.brief, input.sourceItemId);
  if (!item) {
    input.diagnostics.push({
      code: "brief-item-absent",
      slug: input.slug,
      sourceItemId: input.sourceItemId,
      message: input.absentMessage,
    });
    return;
  }
  input.parameters.push(input.parameter);
  input.provenance.push(provenanceFor(input.parameter.key, item));
  collectItemDiagnostics(item, input.slug, input.diagnostics);
}

function componentParameters(
  component: BriefArchitectureComponentDeclaration,
): readonly EngineeringDecisionProposalParameter[] {
  const parameters: EngineeringDecisionProposalParameter[] = [
    {
      key: `component.${component.slug}.name`,
      label: `Component ${component.slug} name`,
      value: component.name,
    },
    {
      key: `component.${component.slug}.usage`,
      label: `Component ${component.slug} usage`,
      value: component.usage,
    },
  ];
  if (component.parent !== undefined) {
    parameters.push({
      key: `component.${component.slug}.parent`,
      label: `Component ${component.slug} parent`,
      value: component.parent,
    });
  }
  return parameters;
}

function attributeParameters(
  attribute: BriefArchitectureAttributeDeclaration,
): readonly EngineeringDecisionProposalParameter[] {
  const parameters: EngineeringDecisionProposalParameter[] = [{
    key: `attribute.${attribute.slug}.name`,
    label: `Attribute ${attribute.slug} name`,
    value: attribute.name,
  }];
  if (attribute.parent !== undefined) {
    parameters.push({
      key: `attribute.${attribute.slug}.parent`,
      label: `Attribute ${attribute.slug} parent`,
      value: attribute.parent,
    });
  }
  return parameters;
}

function provenanceFor(
  parameterKey: string,
  item: ProjectBriefItem,
): BriefArchitectureProvenanceEntry {
  return {
    parameterKey,
    sourceItemId: item.id,
    sourceItemKind: item.kind,
    sourceRefs: structuredClone(item.sourceRefs),
  };
}

function parseCommand(value: unknown): ProjectBriefArchitectureReviewCommand {
  const root = closedRecord(
    value,
    [
      "projectId",
      "packageName",
      "packageSourceItemId",
      "systemName",
      "systemSourceItemId",
      "components",
      "attributes",
    ],
    [
      "projectId",
      "packageName",
      "packageSourceItemId",
      "systemName",
      "systemSourceItemId",
      "components",
    ],
    "$briefArchitectureReview",
  );
  const components = arrayOf(
    root.components,
    "$briefArchitectureReview.components",
  );
  const attributes = root.attributes === undefined
    ? []
    : arrayOf(root.attributes, "$briefArchitectureReview.attributes");
  return {
    projectId: safeId(root.projectId, "$briefArchitectureReview.projectId"),
    packageName: nonEmptyText(
      root.packageName,
      "$briefArchitectureReview.packageName",
    ),
    packageSourceItemId: safeId(
      root.packageSourceItemId,
      "$briefArchitectureReview.packageSourceItemId",
    ),
    systemName: nonEmptyText(
      root.systemName,
      "$briefArchitectureReview.systemName",
    ),
    systemSourceItemId: safeId(
      root.systemSourceItemId,
      "$briefArchitectureReview.systemSourceItemId",
    ),
    components: components.map((item, index) =>
      parseDeclaration(item, `$briefArchitectureReview.components[${index}]`)
    ),
    ...(attributes.length === 0 ? {} : {
      attributes: attributes.map((item, index) =>
        parseAttributeDeclaration(
          item,
          `$briefArchitectureReview.attributes[${index}]`,
        )
      ),
    }),
  };
}

function parseDeclaration(
  value: unknown,
  path: string,
): BriefArchitectureComponentDeclaration {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!record) throw new TypeError(`${path} must be an object.`);
  const keys = Object.hasOwn(record, "parent")
    ? ["slug", "name", "usage", "parent", "sourceItemId"]
    : ["slug", "name", "usage", "sourceItemId"];
  const root = exactRecord(value, keys, path);
  return {
    slug: safeId(root.slug, `${path}.slug`),
    name: nonEmptyText(root.name, `${path}.name`),
    usage: nonEmptyText(root.usage, `${path}.usage`),
    ...(root.parent !== undefined
      ? { parent: nonEmptyText(root.parent, `${path}.parent`) }
      : {}),
    sourceItemId: safeId(root.sourceItemId, `${path}.sourceItemId`),
  };
}

function parseAttributeDeclaration(
  value: unknown,
  path: string,
): BriefArchitectureAttributeDeclaration {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!record) throw new TypeError(`${path} must be an object.`);
  const keys = Object.hasOwn(record, "parent")
    ? ["slug", "name", "parent", "sourceItemId"]
    : ["slug", "name", "sourceItemId"];
  const root = exactRecord(value, keys, path);
  return {
    slug: safeId(root.slug, `${path}.slug`),
    name: nonEmptyText(root.name, `${path}.name`),
    ...(root.parent !== undefined
      ? { parent: nonEmptyText(root.parent, `${path}.parent`) }
      : {}),
    sourceItemId: safeId(root.sourceItemId, `${path}.sourceItemId`),
  };
}

function reviewError(
  code: ProjectBriefArchitectureReviewErrorCode,
  message: string,
): ProjectBriefArchitectureReviewError {
  return new ProjectBriefArchitectureReviewError(code, message);
}
