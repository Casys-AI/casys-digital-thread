import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../../presentation/workbench/thread/graph.ts";
import type { ThreadWorkbenchSnapshot } from "../../../presentation/workbench/thread/snapshot.ts";
import { LIVE_THREAD_OVERLAY_SCHEMA } from "../../../presentation/workbench/engineering/schema.ts";
import type {
  LiveThreadGraphState,
  LiveThreadUpdateState,
  LiveThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/live-overlay.ts";

export { LIVE_THREAD_OVERLAY_SCHEMA } from "../../../presentation/workbench/engineering/schema.ts";
export type {
  LiveThreadGraphState,
  LiveThreadOverlay,
  LiveThreadUpdateState,
  LiveThreadWorkbenchSnapshot,
} from "../../../presentation/workbench/engineering/live-overlay.ts";

export const LIVE_THREAD_UPDATE_SCHEMA = "live-thread-update/1.0" as const;

export interface LiveThreadGraphPatch {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
}

export interface AppendLiveThreadUpdate {
  subjectId: string;
  runId: string;
  operationId: string;
  /** Canonical revision visible when the operation began. */
  baseRevision: number;
  state: LiveThreadGraphState;
  recordedAt: string;
  graph: LiveThreadGraphPatch;
}

/**
 * Immutable journal entry. Tool arguments and raw structuredContent are
 * deliberately absent: the journal only owns the browser-safe graph projection.
 */
export interface LiveThreadUpdate extends Omit<AppendLiveThreadUpdate, "state"> {
  schemaVersion: typeof LIVE_THREAD_UPDATE_SCHEMA;
  sequence: number;
  state: LiveThreadUpdateState;
}

export interface LiveThreadUpdateJournal {
  append(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate>;
  reconcileRun(
    subjectId: string,
    runId: string,
    recordedAt?: string,
  ): Promise<LiveThreadUpdate>;
  list(subjectId: string): Promise<LiveThreadUpdate[]>;
  version(subjectId: string): Promise<number>;
}

/**
 * Optional stronger contract for executors whose lifecycle milestones must be
 * idempotent across concurrent attempts. Generic journals stay append-only.
 */
export interface LiveThreadUpdateMilestoneJournal extends LiveThreadUpdateJournal {
  /**
   * Atomically record one lifecycle milestone for a run. The idempotency
   * identity is subjectId + runId + operationId + state; regular append()
   * intentionally remains fully append-only for callers that need each event.
   */
  appendOnce(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate>;
  /** Atomically append at most one reconciliation tombstone for a run. */
  reconcileRunOnce(
    subjectId: string,
    runId: string,
    recordedAt?: string,
  ): Promise<LiveThreadUpdate>;
}

/**
 * Process-local, append-only activity journal. It has no tool execution method
 * and cannot mutate a canonical ThreadSnapshot.
 */
export class LiveThreadUpdateStore implements LiveThreadUpdateMilestoneJournal {
  #nextSequence = 1;
  readonly #updatesBySubject = new Map<string, LiveThreadUpdate[]>();

  append(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    validateUpdateInput(input);
    const update: LiveThreadUpdate = {
      schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
      sequence: this.#nextSequence++,
      subjectId: input.subjectId,
      runId: input.runId,
      operationId: input.operationId,
      baseRevision: input.baseRevision,
      state: input.state,
      recordedAt: input.recordedAt,
      graph: normalizePatch(input.graph, input.state, input.recordedAt),
    };
    const journal = this.#updatesBySubject.get(input.subjectId) ?? [];
    journal.push(update);
    this.#updatesBySubject.set(input.subjectId, journal);
    return Promise.resolve(structuredClone(update));
  }

  appendOnce(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    validateUpdateInput(input);
    const existing = this.#updatesBySubject.get(input.subjectId)?.find((update) =>
      sameLifecycleMilestone(update, input)
    );
    if (existing) return Promise.resolve(structuredClone(existing));
    return this.append(input);
  }

  reconcileRun(
    subjectId: string,
    runId: string,
    recordedAt = new Date().toISOString(),
  ): Promise<LiveThreadUpdate> {
    validateSubjectId(subjectId);
    nonEmpty(runId, "runId");
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new TypeError("recordedAt must be an ISO timestamp");
    }
    const update: LiveThreadUpdate = {
      schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
      sequence: this.#nextSequence++,
      subjectId,
      runId,
      operationId: "$reconcile",
      baseRevision: 0,
      state: "reconciled",
      recordedAt,
      graph: { nodes: [], edges: [] },
    };
    const journal = this.#updatesBySubject.get(subjectId) ?? [];
    journal.push(update);
    this.#updatesBySubject.set(subjectId, journal);
    return Promise.resolve(structuredClone(update));
  }

  reconcileRunOnce(
    subjectId: string,
    runId: string,
    recordedAt = new Date().toISOString(),
  ): Promise<LiveThreadUpdate> {
    validateSubjectId(subjectId);
    nonEmpty(runId, "runId");
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new TypeError("recordedAt must be an ISO timestamp");
    }
    const existing = this.#updatesBySubject.get(subjectId)?.find((update) =>
      isRunReconciliation(update, runId)
    );
    if (existing) return Promise.resolve(structuredClone(existing));
    return this.reconcileRun(subjectId, runId, recordedAt);
  }

  list(subjectId: string): Promise<LiveThreadUpdate[]> {
    return Promise.resolve(
      structuredClone(this.#updatesBySubject.get(subjectId) ?? []),
    );
  }

  version(subjectId: string): Promise<number> {
    return Promise.resolve(
      this.#updatesBySubject.get(subjectId)?.at(-1)?.sequence ?? 0,
    );
  }
}

