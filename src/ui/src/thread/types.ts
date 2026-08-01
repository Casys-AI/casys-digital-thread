/**
 * Browser-safe projection of the linked engineering thread.
 *
 * This contract deliberately contains no MCP transport types. The backend owns
 * tool calls and projects their persisted, linked evidence into this snapshot.
 */

import type { EngineeringProjectSnapshot } from "../../../domain/engineering-project.ts";
import {
  type EngineeringWorkbenchCapabilities,
  isOperatorCommandCapabilities,
} from "../project/command-contract.ts";
import { isEngineeringProjectSnapshot } from "../project/contract.ts";

export type ThreadFreshness = "fresh" | "stale" | "running" | "failed";
export type ThreadTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ThreadRef {
  kind: "change" | "artifact" | "observation" | "requirement" | "violation";
  id: string;
}

/** Every canonical entity kind which can participate in the native graph. */
export interface ThreadGraphRef {
  kind:
    | "artifact"
    | "consumption"
    | "observation"
    | "requirement"
    | "evaluation"
    | "violation"
    | "change"
    | "action";
  id: string;
}

/** Canonical provenance relations plus two explicit structural facts. */
export type ThreadGraphRelation =
  | "changes"
  | "derived_from"
  | "traces_to"
  | "uses"
  | "evaluates"
  | "evidences"
  | "caused_by"
  | "addresses"
  | "supersedes"
  | "input_to"
  | "source_of";

export interface ThreadGraphNode {
  /** Stable browser key, distinct from the canonical entity id. */
  id: string;
  ref: ThreadGraphRef;
  entityKind: ThreadGraphRef["kind"];
  /** Canonical artifact kind, present only for artifact nodes. */
  artifactKind?: string;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  /** Canonical timestamp used to order this fact in the activity feed. */
  recordedAt?: string;
  /** Existing inspector target when this entity has a native detail panel. */
  selection?: ThreadRef;
}

export interface ThreadGraphEdgeAttestation {
  consumptionId: string;
  status: "verified" | "mismatch";
  producerFingerprint: string;
  consumedFingerprint: string;
  checkedAt: string;
}

export interface ThreadGraphEdge {
  id: string;
  /** Visual direction: dependency/source -> result/consumer. */
  from: ThreadGraphRef;
  to: ThreadGraphRef;
  relation: ThreadGraphRelation;
  rationale: string;
  origin: "provenance" | "structure";
  attestation?: ThreadGraphEdgeAttestation;
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
}

export interface ThreadChange {
  id: string;
  title: string;
  summary: string;
  author: string;
  revision: string;
  changedAt: string;
  status: "evaluated" | "partially_evaluated" | "pending";
  files: string[];
}

export interface ThreadFlowStage {
  id: string;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  selection: ThreadRef;
  /** Stage ids backed by an explicit canonical dependency or provenance link. */
  dependsOn: string[];
}

export interface ThreadArtifact {
  id: string;
  label: string;
  kind: string;
  system: string;
  revision: string;
  freshness: ThreadFreshness;
  fingerprint?: string;
  uri?: string;
  producedAt?: string;
  producedBy?: string;
  dependsOn: string[];
  attestation?: {
    status: "verified" | "mismatch";
    sourceArtifactId: string;
    producerFingerprint: string;
    consumedFingerprint: string;
    checkedAt: string;
  };
}

export interface ThreadObservation {
  id: string;
  label: string;
  value: number;
  unit: string;
  display: string;
  sourceArtifactId: string;
  requirementIds: string[];
  freshness: ThreadFreshness;
  measuredAt?: string;
}

export interface ThreadRequirement {
  id: string;
  label: string;
  source: string;
  expression: string;
  status: "pass" | "fail" | "unresolved";
  observationIds: string[];
  violationIds: string[];
  rationale: string;
}

export interface ThreadViolation {
  id: string;
  name: string;
  severity: "blocking" | "warning";
  status: "open" | "resolved";
  requirementId: string;
  observationId: string;
  message: string;
  margin: string;
  evidence: string[];
  proposedActionIds: string[];
}

export interface ThreadAction {
  id: string;
  label: string;
  description: string;
  kind: "change" | "recompute" | "inspect";
  targetId: string;
  system: string;
  readiness: "ready" | "blocked";
  requiresConfirmation: boolean;
}

export type ThreadComponentProvider = "syson" | "erpnext" | "build123d";

export interface ThreadComponentBinding {
  provider: ThreadComponentProvider;
  kind: "part-usage" | "item" | "artifact" | "assembly-child";
  id: string;
  label: string;
  evidenceArtifactId: string;
  status: "verified" | "unverified";
  reason?: string;
  /** Existing browser record which carries the provider evidence. */
  selection?: ThreadRef;
}

