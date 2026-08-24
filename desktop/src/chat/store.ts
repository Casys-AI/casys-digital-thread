import type {
  ChatConversationStatus,
  ChatMessageDto,
} from "../../../src/presentation/desktop/chat/contracts.ts";

export interface StoredConversation {
  readonly id: string;
  readonly projectId: string;
  readonly sessionKey: string;
  readonly title: string;
  readonly status: ChatConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessageDto[];
}

export interface ChatConversationStore {
  load(): Promise<readonly StoredConversation[]>;
  save(conversations: readonly StoredConversation[]): Promise<void>;
}

export class MemoryChatConversationStore implements ChatConversationStore {
  #value: readonly StoredConversation[] = [];

  load(): Promise<readonly StoredConversation[]> {
    return Promise.resolve(structuredClone(this.#value));
  }

  save(conversations: readonly StoredConversation[]): Promise<void> {
    this.#value = structuredClone(conversations);
    return Promise.resolve();
  }
}

export interface FileChatConversationStoreOptions {
  readonly root: string;
  readonly now?: () => Date;
  readonly retentionDays?: number;
  readonly maxConversations?: number;
  readonly maxMessagesPerConversation?: number;
}

interface StoredIndex {
  readonly schemaVersion: "casys-desktop-chat-store/1.0";
  readonly conversations: readonly Omit<StoredConversation, "messages">[];
}

interface StoredTranscript {
  readonly schemaVersion: "casys-desktop-chat-transcript/1.0";
  readonly conversationId: string;
  readonly messages: readonly ChatMessageDto[];
}

/**
 * Desktop chat metadata and transcripts live below a dedicated product-data
 * directory. They are never written into Thread/CAS state.
 */
export class FileChatConversationStore implements ChatConversationStore {
  readonly #root: string;
  readonly #now: () => Date;
  readonly #retentionMs: number;
  readonly #maxConversations: number;
  readonly #maxMessages: number;

  constructor(options: FileChatConversationStoreOptions) {
    this.#root = options.root;
    this.#now = options.now ?? (() => new Date());
    this.#retentionMs = (options.retentionDays ?? 30) * 86_400_000;
    this.#maxConversations = options.maxConversations ?? 50;
    this.#maxMessages = options.maxMessagesPerConversation ?? 400;
  }

  async load(): Promise<readonly StoredConversation[]> {
    let index: StoredIndex;
    try {
      index = readIndex(JSON.parse(await Deno.readTextFile(this.#indexPath())));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const conversations: StoredConversation[] = [];
    for (const metadata of index.conversations) {
      if (Date.parse(metadata.updatedAt) < cutoff) continue;
      try {
        const transcript = readTranscript(
          JSON.parse(await Deno.readTextFile(this.#transcriptPath(metadata.id))),
          metadata.id,
        );
        conversations.push(Object.freeze({
          ...metadata,
          status: metadata.status === "running" || metadata.status === "queued"
            ? "idle"
            : metadata.status,
          messages: Object.freeze(transcript.messages.slice(-this.#maxMessages)),
        }));
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    return Object.freeze(
      conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, this.#maxConversations),
    );
  }

  async save(conversations: readonly StoredConversation[]): Promise<void> {
    await Deno.mkdir(`${this.#root}/transcripts`, { recursive: true, mode: 0o700 });
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const retained = [...conversations]
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, this.#maxConversations);
    for (const entry of retained) {
      await atomicWriteJson(this.#transcriptPath(entry.id), {
        schemaVersion: "casys-desktop-chat-transcript/1.0",
        conversationId: entry.id,
        messages: entry.messages.slice(-this.#maxMessages),
      });
    }
    const retainedFiles = new Set(retained.map((entry) => `${entry.id}.json`));
    for await (const entry of Deno.readDir(`${this.#root}/transcripts`)) {
      if (
        entry.isFile && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}\.json$/.test(entry.name) &&
        !retainedFiles.has(entry.name)
      ) await Deno.remove(`${this.#root}/transcripts/${entry.name}`);
    }
    await atomicWriteJson(this.#indexPath(), {
      schemaVersion: "casys-desktop-chat-store/1.0",
      conversations: retained.map(({ messages: _messages, ...metadata }) => metadata),
    });
  }

  #indexPath(): string {
    return `${this.#root}/conversations.json`;
  }

  #transcriptPath(id: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id)) {
      throw new TypeError("conversation id is invalid");
    }
    return `${this.#root}/transcripts/${id}.json`;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await Deno.writeTextFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await Deno.rename(temporary, path);
}

function readIndex(value: unknown): StoredIndex {
  const record = object(value, "chat index");
  if (
    record.schemaVersion !== "casys-desktop-chat-store/1.0" ||
    !Array.isArray(record.conversations)
  ) {
    throw new TypeError("chat index has an unsupported schema");
  }
  return {
    schemaVersion: "casys-desktop-chat-store/1.0",
    conversations: record.conversations.map(readMetadata),
  };
}

function readTranscript(value: unknown, id: string): StoredTranscript {
  const record = object(value, "chat transcript");
  if (
    record.schemaVersion !== "casys-desktop-chat-transcript/1.0" ||
    record.conversationId !== id || !Array.isArray(record.messages)
  ) {
    throw new TypeError("chat transcript has an unsupported schema");
  }
  return {
    schemaVersion: "casys-desktop-chat-transcript/1.0",
    conversationId: id,
    messages: record.messages.map(readMessage),
  };
}

function readMetadata(value: unknown): Omit<StoredConversation, "messages"> {
  const entry = object(value, "conversation metadata");
  const status = entry.status;
  if (
    status !== "idle" && status !== "queued" && status !== "running" &&
    status !== "failed" && status !== "closed"
  ) throw new TypeError("conversation status is invalid");
  return {
    id: requiredString(entry.id, "conversation id"),
    projectId: requiredString(entry.projectId, "project id"),
    sessionKey: requiredString(entry.sessionKey, "session key"),
    title: requiredString(entry.title, "conversation title"),
    status,
    createdAt: requiredDate(entry.createdAt, "createdAt"),
    updatedAt: requiredDate(entry.updatedAt, "updatedAt"),
  };
}

function readMessage(value: unknown): ChatMessageDto {
  const message = object(value, "chat message");
  const role = message.role;
  const kind = message.kind;
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
    id: requiredString(message.id, "message id"),
    role,
    kind,
    text: requiredString(message.text, "message text"),
    createdAt: requiredDate(message.createdAt, "message createdAt"),
  });
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function requiredDate(value: unknown, name: string): string {
  const text = requiredString(value, name);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${name} is invalid`);
  return text;
}
