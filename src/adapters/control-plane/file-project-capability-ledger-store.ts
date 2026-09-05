import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityLedger,
  reconstructProjectCapabilityEffectiveEnvelope,
  validateProjectCapabilityProposal,
} from "../../domain/capability/project-capability-authorization.ts";
import {
  ProjectCapabilityLedgerConflictError,
  type ProjectCapabilityLedgerStore,
} from "../../application/ports/out/project-capability-ledger-store.ts";

/** Shared local default for the MCP server and read-only native Workbench. */
export const DEFAULT_PROJECT_CAPABILITY_LEDGER_DIRECTORY =
  "state/local/project-capability-ledgers";

interface ProjectCapabilityClaim {
  readonly revision: number;
  readonly digest: string;
}

export type ProjectCapabilityLedgerDurabilityTransition =
  | "project-directory-created"
  | "temporary-created"
  | "pending-published"
  | "temporary-removed"
  | "claim-created"
  | "revision-published"
  | "pending-removed";

/** Isolates required parent-directory metadata flushes for review and tests. */
export interface ProjectCapabilityLedgerDurability {
  syncDirectory(
    directory: string,
    transition: ProjectCapabilityLedgerDurabilityTransition,
  ): Promise<void>;
}

class DenoProjectCapabilityLedgerDurability
  implements ProjectCapabilityLedgerDurability {
  async syncDirectory(
    directory: string,
    _transition: ProjectCapabilityLedgerDurabilityTransition,
  ): Promise<void> {
    const handle = await Deno.open(directory, { read: true });
    try {
      await handle.sync();
    } finally {
      handle.close();
    }
  }
}

/**
 * Immutable local authority ledger. The durable JSON revision is authoritative;
 * an identity-bearing empty `.claim` and deterministic `.pending` file are a recoverable
 * interrupted publication, not a permanent brick. A mismatched claim fails
 * closed rather than falling back to an older envelope.
 */
export class FileProjectCapabilityLedgerStore implements ProjectCapabilityLedgerStore {
  constructor(
    private readonly directory = DEFAULT_PROJECT_CAPABILITY_LEDGER_DIRECTORY,
    private readonly durability: ProjectCapabilityLedgerDurability =
      new DenoProjectCapabilityLedgerDurability(),
  ) {}

  async get(projectId: string): Promise<ProjectCapabilityLedger | undefined> {
    assertProjectId(projectId);
    let names: string[];
    try {
      names = [];
      for await (const entry of Deno.readDir(this.projectDirectory(projectId))) {
        if (entry.isFile) {
          names.push(entry.name);
        } else if (entry.name.endsWith(".json.pending")) {
          throw new ProjectCapabilityLedgerConflictError(
            `Capability ledger ${projectId} has a non-file pending revision ${entry.name}.`,
          );
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    const claims = claimDescriptorsFrom(names);
    const highestClaim = claims.length === 0
      ? undefined
      : Math.max(...claims.map((claim) => claim.revision));
    const highestJson = highestRevision(names, "json");
    for (const claim of claims) {
      if (claim.revision <= (highestJson ?? 0)) {
        await this.attestPublishedClaim(projectId, claim);
      }
    }
    if (highestClaim !== undefined && highestClaim > (highestJson ?? 0)) {
      const claim = claims.find((candidate) => candidate.revision === highestClaim);
      if (!claim) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger ${projectId} selected a missing highest claim.`,
        );
      }
      await this.recoverClaim(projectId, claim);
      return await this.get(projectId);
    }
    if (highestJson === undefined) return undefined;
    return await this.readCompleteHistory(projectId, highestJson);
  }

  /**
   * Enumerates only the local durable ledger root. Unknown entries are a
   * configuration error: silently skipping one could incorrectly deactivate
   * a unit still authorized by another project.
   */
  async list(): Promise<readonly ProjectCapabilityLedger[]> {
    const projectIds = await this.listProjectIds();
    const ledgers = await Promise.all(
      projectIds.map((projectId) => this.get(projectId)),
    );
    return ledgers.flatMap((ledger) => ledger === undefined ? [] : [ledger]);
  }

  /**
   * Pending publication is not authorization, but it is still a removal
   * blocker. In particular, a first revision can exist only as a visible
   * `.pending` file, so deriving this from `list()` would omit that project.
   */
  async listPending(): Promise<readonly ProjectCapabilityLedger[]> {
    const projectIds = await this.listProjectIds();
    const pending = await Promise.all(
      projectIds.map((projectId) => this.getPending(projectId)),
    );
    return pending.flatMap((ledger) => ledger === undefined ? [] : [ledger]);
  }

  private async listProjectIds(): Promise<readonly string[]> {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(this.directory));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    const projectIds: string[] = [];
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (!entry.isDirectory || entry.isSymlink) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger root contains unsupported entry ${entry.name}.`,
        );
      }
      let projectId: string;
      try {
        projectId = decodeURIComponent(entry.name);
      } catch {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger root contains an invalid project directory ${entry.name}.`,
        );
      }
      try {
        assertProjectId(projectId);
      } catch (error) {
        throw new ProjectCapabilityLedgerConflictError(
          error instanceof Error
            ? error.message
            : `Capability ledger root contains an invalid project directory ${entry.name}.`,
        );
      }
      if (encodeURIComponent(projectId) !== entry.name) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger root contains a non-canonical project directory ${entry.name}.`,
        );
      }
      projectIds.push(projectId);
    }
    return projectIds;
  }

