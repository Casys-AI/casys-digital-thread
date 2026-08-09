import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../domain/kernel/case-validation.ts";
import {
  type ProjectReviewIntent,
  type ProjectReviewIntentAcknowledgement,
  type ProjectReviewIntentRecord,
  validateProjectReviewIntent,
  validateProjectReviewIntentAcknowledgement,
  validateProjectReviewIntentProjectId,
} from "../../domain/project/project-review-intent.ts";

const JOURNAL_EVENT_SCHEMA = "project-review-intent-event/1.0" as const;

type ProjectReviewIntentJournalEvent =
  | {
    readonly schemaVersion: typeof JOURNAL_EVENT_SCHEMA;
    readonly kind: "intent";
    readonly intent: ProjectReviewIntent;
  }
  | {
    readonly schemaVersion: typeof JOURNAL_EVENT_SCHEMA;
    readonly kind: "acknowledgement";
    readonly acknowledgement: ProjectReviewIntentAcknowledgement;
  };

export interface ProjectReviewIntentStore {
  append(intent: ProjectReviewIntent): Promise<ProjectReviewIntentRecord>;
  list(projectId: string): Promise<ProjectReviewIntentRecord[]>;
  acknowledge(
    acknowledgement: ProjectReviewIntentAcknowledgement,
  ): Promise<ProjectReviewIntentRecord>;
}

export class ProjectReviewIntentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectReviewIntentConflictError";
  }
}

/**
 * Cross-process append-only outbox. The one global journal makes intentId an
 * actual idempotency identity across projects, while list() exposes only the
 * requested project's records. An acknowledgement is a paired-agent receipt,
 * never a project decision transition.
 */
export class FileProjectReviewIntentStore implements ProjectReviewIntentStore {
  readonly #directory: string;

  constructor(directory = "state/local/project-review-intents") {
    if (directory.trim().length === 0) {
      throw new TypeError("directory must not be empty");
    }
    this.#directory = directory;
  }

  async append(input: ProjectReviewIntent): Promise<ProjectReviewIntentRecord> {
    const intent = validateProjectReviewIntent(input);
    return await this.#appendLocked((records) => {
      const existing = records.find((record) =>
        record.intent.intentId === intent.intentId
      );
      if (existing) {
        if (deterministicJson(existing.intent) !== deterministicJson(intent)) {
          throw new ProjectReviewIntentConflictError(
            `Review intent ${intent.intentId} was already used with different content.`,
          );
        }
        return { record: existing };
      }
      const existingScope = records.find((record) =>
        sameDecisionReviewScope(record.intent, intent)
      );
      if (existingScope) {
        throw new ProjectReviewIntentConflictError(
          `Decision ${intent.decisionId} already has review intent ${existingScope.intent.intentId} for project ${intent.projectId} and the same proposal fingerprint.`,
        );
      }
      return {
        record: { intent },
        event: {
          schemaVersion: JOURNAL_EVENT_SCHEMA,
          kind: "intent",
          intent,
        },
      };
    });
  }

  async list(projectId: string): Promise<ProjectReviewIntentRecord[]> {
    const validatedProjectId = validateProjectReviewIntentProjectId(projectId);
    let file: Deno.FsFile;
    try {
      file = await Deno.open(this.#path(), { read: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    await file.lock(false);
    try {
      return structuredClone(
        (await this.#readUnlocked()).filter((record) =>
          record.intent.projectId === validatedProjectId
        ),
      );
    } finally {
      await file.unlock();
      file.close();
    }
  }

  async acknowledge(
    input: ProjectReviewIntentAcknowledgement,
  ): Promise<ProjectReviewIntentRecord> {
    const acknowledgement = validateProjectReviewIntentAcknowledgement(input);
    return await this.#appendLocked((records) => {
      const existing = records.find((record) =>
        record.intent.intentId === acknowledgement.intentId
      );
      if (!existing || existing.intent.projectId !== acknowledgement.projectId) {
        throw new ProjectReviewIntentConflictError(
          `Review intent ${acknowledgement.intentId} does not exist for project ${acknowledgement.projectId}.`,
        );
      }
      if (existing.acknowledgement) {
        if (
          deterministicJson(existing.acknowledgement) !==
            deterministicJson(acknowledgement)
        ) {
          throw new ProjectReviewIntentConflictError(
            `Review intent ${acknowledgement.intentId} was already acknowledged with different content.`,
          );
        }
        return { record: existing };
      }
      return {
        record: { intent: existing.intent, acknowledgement },
        event: {
          schemaVersion: JOURNAL_EVENT_SCHEMA,
          kind: "acknowledgement",
          acknowledgement,
        },
      };
    });
  }

  async #appendLocked(
    update: (
      records: readonly ProjectReviewIntentRecord[],
    ) => {
      readonly record: ProjectReviewIntentRecord;
      readonly event?: ProjectReviewIntentJournalEvent;
    },
  ): Promise<ProjectReviewIntentRecord> {
    await Deno.mkdir(this.#directory, { recursive: true });
    const file = await Deno.open(this.#path(), {
      create: true,
      read: true,
      write: true,
      append: true,
    });
    await file.lock(true);
    try {
      const result = update(await this.#readUnlocked());
      if (result.event) {
        const bytes = new TextEncoder().encode(
          `${deterministicJson(result.event)}\n`,
        );
        let written = 0;
        while (written < bytes.length) {
          written += await file.write(bytes.subarray(written));
        }
        await file.syncData();
      }
      return structuredClone(result.record);
    } finally {
      await file.unlock();
      file.close();
    }
  }

  async #readUnlocked(): Promise<ProjectReviewIntentRecord[]> {
    const text = await Deno.readTextFile(this.#path());
    const events = text.split("\n").flatMap((line, index) => {
      if (line.trim().length === 0) return [];
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new TypeError(
          `invalid project review intent JSONL at line ${index + 1}`,
        );
      }
      return [decodeJournalEvent(value, index + 1)];
    });
    return foldJournal(events);
  }

  #path(): string {
    return `${this.#directory}/project-review-intents.jsonl`;
  }
}