export interface ThreadComponentPreview {
  provider: "build123d";
  artifactId: string;
  mediaType: "model/stl";
  url: string;
  /** Presentation mesh fingerprint, distinct from the authoritative CAD hash. */
  sha256: string;
}

export interface ThreadComponent {
  id: string;
  label: string;
  kind: "assembly" | "part";
  quantity: number;
  parentId?: string;
  bindings: ThreadComponentBinding[];
  preview?: ThreadComponentPreview;
}

export interface ThreadComponentCatalog {
  schemaVersion: "thread-components/1.0";
  authority: "workspace-declared";
  subjectId: string;
  rationale: string;
  systemViews: {
    syson?: {
      projectId: string;
      editingContextId: string;
      diagramId: string;
      diagramLabel: string;
    };
    erpnext?: { bomName: string };
  };
  components: ThreadComponent[];
}

export interface ThreadWorkbenchSnapshot {
  /** UI projection produced from the canonical domain ThreadSnapshot. */
  schemaVersion: "thread-workbench/0.1";
  id: string;
  subject: {
    id: string;
    label: string;
    program: string;
  };
  generatedAt: string;
  source: "observed" | "fixture";
  sourceLabel: string;
  change: ThreadChange;
  components: ThreadComponentCatalog;
  graph: ThreadGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}

/** Project intent and linked technical proof delivered as one atomic BFF read. */
export interface EngineeringWorkbenchSnapshot {
  readonly schemaVersion: "engineering-workbench/0.1";
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadWorkbenchSnapshot;
  /** Absent means read-only. Mutation is never inferred from HTTP availability. */
  readonly capabilities?: EngineeringWorkbenchCapabilities;
  readonly alignment: {
    readonly status: "aligned" | "thread-ahead";
    readonly projectThreadRevision: number;
    readonly currentThreadRevision: number;
  };
}

export function isEngineeringWorkbenchSnapshot(
  value: unknown,
): value is EngineeringWorkbenchSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EngineeringWorkbenchSnapshot>;
  return candidate.schemaVersion === "engineering-workbench/0.1" &&
    isEngineeringProjectSnapshot(candidate.project) &&
    isThreadWorkbenchSnapshot(candidate.thread) &&
    (candidate.capabilities === undefined ||
      (!!candidate.capabilities &&
        isOperatorCommandCapabilities(
          candidate.capabilities.operatorCommands,
        ))) &&
    !!candidate.alignment &&
    (candidate.alignment.status === "aligned" ||
      candidate.alignment.status === "thread-ahead") &&
    typeof candidate.alignment.projectThreadRevision === "number" &&
    typeof candidate.alignment.currentThreadRevision === "number";
}

export function isThreadWorkbenchSnapshot(
  value: unknown,
): value is ThreadWorkbenchSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThreadWorkbenchSnapshot>;
  return candidate.schemaVersion === "thread-workbench/0.1" &&
    typeof candidate.id === "string" &&
    typeof candidate.generatedAt === "string" &&
    !!candidate.subject &&
    !!candidate.change &&
    isThreadComponentCatalog(candidate.components) &&
    isThreadGraph(candidate.graph) &&
    Array.isArray(candidate.flow) &&
    candidate.flow.every(isThreadFlowStage) &&
    Array.isArray(candidate.artifacts) &&
    Array.isArray(candidate.observations) &&
    Array.isArray(candidate.requirements) &&
    Array.isArray(candidate.violations) &&
    Array.isArray(candidate.actions);
}

function isThreadComponentCatalog(
  value: unknown,
): value is ThreadComponentCatalog {
  if (!value || typeof value !== "object") return false;
  const catalog = value as Partial<ThreadComponentCatalog>;
  return catalog.schemaVersion === "thread-components/1.0" &&
    catalog.authority === "workspace-declared" &&
    typeof catalog.subjectId === "string" &&
    typeof catalog.rationale === "string" &&
    !!catalog.systemViews &&
    Array.isArray(catalog.components) &&
    catalog.components.every(isThreadComponent);
}

function isThreadComponent(value: unknown): value is ThreadComponent {
  if (!value || typeof value !== "object") return false;
  const component = value as Partial<ThreadComponent>;
  return typeof component.id === "string" &&
    typeof component.label === "string" &&
    (component.kind === "assembly" || component.kind === "part") &&
    typeof component.quantity === "number" &&
    Array.isArray(component.bindings) &&
    component.bindings.every(isThreadComponentBinding) &&
    (component.preview === undefined ||
      (component.preview.provider === "build123d" &&
        component.preview.mediaType === "model/stl" &&
        typeof component.preview.url === "string" &&
        typeof component.preview.sha256 === "string"));
}

