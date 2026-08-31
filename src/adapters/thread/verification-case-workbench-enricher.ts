/**
 * BFF-only projection of sealed engineering cases into the Workbench graph.
 *
 * The canonical Thread already records the authoritative seal document and
 * every downstream provenance edge. This adapter reopens that exact CAS
 * document, projects its typed case identity, then follows recorded edges in
 * their source-to-consumer direction. It never parses a label or invents a
 * canonical Thread relation.
 */

import type {
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ThreadGraph,
  ThreadGraphNode,
  ThreadGraphRelation,
} from "../../presentation/workbench/thread/graph.ts";
import type {
  EngineeringCase,
  EngineeringCaseCatalog,
  EngineeringCaseFamily,
  EngineeringCaseIssue,
} from "../../presentation/workbench/thread/evidence.ts";
import {
  ENGINEERING_CASE_CATALOG_SCHEMA,
} from "../../presentation/workbench/thread/evidence.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  parseFeaProofCaseCapture,
} from "../../domain/fea/seal-case/fea-proof-case-capture.ts";
import {
  FEA_PROOF_CASE_CAPTURE_URI_PREFIX,
} from "../fea/seal-case/verify-seal-proof-case-run-executor.ts";
import {
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
  validateSensitivityStudyCaseCapture,
} from "../sensitivity/study/sensitivity-study-case-capture.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  PRINTABILITY_CASE_CAPTURE_URI_PREFIX,
  validatePrintabilityCaseCapture,
} from "../make/printability/printability-case-capture.ts";
import {
  INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
} from "../../domain/make/printability/printability-proposal.ts";
import {
  PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX,
  validatePrintEstimateCaseCapture,
} from "../make/print-estimate/print-estimate-case-capture.ts";
import {
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
} from "../../domain/make/print-estimate/print-estimate-proposal.ts";
import {
  DFM_CASE_CAPTURE_URI_PREFIX,
  validateDfmCaseCapture,
} from "../make/dfm/dfm-case-capture.ts";
import {
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
} from "../../domain/make/dfm/dfm-case.ts";
const SHA256 = /^[a-f0-9]{64}$/;

const CASE_LINEAGE_RELATIONS = new Set<ThreadGraphRelation>([
  "derived_from",
  "uses",
  "evaluates",
  "evidences",
  "caused_by",
  "addresses",
  "input_to",
  "source_of",
]);

export interface EngineeringCaseCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface EngineeringCaseWorkbenchEnricherDependencies {
  readonly mechanicalProof?: EngineeringCaseCaptureReader;
  readonly sensitivityStudy?: EngineeringCaseCaptureReader;
  readonly printabilityCheck?: EngineeringCaseCaptureReader;
  readonly printEstimate?: EngineeringCaseCaptureReader;
  readonly dfmCheck?: EngineeringCaseCaptureReader;
}

interface ExtractedCaseBase {
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly caseDigest: string;
  readonly projectId: string;
  readonly subjectId: string;
  readonly expectedAuthorityArtifactId: string;
  readonly expectedAuthorityRunId?: string;
  readonly inputArtifacts: readonly {
    readonly id: string;
    readonly fingerprint: string;
    readonly producerRunId?: string;
  }[];
}

type ExtractedCase =
  & ExtractedCaseBase
  & (
    | {
      readonly family: "mechanical-proof";
      readonly caseSchemaVersion: "mechanical-proof-case/1.0";
      readonly targetModelElementId: string;
    }
    | {
      readonly family: "sensitivity-study";
      readonly caseSchemaVersion: "sensitivity-study-case/3.0";
    }
    | {
      readonly family: "printability-check";
      readonly caseSchemaVersion: "printability-check-case/1.0";
    }
    | {
      readonly family: "print-estimate";
      readonly caseSchemaVersion: "print-estimate-case/1.0";
    }
    | {
      readonly family: "dfm-check";
      readonly caseSchemaVersion: "dfm-check-case/1.0";
    }
  );