/**
 * Cross-process JSONL journal used by the runner (writer) and Workbench BFF
 * (reader). Every append is a complete immutable line; readers fold the lines.
 */
export class FileLiveThreadUpdateStore implements LiveThreadUpdateMilestoneJournal {
  readonly #directory: string;

  constructor(directory: string) {
    if (directory.trim() === "") throw new TypeError("directory must not be empty");
    this.#directory = directory;
  }

  append(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    validateUpdateInput(input);
    return this.#appendLocked(input.subjectId, (sequence) => ({
      schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
      sequence,
      subjectId: input.subjectId,
      runId: input.runId,
      operationId: input.operationId,
      baseRevision: input.baseRevision,
      state: input.state,
      recordedAt: input.recordedAt,
      graph: normalizePatch(input.graph, input.state, input.recordedAt),
    }));
  }

  appendOnce(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    validateUpdateInput(input);
    return this.#appendLocked(
      input.subjectId,
      (sequence) => ({
        schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
        sequence,
        subjectId: input.subjectId,
        runId: input.runId,
        operationId: input.operationId,
        baseRevision: input.baseRevision,
        state: input.state,
        recordedAt: input.recordedAt,
        graph: normalizePatch(input.graph, input.state, input.recordedAt),
      }),
      (existing) => existing.find((update) => sameLifecycleMilestone(update, input)),
    );
  }

  reconcileRun(
    subjectId: string,
    runId: string,
    recordedAt = new Date().toISOString(),
  ): Promise<LiveThreadUpdate> {
    validateSubjectId(subjectId);
    nonEmpty(runId, "runId");
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new TypeError("recordedAt must be an ISO timestamp");
    }
    return this.#appendLocked(subjectId, (sequence) => ({
      schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
      sequence,
      subjectId,
      runId,
      operationId: "$reconcile",
      baseRevision: 0,
      state: "reconciled",
      recordedAt,
      graph: { nodes: [], edges: [] },
    }));
  }

  reconcileRunOnce(
    subjectId: string,
    runId: string,
    recordedAt = new Date().toISOString(),
  ): Promise<LiveThreadUpdate> {
    validateSubjectId(subjectId);
    nonEmpty(runId, "runId");
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new TypeError("recordedAt must be an ISO timestamp");
    }
    return this.#appendLocked(
      subjectId,
      (sequence) => ({
        schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
        sequence,
        subjectId,
        runId,
        operationId: "$reconcile",
        baseRevision: 0,
        state: "reconciled",
        recordedAt,
        graph: { nodes: [], edges: [] },
      }),
      (existing) => existing.find((update) => isRunReconciliation(update, runId)),
    );
  }

  async list(subjectId: string): Promise<LiveThreadUpdate[]> {
    validateSubjectId(subjectId);
    let file: Deno.FsFile;
    try {
      file = await Deno.open(this.#path(subjectId), { read: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    await file.lock(false);
    try {
      return await this.#readUnlocked(subjectId);
    } finally {
      await file.unlock();
      file.close();
    }
  }

  async version(subjectId: string): Promise<number> {
    return (await this.list(subjectId)).at(-1)?.sequence ?? 0;
  }

  async #appendLocked(
    subjectId: string,
    create: (sequence: number) => LiveThreadUpdate,
    existingMatch?: (
      existing: readonly LiveThreadUpdate[],
    ) => LiveThreadUpdate | undefined,
  ): Promise<LiveThreadUpdate> {
    await Deno.mkdir(this.#directory, { recursive: true });
    const file = await Deno.open(this.#path(subjectId), {
      create: true,
      read: true,
      write: true,
      append: true,
    });
    await file.lock(true);
    try {
      const existing = await this.#readUnlocked(subjectId);
      const prior = existingMatch?.(existing);
      if (prior) return structuredClone(prior);
      const update = create((existing.at(-1)?.sequence ?? 0) + 1);
      const bytes = new TextEncoder().encode(`${JSON.stringify(update)}\n`);
      let written = 0;
      while (written < bytes.length) {
        written += await file.write(bytes.subarray(written));
      }
      await file.syncData();
      return structuredClone(update);
    } finally {
      await file.unlock();
      file.close();
    }
  }

  async #readUnlocked(subjectId: string): Promise<LiveThreadUpdate[]> {
    const text = await Deno.readTextFile(this.#path(subjectId));
    const updates = text.split("\n").flatMap((line, index) => {
      if (line.trim() === "") return [];
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new TypeError(`invalid live update JSONL at line ${index + 1}`);
      }
      return [decodeStoredUpdate(value, subjectId, index + 1)];
    });
    for (let index = 1; index < updates.length; index++) {
      if (updates[index].sequence <= updates[index - 1].sequence) {
        throw new TypeError("live update sequence must be strictly increasing");
      }
    }
    return updates;
  }

  #path(subjectId: string): string {
    validateSubjectId(subjectId);
    return `${this.#directory}/${encodeURIComponent(subjectId)}.jsonl`;
  }
}