  /**
   * A pending body is not authority and never becomes visible through `get`.
   * It is nevertheless recoverable by the same logical command, so a crash
   * between pending persistence and claim creation does not depend on a fresh
   * wall-clock event body matching byte-for-byte.
   */
  async getPending(projectId: string): Promise<ProjectCapabilityLedger | undefined> {
    assertProjectId(projectId);
    const current = await this.get(projectId);
    let names: string[];
    try {
      names = [];
      for await (const entry of Deno.readDir(this.projectDirectory(projectId))) {
        if (entry.isFile) names.push(entry.name);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    const pendingRevisions = pendingRevisionsFrom(names);
    if (pendingRevisions.length === 0) return undefined;
    const expectedRevision = (current?.revision ?? 0) + 1;
    if (
      pendingRevisions.length !== 1 || pendingRevisions[0] !== expectedRevision
    ) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${projectId} has a pending revision outside its exact next append position.`,
      );
    }
    let pending: ProjectCapabilityLedger;
    try {
      const bytes = await Deno.readTextFile(
        this.pendingPath(projectId, expectedRevision),
      );
      pending = await validateLedger(JSON.parse(bytes));
      if (bytes !== `${deterministicJson(pending)}\n`) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger ${projectId} pending revision is not canonical exact bytes.`,
        );
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        const refreshed = await this.get(projectId);
        if ((refreshed?.revision ?? 0) >= expectedRevision) return undefined;
      }
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${projectId} pending revision is not valid for recovery: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      assertExactExtension(current, pending, current?.revision ?? 0);
    } catch (error) {
      throw new ProjectCapabilityLedgerConflictError(
        error instanceof Error
          ? error.message
          : "Capability ledger pending revision does not extend the durable history.",
      );
    }
    return structuredClone(pending);
  }

  async append(
    ledger: ProjectCapabilityLedger,
    expectedRevision: number,
  ): Promise<ProjectCapabilityLedger> {
    const validated = await validateLedger(ledger);
    assertProjectId(validated.projectId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError(
        "Capability ledger expectedRevision must be a non-negative safe integer.",
      );
    }
    const current = await this.get(validated.projectId);
    const alreadyPublished = await this.attestPublishedRevision(validated);
    if (alreadyPublished) return alreadyPublished;
    assertExactExtension(current, validated, expectedRevision);
    const directory = this.projectDirectory(validated.projectId);
    await this.ensureProjectDirectory(directory);
    const pending = this.pendingPath(validated.projectId, validated.revision);
    await this.preparePending(pending, validated);
    // A competing identical writer can publish between the first durable
    // attestation and this pending write. Never leave a stale pending marker
    // behind in that idempotent case: `getPending` must only ever see the next
    // append position.
    const publishedWhilePreparing = await this.attestPublishedRevision(validated);
    if (publishedWhilePreparing) {
      await this.removeMatchingPending(pending, validated);
      return publishedWhilePreparing;
    }
    const claim = await this.createOrReadClaim(validated);
    if (claim.digest !== validated.ledgerFingerprint.digest) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${validated.projectId} revision ${validated.revision} is claimed by another exact revision.`,
      );
    }
    const publishedAfterClaim = await this.attestPublishedRevision(validated);
    if (publishedAfterClaim) {
      await this.removeMatchingPending(pending, validated);
      return publishedAfterClaim;
    }
    await this.recoverClaim(validated.projectId, claim);
    const recovered = await this.attestPublishedRevision(validated);
    if (recovered) return recovered;
    throw new ProjectCapabilityLedgerConflictError(
      `Capability ledger ${validated.projectId} revision ${validated.revision} did not publish the exact claimed revision.`,
    );
  }

  /**
   * Pending is published from one synced same-directory temp file via an
   * exclusive hard link. A torn temp is inert; a visible pending is complete.
   * Pending remains before the claim, so a crash before claiming is retryable.
   */
  private async preparePending(
    path: string,
    expected: ProjectCapabilityLedger,
  ): Promise<void> {
    const bytes = `${deterministicJson(expected)}\n`;
    const temporary = `${path}.tmp-${crypto.randomUUID()}`;
    try {
      await writeSyncedFile(temporary, bytes);
      await this.syncDirectory(parentDirectory(temporary), "temporary-created");
      try {
        await Deno.link(temporary, path);
        await this.syncDirectory(parentDirectory(path), "pending-published");
        return;
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      }
    } finally {
      if (await removeIfPresent(temporary)) {
        await this.syncDirectory(
          parentDirectory(temporary),
          "temporary-removed",
        );
      }
    }
    let pending: ProjectCapabilityLedger;
    try {
      const actual = await Deno.readTextFile(path);
      if (actual !== bytes) {
        throw new ProjectCapabilityLedgerConflictError(
          "Capability ledger pending revision bytes differ from this exact retry.",
        );
      }
      pending = await validateLedger(JSON.parse(actual));
    } catch (error) {
      if (error instanceof ProjectCapabilityLedgerConflictError) throw error;
      if (error instanceof Deno.errors.NotFound) {
        const published = await this.attestPublishedRevision(expected);
        if (published) return;
      }
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger pending revision is not valid for recovery: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!fingerprintsEqual(pending.ledgerFingerprint, expected.ledgerFingerprint)) {
      throw new ProjectCapabilityLedgerConflictError(
        "Capability ledger pending revision fingerprint differs from this exact retry.",
      );
    }
  }

  private async recoverClaim(
    projectId: string,
    claim: ProjectCapabilityClaim,
  ): Promise<void> {
    const { revision, digest: claimedFingerprint } = claim;
    const publishedBeforeRead = await this.attestPublishedClaim(projectId, claim);
    if (publishedBeforeRead) return;
    const pendingPath = this.pendingPath(projectId, revision);
    let recovered: ProjectCapabilityLedger;
    try {
      const bytes = await Deno.readTextFile(pendingPath);
      recovered = await validateLedger(JSON.parse(bytes));
      if (bytes !== `${deterministicJson(recovered)}\n`) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger ${projectId} revision ${revision} pending bytes are not canonical.`,
        );
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        const published = await this.attestPublishedClaim(projectId, claim);
        if (published) return;
      }
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${projectId} revision ${revision} is claimed without one matching recoverable pending revision: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      recovered.projectId !== projectId || recovered.revision !== revision ||
      recovered.ledgerFingerprint.digest !== claimedFingerprint
    ) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${projectId} revision ${revision} claim does not match its pending revision.`,
      );
    }
    await this.promotePending(recovered);
  }

  /** An empty createNew claim encodes its complete identity in its filename. */
  private async createOrReadClaim(
    expected: ProjectCapabilityLedger,
  ): Promise<ProjectCapabilityClaim> {
    const path = this.claimPath(
      expected.projectId,
      expected.revision,
      expected.ledgerFingerprint.digest,
    );
    try {
      await writeSyncedFile(path, "");
      await this.syncDirectory(parentDirectory(path), "claim-created");
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const claim = await this.claimForRevision(expected.projectId, expected.revision);
    if (claim) return claim;
    const published = await this.attestPublishedRevision(expected);
    if (published) {
      return {
        revision: expected.revision,
        digest: expected.ledgerFingerprint.digest,
      };
    }
    throw new ProjectCapabilityLedgerConflictError(
      `Capability ledger ${expected.projectId} revision ${expected.revision} claim disappeared before recovery.`,
    );
  }

  private async promotePending(expected: ProjectCapabilityLedger): Promise<void> {
    const pendingPath = this.pendingPath(expected.projectId, expected.revision);
    try {
      await Deno.rename(
        pendingPath,
        this.revisionPath(expected.projectId, expected.revision),
      );
      await this.syncDirectory(
        this.projectDirectory(expected.projectId),
        "revision-published",
      );
      return;
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.AlreadyExists
      ) {
        const published = await this.attestPublishedRevision(expected);
        if (published) return;
      }
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${expected.projectId} revision ${expected.revision} pending publication did not produce its exact durable JSON.`,
      );
    }
  }

  /**
   * An append is idempotent only when the complete durable revision has the
   * exact bytes requested by this writer. It deliberately does not accept a
   * merely matching claim: the JSON history remains the authority.
   */
  private async attestPublishedRevision(
    expected: ProjectCapabilityLedger,
  ): Promise<ProjectCapabilityLedger | undefined> {
    try {
      await Deno.stat(this.revisionPath(expected.projectId, expected.revision));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    const published = await this.read(expected.projectId, expected.revision);
    if (deterministicJson(published) !== deterministicJson(expected)) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${expected.projectId} revision ${expected.revision} was already published with different exact bytes.`,
      );
    }
    return await this.readCompleteHistory(expected.projectId, expected.revision);
  }

  private async attestPublishedClaim(
    projectId: string,
    claim: ProjectCapabilityClaim,
  ): Promise<ProjectCapabilityLedger | undefined> {
    try {
      await Deno.stat(this.revisionPath(projectId, claim.revision));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    const published = await this.read(projectId, claim.revision);
    if (published.ledgerFingerprint.digest !== claim.digest) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${projectId} revision ${claim.revision} claim does not match its durable JSON.`,
      );
    }
    return await this.readCompleteHistory(projectId, claim.revision);
  }

  private async claimForRevision(
    projectId: string,
    revision: number,
  ): Promise<ProjectCapabilityClaim | undefined> {
    let names: string[];
    try {
      names = [];
      for await (const entry of Deno.readDir(this.projectDirectory(projectId))) {
        if (entry.isFile) names.push(entry.name);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    return claimDescriptorsFrom(names).find((claim) => claim.revision === revision);
  }

  private async removeMatchingPending(
    pendingPath: string,
    expected: ProjectCapabilityLedger,
  ): Promise<void> {
    try {
      const pending = await Deno.readTextFile(pendingPath);
      if (pending !== `${deterministicJson(expected)}\n`) {
        throw new ProjectCapabilityLedgerConflictError(
          "Capability ledger pending revision bytes differ from the attested durable revision.",
        );
      }
      await Deno.remove(pendingPath);
      await this.syncDirectory(parentDirectory(pendingPath), "pending-removed");
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
  }

  private async read(
    projectId: string,
    revision: number,
  ): Promise<ProjectCapabilityLedger> {
    try {
      const ledger = await validateLedger(JSON.parse(
        await Deno.readTextFile(this.revisionPath(projectId, revision)),
      ));
      if (ledger.projectId !== projectId || ledger.revision !== revision) {
        throw new TypeError(
          `Capability ledger path ${projectId}@${revision} contains another ledger.`,
        );
      }
      return structuredClone(ledger);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger ${projectId}@${revision} disappeared after it was selected.`,
        );
      }
      throw error;
    }
  }

  private async readCompleteHistory(
    projectId: string,
    highestRevision: number,
  ): Promise<ProjectCapabilityLedger> {
    let current = await this.read(projectId, highestRevision);
    for (let revision = highestRevision - 1; revision >= 1; revision--) {
      const previous = await this.read(projectId, revision);
      if (
        !fingerprintsEqual(current.previous ?? undefined, previous.ledgerFingerprint) ||
        deterministicJson(current.events.slice(0, -1)) !==
          deterministicJson(previous.events)
      ) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger ${projectId} revision ${current.revision} does not retain the exact preceding ledger history.`,
        );
      }
      current = previous;
    }
    if (current.revision !== 1 || current.previous !== null) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger ${projectId} does not begin with one exact root revision.`,
      );
    }
    return await this.read(projectId, highestRevision);
  }

  private projectDirectory(projectId: string): string {
    return `${this.directory}/${encodeURIComponent(projectId)}`;
  }

  private revisionPath(projectId: string, revision: number): string {
    return `${this.projectDirectory(projectId)}/${revisionName(revision)}.json`;
  }

  private pendingPath(projectId: string, revision: number): string {
    return `${this.projectDirectory(projectId)}/${revisionName(revision)}.json.pending`;
  }

  private claimPath(projectId: string, revision: number, digest: string): string {
    return `${this.projectDirectory(projectId)}/${
      revisionName(revision)
    }.${digest}.claim`;
  }

  private async ensureProjectDirectory(directory: string): Promise<void> {
    await Deno.mkdir(directory, { recursive: true });
    await this.syncDirectory(
      parentDirectory(directory),
      "project-directory-created",
    );
  }

  private async syncDirectory(
    directory: string,
    transition: ProjectCapabilityLedgerDurabilityTransition,
  ): Promise<void> {
    try {
      await this.durability.syncDirectory(directory, transition);
    } catch (error) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger cannot establish durable directory metadata for ${transition}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export class InMemoryProjectCapabilityLedgerStore
  implements ProjectCapabilityLedgerStore {
  #ledgers = new Map<string, ProjectCapabilityLedger>();

  async get(projectId: string): Promise<ProjectCapabilityLedger | undefined> {
    const ledger = this.#ledgers.get(projectId);
    return ledger === undefined
      ? undefined
      : structuredClone(await validateLedger(ledger));
  }

  list(): Promise<readonly ProjectCapabilityLedger[]> {
    return Promise.resolve(
      [...this.#ledgers.values()]
        .map((ledger) => structuredClone(ledger))
        .toSorted((left, right) => left.projectId.localeCompare(right.projectId)),
    );
  }

  listPending(): Promise<readonly ProjectCapabilityLedger[]> {
    return Promise.resolve([]);
  }

  getPending(_projectId: string): Promise<ProjectCapabilityLedger | undefined> {
    return Promise.resolve(undefined);
  }

  async append(
    ledger: ProjectCapabilityLedger,
    expectedRevision: number,
  ): Promise<ProjectCapabilityLedger> {
    const validated = await validateLedger(ledger);
    const current = this.#ledgers.get(validated.projectId);
    try {
      assertExactExtension(current, validated, expectedRevision);
    } catch (error) {
      throw new ProjectCapabilityLedgerConflictError(
        error instanceof Error
          ? error.message
          : "Capability ledger compare-and-swap failed.",
      );
    }
    this.#ledgers.set(validated.projectId, structuredClone(validated));
    return structuredClone(validated);
  }
}

/** Strictly validates a whole persisted revision, never a TypeScript cast. */
export async function validateLedger(value: unknown): Promise<ProjectCapabilityLedger> {
  const ledger = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "revision",
    "previous",
    "events",
    "effectiveEnvelope",
    "ledgerFingerprint",
  ], "Capability ledger") as unknown as ProjectCapabilityLedger;
  if (
    ledger.schemaVersion !== PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION ||
    !safeProjectId(ledger.projectId) ||
    !Number.isSafeInteger(ledger.revision) || ledger.revision < 1 ||
    !Array.isArray(ledger.events) ||
    ledger.events.length !== ledger.revision ||
    !fingerprint(ledger.ledgerFingerprint) ||
    (ledger.previous !== null && !fingerprint(ledger.previous))
  ) {
    throw new TypeError("Capability ledger has an invalid top-level shape.");
  }
  const events = await Promise.all(ledger.events.map(validateEvent));
  const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope(events);
  if (
    deterministicJson(effectiveEnvelope) !== deterministicJson(ledger.effectiveEnvelope)
  ) {
    throw new TypeError(
      "Capability ledger effective envelope does not match its append-only event history.",
    );
  }
  const body = {
    schemaVersion: ledger.schemaVersion,
    projectId: ledger.projectId,
    revision: ledger.revision,
    previous: ledger.previous,
    events,
    effectiveEnvelope,
  };
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(expected, ledger.ledgerFingerprint)) {
    throw new TypeError(
      "Capability ledger fingerprint does not match its exact revision body.",
    );
  }
  return structuredClone({ ...body, ledgerFingerprint: ledger.ledgerFingerprint });
}

function assertExactExtension(
  current: ProjectCapabilityLedger | undefined,
  next: ProjectCapabilityLedger,
  expectedRevision: number,
): void {
  if ((current?.revision ?? 0) !== expectedRevision) {
    throw new ProjectCapabilityLedgerConflictError(
      `Capability ledger ${next.projectId} expected revision ${expectedRevision}, current revision is ${
        current?.revision ?? "absent"
      }.`,
    );
  }
  if (
    next.revision !== expectedRevision + 1 ||
    (expectedRevision === 0 && next.previous !== null) ||
    (expectedRevision > 0 &&
      !fingerprintsEqual(next.previous ?? undefined, current?.ledgerFingerprint))
  ) {
    throw new ProjectCapabilityLedgerConflictError(
      "Capability ledger revision does not extend the exact current revision.",
    );
  }
  const priorEvents = current?.events ?? [];
  if (
    next.events.length !== priorEvents.length + 1 ||
    deterministicJson(next.events.slice(0, -1)) !== deterministicJson(priorEvents)
  ) {
    throw new ProjectCapabilityLedgerConflictError(
      "Capability ledger must retain the exact prior event prefix and append exactly one event.",
    );
  }
}

async function validateEvent(
  value: unknown,
): Promise<ProjectCapabilityAuthorizationEvent> {
  const record = exactRecord(value, eventKeys(value), "Capability ledger event");
  if (
    typeof record.kind !== "string" || typeof record.recordedAt !== "string" ||
    !fingerprint(record.eventFingerprint)
  ) {
    throw new TypeError("Capability ledger event has an invalid common shape.");
  }
  switch (record.kind) {
    case "initial-prepared":
      await validateProjectCapabilityProposal(record.proposal);
      break;
    case "initial-authorized":
      validateApproval(record.approval);
      assertFingerprint(
        record.proposalFingerprint,
        "initial authorization proposalFingerprint",
      );
      break;
    case "amendment-authorized":
      assertFingerprint(
        record.previousEnvelopeFingerprint,
        "amendment previousEnvelopeFingerprint",
      );
      assertFingerprint(record.proposalFingerprint, "amendment proposalFingerprint");
      validateDelta(record.delta);
      break;
    case "revocation-recorded":
      if (
        record.scope !== "full-envelope" || typeof record.reason !== "string" ||
        !record.reason.trim()
      ) {
        throw new TypeError(
          "Capability revocation must name one complete envelope and a non-empty reason.",
        );
      }
      break;
    default:
      throw new TypeError("Capability ledger event kind is not supported.");
  }
  // Reconstruction subsequently validates the event hash, exact predecessor
  // reference, and effective-envelope outcome.
  return structuredClone(record as unknown as ProjectCapabilityAuthorizationEvent);
}

function validateApproval(value: unknown): void {
  const approval = exactRecord(value, [
    "projectSnapshotId",
    "projectRevision",
    "approvedBriefFingerprint",
  ], "Capability approval receipt");
  if (
    typeof approval.projectSnapshotId !== "string" ||
    !Number.isSafeInteger(approval.projectRevision) ||
    (approval.projectRevision as number) < 1
  ) {
    throw new TypeError(
      "Capability approval receipt has an invalid project reference.",
    );
  }
  assertFingerprint(approval.approvedBriefFingerprint, "approvedBriefFingerprint");
}

function validateDelta(value: unknown): void {
  const delta = exactRecord(value, [
    "addedRequirementKeys",
    "removedRequirementKeys",
    "addedRequirements",
    "requirementReplacements",
    "bindingReplacements",
    "units",
    "materials",
    "effects",
    "next",
  ], "Capability amendment delta");
  assertStringArray(delta.addedRequirementKeys, "addedRequirementKeys");
  assertStringArray(delta.removedRequirementKeys, "removedRequirementKeys");
  assertArray(delta.addedRequirements, "addedRequirements", validateRequirement);
  assertArray(delta.requirementReplacements, "requirementReplacements", (item) => {
    const replacement = exactRecord(
      item,
      ["requirementKey", "previous", "next"],
      "requirement replacement",
    );
    if (typeof replacement.requirementKey !== "string") {
      throw new TypeError("Capability requirement replacement key is invalid.");
    }
    validateRequirement(replacement.previous);
    validateRequirement(replacement.next);
  });
  assertArray(delta.bindingReplacements, "bindingReplacements", (item) => {
    const replacement = exactRecord(
      item,
      ["requirementKey", "previous", "next"],
      "binding replacement",
    );
    if (typeof replacement.requirementKey !== "string") {
      throw new TypeError("Capability binding replacement key is invalid.");
    }
    validateBindingOrNull(replacement.previous);
    validateBindingOrNull(replacement.next);
  });
  const units = exactRecord(delta.units, [
    "addedIds",
    "removedIds",
    "changedIds",
    "added",
    "changed",
  ], "Capability amendment units");
  assertStringArray(units.addedIds, "unit addedIds");
  assertStringArray(units.removedIds, "unit removedIds");
  assertStringArray(units.changedIds, "unit changedIds");
  assertArray(units.added, "unit added", validateUnit);
  assertArray(units.changed, "unit changed", (item) => {
    const replacement = exactRecord(
      item,
      ["id", "previous", "next"],
      "unit replacement",
    );
    if (typeof replacement.id !== "string") {
      throw new TypeError("Capability unit replacement id is invalid.");
    }
    validateUnit(replacement.previous);
    validateUnit(replacement.next);
  });
  const materials = exactRecord(
    delta.materials,
    ["added", "removedKeys", "changed"],
    "Capability amendment materials",
  );
  assertArray(materials.added, "material added", validateMaterial);
  assertStringArray(materials.removedKeys, "material removedKeys");
  assertArray(materials.changed, "material changed", (item) => {
    const replacement = exactRecord(
      item,
      ["key", "previous", "next"],
      "material replacement",
    );
    if (typeof replacement.key !== "string") {
      throw new TypeError("Capability material replacement key is invalid.");
    }
    validateMaterial(replacement.previous);
    validateMaterial(replacement.next);
  });
  validateEffectsDelta(delta.effects);
  const next = exactRecord(delta.next, [
    "source",
    "brief",
    "intent",
    "status",
    "activation",
    "blockers",
  ], "Capability amendment successor metadata");
  if (
    (next.source !== "brief-intent" && next.source !== "published-plan") ||
    !["ready", "changes-required", "blocked", "unresolved"].includes(
      next.status as string,
    ) ||
    !["allowed", "blocked"].includes(next.activation as string)
  ) {
    throw new TypeError("Capability amendment successor metadata is invalid.");
  }
  validateBrief(next.brief);
  if (next.intent !== null && !isRecord(next.intent)) {
    throw new TypeError("Capability amendment intent must be object or null.");
  }
  assertStringArray(next.blockers, "successor blockers");
}

function validateRequirement(value: unknown): void {
  const requirement = exactRecord(value, [
    "id",
    "version",
    "minimumQualification",
    "use",
  ], "Capability requirement");
  if (
    typeof requirement.id !== "string" || typeof requirement.version !== "string" ||
    !["compatible", "qualified"].includes(requirement.minimumQualification as string) ||
    !["preparation", "execution"].includes(requirement.use as string)
  ) {
    throw new TypeError("Capability requirement is invalid.");
  }
}

function validateBindingOrNull(value: unknown): void {
  if (value === null) return;
  const binding = optionalRecord(
    value,
    ["requirement", "status", "binding", "unitIds", "reasons"],
    ["candidate"],
    "Capability binding",
  );
  validateRequirement(binding.requirement);
  if (
    typeof binding.status !== "string" ||
    !["selected", "unavailable", "ambiguous", "disabled", "revoked", "incompatible"]
      .includes(binding.status)
  ) {
    throw new TypeError("Capability binding is invalid.");
  }
  if (binding.binding !== null && !isRecord(binding.binding)) {
    throw new TypeError("Capability selected binding is invalid.");
  }
  if (binding.binding !== null) {
    const selected = exactRecord(
      binding.binding,
      ["id", "version", "qualification"],
      "Capability selected binding",
    );
    if (
      typeof selected.id !== "string" || typeof selected.version !== "string" ||
      (selected.qualification !== "compatible" &&
        selected.qualification !== "qualified")
    ) {
      throw new TypeError("Capability selected binding is invalid.");
    }
  }
  if (binding.candidate !== undefined) {
    const candidate = exactRecord(
      binding.candidate,
      ["id", "version", "qualification", "adapter", "profile", "unitIds"],
      "Capability binding candidate",
    );
    if (
      typeof candidate.id !== "string" || typeof candidate.version !== "string" ||
      !["compatible", "qualified", "unqualified", "revoked"].includes(
        candidate.qualification as string,
      )
    ) {
      throw new TypeError("Capability binding candidate is invalid.");
    }
    assertStringArray(candidate.unitIds, "candidate unitIds");
    const adapter = exactRecord(
      candidate.adapter,
      ["id", "version", "source"],
      "Capability binding adapter",
    );
    if (
      typeof adapter.id !== "string" || typeof adapter.version !== "string" ||
      typeof adapter.source !== "string"
    ) {
      throw new TypeError("Capability binding adapter is invalid.");
    }
    if (candidate.profile !== null) {
      const profile = exactRecord(
        candidate.profile,
        ["id", "version", "fingerprint"],
        "Capability binding profile",
      );
      if (
        typeof profile.id !== "string" || typeof profile.version !== "string" ||
        (profile.fingerprint !== null && !fingerprint(profile.fingerprint))
      ) {
        throw new TypeError("Capability binding profile is invalid.");
      }
    }
  }
  assertStringArray(binding.unitIds, "binding unitIds");
  assertStringArray(binding.reasons, "binding reasons");
}

function validateUnit(value: unknown): void {
  const unit = exactRecord(
    value,
    ["id", "version", "manifestFingerprint", "materials"],
    "Capability unit",
  );
  if (typeof unit.id !== "string" || typeof unit.version !== "string") {
    throw new TypeError("Capability unit is invalid.");
  }
  assertFingerprint(unit.manifestFingerprint, "unit manifestFingerprint");
  assertArray(unit.materials, "unit materials", (material) => {
    if (!isRecord(material)) {
      throw new TypeError("Capability unit material is invalid.");
    }
  });
}

function validateMaterial(value: unknown): void {
  const material = exactRecord(value, [
    "unitId",
    "materialId",
    "imageReference",
    "mode",
    "downloadBytes",
    "storageBytes",
  ], "Capability material");
  if (
    typeof material.unitId !== "string" || typeof material.materialId !== "string" ||
    typeof material.imageReference !== "string" ||
    !["native", "emulated", "unavailable"].includes(material.mode as string) ||
    !nullableBytes(material.downloadBytes) || !nullableBytes(material.storageBytes)
  ) {
    throw new TypeError("Capability material is invalid.");
  }
}

function validateEffectsDelta(value: unknown): void {
  const effects = exactRecord(value, [
    "added",
    "removed",
    "downloadBytes",
    "storageBytes",
  ], "Capability host-effect delta");
  for (const field of ["added", "removed"] as const) {
    const set = exactRecord(effects[field], [
      "services",
      "volumes",
      "networks",
      "loopbackPorts",
      "bindMounts",
      "devices",
      "secretSlots",
      "licences",
      "security",
    ], `Capability host-effect ${field}`);
    for (
      const key of [
        "services",
        "volumes",
        "networks",
        "loopbackPorts",
        "bindMounts",
        "devices",
        "secretSlots",
        "licences",
      ] as const
    ) {
      if (!Array.isArray(set[key])) {
        throw new TypeError(`Capability host-effect ${field}.${key} must be an array.`);
      }
    }
    if (
      set.security !== null && set.security !== "reviewed" && set.security !== "unknown"
    ) throw new TypeError("Capability host-effect security is invalid.");
  }
  for (const field of ["downloadBytes", "storageBytes"] as const) {
    const bytes = exactRecord(
      effects[field],
      ["previous", "next", "delta"],
      `Capability ${field} delta`,
    );
    if (
      !nullableBytes(bytes.previous) || !nullableBytes(bytes.next) ||
      !nullableBytes(bytes.delta)
    ) {
      throw new TypeError(`Capability ${field} delta is invalid.`);
    }
  }
}

function validateBrief(value: unknown): void {
  const brief = exactRecord(value, [
    "briefSnapshotId",
    "briefRevision",
    "briefReviewFingerprint",
  ], "Capability brief basis");
  if (
    typeof brief.briefSnapshotId !== "string" ||
    !Number.isSafeInteger(brief.briefRevision) ||
    (brief.briefRevision as number) < 1
  ) throw new TypeError("Capability brief basis is invalid.");
  assertFingerprint(brief.briefReviewFingerprint, "briefReviewFingerprint");
}

function assertArray(
  value: unknown,
  label: string,
  validate: (item: unknown) => void,
): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  for (const item of value) validate(item);
}

function assertStringArray(value: unknown, label: string): void {
  assertArray(value, label, (item) => {
    if (typeof item !== "string") {
      throw new TypeError(`${label} must contain only strings.`);
    }
  });
}

function nullableBytes(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function assertFingerprint(value: unknown, label: string): void {
  if (!fingerprint(value)) {
    throw new TypeError(`${label} must be one SHA-256 fingerprint.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function eventKeys(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  switch ((value as Record<string, unknown>).kind) {
    case "initial-prepared":
      return ["kind", "recordedAt", "proposal", "eventFingerprint"];
    case "initial-authorized":
      return [
        "kind",
        "recordedAt",
        "proposalFingerprint",
        "approval",
        "eventFingerprint",
      ];
    case "amendment-authorized":
      return [
        "kind",
        "recordedAt",
        "previousEnvelopeFingerprint",
        "proposalFingerprint",
        "delta",
        "eventFingerprint",
      ];
    case "revocation-recorded":
      return ["kind", "recordedAt", "scope", "reason", "eventFingerprint"];
    default:
      return [];
  }
}

function highestRevision(
  names: readonly string[],
  extension: "json",
): number | undefined {
  const revisions = names.flatMap((name) => {
    const match = new RegExp(`^(\\d{10})\\.${extension}$`).exec(name);
    return match ? [Number(match[1])] : [];
  });
  return revisions.length === 0 ? undefined : Math.max(...revisions);
}

/**
 * Claims never carry mutable bytes: the full ledger digest is the filename.
 * A malformed claim-looking file is not an ignorable legacy artefact because
 * it could otherwise hide a divergent ownership claim for one revision.
 */
function claimDescriptorsFrom(
  names: readonly string[],
): readonly ProjectCapabilityClaim[] {
  const claims: ProjectCapabilityClaim[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const valid = /^(\d{10})\.([a-f0-9]{64})\.claim$/.exec(name);
    if (valid) {
      const revision = Number(valid[1]);
      if (seen.has(revision)) {
        throw new ProjectCapabilityLedgerConflictError(
          `Capability ledger has multiple claims for revision ${revision}.`,
        );
      }
      seen.add(revision);
      claims.push({ revision, digest: valid[2] });
      continue;
    }
    if (/^\d{10}(?:\..*)?\.claim$/.test(name)) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger has a malformed visible claim file ${name}.`,
      );
    }
  }
  return claims.toSorted((left, right) => left.revision - right.revision);
}

function pendingRevisionsFrom(names: readonly string[]): readonly number[] {
  const revisions: number[] = [];
  for (const name of names) {
    const match = /^(\d{10})\.json\.pending$/.exec(name);
    if (match) {
      revisions.push(Number(match[1]));
      continue;
    }
    if (name.endsWith(".json.pending")) {
      throw new ProjectCapabilityLedgerConflictError(
        `Capability ledger has a malformed visible pending revision ${name}.`,
      );
    }
  }
  return revisions.toSorted((left, right) => left - right);
}

function revisionName(revision: number): string {
  return String(revision).padStart(10, "0");
}

function parentDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  if (separator <= 0) {
    throw new TypeError(`Capability ledger path has no parent directory: ${path}`);
  }
  return path.slice(0, separator);
}

async function writeSyncedFile(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset));
      if (written === 0) {
        throw new Error("Could not write one complete capability ledger artifact.");
      }
      offset += written;
    }
    await file.sync();
  } finally {
    file.close();
  }
}

async function removeIfPresent(path: string): Promise<boolean> {
  try {
    await Deno.remove(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields.`);
  }
  return record;
}

function optionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  const actual = Object.keys(value).toSorted();
  const allowed = [...required, ...optional].toSorted();
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !allowed.includes(key))
  ) {
    throw new TypeError(`${label} has unknown or missing fields.`);
  }
  return value;
}

function fingerprint(
  value: unknown,
): value is { readonly algorithm: "sha256"; readonly digest: string } {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as { algorithm?: unknown }).algorithm === "sha256" &&
    /^[a-f0-9]{64}$/.test((value as { digest?: unknown }).digest as string);
}

function safeProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function assertProjectId(projectId: string): void {
  if (!safeProjectId(projectId)) {
    throw new TypeError("Capability ledger projectId must be a safe project id.");
  }
}
