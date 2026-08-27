import {
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatConversationDto,
  type ChatConversationStatus,
  type ChatMessageDto,
  type ChatPendingInteractionDto,
  type ChatSnapshotDto,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import type {
  ChatRuntimeAdapter,
  RuntimeElicitationContext,
  RuntimeElicitationRequest,
  RuntimeElicitationResponse,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeInteractionSink,
  RuntimePermissionDecision,
  RuntimePermissionRequest,
  RuntimeTurn,
} from "./runtime-port.ts";
import {
  sanitizeElicitationRequest,
  sanitizePermissionRequest,
  validateElicitationContent,
} from "./sanitize.ts";
import type { ChatConversationStore, StoredConversation } from "./store.ts";

const AGENT_NAME = "casys-codex";
const SESSION_PREFIX = "casys-desktop-exclusive";

interface ConversationState {
  readonly id: string;
  readonly projectId: string;
  readonly sessionKey: string;
  readonly title: string;
  readonly createdAt: string;
  updatedAt: string;
  status: ChatConversationStatus;
  messages: ChatMessageDto[];
  handle?: RuntimeHandle;
  activeTurn?: RuntimeTurn;
  activeAbort?: AbortController;
  pending?: PendingInteraction;
  queueTail: Promise<void>;
}

interface PendingInteraction {
  readonly dto: ChatPendingInteractionDto;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly abort: () => void;
}

export interface ChatCoordinatorOptions {
  readonly runtimeAdapter: ChatRuntimeAdapter;
  readonly store: ChatConversationStore;
  /** Private host path. It is never copied into a renderer DTO. */
  readonly workspaceRoot: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class ChatCoordinator implements RuntimeInteractionSink {
  readonly #runtimeAdapter: ChatRuntimeAdapter;
  readonly #store: ChatConversationStore;
  readonly #workspaceRoot: string;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #conversations = new Map<string, ConversationState>();
  readonly #sessionOwners = new Map<string, string>();
  #host: "ready" | "shutting-down" = "ready";
  #persistTail: Promise<void> = Promise.resolve();
  #stopPromise?: Promise<void>;

  private constructor(options: ChatCoordinatorOptions) {
    this.#runtimeAdapter = options.runtimeAdapter;
    this.#store = options.store;
    this.#workspaceRoot = options.workspaceRoot;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#runtimeAdapter.setInteractionSink(this);
  }

  static async create(options: ChatCoordinatorOptions): Promise<ChatCoordinator> {
    const coordinator = new ChatCoordinator(options);
    for (const stored of await options.store.load()) coordinator.#restore(stored);
    return coordinator;
  }

  snapshot(conversationId?: string): ChatSnapshotDto {
    const ordered = [...this.#conversations.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    const selected =
      conversationId !== undefined && this.#conversations.has(conversationId)
        ? conversationId
        : ordered[0]?.id;
    const conversations = ordered.map((entry) =>
      this.#toDto(entry, selected === entry.id)
    );
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      host: this.#host,
      conversations: Object.freeze(conversations),
      ...(selected === undefined ? {} : { selectedConversationId: selected }),
    });
  }

  async command(request: ChatCommandRequest): Promise<ChatCommandResponse> {
    try {
      if (this.#host !== "ready") throw new Error("Chat Host is shutting down");
      let conversationId: string;
      switch (request.command) {
        case "conversation.create":
          conversationId = await this.#createConversation(
            request.projectId,
            request.title,
          );
          break;
        case "message.send":
          conversationId = request.conversationId;
          await this.#enqueueMessage(conversationId, request.text, request.requestId);
          break;
        case "turn.cancel":
          conversationId = request.conversationId;
          await this.#cancelTurn(conversationId, "cancelled by user");
          break;
        case "conversation.close":
          conversationId = request.conversationId;
          await this.#closeConversation(conversationId);
          break;
        case "permission.resolve":
          conversationId = request.conversationId;
          this.#resolvePermission(
            conversationId,
            request.correlationId,
            request.decision,
          );
          break;
        case "elicitation.resolve":
          conversationId = request.conversationId;
          this.#resolveElicitation(
            conversationId,
            request.correlationId,
            request.action,
            request.content,
          );
          break;
      }
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: request.requestId,
        ok: true,
        conversationId,
      });
    } catch (error) {
      return Object.freeze({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: request.requestId,
        ok: false,
        error: safeError(error),
      });
    }
  }

  async requestPermission(
    request: RuntimePermissionRequest,
    signal: AbortSignal,
  ): Promise<{ readonly outcome: RuntimePermissionDecision } | undefined> {
    const conversation = this.#findPermissionOwner(request.sessionId);
    if (
      conversation === undefined || signal.aborted || conversation.pending !== undefined
    ) {
      return undefined;
    }
    const correlationId = `permission:${this.#newId()}`;
    let dto: ChatPendingInteractionDto;
    try {
      dto = sanitizePermissionRequest(request, correlationId);
    } catch {
      return undefined;
    }
    return await this.#waitForInteraction<
      { readonly outcome: RuntimePermissionDecision } | undefined
    >(conversation, dto, signal, undefined);
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  async #createConversation(projectId: string, title?: string): Promise<string> {
    const id = `conversation:${this.#newId()}`;
    const now = this.#now().toISOString();
    this.#conversations.set(id, {
      id,
      projectId,
      sessionKey: `${SESSION_PREFIX}/${projectId}/${id}`,
      title: title ?? `Project ${projectId}`,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      messages: [],
      queueTail: Promise.resolve(),
    });
    await this.#persist();
    return id;
  }

  async #enqueueMessage(
    conversationId: string,
    text: string,
    requestId: string,
  ): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.status === "closed") throw new Error("conversation is closed");
    this.#append(conversation, "user", "text", text);
    conversation.status = "queued";
    await this.#persist();
    const queued = conversation.queueTail.then(() =>
      this.#runTurn(conversation, text, requestId)
    );
    conversation.queueTail = queued.catch(() => undefined);
  }

  async #runTurn(
    conversation: ConversationState,
    text: string,
    requestId: string,
  ): Promise<void> {
    if (conversation.status === "closed" || this.#host !== "ready") return;
    try {
      conversation.status = "running";
      conversation.updatedAt = this.#now().toISOString();
      const handle = conversation.handle ??
        await this.#runtimeAdapter.runtime.ensureSession({
          sessionKey: conversation.sessionKey,
          agent: AGENT_NAME,
          mode: "persistent",
          cwd: this.#workspaceRoot,
          sessionOptions: { systemPrompt: projectSystemPrompt(conversation.projectId) },
        });
      conversation.handle = handle;
      this.#claimSessionIds(conversation, handle);
      const abort = new AbortController();
      conversation.activeAbort = abort;
      const turn = this.#runtimeAdapter.runtime.startTurn({
        handle,
        text: boundPrompt(conversation.projectId, text),
        mode: "prompt",
        requestId,
        signal: abort.signal,
        onElicitation: (elicitation, context) =>
          this.#requestElicitation(conversation, elicitation, context),
      });
      conversation.activeTurn = turn;
      await this.#persist();
      await this.#consumeEvents(conversation, turn.events);
      const result = await turn.result;
      if (result.status === "failed") {
        conversation.status = "failed";
        this.#append(conversation, "system", "error", safeError(result.error.message));
      } else {
        conversation.status = "idle";
        if (result.status === "cancelled") {
          this.#append(conversation, "system", "status", "Turn cancelled.");
        }
      }
    } catch (error) {
      conversation.status = "failed";
      this.#append(conversation, "system", "error", safeError(error));
    } finally {
      this.#abortPending(conversation);
      conversation.activeTurn = undefined;
      conversation.activeAbort = undefined;
      conversation.updatedAt = this.#now().toISOString();
      await this.#persist();
    }
  }

  async #consumeEvents(
    conversation: ConversationState,
    events: AsyncIterable<RuntimeEvent>,
  ): Promise<void> {
    for await (const event of events) {
      if (conversation.status === "closed" || this.#host !== "ready") break;
      if (event.type === "text_delta") {
        this.#appendDelta(
          conversation,
          event.stream === "thought" ? "thought" : "text",
          event.text,
        );
      } else if (event.type === "tool_call") {
        const title = clean(event.title ?? event.text, 500);
        const suffix = event.status === undefined
          ? ""
          : ` — ${clean(event.status, 80)}`;
        this.#append(conversation, "assistant", "tool", `${title}${suffix}`);
      } else {
        this.#append(conversation, "assistant", "status", clean(event.text, 1_000));
      }
      await this.#persist();
    }
  }

  async #requestElicitation(
    conversation: ConversationState,
    request: RuntimeElicitationRequest,
    context: RuntimeElicitationContext,
  ): Promise<RuntimeElicitationResponse> {
    const handle = conversation.handle;
    if (
      context.signal.aborted || conversation.pending !== undefined ||
      handle === undefined ||
      (request.sessionId !== handle.backendSessionId &&
        request.sessionId !== handle.agentSessionId)
    ) {
      return { action: "cancel" };
    }
    const correlationId = `elicitation:${String(context.requestId)}:${this.#newId()}`;
    let dto: ChatPendingInteractionDto;
    try {
      dto = sanitizeElicitationRequest(request, correlationId);
    } catch {
      return { action: "cancel" };
    }
    return await this.#waitForInteraction<RuntimeElicitationResponse>(
      conversation,
      dto,
      context.signal,
      { action: "cancel" },
    );
  }

  #waitForInteraction<T>(
    conversation: ConversationState,
    dto: ChatPendingInteractionDto,
    signal: AbortSignal,
    abortedValue: T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        if (conversation.pending?.dto.correlationId !== dto.correlationId) return;
        conversation.pending = undefined;
        resolve(abortedValue);
        void this.#persist();
      };
      conversation.pending = {
        dto,
        resolve: (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value as T);
        },
        reject,
        abort: onAbort,
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      void this.#persist();
    });
  }

  #resolvePermission(
    conversationId: string,
    correlationId: string,
    decision: RuntimePermissionDecision,
  ): void {
    const conversation = this.#conversation(conversationId);
    const pending = this.#takePending(conversation, correlationId, "permission");
    if (pending.dto.type !== "permission") {
      pending.resolve(undefined);
      throw new Error("interaction type changed while resolving permission");
    }
    if (
      decision !== "cancel" &&
      !pending.dto.options.some((option) => option.decision === decision)
    ) {
      pending.resolve(undefined);
      throw new Error("permission option is not available");
    }
    pending.resolve(decision === "cancel" ? undefined : { outcome: decision });
    void this.#persist();
  }

  #resolveElicitation(
    conversationId: string,
    correlationId: string,
    action: "accept" | "decline" | "cancel",
    content?: Readonly<Record<string, string | number | boolean | string[]>>,
  ): void {
    const conversation = this.#conversation(conversationId);
    const pending = this.#takePending(conversation, correlationId, "elicitation");
    if (pending.dto.type === "permission") {
      pending.resolve({ action: "cancel" });
      throw new Error("interaction type changed while resolving elicitation");
    }
    if (action !== "accept") {
      pending.resolve({ action });
    } else if (pending.dto.type === "elicitation-url") {
      if (content !== undefined) {
        pending.resolve({ action: "cancel" });
        throw new Error("URL elicitation cannot include form content");
      }
      pending.resolve({ action: "accept" });
    } else {
      try {
        pending.resolve({
          action: "accept",
          content: validateElicitationContent(pending.dto, content ?? {}),
        });
      } catch (error) {
        pending.resolve({ action: "cancel" });
        throw error;
      }
    }
    void this.#persist();
  }

  #takePending(
    conversation: ConversationState,
    correlationId: string,
    kind: "permission" | "elicitation",
  ): PendingInteraction & { dto: ChatPendingInteractionDto } {
    const pending = conversation.pending;
    const matchesKind = kind === "permission"
      ? pending?.dto.type === "permission"
      : pending?.dto.type === "elicitation-form" ||
        pending?.dto.type === "elicitation-url";
    if (
      pending === undefined || pending.dto.correlationId !== correlationId ||
      !matchesKind
    ) {
      throw new Error("interaction is stale or does not belong to this conversation");
    }
    conversation.pending = undefined;
    return pending;
  }

  async #cancelTurn(conversationId: string, reason: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    this.#abortPending(conversation);
    conversation.activeAbort?.abort(reason);
    if (conversation.activeTurn !== undefined) {
      await conversation.activeTurn.cancel({ reason });
    } else if (conversation.handle !== undefined) {
      await this.#runtimeAdapter.runtime.cancel({
        handle: conversation.handle,
        reason,
      });
    }
  }

  async #closeConversation(conversationId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    await this.#cancelTurn(conversationId, "conversation closed");
    conversation.status = "closed";
    if (conversation.handle !== undefined) {
      await this.#runtimeAdapter.runtime.close({
        handle: conversation.handle,
        reason: "conversation closed",
        discardPersistentState: false,
      });
      this.#releaseSessionIds(conversation);
      conversation.handle = undefined;
    }
    await this.#persist();
  }

  async #stop(): Promise<void> {
    this.#host = "shutting-down";
    for (const conversation of this.#conversations.values()) {
      this.#abortPending(conversation);
      conversation.activeAbort?.abort("Chat Host shutting down");
      if (conversation.activeTurn !== undefined) {
        await conversation.activeTurn.cancel({ reason: "Chat Host shutting down" })
          .catch(
            () => undefined,
          );
      }
    }
    await Promise.allSettled(
      [...this.#conversations.values()].map((conversation) => conversation.queueTail),
    );
    for (const conversation of this.#conversations.values()) {
      if (conversation.handle === undefined) continue;
      await this.#runtimeAdapter.runtime.close({
        handle: conversation.handle,
        reason: "Chat Host shutting down",
        discardPersistentState: false,
      }).catch(() => undefined);
      this.#releaseSessionIds(conversation);
      conversation.handle = undefined;
    }
    await this.#runtimeAdapter.close();
    await this.#persistTail;
  }

  #findPermissionOwner(sessionId: string): ConversationState | undefined {
    const owner = this.#sessionOwners.get(sessionId);
    return owner === undefined ? undefined : this.#conversations.get(owner);
  }

  #claimSessionIds(conversation: ConversationState, handle: RuntimeHandle): void {
    for (const id of [handle.backendSessionId, handle.agentSessionId]) {
      if (id === undefined) continue;
      const existing = this.#sessionOwners.get(id);
      if (existing !== undefined && existing !== conversation.id) {
        throw new Error("ACP session is already owned by another Desktop conversation");
      }
      this.#sessionOwners.set(id, conversation.id);
    }
  }

  #releaseSessionIds(conversation: ConversationState): void {
    for (const [id, owner] of this.#sessionOwners) {
      if (owner === conversation.id) this.#sessionOwners.delete(id);
    }
  }

  #abortPending(conversation: ConversationState): void {
    const pending = conversation.pending;
    if (pending === undefined) return;
    pending.abort();
    if (conversation.pending === pending) conversation.pending = undefined;
  }

  #conversation(id: string): ConversationState {
    const conversation = this.#conversations.get(id);
    if (conversation === undefined) throw new Error("conversation does not exist");
    return conversation;
  }

  #append(
    conversation: ConversationState,
    role: ChatMessageDto["role"],
    kind: ChatMessageDto["kind"],
    text: string,
  ): void {
    const sanitized = clean(text, 32_000);
    if (sanitized === "") return;
    conversation.messages.push(Object.freeze({
      id: `message:${this.#newId()}`,
      role,
      kind,
      text: sanitized,
      createdAt: this.#now().toISOString(),
    }));
    conversation.updatedAt = this.#now().toISOString();
  }

  #appendDelta(
    conversation: ConversationState,
    kind: "text" | "thought",
    text: string,
  ): void {
    const delta = clean(text, 16_000);
    if (delta === "") return;
    const last = conversation.messages.at(-1);
    if (last?.role === "assistant" && last.kind === kind) {
      conversation.messages[conversation.messages.length - 1] = Object.freeze({
        ...last,
        text: clean(`${last.text}${delta}`, 32_000),
      });
      conversation.updatedAt = this.#now().toISOString();
      return;
    }
    this.#append(conversation, "assistant", kind, delta);
  }

  #toDto(
    conversation: ConversationState,
    includeMessages: boolean,
  ): ChatConversationDto {
    return Object.freeze({
      id: conversation.id,
      projectId: conversation.projectId,
      title: conversation.title,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: Object.freeze(includeMessages ? [...conversation.messages] : []),
      ...(conversation.pending === undefined
        ? {}
        : { pendingInteraction: conversation.pending.dto }),
    });
  }

  #restore(stored: StoredConversation): void {
    if (!stored.sessionKey.startsWith(`${SESSION_PREFIX}/${stored.projectId}/`)) return;
    this.#conversations.set(stored.id, {
      ...stored,
      status: stored.status === "running" || stored.status === "queued"
        ? "idle"
        : stored.status,
      messages: [...stored.messages],
      queueTail: Promise.resolve(),
    });
  }

  #persist(): Promise<void> {
    const snapshot = [...this.#conversations.values()].map((entry) =>
      Object.freeze({
        id: entry.id,
        projectId: entry.projectId,
        sessionKey: entry.sessionKey,
        title: entry.title,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        messages: Object.freeze([...entry.messages]),
      })
    );
    this.#persistTail = this.#persistTail.then(() => this.#store.save(snapshot));
    return this.#persistTail;
  }
}

function projectSystemPrompt(projectId: string): string {
  return [
    "You are embedded in Casys Digital Thread Desktop.",
    `This ACP session is exclusively bound to projectId ${projectId}.`,
    "Use only registered Casys project tools and always pass that exact projectId.",
    "Never choose providers, operation arguments, or runtime versions; the server owns them.",
    "MRTR engineering decisions require the server elicitation and explicit human acceptance.",
    "Agent permission prompts are operational permissions and never substitute for MRTR.",
    "Thread/CAS is authoritative; this chat transcript is presentation history only.",
  ].join("\n");
}

function boundPrompt(projectId: string, text: string): string {
  return `Bound Casys projectId: ${projectId}\n\nHuman message:\n${text}`;
}

function safeError(error: unknown): string {
  if (typeof error === "string") return clean(error, 1_000);
  if (error instanceof Error) return clean(error.message, 1_000);
  return "Chat Host operation failed.";
}

function clean(value: string, max: number): string {
  const cleaned = [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  return cleaned.slice(0, max);
}