/**
 * Overlay intermediate facts on the existing Workbench contract. A live fact
 * may replace the same fact from its base revision (for example fresh ->
 * running). Once a newer canonical revision contains that identity, canonical
 * data wins and the provisional fact disappears without a duplicate.
 */
export function overlayLiveThreadUpdates(
  canonical: ThreadWorkbenchSnapshot,
  canonicalRevision: number,
  updates: readonly LiveThreadUpdate[],
  version = updates.at(-1)?.sequence ?? 0,
): LiveThreadWorkbenchSnapshot {
  const nodeCandidates = new Map<string, Candidate<ThreadGraphNode>>();
  const edgeCandidates = new Map<string, Candidate<ThreadGraphEdge>>();
  const reconciledRuns = new Map<string, number>();
  for (const update of updates) {
    if (update.state === "reconciled") {
      reconciledRuns.set(update.runId, update.sequence);
    }
  }
  for (const update of updates) {
    if (
      update.state === "reconciled" ||
      update.sequence <= (reconciledRuns.get(update.runId) ?? 0)
    ) {
      continue;
    }
    const activeUpdate = update as ActiveLiveThreadUpdate;
    for (const node of update.graph.nodes) {
      nodeCandidates.set(nodeKey(node), { value: node, update: activeUpdate });
    }
    for (const edge of update.graph.edges) {
      edgeCandidates.set(edgeKey(edge), { value: edge, update: activeUpdate });
    }
  }

  const canonicalNodeKeys = new Set(canonical.graph.nodes.map(nodeKey));
  const canonicalEdgeKeys = new Set(canonical.graph.edges.map(edgeKey));
  const survivingNodes = [...nodeCandidates.values()].filter((candidate) =>
    !isReconciled(
      candidate.update,
      canonicalRevision,
      canonicalNodeKeys.has(nodeKey(candidate.value)),
    )
  );
  const survivingEdges = [...edgeCandidates.values()].filter((candidate) =>
    !isReconciled(
      candidate.update,
      canonicalRevision,
      canonicalEdgeKeys.has(edgeKey(candidate.value)),
    )
  );

  const nodes = new Map(canonical.graph.nodes.map((node) => [nodeKey(node), node]));
  for (const candidate of survivingNodes) {
    nodes.set(nodeKey(candidate.value), candidate.value);
  }
  const edges = new Map(canonical.graph.edges.map((edge) => [edgeKey(edge), edge]));
  for (const candidate of survivingEdges) {
    edges.set(edgeKey(candidate.value), candidate.value);
  }
  const availableNodeKeys = new Set([...nodes.values()].map(nodeKey));
  const graph: ThreadGraph = {
    nodes: structuredClone([...nodes.values()]),
    edges: structuredClone(
      [...edges.values()].filter((edge) =>
        availableNodeKeys.has(refKey(edge.from)) &&
        availableNodeKeys.has(refKey(edge.to))
      ),
    ),
  };

  const activeUpdates = latestActiveUpdates([
    ...survivingNodes.map((candidate) => candidate.update),
    ...survivingEdges.map((candidate) => candidate.update),
  ]);
  return {
    ...structuredClone(canonical),
    graph,
    live: {
      schemaVersion: LIVE_THREAD_OVERLAY_SCHEMA,
      version,
      active: activeUpdates.map((update) => ({
        runId: update.runId,
        operationId: update.operationId,
        state: update.state,
        recordedAt: update.recordedAt,
        baseRevision: update.baseRevision,
        sequence: update.sequence,
      })),
    },
  };
}

