/**
 * Provider-free compilation of reviewed brief criteria into the canonical
 * `model.write-requirements@1` MRTR parameters.
 *
 * The server owns the parameter envelope: the caller declares typed criteria
 * and the exact brief item that states each one, and this use case reopens the
 * human-approved canonical brief, checks every declaration against it, and
 * assembles the parameters through the production grammar itself. It writes no
 * project or Thread state, calls no provider, and approves nothing.
 *
 * What it does NOT claim: that a declared threshold restates its item's prose.
 * The brief carries free-text statements, so no server-side check can prove
 * that transcription without inventing an interpretation. Provenance is
 * therefore recorded field by field and the signing human remains the one who
 * confirms the values against the exact brief items named here.
 */

import type {
  BriefRequirementDeclaration,
  BriefRequirementsDiagnostic,
  BriefRequirementsProvenanceEntry,
  BriefRequirementsTransformation,
  ProjectBriefRequirementsReviewCommand,
  ProjectBriefRequirementsReviewResult,
  ProjectBriefRequirementsReviewUseCase,
} from "../../../ports/in/architecture/requirements/project-brief-requirements-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import { approvedBriefBasisForProject } from "../../project/engineering-project-command-service.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  nonEmptyText,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
} from "../../../../domain/project/engineering-project.ts";
import { parseRequirementsProposalParameters } from "../../../../domain/architecture/requirements/requirements-proposal.ts";
import { normaliseThreshold } from "../../../../domain/kernel/unit-normalisation.ts";
import {
  isProjectBriefGateKind,
  type ProjectBriefItem,
  type ProjectBriefRevision,
} from "../../../../domain/project/project-brief.ts";

export type ProjectBriefRequirementsReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "brief_not_approved";

/** Stable application error. Storage paths and internal causes stay internal. */
export class ProjectBriefRequirementsReviewError extends Error {
  constructor(
    readonly code: ProjectBriefRequirementsReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectBriefRequirementsReviewError";
  }
}

export interface PrepareProjectBriefRequirementsReviewDependencies {
  readonly projects: EngineeringProjectRevisionStore;
}

