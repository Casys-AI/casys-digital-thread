import {
  type ChatCommandRequest,
  type ChatCommandResponse,
  type ChatConnectableMcpDto,
  type ChatConversationDto,
  type ChatConversationKind,
  type ChatConversationMcpDto,
  type ChatConversationStatus,
  type ChatMessageDto,
  type ChatPendingInteractionDto,
  type ChatSnapshotDto,
  DESKTOP_CHAT_PROTOCOL,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import {
  type ChatMcpProbeOutcome,
  type ChatMcpServerConfig,
  type ChatRuntimeAdapter,
  chatRuntimeKey,
  type RuntimeElicitationContext,
  type RuntimeElicitationRequest,
  type RuntimeElicitationResponse,
  type RuntimeEvent,
  type RuntimeHandle,
  type RuntimeInteractionSink,
  type RuntimePermissionDecision,
  type RuntimePermissionRequest,
  type RuntimeTurn,
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
  readonly kind: ChatConversationKind;
  readonly projectId?: string;
  sessionKey: string;
  /** Standalone MCP attachment; status failed keeps the zero-MCP runtime. */
  mcpId?: string;
  mcpStatus?: "connected" | "failed";
  mcpTools: readonly string[];
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
  /**
   * Bumped by turn.cancel; a chained turn whose captured epoch no longer
   * matches was cancelled while queued and must not execute.
   */
  queueEpoch: number;
}

interface PendingInteraction {
  readonly dto: ChatPendingInteractionDto;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly abort: () => void;
}

export interface ChatCoordinatorOptions {
  /** One adapter per MCP set, keyed by chatRuntimeKey. */
  readonly runtimes: ReadonlyMap<string, ChatRuntimeAdapter>;
  /** Host-side connectable MCP registry (standalone only). */
  readonly mcpServers: readonly ChatMcpServerConfig[];
  /** Direct endpoint probe; distinguishes connection from execution failure. */
  readonly probeMcp: (server: ChatMcpServerConfig) => Promise<ChatMcpProbeOutcome>;
  readonly store: ChatConversationStore;
  /** Private host path. It is never copied into a renderer DTO. */
  readonly workspaceRoot: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class ChatCoordinator implements RuntimeInteractionSink {
  readonly #runtimes: ReadonlyMap<string, ChatRuntimeAdapter>;
  readonly #mcpServers: readonly ChatMcpServerConfig[];
  readonly #probeMcp: (
    server: ChatMcpServerConfig,
  ) => Promise<ChatMcpProbeOutcome>;
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
    this.#runtimes = options.runtimes;
    this.#mcpServers = options.mcpServers;
    this.#probeMcp = options.probeMcp;
    this.#store = options.store;
    this.#workspaceRoot = options.workspaceRoot;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    for (const adapter of options.runtimes.values()) {
      adapter.setInteractionSink(this);
    }
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
      connectableMcps: Object.freeze(
        this.#mcpServers.map((server): ChatConnectableMcpDto =>
          Object.freeze({
            id: server.id,
            displayName: server.displayName,
            description: server.description,
            transport: server.transport,
          })
        ),
      ),
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
        case "mcp.enable":
          conversationId = request.conversationId;
          await this.#enableMcp(conversationId, request.mcpId);
          break;
        case "mcp.disable":
          conversationId = request.conversationId;
          await this.#disableMcp(conversationId);
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

  async #createConversation(projectId?: string, title?: string): Promise<string> {
    const id = `conversation:${this.#newId()}`;
    const now = this.#now().toISOString();
    const kind: ChatConversationKind = projectId === undefined
      ? "standalone"
      : "project";
    this.#conversations.set(id, {
      id,
      kind,
      ...(projectId === undefined ? {} : { projectId }),
      sessionKey: kind === "project"
        ? `${SESSION_PREFIX}/${projectId}/${id}`
        : `${SESSION_PREFIX}/standalone/${id}`,
      mcpTools: [],
      title: title ?? (kind === "project" ? `Project ${projectId}` : "Standalone chat"),
      status: "idle",
      createdAt: now,
      updatedAt: now,
      messages: [],
      queueTail: Promise.resolve(),
      queueEpoch: 0,
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
    const epoch = conversation.queueEpoch;
    await this.#persist();
    const queued = conversation.queueTail.then(() =>
      this.#runTurn(conversation, text, requestId, epoch)
    );
    conversation.queueTail = queued.catch(() => undefined);
  }

  async #runTurn(
    conversation: ConversationState,
    text: string,
    requestId: string,
    epoch: number,
  ): Promise<void> {
    if (conversation.status === "closed" || this.#host !== "ready") return;
    if (epoch !== conversation.queueEpoch) {
      if (conversation.status === "queued") {
        conversation.status = "idle";
        conversation.updatedAt = this.#now().toISOString();
        this.#append(conversation, "system", "status", "Turn cancelled.");
        await this.#persist();
      }
      return;
    }
    try {
      conversation.status = "running";
      conversation.updatedAt = this.#now().toISOString();
      const runtime = this.#adapterFor(conversation).runtime;
      const handle = conversation.handle ??
        await runtime.ensureSession({
          sessionKey: conversation.sessionKey,
          agent: AGENT_NAME,
          mode: "persistent",
          cwd: this.#workspaceRoot,
          sessionOptions: { systemPrompt: systemPromptFor(conversation) },
        });
      conversation.handle = handle;
      this.#claimSessionIds(conversation, handle);
      const abort = new AbortController();
      conversation.activeAbort = abort;
      const turn = runtime.startTurn({
        handle,
        text: turnTextFor(conversation, text),
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
    conversation.queueEpoch += 1;
    conversation.activeAbort?.abort(reason);
    if (conversation.activeTurn !== undefined) {
      await conversation.activeTurn.cancel({ reason });
    } else if (conversation.handle !== undefined) {
      await this.#adapterFor(conversation).runtime.cancel({
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
      await this.#adapterFor(conversation).runtime.close({
        handle: conversation.handle,
        reason: "conversation closed",
        discardPersistentState: false,
      });
      this.#releaseSessionIds(conversation);
      conversation.handle = undefined;
    }
    await this.#persist();
  }

  /**
   * Attaches an MCP to a standalone conversation. The endpoint is probed
   * directly first: a connection failure is reported as such and never as
   * a tool execution failure. On success the ACP session restarts on the
   * MCP runtime; the transcript is preserved. Re-enabling re-probes, so
   * enable doubles as the reconnect path.
   */
  async #enableMcp(conversationId: string, mcpId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.kind !== "standalone") {
      throw new Error("project conversations keep their fixed MCP");
    }
    if (conversation.status === "closed") throw new Error("conversation is closed");
    this.#requireSettledForMcpSwitch(conversation);
    const server = this.#mcpServers.find((entry) => entry.id === mcpId);
    if (server === undefined) throw new Error("MCP is not connectable");
    let probe: ChatMcpProbeOutcome;
    try {
      probe = await this.#probeMcp(server);
    } catch (error) {
      probe = { ok: false, error: safeError(error) };
    }
    if (!probe.ok) {
      if (conversation.mcpStatus === "connected") {
        await this.#detachHandle(conversation, "MCP connection failed");
        conversation.sessionKey = standaloneSessionKey(conversation.id);
      }
      conversation.mcpId = server.id;
      conversation.mcpStatus = "failed";
      conversation.mcpTools = [];
      this.#append(
        conversation,
        "system",
        "error",
        `MCP connection failed (${server.displayName}): ${probe.error} The agent keeps running without it.`,
      );
      await this.#persist();
      throw new Error(`MCP connection failed (${server.displayName}): ${probe.error}`);
    }
    await this.#detachHandle(conversation, "MCP attachment changed");
    conversation.mcpId = server.id;
    conversation.mcpStatus = "connected";
    conversation.mcpTools = [...probe.tools];
    conversation.sessionKey = standaloneSessionKey(conversation.id, server.id);
    this.#append(
      conversation,
      "system",
      "status",
      `${server.displayName} connected (${probe.tools.length} tools). The agent session restarts with it.`,
    );
    await this.#persist();
  }

  async #disableMcp(conversationId: string): Promise<void> {
    const conversation = this.#conversation(conversationId);
    if (conversation.kind !== "standalone") {
      throw new Error("project conversations keep their fixed MCP");
    }
    if (conversation.status === "closed") throw new Error("conversation is closed");
    this.#requireSettledForMcpSwitch(conversation);
    if (conversation.mcpId === undefined) return;
    const displayName = this.#mcpDisplayName(conversation.mcpId);
    await this.#detachHandle(conversation, "MCP detached");
    conversation.mcpId = undefined;
    conversation.mcpStatus = undefined;
    conversation.mcpTools = [];
    conversation.sessionKey = standaloneSessionKey(conversation.id);
    this.#append(
      conversation,
      "system",
      "status",
      `${displayName} detached. The agent session restarts without it.`,
    );
    await this.#persist();
  }

  #requireSettledForMcpSwitch(conversation: ConversationState): void {
    if (
      conversation.activeTurn !== undefined || conversation.status === "running" ||
      conversation.status === "queued" || conversation.pending !== undefined
    ) {
      throw new Error("stop the active turn before changing the MCP attachment");
    }
  }

  async #detachHandle(conversation: ConversationState, reason: string): Promise<void> {
    if (conversation.handle === undefined) return;
    await this.#adapterFor(conversation).runtime.close({
      handle: conversation.handle,
      reason,
      discardPersistentState: false,
    });
    this.#releaseSessionIds(conversation);
    conversation.handle = undefined;
  }

  #adapterFor(conversation: ConversationState): ChatRuntimeAdapter {
    const adapter = this.#runtimes.get(
      chatRuntimeKey(
        conversation.kind,
        conversation.mcpStatus === "connected" ? conversation.mcpId : undefined,
      ),
    );
    if (adapter === undefined) throw new Error("chat runtime is not configured");
    return adapter;
  }

  #mcpDisplayName(mcpId: string): string {
    return this.#mcpServers.find((entry) => entry.id === mcpId)?.displayName ?? mcpId;
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
      try {
        await this.#adapterFor(conversation).runtime.close({
          handle: conversation.handle,
          reason: "Chat Host shutting down",
          discardPersistentState: false,
        });
      } catch {
        // Shutdown closes every runtime below regardless.
      }
      this.#releaseSessionIds(conversation);
      conversation.handle = undefined;
    }
    await Promise.allSettled(
      [...this.#runtimes.values()].map((adapter) => adapter.close()),
    );
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
    let mcp: ChatConversationMcpDto | undefined;
    if (conversation.mcpId !== undefined && conversation.mcpStatus !== undefined) {
      mcp = Object.freeze({
        id: conversation.mcpId,
        displayName: this.#mcpDisplayName(conversation.mcpId),
        status: conversation.mcpStatus,
        tools: Object.freeze([...conversation.mcpTools]),
      });
    }
    return Object.freeze({
      id: conversation.id,
      kind: conversation.kind,
      ...(conversation.projectId === undefined
        ? {}
        : { projectId: conversation.projectId }),
      title: conversation.title,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: Object.freeze(includeMessages ? [...conversation.messages] : []),
      ...(mcp === undefined ? {} : { mcp }),
      ...(conversation.pending === undefined
        ? {}
        : { pendingInteraction: conversation.pending.dto }),
    });
  }

  #restore(stored: StoredConversation): void {
    const kind: ChatConversationKind = stored.kind ??
      (stored.projectId !== undefined ? "project" : "standalone");
    if (kind === "project") {
      if (
        stored.projectId === undefined ||
        !stored.sessionKey.startsWith(`${SESSION_PREFIX}/${stored.projectId}/`)
      ) return;
    } else {
      if (
        stored.projectId !== undefined ||
        !stored.sessionKey.startsWith(`${SESSION_PREFIX}/standalone/`)
      ) return;
    }
    const mcpId = kind === "standalone" ? stored.mcpId : undefined;
    const mcpStatus = kind === "standalone" ? stored.mcpStatus : undefined;
    const mcpAttached = mcpId !== undefined && mcpStatus !== undefined;
    this.#conversations.set(stored.id, {
      id: stored.id,
      kind,
      ...(stored.projectId === undefined ? {} : { projectId: stored.projectId }),
      sessionKey: stored.sessionKey,
      ...(mcpAttached ? { mcpId } : {}),
      ...(mcpAttached ? { mcpStatus } : {}),
      mcpTools: mcpAttached ? [...(stored.mcpTools ?? [])] : [],
      title: stored.title,
      status: stored.status === "running" || stored.status === "queued"
        ? "idle"
        : stored.status,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      messages: [...stored.messages],
      queueTail: Promise.resolve(),
      queueEpoch: 0,
    });
  }

  #persist(): Promise<void> {
    const snapshot = [...this.#conversations.values()].map((entry) =>
      Object.freeze({
        id: entry.id,
        kind: entry.kind,
        ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
        ...(entry.mcpId === undefined ? {} : { mcpId: entry.mcpId }),
        ...(entry.mcpStatus === undefined ? {} : { mcpStatus: entry.mcpStatus }),
        mcpTools: Object.freeze([...entry.mcpTools]),
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

function standaloneSystemPrompt(conversation: ConversationState): string {
  const lines = [
    "You are embedded in Casys Digital Thread Desktop.",
    "This is a standalone conversation: no Casys project, brief, SysML model, Thread baseline, or Canvas is attached.",
  ];
  if (conversation.mcpStatus === "connected" && conversation.mcpId !== undefined) {
    lines.push(
      `An MCP server is connected. Its own tool contracts determine supported inputs and results; no Casys admitted-language subset applies to ordinary calls.`,
    );
  } else {
    lines.push(
      "No engineering MCP is connected. Answer directly, and offer to connect a tool when the task needs one.",
    );
  }
  lines.push(
    "Never choose providers, operation arguments, or runtime versions.",
    "This chat transcript is presentation history only.",
  );
  return lines.join("\n");
}

function systemPromptFor(conversation: ConversationState): string {
  if (conversation.kind === "standalone") return standaloneSystemPrompt(conversation);
  if (conversation.projectId === undefined) {
    throw new Error("project conversation is missing its projectId");
  }
  return projectSystemPrompt(conversation.projectId);
}

function turnTextFor(conversation: ConversationState, text: string): string {
  if (conversation.kind === "standalone") return text;
  if (conversation.projectId === undefined) {
    throw new Error("project conversation is missing its projectId");
  }
  return boundPrompt(conversation.projectId, text);
}

function standaloneSessionKey(conversationId: string, mcpId?: string): string {
  const base = `${SESSION_PREFIX}/standalone/${conversationId}`;
  return mcpId === undefined ? base : `${base}/mcp/${mcpId}`;
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
