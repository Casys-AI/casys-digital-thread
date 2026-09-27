import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ChatConversationStore,
  ChatStoreRetention,
  StoredConversation,
} from "../chat/store.ts";
import {
  ARTIFACT_FILE_SUFFIX,
  artifactFileName,
  CHAT_STORE_SCHEMA,
  CHAT_TRANSCRIPT_SCHEMA,
  CONVERSATION_ID_PATTERN,
  isArtifactSha,
  readConversationIndex,
  readTranscriptData,
  referencedArtifactDigests,
} from "../chat/store-codec.ts";

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
    const index = readConversationIndex(parsed);
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const loaded: StoredConversation[] = [];
    for (const metadata of index.conversations) {
      if (Date.parse(metadata.updatedAt) < cutoff) continue;
      try {
        const transcript = readTranscriptData(
          JSON.parse(await readFile(this.#transcriptPath(metadata.id), "utf8")),
          metadata.id,
        );
        loaded.push(Object.freeze({
          ...metadata,
          status: metadata.status === "running" || metadata.status === "queued"
            ? "idle"
            : metadata.status,
          messages: Object.freeze(
            [...transcript.messages].slice(-this.#maxMessages),
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
    await mkdir(join(this.#root, "artifacts"), { recursive: true, mode: 0o700 });
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const retained = [...conversations]
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, this.#maxConversations);
    for (const entry of retained) {
      await atomicWriteJson(this.#transcriptPath(entry.id), {
        schemaVersion: CHAT_TRANSCRIPT_SCHEMA,
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
        entry.isFile() && transcriptFileName(entry.name) &&
        !retainedFiles.has(entry.name)
      ) await unlink(join(this.#root, "transcripts", entry.name));
    }
    await atomicWriteJson(this.#indexPath(), {
      schemaVersion: CHAT_STORE_SCHEMA,
      conversations: retained.map(({ messages: _messages, ...metadata }) => metadata),
    });
    await this.#pruneArtifacts(referencedArtifactDigests(retained));
  }

  async saveArtifact(sha256: string, bytes: Uint8Array): Promise<void> {
    await mkdir(join(this.#root, "artifacts"), { recursive: true, mode: 0o700 });
    const temporary = `${this.#artifactPath(sha256)}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, this.#artifactPath(sha256));
  }

  async loadArtifact(sha256: string): Promise<Uint8Array | undefined> {
    if (!isArtifactSha(sha256)) return undefined;
    try {
      return new Uint8Array(await readFile(this.#artifactPath(sha256)));
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  retention(): ChatStoreRetention | undefined {
    return {
      days: this.#retentionMs / 86_400_000,
      maxConversations: this.#maxConversations,
    };
  }

  async #pruneArtifacts(referenced: ReadonlySet<string>): Promise<void> {
    for (
      const entry of await readdir(join(this.#root, "artifacts"), {
        withFileTypes: true,
      })
    ) {
      if (!entry.isFile() || !entry.name.endsWith(ARTIFACT_FILE_SUFFIX)) continue;
      const sha256 = entry.name.slice(0, -ARTIFACT_FILE_SUFFIX.length);
      if (!isArtifactSha(sha256) || referenced.has(sha256)) continue;
      await unlink(join(this.#root, "artifacts", entry.name));
    }
  }

  #indexPath(): string {
    return join(this.#root, "conversations.json");
  }

  #artifactPath(sha256: string): string {
    return join(this.#root, "artifacts", artifactFileName(sha256));
  }

  #transcriptPath(id: string): string {
    if (!CONVERSATION_ID_PATTERN.test(id)) {
      throw new TypeError("conversation id is invalid");
    }
    return join(this.#root, "transcripts", `${id}.json`);
  }
}

function transcriptFileName(name: string): boolean {
  return name.endsWith(".json") &&
    CONVERSATION_ID_PATTERN.test(name.slice(0, -".json".length));
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string"
    ? error.code
    : undefined;
}