export class PrepareProjectBriefRequirementsReview
  implements ProjectBriefRequirementsReviewUseCase {
  readonly #projects: EngineeringProjectRevisionStore;

  constructor(dependencies: PrepareProjectBriefRequirementsReviewDependencies) {
    this.#projects = dependencies.projects;
  }

  async execute(value: unknown): Promise<ProjectBriefRequirementsReviewResult> {
    let command: ProjectBriefRequirementsReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The brief requirements review request failed exact validation.",
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

    const diagnostics: BriefRequirementsDiagnostic[] = [];
    const provenance: BriefRequirementsProvenanceEntry[] = [];
    const parameters: EngineeringDecisionProposalParameter[] = [];

    const container = resolveItem(brief, command.containerSourceItemId);
    if (!container) {
      diagnostics.push({
        code: "brief-item-absent",
        slug: null,
        sourceItemId: command.containerSourceItemId,
        message:
          "The approved brief has no item stating the requirements target component.",
      });
    } else {
      parameters.push({
        key: "requirements.containerComponent",
        label: "Requirements target component",
        value: command.containerComponent,
      });
      provenance.push(provenanceFor("requirements.containerComponent", container));
      collectItemDiagnostics(container, null, diagnostics, { requireGate: false });
    }

    const seenSlugs = new Set<string>();
    for (const requirement of command.requirements) {
      if (seenSlugs.has(requirement.slug)) {
        diagnostics.push({
          code: "duplicate-requirement-slug",
          slug: requirement.slug,
          sourceItemId: requirement.sourceItemId,
          message:
            `Requirement slug "${requirement.slug}" is declared more than once; ` +
            "each requirement must own exactly one slug.",
        });
        continue;
      }
      seenSlugs.add(requirement.slug);

      const item = resolveItem(brief, requirement.sourceItemId);
      if (!item) {
        diagnostics.push({
          code: "brief-item-absent",
          slug: requirement.slug,
          sourceItemId: requirement.sourceItemId,
          message: `Requirement "${requirement.slug}" names brief item ` +
            `"${requirement.sourceItemId}", which the approved brief does not contain.`,
        });
        continue;
      }
      collectItemDiagnostics(item, requirement.slug, diagnostics, {
        requireGate: true,
      });
      const { transformation } = normaliseThreshold(
        requirement.threshold,
        requirement.unit,
      );
      for (const parameter of requirementParameters(requirement)) {
        parameters.push(parameter);
        provenance.push(
          provenanceFor(
            parameter.key,
            item,
            // Only the threshold carries a value the server rescaled; the
            // other fields are copied verbatim.
            parameter.key.endsWith(".threshold") ? transformation : "identity",
          ),
        );
      }
    }

    /**
     * The production parser is the only authority on the envelope: reusing it
     * here means an unsupported unit, a non-integer threshold or an unknown
     * key is refused by the same code that will refuse it at MRTR time.
     *
     * It runs only on an otherwise clean set. A declaration already refused
     * above contributes no parameter, so parsing a truncated set would report
     * the consequence of that refusal as a second, independent-looking cause.
     */
    if (diagnostics.length === 0) {
      try {
        parseRequirementsProposalParameters(parameters);
      } catch (error) {
        diagnostics.push({
          code: "proposal-grammar-rejected",
          slug: null,
          sourceItemId: null,
          message: `The compiled parameters were refused by the requirements grammar: ${
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
    }) as ProjectBriefRequirementsReviewResult;
  }
}

function resolveItem(
  brief: ProjectBriefRevision,
  itemId: string,
): ProjectBriefItem | undefined {
  return brief.items.find((item) => item.id === itemId);
}

/**
 * A requirement threshold is normative evidence, so it may only be traced to a
 * gate item (`success-criterion` or `verification-activity`). Tracing one to a
 * constraint, assumption or exclusion would dress a non-binding statement as a
 * signed requirement. The container component is not itself normative — it
 * names where the requirements are anchored — so it only has to be sourced.
 */
function collectItemDiagnostics(
  item: ProjectBriefItem,
  slug: string | null,
  diagnostics: BriefRequirementsDiagnostic[],
  options: { readonly requireGate: boolean },
): void {
  if (options.requireGate && !isProjectBriefGateKind(item.kind)) {
    diagnostics.push({
      code: "brief-item-not-normative",
      slug,
      sourceItemId: item.id,
      message: `Brief item "${item.id}" has kind ${item.kind}; only a ` +
        "success-criterion or a verification-activity states a normative requirement.",
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

// Unit normalisation (MPa → Pa and future affine cases like °C → K) is handled
// by the domain module `unit-normalisation.ts`, which validates every target
// unit against SUPPORTED_ORACLE_UNITS at module load time.  See the module and
// docs/reference/providers/oracle-units.md for the rationale and probe evidence.

function requirementParameters(
  requirement: BriefRequirementDeclaration,
): readonly EngineeringDecisionProposalParameter[] {
  const { value: thresholdValue, unit: thresholdUnit } = normaliseThreshold(
    requirement.threshold,
    requirement.unit,
  );
  return [
    {
      key: `requirement.${requirement.slug}.name`,
      label: `Requirement ${requirement.slug} name`,
      value: requirement.name,
    },
    {
      key: `requirement.${requirement.slug}.metric`,
      label: `Requirement ${requirement.slug} metric`,
      value: requirement.metric,
    },
    {
      key: `requirement.${requirement.slug}.operator`,
      label: `Requirement ${requirement.slug} operator`,
      value: requirement.operator,
    },
    {
      key: `requirement.${requirement.slug}.threshold`,
      label: `Requirement ${requirement.slug} threshold`,
      value: thresholdValue,
      unit: thresholdUnit,
    },
  ];
}

function provenanceFor(
  parameterKey: string,
  item: ProjectBriefItem,
  transformation: BriefRequirementsTransformation = "identity",
): BriefRequirementsProvenanceEntry {
  return {
    parameterKey,
    sourceItemId: item.id,
    sourceItemKind: item.kind,
    sourceRefs: structuredClone(item.sourceRefs),
    transformation,
  };
}

function parseCommand(value: unknown): ProjectBriefRequirementsReviewCommand {
  const root = exactRecord(value, [
    "projectId",
    "containerComponent",
    "containerSourceItemId",
    "requirements",
  ], "$briefRequirementsReview");
  const requirements = arrayOf(
    root.requirements,
    "$briefRequirementsReview.requirements",
  );
  if (requirements.length === 0) {
    throw new TypeError(
      "$briefRequirementsReview.requirements must declare at least one requirement.",
    );
  }
  return {
    projectId: safeId(root.projectId, "$briefRequirementsReview.projectId"),
    containerComponent: nonEmptyText(
      root.containerComponent,
      "$briefRequirementsReview.containerComponent",
    ),
    containerSourceItemId: safeId(
      root.containerSourceItemId,
      "$briefRequirementsReview.containerSourceItemId",
    ),
    requirements: requirements.map((item, index) =>
      parseDeclaration(item, `$briefRequirementsReview.requirements[${index}]`)
    ),
  };
}

function parseDeclaration(
  value: unknown,
  path: string,
): BriefRequirementDeclaration {
  const root = exactRecord(value, [
    "slug",
    "name",
    "metric",
    "operator",
    "threshold",
    "unit",
    "sourceItemId",
  ], path);
  return {
    slug: safeId(root.slug, `${path}.slug`),
    name: nonEmptyText(root.name, `${path}.name`),
    metric: nonEmptyText(root.metric, `${path}.metric`),
    operator: nonEmptyText(root.operator, `${path}.operator`),
    threshold: finite(root.threshold, `${path}.threshold`),
    unit: nonEmptyText(root.unit, `${path}.unit`),
    sourceItemId: safeId(root.sourceItemId, `${path}.sourceItemId`),
  };
}

function reviewError(
  code: ProjectBriefRequirementsReviewErrorCode,
  message: string,
): ProjectBriefRequirementsReviewError {
  return new ProjectBriefRequirementsReviewError(code, message);
}
