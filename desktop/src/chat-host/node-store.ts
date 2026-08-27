import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessageDto } from "../../../src/presentation/desktop/chat/contracts.ts";
import type { ChatConversationStore, StoredConversation } from "../chat/store.ts";

interface StoredIndex {
  readonly schemaVersion: "casys-desktop-chat-store/1.0";
  readonly conversations: readonly Omit<StoredConversation, "messages">[];
}

export class NodeChatConversationStore implements ChatConversationStore {
  readonly #root: string;
  readonly #now: () => Date;
  readonly #retentionMs: number;
  readonly #maxConversations: number;
  readonly #maxMessages: number;

  constructor(
    root: string,
    options: {
      readonly now?: () => Date;
      readonly retentionDays?: number;
      readonly maxConversations?: number;
      readonly maxMessagesPerConversation?: number;
    } = {},
  ) {
    this.#root = root;
    this.#now = options.now ?? (() => new Date());
    this.#retentionMs = (options.retentionDays ?? 30) * 86_400_000;
    this.#maxConversations = options.maxConversations ?? 50;
    this.#maxMessages = options.maxMessagesPerConversation ?? 400;
  }

  async load(): Promise<readonly StoredConversation[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.#indexPath(), "utf8"));
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const index = readIndex(parsed);
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const loaded: StoredConversation[] = [];
    for (const metadata of index.conversations) {
      if (Date.parse(metadata.updatedAt) < cutoff) continue;
      try {
        const transcript = object(
          JSON.parse(await readFile(this.#transcriptPath(metadata.id), "utf8")),
          "transcript",
        );
        if (
          transcript.schemaVersion !== "casys-desktop-chat-transcript/1.0" ||
          transcript.conversationId !== metadata.id ||
          !Array.isArray(transcript.messages)
        ) throw new TypeError("chat transcript schema is invalid");
        loaded.push(Object.freeze({
          ...metadata,
          status: metadata.status === "running" || metadata.status === "queued"
            ? "idle"
            : metadata.status,
          messages: Object.freeze(
            transcript.messages.map(readMessage).slice(-this.#maxMessages),
          ),
        }));
      } catch (error) {
        if (nodeErrorCode(error) !== "ENOENT") throw error;
      }
    }
    return Object.freeze(
      loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, this.#maxConversations),
    );
  }

  async save(conversations: readonly StoredConversation[]): Promise<void> {
    await mkdir(join(this.#root, "transcripts"), { recursive: true, mode: 0o700 });
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const retained = [...conversations]
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, this.#maxConversations);
    for (const entry of retained) {
      await atomicWrite(this.#transcriptPath(entry.id), {
        schemaVersion: "casys-desktop-chat-transcript/1.0",
        conversationId: entry.id,
        messages: entry.messages.slice(-this.#maxMessages),
      });
    }
    const retainedFiles = new Set(retained.map((entry) => `${entry.id}.json`));
    for (
      const entry of await readdir(join(this.#root, "transcripts"), {
        withFileTypes: true,
      })
    ) {
      if (
        entry.isFile() &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}\.json$/.test(entry.name) &&
        !retainedFiles.has(entry.name)
      ) await unlink(join(this.#root, "transcripts", entry.name));
    }
    await atomicWrite(this.#indexPath(), {
      schemaVersion: "casys-desktop-chat-store/1.0",
      conversations: retained.map(({ messages: _messages, ...metadata }) => metadata),
    });
  }

  #indexPath(): string {
    return join(this.#root, "conversations.json");
  }

  #transcriptPath(id: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id)) {
      throw new TypeError("conversation id is invalid");
    }
    return join(this.#root, "transcripts", `${id}.json`);
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

function readIndex(value: unknown): StoredIndex {
  const record = object(value, "chat index");
  if (
    record.schemaVersion !== "casys-desktop-chat-store/1.0" ||
    !Array.isArray(record.conversations)
  ) throw new TypeError("chat index schema is invalid");
  return {
    schemaVersion: "casys-desktop-chat-store/1.0",
    conversations: record.conversations.map(readMetadata),
  };
}

function readMetadata(value: unknown): Omit<StoredConversation, "messages"> {
  const record = object(value, "conversation metadata");
  const status = record.status;
  if (
    status !== "idle" && status !== "queued" && status !== "running" &&
    status !== "failed" && status !== "closed"
  ) {
    throw new TypeError("conversation status is invalid");
  }
  return {
    id: string(record.id, "id"),
    projectId: string(record.projectId, "projectId"),
    sessionKey: string(record.sessionKey, "sessionKey"),
    title: string(record.title, "title"),
    status,
    createdAt: date(record.createdAt, "createdAt"),
    updatedAt: date(record.updatedAt, "updatedAt"),
  };
}

function readMessage(value: unknown): ChatMessageDto {
  const record = object(value, "chat message");
  const role = record.role;
  const kind = record.kind;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new TypeError("chat message role is invalid");
  }
  if (
    kind !== "text" && kind !== "thought" && kind !== "tool" &&
    kind !== "status" && kind !== "error"
  ) {
    throw new TypeError("chat message kind is invalid");
  }
  return Object.freeze({
    id: string(record.id, "message id"),
    role,
    kind,
    text: string(record.text, "message text"),
    createdAt: date(record.createdAt, "message createdAt"),
  });
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function date(value: unknown, name: string): string {
  const result = string(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${name} is invalid`);
  return result;
}