/** Redact known sensitive values before a projected patch reaches the journal. */
export function redactLiveThreadGraphPatch(
  patch: LiveThreadGraphPatch,
  sensitiveSources: readonly unknown[] = [],
): LiveThreadGraphPatch {
  const sensitiveValues = sensitiveSources.flatMap((value) =>
    extractSensitiveValues(value)
  )
    .filter((value, index, values) =>
      value.length >= 3 && values.indexOf(value) === index
    )
    .sort((left, right) => right.length - left.length);
  const clean = (value: string, maxLength: number): string =>
    redactText(value, sensitiveValues).slice(0, maxLength);
  return {
    nodes: patch.nodes.map((node) => ({
      ...structuredClone(node),
      label: clean(node.label, 240),
      system: clean(node.system, 160),
      summary: clean(node.summary, 800),
    })),
    edges: patch.edges.map((edge) => ({
      ...structuredClone(edge),
      rationale: clean(edge.rationale, 800),
    })),
  };
}

interface Candidate<T> {
  value: T;
  update: ActiveLiveThreadUpdate;
}

type ActiveLiveThreadUpdate = LiveThreadUpdate & { state: LiveThreadGraphState };

function sameLifecycleMilestone(
  update: LiveThreadUpdate,
  input: AppendLiveThreadUpdate,
): boolean {
  return update.runId === input.runId &&
    update.operationId === input.operationId &&
    update.state === input.state;
}

function isRunReconciliation(update: LiveThreadUpdate, runId: string): boolean {
  return update.runId === runId &&
    update.operationId === "$reconcile" &&
    update.state === "reconciled";
}

function latestActiveUpdates(
  updates: readonly ActiveLiveThreadUpdate[],
): ActiveLiveThreadUpdate[] {
  const latest = new Map<string, ActiveLiveThreadUpdate>();
  for (const update of updates) {
    const key = `${update.runId}\u0000${update.operationId}`;
    if ((latest.get(key)?.sequence ?? 0) < update.sequence) latest.set(key, update);
  }
  return [...latest.values()].sort((left, right) => left.sequence - right.sequence);
}

function isReconciled(
  update: LiveThreadUpdate,
  canonicalRevision: number,
  canonicalContainsIdentity: boolean,
): boolean {
  return canonicalContainsIdentity && canonicalRevision > update.baseRevision;
}

function normalizePatch(
  patch: LiveThreadGraphPatch,
  state: LiveThreadUpdateState,
  recordedAt: string,
): LiveThreadGraphPatch {
  if (!patch || !Array.isArray(patch.nodes) || !Array.isArray(patch.edges)) {
    throw new TypeError("live graph patch must contain nodes and edges arrays");
  }
  if (state === "reconciled") {
    if (patch.nodes.length > 0 || patch.edges.length > 0) {
      throw new TypeError("a reconciled update must have an empty graph patch");
    }
    return { nodes: [], edges: [] };
  }
  const nodes = patch.nodes.map((node) => {
    validateNode(node);
    return {
      ...structuredClone(node),
      freshness: state,
      recordedAt,
    };
  });
  const edges = patch.edges.map((edge) => {
    validateEdge(edge);
    return structuredClone(edge);
  });
  rejectDuplicates(nodes.map(nodeKey), "live graph node identity");
  rejectDuplicates(edges.map(edgeKey), "live graph edge identity");
  return { nodes, edges };
}

function validateUpdateInput(input: AppendLiveThreadUpdate): void {
  validateSubjectId(input.subjectId);
  nonEmpty(input.runId, "runId");
  nonEmpty(input.operationId, "operationId");
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new TypeError("baseRevision must be a non-negative safe integer");
  }
  if (
    input.state !== "running" && input.state !== "fresh" && input.state !== "failed"
  ) {
    throw new TypeError("state must be running, fresh, or failed");
  }
  if (Number.isNaN(Date.parse(input.recordedAt))) {
    throw new TypeError("recordedAt must be an ISO timestamp");
  }
}