function isThreadComponentBinding(
  value: unknown,
): value is ThreadComponentBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<ThreadComponentBinding>;
  return (binding.provider === "syson" || binding.provider === "erpnext" ||
    binding.provider === "build123d") &&
    (binding.kind === "part-usage" || binding.kind === "item" ||
      binding.kind === "artifact" || binding.kind === "assembly-child") &&
    typeof binding.id === "string" &&
    typeof binding.label === "string" &&
    typeof binding.evidenceArtifactId === "string" &&
    (binding.status === "verified" || binding.status === "unverified") &&
    (binding.selection === undefined || isThreadRef(binding.selection));
}

function isThreadGraph(value: unknown): value is ThreadGraph {
  if (!value || typeof value !== "object") return false;
  const graph = value as Partial<ThreadGraph>;
  return Array.isArray(graph.nodes) && graph.nodes.every(isThreadGraphNode) &&
    Array.isArray(graph.edges) && graph.edges.every(isThreadGraphEdge);
}

function isThreadGraphNode(value: unknown): value is ThreadGraphNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<ThreadGraphNode>;
  return typeof node.id === "string" &&
    isThreadGraphRef(node.ref) &&
    node.entityKind === node.ref?.kind &&
    (node.artifactKind === undefined ||
      typeof node.artifactKind === "string") &&
    typeof node.label === "string" &&
    typeof node.system === "string" &&
    isThreadFreshness(node.freshness) &&
    typeof node.summary === "string" &&
    (node.recordedAt === undefined || typeof node.recordedAt === "string") &&
    (node.selection === undefined || isThreadRef(node.selection));
}

function isThreadGraphEdge(value: unknown): value is ThreadGraphEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<ThreadGraphEdge>;
  return typeof edge.id === "string" &&
    isThreadGraphRef(edge.from) &&
    isThreadGraphRef(edge.to) &&
    isThreadGraphRelation(edge.relation) &&
    typeof edge.rationale === "string" &&
    (edge.origin === "provenance" || edge.origin === "structure") &&
    (edge.attestation === undefined ||
      isThreadGraphEdgeAttestation(edge.attestation));
}

function isThreadGraphEdgeAttestation(
  value: unknown,
): value is ThreadGraphEdgeAttestation {
  if (!value || typeof value !== "object") return false;
  const attestation = value as Partial<ThreadGraphEdgeAttestation>;
  return typeof attestation.consumptionId === "string" &&
    (attestation.status === "verified" || attestation.status === "mismatch") &&
    typeof attestation.producerFingerprint === "string" &&
    typeof attestation.consumedFingerprint === "string" &&
    typeof attestation.checkedAt === "string";
}

function isThreadGraphRef(value: unknown): value is ThreadGraphRef {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ThreadGraphRef>;
  return typeof reference.id === "string" &&
    (reference.kind === "artifact" ||
      reference.kind === "consumption" ||
      reference.kind === "observation" ||
      reference.kind === "requirement" ||
      reference.kind === "evaluation" ||
      reference.kind === "violation" ||
      reference.kind === "change" ||
      reference.kind === "action");
}

function isThreadRef(value: unknown): value is ThreadRef {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ThreadRef>;
  return typeof reference.id === "string" &&
    (reference.kind === "change" ||
      reference.kind === "artifact" ||
      reference.kind === "observation" ||
      reference.kind === "requirement" ||
      reference.kind === "violation");
}

function isThreadGraphRelation(value: unknown): value is ThreadGraphRelation {
  return value === "changes" ||
    value === "derived_from" ||
    value === "traces_to" ||
    value === "uses" ||
    value === "evaluates" ||
    value === "evidences" ||
    value === "caused_by" ||
    value === "addresses" ||
    value === "supersedes" ||
    value === "input_to" ||
    value === "source_of";
}

function isThreadFreshness(value: unknown): value is ThreadFreshness {
  return value === "fresh" || value === "stale" || value === "running" ||
    value === "failed";
}

function isThreadFlowStage(value: unknown): value is ThreadFlowStage {
  if (!value || typeof value !== "object") return false;
  const stage = value as Partial<ThreadFlowStage>;
  return typeof stage.id === "string" &&
    Array.isArray(stage.dependsOn) &&
    stage.dependsOn.every((dependency) => typeof dependency === "string");
}