interface CaseDriver {
  readonly family: EngineeringCaseFamily;
  readonly producedBy: string;
  readonly artifactIdPrefix: string;
  readonly uriPrefix: string;
  readonly reader?: EngineeringCaseCaptureReader;
  /** False for a detected historical schema that is visible only as an issue. */
  readonly advertiseCoverage?: boolean;
  extract(
    text: string,
    fingerprint: ContentFingerprint,
  ): Promise<ExtractedCase>;
}

/**
 * Reopen every supported case seal, expose exact declarations, and assign
 * zero-to-many case references to their recorded downstream graph nodes.
 */
export async function enrichThreadWorkbenchWithEngineeringCases(
  snapshot: ThreadWorkbenchSnapshot,
  dependencies: EngineeringCaseWorkbenchEnricherDependencies,
  context: { readonly projectId: string },
): Promise<
  ThreadWorkbenchSnapshot & {
    engineeringCases: EngineeringCaseCatalog;
  }
> {
  if (
    context.projectId.length === 0 ||
    context.projectId !== context.projectId.trim()
  ) {
    throw new TypeError("Engineering-case projectId must be non-empty exact text.");
  }
  const drivers = caseDrivers(dependencies);
  const issues: EngineeringCaseIssue[] = [];
  const casesByKey = new Map<string, EngineeringCase>();
  const inputArtifactIdsByCaseKey = new Map<string, Set<string>>();

  for (const artifact of snapshot.artifacts) {
    const driver = drivers.find((candidate) =>
      candidate.producedBy === artifact.producedBy &&
      (artifact.id.startsWith(candidate.artifactIdPrefix) ||
        artifact.uri?.startsWith(`${candidate.uriPrefix}sha256/`) === true)
    );
    if (!driver) continue;

    const fingerprint = boundCaptureFingerprint(artifact, driver);
    if (!fingerprint) {
      issues.push(issue(
        driver.family,
        artifact.id,
        "error",
        "artifact-binding-invalid",
      ));
      continue;
    }

    if (!driver.reader) {
      issues.push(issue(
        driver.family,
        artifact.id,
        "unavailable",
        "capture-reader-unavailable",
      ));
      continue;
    }

    let text: string | undefined;
    try {
      text = await driver.reader.read(fingerprint);
    } catch {
      issues.push(issue(
        driver.family,
        artifact.id,
        "error",
        "capture-invalid",
      ));
      continue;
    }
    if (text === undefined) {
      issues.push(issue(
        driver.family,
        artifact.id,
        "unavailable",
        "capture-unavailable",
      ));
      continue;
    }

    let extracted: ExtractedCase;
    try {
      extracted = await driver.extract(text, fingerprint);
    } catch {
      issues.push(issue(
        driver.family,
        artifact.id,
        "error",
        "capture-invalid",
      ));
      continue;
    }
    if (
      extracted.caseDigest !== artifact.revision ||
      extracted.projectId !== context.projectId ||
      extracted.subjectId !== snapshot.subject.id ||
      extracted.expectedAuthorityArtifactId !== artifact.id ||
      (extracted.expectedAuthorityRunId !== undefined &&
        extracted.expectedAuthorityRunId !== artifact.producerRunId) ||
      !caseInputsMatch(snapshot, artifact, extracted.inputArtifacts)
    ) {
      issues.push(issue(
        driver.family,
        artifact.id,
        "error",
        "case-binding-divergent",
      ));
      continue;
    }

    const key = caseKey(extracted.family, extracted.caseDigest);
    inputArtifactIdsByCaseKey.set(
      key,
      new Set([
        ...(inputArtifactIdsByCaseKey.get(key) ?? []),
        ...extracted.inputArtifacts.map((input) => input.id),
      ]),
    );
    const existing = casesByKey.get(key);
    if (existing) {
      if (!sameDeclaration(existing, extracted)) {
        issues.push(issue(
          driver.family,
          artifact.id,
          "error",
          "case-binding-divergent",
        ));
        continue;
      }
      existing.authorityArtifactIds.push(artifact.id);
      continue;
    }
    casesByKey.set(
      key,
      projectCaseDeclaration(key, extracted, artifact.id),
    );
  }

  const cases = [...casesByKey.values()]
    .map((item) => ({
      ...item,
      authorityArtifactIds: [...new Set(item.authorityArtifactIds)].sort(),
    }))
    .sort(compareCases);
  const membership = projectCaseMemberships(
    snapshot,
    cases,
    inputArtifactIdsByCaseKey,
    issues,
  );
  const graph = {
    ...snapshot.graph,
    nodes: snapshot.graph.nodes.map((node) => {
      const references = membership.get(graphNodeKey(node));
      const { engineeringCaseRefs: _stale, ...withoutStaleMembership } = node;
      return references && references.size > 0
        ? {
          ...withoutStaleMembership,
          engineeringCaseRefs: [...references].sort(),
        }
        : withoutStaleMembership;
    }),
    edges: [
      ...snapshot.graph.edges,
      ...projectVerifiedByEdges(snapshot, cases),
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const coverage = drivers
    .filter((driver) => driver.advertiseCoverage !== false)
    .map((driver) => ({
      family: driver.family,
      status: driver.reader ? "observed" as const : "unavailable" as const,
    }));
  const sortedIssues = [...issues].sort(compareIssues);
  const catalog: EngineeringCaseCatalog = {
    schemaVersion: ENGINEERING_CASE_CATALOG_SCHEMA,
    status: catalogStatus(coverage, sortedIssues),
    coverage,
    cases,
    issues: sortedIssues,
  };

  return { ...snapshot, engineeringCases: catalog, graph };
}

function caseDrivers(
  dependencies: EngineeringCaseWorkbenchEnricherDependencies,
): CaseDriver[] {
  return [
    {
      family: "mechanical-proof",
      producedBy:
        `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`,
      artifactIdPrefix: "fea-proof-",
      uriPrefix: FEA_PROOF_CASE_CAPTURE_URI_PREFIX,
      reader: dependencies.mechanicalProof,
      extract: async (text, fingerprint) => {
        const capture = await parseFeaProofCaseCapture(text);
        return {
          family: "mechanical-proof",
          caseSchemaVersion: capture.proofCase.schemaVersion,
          id: capture.proofCase.id,
          revision: capture.proofCase.revision,
          scope: capture.proofCase.scope,
          caseDigest: capture.proofDigest,
          projectId: capture.proofCase.project.id,
          subjectId: capture.proofCase.project.subjectId,
          expectedAuthorityArtifactId: `fea-proof-${fingerprint.digest}`,
          expectedAuthorityRunId: capture.trustedRunId,
          targetModelElementId: capture.proofCase.target.modelElementId,
          inputArtifacts: [
            capture.geometryArtifact,
            capture.requirementsArtifact,
            capture.stepArtifact,
          ].map((artifact) => ({
            id: artifact.id,
            fingerprint:
              `${artifact.fingerprint.algorithm}:${artifact.fingerprint.digest}`,
            producerRunId: artifact.producerRunId,
          })),
        };
      },
    },
    {
      family: "sensitivity-study",
      producedBy:
        `${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id}@${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version}`,
      artifactIdPrefix: "sensitivity-case-",
      uriPrefix: captureUriPrefix(SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX),
      reader: dependencies.sensitivityStudy,
      extract: async (text) => {
        const capture = await validateSensitivityStudyCaseCapture(
          JSON.parse(text),
        );
        return {
          family: "sensitivity-study",
          caseSchemaVersion: capture.studyCase.schemaVersion,
          id: capture.studyCase.id,
          revision: capture.studyCase.revision,
          scope: capture.studyCase.scope,
          caseDigest: capture.caseDigest,
          projectId: capture.studyCase.project.id,
          subjectId: capture.studyCase.project.subjectId,
          expectedAuthorityArtifactId: `sensitivity-case-${capture.caseDigest}`,
          expectedAuthorityRunId: capture.trustedRunId,
          inputArtifacts: [{
            id: capture.admissionArtifact.id,
            fingerprint:
              `${capture.admissionArtifact.fingerprint.algorithm}:${capture.admissionArtifact.fingerprint.digest}`,
          }],
        };
      },
    },
    {
      family: "printability-check",
      producedBy:
        `${INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.id}@${INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.version}`,
      artifactIdPrefix: "printability-case-",
      uriPrefix: captureUriPrefix(PRINTABILITY_CASE_CAPTURE_URI_PREFIX),
      reader: dependencies.printabilityCheck,
      extract: async (text) => {
        const capture = await validatePrintabilityCaseCapture(JSON.parse(text));
        return {
          family: "printability-check",
          caseSchemaVersion: capture.printabilityCase.schemaVersion,
          id: capture.printabilityCase.id,
          revision: capture.printabilityCase.revision,
          scope: capture.printabilityCase.scope,
          caseDigest: capture.caseDigest,
          projectId: capture.printabilityCase.project.id,
          subjectId: capture.printabilityCase.project.subjectId,
          expectedAuthorityArtifactId: `printability-case-${capture.caseDigest}`,
          expectedAuthorityRunId: capture.trustedRunId,
          inputArtifacts: [],
        };
      },
    },
    {
      family: "print-estimate",
      producedBy:
        `${INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.id}@${INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.version}`,
      artifactIdPrefix: "print-estimate-case-",
      uriPrefix: captureUriPrefix(PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX),
      reader: dependencies.printEstimate,
      extract: async (text) => {
        const capture = await validatePrintEstimateCaseCapture(JSON.parse(text));
        return {
          family: "print-estimate",
          caseSchemaVersion: capture.printEstimateCase.schemaVersion,
          id: capture.printEstimateCase.id,
          revision: capture.printEstimateCase.revision,
          scope: capture.printEstimateCase.scope,
          caseDigest: capture.caseDigest,
          projectId: capture.printEstimateCase.project.id,
          subjectId: capture.printEstimateCase.project.subjectId,
          expectedAuthorityArtifactId: `print-estimate-case-${capture.caseDigest}`,
          expectedAuthorityRunId: capture.trustedRunId,
          inputArtifacts: [],
        };
      },
    },
    {
      family: "dfm-check",
      producedBy:
        `${INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.id}@${INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.version}`,
      artifactIdPrefix: "dfm-case-",
      uriPrefix: captureUriPrefix(DFM_CASE_CAPTURE_URI_PREFIX),
      reader: dependencies.dfmCheck,
      extract: async (text) => {
        const capture = await validateDfmCaseCapture(JSON.parse(text));
        return {
          family: "dfm-check",
          caseSchemaVersion: capture.dfmCase.schemaVersion,
          id: capture.dfmCase.id,
          revision: capture.dfmCase.revision,
          scope: capture.dfmCase.scope,
          caseDigest: capture.caseDigest,
          projectId: capture.dfmCase.project.id,
          subjectId: capture.dfmCase.project.subjectId,
          expectedAuthorityArtifactId: `dfm-case-${capture.caseDigest}`,
          expectedAuthorityRunId: capture.trustedRunId,
          inputArtifacts: [],
        };
      },
    },
  ];
}

function captureUriPrefix(prefix: string): string {
  return prefix.replace(/sha256\/$/, "");
}

function boundCaptureFingerprint(
  artifact: ThreadArtifact,
  driver: CaseDriver,
): ContentFingerprint | undefined {
  if (
    artifact.kind !== "document" ||
    artifact.system !== "digital-thread" ||
    artifact.producedBy !== driver.producedBy ||
    artifact.producerRunId === undefined ||
    artifact.producerRunId.length === 0 ||
    artifact.fingerprint === undefined ||
    artifact.uri === undefined
  ) return undefined;
  const match = /^sha256:([a-f0-9]{64})$/.exec(artifact.fingerprint);
  if (!match) return undefined;
  const digest = match[1]!;
  if (artifact.uri !== `${driver.uriPrefix}sha256/${digest}`) return undefined;
  return { algorithm: "sha256", digest };
}

function projectCaseMemberships(
  snapshot: ThreadWorkbenchSnapshot,
  cases: readonly EngineeringCase[],
  inputArtifactIdsByCaseKey: ReadonlyMap<string, ReadonlySet<string>>,
  issues: EngineeringCaseIssue[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const nodeKeys = new Set(snapshot.graph.nodes.map(graphNodeKey));
  const outgoing = new Map<string, Set<string>>();
  for (const edge of snapshot.graph.edges) {
    if (!CASE_LINEAGE_RELATIONS.has(edge.relation)) continue;
    const from = `${edge.from.kind}:${edge.from.id}`;
    const to = `${edge.to.kind}:${edge.to.id}`;
    const targets = outgoing.get(from) ?? new Set<string>();
    targets.add(to);
    outgoing.set(from, targets);
  }

  const membership = new Map<string, Set<string>>();
  for (const verificationCase of cases) {
    const queue: string[] = [];
    const reached = new Set<string>();
    for (const artifactId of verificationCase.authorityArtifactIds) {
      const root = `artifact:${artifactId}`;
      if (!nodeKeys.has(root)) {
        issues.push(issue(
          verificationCase.family,
          artifactId,
          "error",
          "case-binding-divergent",
        ));
        continue;
      }
      reached.add(root);
      queue.push(root);
    }
    for (
      const artifactId of inputArtifactIdsByCaseKey.get(
        verificationCase.key,
      ) ?? []
    ) {
      const input = `artifact:${artifactId}`;
      if (nodeKeys.has(input)) reached.add(input);
    }
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of outgoing.get(current) ?? []) {
        if (!nodeKeys.has(next) || reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    // A requirement is an evaluation subject, not a downstream case output.
    // Include only the exact recorded requirement predecessor of a reached
    // evaluation; never continue through it into sibling evaluations.
    for (const edge of snapshot.graph.edges) {
      if (edge.relation !== "evaluates") continue;
      const to = `${edge.to.kind}:${edge.to.id}`;
      const from = `${edge.from.kind}:${edge.from.id}`;
      if (reached.has(to) && nodeKeys.has(from)) reached.add(from);
    }
    for (const nodeKey of reached) {
      const references = membership.get(nodeKey) ?? new Set<string>();
      references.add(verificationCase.key);
      membership.set(nodeKey, references);
    }
  }
  return membership;
}

function caseInputsMatch(
  snapshot: ThreadWorkbenchSnapshot,
  authority: ThreadArtifact,
  expectedInputs: readonly {
    readonly id: string;
    readonly fingerprint: string;
    readonly producerRunId?: string;
  }[],
): boolean {
  const declaredIds = [...authority.dependsOn].sort();
  const expectedIds = expectedInputs.map((input) => input.id).sort();
  if (
    declaredIds.length !== expectedIds.length ||
    declaredIds.some((id, index) => id !== expectedIds[index])
  ) return false;
  const artifacts = new Map(
    snapshot.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  return expectedInputs.every((input) => {
    const artifact = artifacts.get(input.id);
    return artifact?.fingerprint === input.fingerprint &&
      (input.producerRunId === undefined ||
        artifact.producerRunId === input.producerRunId);
  });
}

function caseKey(
  family: EngineeringCaseFamily,
  digest: string,
): string {
  if (!SHA256.test(digest)) {
    throw new TypeError("verification case digest must be lowercase SHA-256");
  }
  return `verification-case:${family}:${digest}`;
}

function sameDeclaration(
  existing: EngineeringCase,
  extracted: ExtractedCase,
): boolean {
  if (
    existing.family !== extracted.family ||
    existing.caseSchemaVersion !== extracted.caseSchemaVersion ||
    existing.id !== extracted.id ||
    existing.revision !== extracted.revision ||
    existing.scope !== extracted.scope ||
    existing.caseDigest !== extracted.caseDigest
  ) {
    return false;
  }
  if (existing.family === "mechanical-proof") {
    return extracted.family === "mechanical-proof" &&
      existing.target?.modelElementId === extracted.targetModelElementId;
  }
  return true;
}

function projectCaseDeclaration(
  key: string,
  extracted: ExtractedCase,
  authorityArtifactId: string,
): EngineeringCase {
  const common = {
    key,
    id: extracted.id,
    revision: extracted.revision,
    scope: extracted.scope,
    caseDigest: extracted.caseDigest,
    authorityArtifactIds: [authorityArtifactId],
  };
  switch (extracted.family) {
    case "mechanical-proof":
      return {
        ...common,
        family: extracted.family,
        caseSchemaVersion: extracted.caseSchemaVersion,
        target: { modelElementId: extracted.targetModelElementId },
      };
    case "sensitivity-study":
      return {
        ...common,
        family: extracted.family,
        caseSchemaVersion: extracted.caseSchemaVersion,
      };
    case "printability-check":
      return {
        ...common,
        family: extracted.family,
        caseSchemaVersion: extracted.caseSchemaVersion,
      };
    case "print-estimate":
      return {
        ...common,
        family: extracted.family,
        caseSchemaVersion: extracted.caseSchemaVersion,
      };
    case "dfm-check":
      return {
        ...common,
        family: extracted.family,
        caseSchemaVersion: extracted.caseSchemaVersion,
      };
  }
}

function projectVerifiedByEdges(
  snapshot: ThreadWorkbenchSnapshot,
  cases: readonly EngineeringCase[],
): ThreadGraph["edges"] {
  const partIds = new Set(
    snapshot.graph.nodes
      .filter((node) => node.entityKind === "part-definition")
      .map((node) => node.ref.id),
  );
  const artifactIds = new Set(
    snapshot.graph.nodes
      .filter((node) => node.entityKind === "artifact")
      .map((node) => node.ref.id),
  );
  const edges: ThreadGraph["edges"] = [];
  for (const item of cases) {
    if (item.family !== "mechanical-proof" || !item.target) continue;
    const modelElementId = item.target.modelElementId;
    if (!partIds.has(modelElementId)) continue;
    for (const artifactId of item.authorityArtifactIds) {
      if (!artifactIds.has(artifactId)) continue;
      edges.push({
        id: `structure:verified-by:${modelElementId}:${artifactId}`,
        from: { kind: "part-definition", id: modelElementId },
        to: { kind: "artifact", id: artifactId },
        relation: "verified_by",
        rationale:
          `PartDefinition ${modelElementId} is the exact FEA proof target of ` +
          `sealed case ${item.id}.`,
        origin: "structure",
      });
    }
  }
  return edges;
}

function graphNodeKey(node: ThreadGraphNode): string {
  return `${node.ref.kind}:${node.ref.id}`;
}

function issue(
  family: EngineeringCaseFamily,
  authorityArtifactId: string,
  status: EngineeringCaseIssue["status"],
  reason: EngineeringCaseIssue["reason"],
): EngineeringCaseIssue {
  return { family, authorityArtifactId, status, reason };
}

function catalogStatus(
  coverage: EngineeringCaseCatalog["coverage"],
  issues: readonly EngineeringCaseIssue[],
): EngineeringCaseCatalog["status"] {
  if (issues.length > 0) return "unresolved";
  if (coverage.every((item) => item.status === "unavailable")) {
    return "unavailable";
  }
  return coverage.some((item) => item.status === "unavailable")
    ? "unresolved"
    : "observed";
}

function compareCases(
  left: EngineeringCase,
  right: EngineeringCase,
): number {
  return left.family.localeCompare(right.family) ||
    left.id.localeCompare(right.id) ||
    left.revision - right.revision ||
    left.caseDigest.localeCompare(right.caseDigest);
}

function compareIssues(
  left: EngineeringCaseIssue,
  right: EngineeringCaseIssue,
): number {
  return left.family.localeCompare(right.family) ||
    left.authorityArtifactId.localeCompare(right.authorityArtifactId) ||
    left.reason.localeCompare(right.reason);
}