function decodeStoredUpdate(
  value: unknown,
  subjectId: string,
  line: number,
): LiveThreadUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`invalid live update object at line ${line}`);
  }
  const candidate = value as Partial<LiveThreadUpdate>;
  if (candidate.schemaVersion !== LIVE_THREAD_UPDATE_SCHEMA) {
    throw new TypeError(`unsupported live update schema at line ${line}`);
  }
  if (!Number.isSafeInteger(candidate.sequence) || (candidate.sequence ?? 0) < 1) {
    throw new TypeError(`invalid live update sequence at line ${line}`);
  }
  if (candidate.subjectId !== subjectId) {
    throw new TypeError(`live update subject mismatch at line ${line}`);
  }
  if (candidate.state === "reconciled") {
    nonEmpty(candidate.runId, "runId");
    if (!Number.isSafeInteger(candidate.baseRevision) || candidate.baseRevision !== 0) {
      throw new TypeError(`invalid reconciliation baseRevision at line ${line}`);
    }
    if (candidate.operationId !== "$reconcile") {
      throw new TypeError(`invalid reconciliation operationId at line ${line}`);
    }
    if (
      typeof candidate.recordedAt !== "string" ||
      Number.isNaN(Date.parse(candidate.recordedAt))
    ) {
      throw new TypeError(`invalid reconciliation timestamp at line ${line}`);
    }
    const graph = candidate.graph as LiveThreadGraphPatch;
    return {
      schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
      sequence: candidate.sequence as number,
      subjectId,
      runId: candidate.runId,
      operationId: "$reconcile",
      baseRevision: 0,
      state: "reconciled",
      recordedAt: candidate.recordedAt,
      graph: normalizePatch(graph, "reconciled", candidate.recordedAt),
    };
  }
  const input = {
    subjectId: candidate.subjectId,
    runId: candidate.runId,
    operationId: candidate.operationId,
    baseRevision: candidate.baseRevision,
    state: candidate.state,
    recordedAt: candidate.recordedAt,
    graph: candidate.graph,
  } as AppendLiveThreadUpdate;
  validateUpdateInput(input);
  return {
    schemaVersion: LIVE_THREAD_UPDATE_SCHEMA,
    sequence: candidate.sequence as number,
    ...structuredClone(input),
    graph: normalizePatch(input.graph, input.state, input.recordedAt),
  };
}

function validateSubjectId(subjectId: string): void {
  nonEmpty(subjectId, "subjectId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(subjectId)) {
    throw new TypeError("subjectId contains unsupported characters");
  }
}

function validateNode(node: ThreadGraphNode): void {
  if (!node || typeof node !== "object") throw new TypeError("invalid live graph node");
  nonEmpty(node.id, "node.id");
  nonEmpty(node.ref?.id, "node.ref.id");
  nonEmpty(node.ref?.kind, "node.ref.kind");
  if (node.entityKind !== node.ref.kind) {
    throw new TypeError("node.entityKind must equal node.ref.kind");
  }
  nonEmpty(node.label, "node.label");
  nonEmpty(node.system, "node.system");
  nonEmpty(node.summary, "node.summary");
  if (node.activityRole !== undefined && node.activityRole !== "milestone") {
    throw new TypeError("node.activityRole is unsupported");
  }
}

function validateEdge(edge: ThreadGraphEdge): void {
  if (!edge || typeof edge !== "object") throw new TypeError("invalid live graph edge");
  nonEmpty(edge.id, "edge.id");
  nonEmpty(edge.from?.id, "edge.from.id");
  nonEmpty(edge.to?.id, "edge.to.id");
  nonEmpty(edge.rationale, "edge.rationale");
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function rejectDuplicates(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be unique within one update`);
  }
}

function nodeKey(node: ThreadGraphNode): string {
  return refKey(node.ref);
}

function refKey(reference: ThreadGraphNode["ref"]): string {
  return `${reference.kind}:${reference.id}`;
}

function edgeKey(edge: ThreadGraphEdge): string {
  return edge.id || `${refKey(edge.from)}:${edge.relation}:${refKey(edge.to)}`;
}

function extractSensitiveValues(value: unknown, sensitive = false): string[] {
  if (typeof value === "string") return sensitive ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") {
    return sensitive ? [String(value)] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractSensitiveValues(item, sensitive));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    extractSensitiveValues(item, sensitive || SENSITIVE_KEY.test(key))
  );
}

const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key|script|python|source[_-]?code)/i;

function redactText(value: string, sensitiveValues: readonly string[]): string {
  let result = [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 || code === 9 || code === 10 || code === 13;
  }).join("");
  for (const sensitive of sensitiveValues) {
    result = result.split(sensitive).join("[REDACTED]");
  }
  return result
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED]")
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]");
}