function sameDecisionReviewScope(
  left: ProjectReviewIntent,
  right: ProjectReviewIntent,
): boolean {
  return left.projectId === right.projectId &&
    left.decisionId === right.decisionId &&
    fingerprintsEqual(left.inputFingerprint, right.inputFingerprint);
}

function decodeJournalEvent(
  value: unknown,
  line: number,
): ProjectReviewIntentJournalEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`invalid project review intent event at line ${line}`);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "intent") {
    const event = exactRecord(
      candidate,
      ["schemaVersion", "kind", "intent"],
      `ProjectReviewIntentJournalEvent[${line}]`,
    );
    if (event.schemaVersion !== JOURNAL_EVENT_SCHEMA) {
      throw new TypeError(
        `unsupported project review intent schema at line ${line}`,
      );
    }
    return {
      schemaVersion: JOURNAL_EVENT_SCHEMA,
      kind: "intent",
      intent: validateProjectReviewIntent(event.intent),
    };
  }
  if (candidate.kind === "acknowledgement") {
    const event = exactRecord(
      candidate,
      ["schemaVersion", "kind", "acknowledgement"],
      `ProjectReviewIntentJournalEvent[${line}]`,
    );
    if (event.schemaVersion !== JOURNAL_EVENT_SCHEMA) {
      throw new TypeError(
        `unsupported project review intent schema at line ${line}`,
      );
    }
    return {
      schemaVersion: JOURNAL_EVENT_SCHEMA,
      kind: "acknowledgement",
      acknowledgement: validateProjectReviewIntentAcknowledgement(
        event.acknowledgement,
      ),
    };
  }
  throw new TypeError(`invalid project review intent event kind at line ${line}`);
}

function foldJournal(
  events: readonly ProjectReviewIntentJournalEvent[],
): ProjectReviewIntentRecord[] {
  const records: ProjectReviewIntentRecord[] = [];
  const byIntentId = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "intent") {
      if (byIntentId.has(event.intent.intentId)) {
        throw new TypeError(
          `duplicate project review intent ${event.intent.intentId} in journal`,
        );
      }
      byIntentId.set(event.intent.intentId, records.length);
      records.push({ intent: event.intent });
      continue;
    }
    const index = byIntentId.get(event.acknowledgement.intentId);
    if (index === undefined) {
      throw new TypeError(
        `project review acknowledgement ${event.acknowledgement.intentId} has no matching intent`,
      );
    }
    const existing = records[index];
    if (existing.intent.projectId !== event.acknowledgement.projectId) {
      throw new TypeError(
        `project review acknowledgement ${event.acknowledgement.intentId} has no matching intent`,
      );
    }
    if (existing.acknowledgement) {
      throw new TypeError(
        `duplicate project review acknowledgement ${event.acknowledgement.intentId} in journal`,
      );
    }
    records[index] = {
      intent: existing.intent,
      acknowledgement: event.acknowledgement,
    };
  }
  return records;
}
