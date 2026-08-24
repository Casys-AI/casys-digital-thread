import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Button, buttonVariants } from "../ui/button.tsx";
import { cn } from "../lib/utils.ts";
import { Notice } from "../ui/notice.tsx";
import {
  type ChatCommandResponse,
  type ChatConversationDto,
  type ChatFormFieldDto,
  type ChatPendingInteractionDto,
  type ChatSnapshotDto,
  DESKTOP_CHAT_PROTOCOL,
  type DesktopChatBindingCommandRequest,
  parseChatCommandResponse,
  parseChatSnapshotDto,
} from "../../../presentation/desktop/chat/contracts.ts";

interface DesktopBindings {
  casysChatSnapshot(input: {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly conversationId?: string;
  }): Promise<ChatSnapshotDto>;
  casysChatCommand(
    input: DesktopChatBindingCommandRequest,
  ): Promise<ChatCommandResponse>;
}

declare global {
  // Deno Desktop injects this Proxy only inside its webview realm.
  // Browser previews intentionally have no simulated binding.
  var bindings: DesktopBindings | undefined;
}

export function DesktopChat(
  { projectId, open, onOpenChange }: {
    readonly projectId?: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  },
): JSX.Element {
  const bindings = desktopBindings();
  const nativeChatAvailable = bindings !== undefined;
  const compactModal = useMediaQuery("(max-width: 899px)");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousPresentationRef = useRef({ open, compactModal });
  const [snapshot, setSnapshot] = useState<ChatSnapshotDto>();
  const [selectedId, setSelectedId] = useState<string | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!bindings) return;
    try {
      const next = parseChatSnapshotDto(
        await bindings.casysChatSnapshot({
          protocol: DESKTOP_CHAT_PROTOCOL,
          ...(typeof selectedId === "string"
            ? { conversationId: selectedId }
            : {}),
        }),
      );
      setSnapshot(next);
      setSelectedId((current) => {
        if (current === null) return null;
        if (current !== undefined) return current;
        return next.conversations.find((conversation) =>
          conversation.projectId === projectId
        )?.id;
      });
      setError(next.error);
    } catch (cause) {
      setError(readError(cause));
    }
  }, [bindings, projectId, selectedId]);

  useEffect(() => setSelectedId(undefined), [projectId]);

  useEffect(() => {
    const previous = previousPresentationRef.current;
    previousPresentationRef.current = { open, compactModal };
    if (previous.open && !open && !previous.compactModal) {
      triggerRef.current?.focus();
    }
  }, [compactModal, open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    globalThis.addEventListener("keydown", dismiss);
    return () => globalThis.removeEventListener("keydown", dismiss);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!bindings || !open) return;
    void refresh();
    const active = snapshot?.conversations.some((conversation) =>
      conversation.status === "running" || conversation.status === "queued" ||
      conversation.pendingInteraction !== undefined
    );
    const timer = globalThis.setInterval(
      () => void refresh(),
      active ? 250 : 1_000,
    );
    return () => globalThis.clearInterval(timer);
  }, [bindings, open, refresh, snapshot?.conversations]);

  const command = useCallback(
    async (request: DesktopChatBindingCommandRequest) => {
      if (!bindings) return undefined;
      setBusy(true);
      setError(undefined);
      try {
        const response = parseChatCommandResponse(
          await bindings.casysChatCommand(request),
        );
        if (!response.ok) {
          throw new Error(response.error ?? "Chat command failed");
        }
        if (response.conversationId) setSelectedId(response.conversationId);
        await refresh();
        return response;
      } catch (cause) {
        setError(readError(cause));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [bindings, refresh],
  );

  const conversations =
    snapshot?.conversations.filter((conversation) =>
      conversation.projectId === projectId
    ) ?? [];
  const selected = selectedConversation(snapshot, selectedId, projectId);
  return (
    // Zag installs modal effects only when its open state is entered. Remount
    // when the responsive presentation changes so those effects are rebuilt.
    <ArkDialog.Root
      key={compactModal ? "modal" : "panel"}
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      ids={{
        content: "desktop-chat-panel",
        title: "desktop-chat-title",
        description: "desktop-chat-description",
      }}
      modal={compactModal}
      trapFocus={compactModal}
      preventScroll={compactModal}
      closeOnInteractOutside={compactModal}
      closeOnEscape
    >
      <aside
        className={`desktop-chat${open ? " is-open" : ""}${
          nativeChatAvailable ? "" : " is-unavailable"
        }`}
        aria-label="Project agent chat"
        data-chat-runtime={nativeChatAvailable ? "native" : "browser-preview"}
        data-chat-presentation={compactModal ? "modal" : "panel"}
      >
        <ArkDialog.Trigger
          ref={triggerRef}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "desktop-chat-toggle h-10 rounded-lg bg-background px-3 shadow-lg",
          )}
          aria-expanded={open}
          aria-controls="desktop-chat-panel"
        >
          <span>Project chat</span>
          {!nativeChatAvailable && (
            <Badge
              variant="warning"
              className="desktop-chat-availability font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              preview
            </Badge>
          )}
          {selected?.status === "running" && (
            <Badge
              variant="success"
              className="desktop-chat-live font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              live
            </Badge>
          )}
        </ArkDialog.Trigger>
        <ArkDialog.Backdrop className="desktop-chat-backdrop" />
        <ArkDialog.Positioner className="desktop-chat-positioner">
          <ArkDialog.Content className="desktop-chat-panel">
            <header className="desktop-chat-head">
              <div className="min-w-0">
                <p className="desktop-chat-eyebrow">Agent workspace</p>
                <ArkDialog.Title className="desktop-chat-title">
                  Project chat
                </ArkDialog.Title>
                <ArkDialog.Description className="desktop-chat-description">
                  One project. One conversation.
                </ArkDialog.Description>
              </div>
              <ArkDialog.CloseTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="desktop-chat-close h-8 px-2"
                  aria-label="Close project chat"
                >
                  Close
                </Button>
              </ArkDialog.CloseTrigger>
            </header>
            <ConversationRail
              conversations={conversations}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              interactive={nativeChatAvailable}
            />
            {!nativeChatAvailable
              ? <BrowserPreviewUnavailable projectId={projectId} />
              : selected
              ? (
                <Conversation
                  conversation={selected}
                  busy={busy}
                  command={command}
                />
              )
              : (
                <NewConversation
                  projectId={projectId}
                  busy={busy}
                  command={command}
                />
              )}
            {error && <p className="desktop-chat-error" role="alert">{error}
            </p>}
            <footer className="desktop-chat-foot">
              Transcript history is separate from authoritative Thread/CAS
              evidence.
            </footer>
          </ArkDialog.Content>
        </ArkDialog.Positioner>
      </aside>
    </ArkDialog.Root>
  );
}

function ConversationRail({
  conversations,
  selectedId,
  onSelect,
  interactive,
}: {
  readonly conversations: readonly ChatConversationDto[];
  readonly selectedId?: string;
  readonly onSelect: (id: string | null) => void;
  readonly interactive: boolean;
}): JSX.Element {
  return (
    <nav className="desktop-chat-rail" aria-label="Chat conversations">
      <Button
        variant={!selectedId ? "secondary" : "ghost"}
        size="sm"
        className="desktop-chat-rail-button"
        disabled={!interactive}
        aria-pressed={!selectedId}
        onClick={() => onSelect(null)}
      >
        + New
      </Button>
      {conversations.map((conversation) => (
        <Button
          variant={conversation.id === selectedId ? "secondary" : "ghost"}
          size="sm"
          key={conversation.id}
          className="desktop-chat-rail-button"
          disabled={!interactive}
          aria-pressed={conversation.id === selectedId}
          onClick={() => onSelect(conversation.id)}
          title={`${conversation.projectId} · ${conversation.status}`}
        >
          {conversation.projectId}
        </Button>
      ))}
    </nav>
  );
}

function BrowserPreviewUnavailable(
  { projectId }: { readonly projectId?: string },
): JSX.Element {
  return (
    <div className="desktop-chat-preview">
      <p className="desktop-chat-interaction-kind">
        Browser preview · non-native
      </p>
      <Notice title="Native Chat is unavailable here">
        <p>
          This Workbench preview does not expose the Deno Desktop binding. No
          conversation is loaded and no command can be sent from this panel.
        </p>
        {projectId && (
          <p className="desktop-chat-unavailable-focus">
            Projected project <strong>{projectId}</strong>
          </p>
        )}
      </Notice>
      <p className="desktop-chat-preview-guidance">
        Open the dashboard in the packaged Desktop app to use project chat.
      </p>
    </div>
  );
}

function NewConversation({
  projectId,
  busy,
  command,
}: CommandProps & { readonly projectId?: string }): JSX.Element {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!projectId) return;
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "conversation.create",
      projectId,
    });
  };
  return (
    <form
      className="desktop-chat-new rounded-lg border border-dashed border-border bg-card p-4 shadow-sm"
      onSubmit={submit}
    >
      <p className="desktop-chat-interaction-kind">Current projected project</p>
      {projectId
        ? (
          <>
            <strong>{projectId}</strong>
            <p>
              This server-projected project is fixed for the new conversation.
            </p>
            <Button
              type="submit"
              size="sm"
              className="bg-brand text-white hover:bg-brand-strong"
              disabled={busy}
            >
              Start project conversation
            </Button>
          </>
        )
        : (
          <p role="status">
            Chat is unavailable until the Workbench has a validated project
            focus.
          </p>
        )}
    </form>
  );
}

interface CommandProps {
  readonly busy: boolean;
  readonly command: (
    request: DesktopChatBindingCommandRequest,
  ) => Promise<ChatCommandResponse | undefined>;
}

function Conversation({
  conversation,
  busy,
  command,
}: CommandProps & { readonly conversation: ChatConversationDto }): JSX.Element {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "message.send",
      conversationId: conversation.id,
      text: message,
    });
  };
  return (
    <div className="desktop-chat-conversation">
      <div className="desktop-chat-project-line">
        <span>Project</span>
        <strong>{conversation.projectId}</strong>
        <Badge
          variant={conversationStatusVariant(conversation.status)}
          className="desktop-chat-state font-mono text-[9px] uppercase tracking-[0.08em]"
        >
          {conversation.status}
        </Badge>
      </div>
      <ol className="desktop-chat-messages" aria-live="polite">
        {conversation.messages.length === 0 && (
          <li className="desktop-chat-empty">
            Ask about project intent, evidence, or a registered operation.
          </li>
        )}
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={`is-${message.role} is-${message.kind}`}
          >
            <span>
              {message.role === "user"
                ? "You"
                : message.role === "assistant"
                ? "Agent"
                : "Host"}
            </span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
      {conversation.pendingInteraction && (
        <Interaction
          conversationId={conversation.id}
          interaction={conversation.pendingInteraction}
          busy={busy}
          command={command}
        />
      )}
      <form className="desktop-chat-composer" onSubmit={submit}>
        <label htmlFor="desktop-chat-message">Message</label>
        <textarea
          id="desktop-chat-message"
          value={text}
          maxLength={32_000}
          disabled={conversation.status === "closed"}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder="Ask the agent to review the current project…"
          rows={3}
        />
        <div>
          <Button
            type="submit"
            size="sm"
            className="bg-brand text-white hover:bg-brand-strong"
            disabled={busy || !text.trim() || conversation.status === "closed"}
          >
            Send
          </Button>
          {(conversation.status === "running" ||
            conversation.status === "queued") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void command({
                  protocol: DESKTOP_CHAT_PROTOCOL,
                  requestId: requestId(),
                  command: "turn.cancel",
                  conversationId: conversation.id,
                })}
            >
              Cancel turn
            </Button>
          )}
          {conversation.status !== "closed" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void command({
                  protocol: DESKTOP_CHAT_PROTOCOL,
                  requestId: requestId(),
                  command: "conversation.close",
                  conversationId: conversation.id,
                })}
            >
              Close conversation
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Interaction({
  conversationId,
  interaction,
  busy,
  command,
}: CommandProps & {
  readonly conversationId: string;
  readonly interaction: ChatPendingInteractionDto;
}): JSX.Element {
  if (interaction.type === "permission") {
    return (
      <section className="desktop-chat-interaction is-permission rounded-lg border border-warning/25 border-l-4 border-l-warning bg-warning/5 p-3">
        <p className="desktop-chat-interaction-kind">
          Agent permission · Not MRTR
        </p>
        <h3>{interaction.title}</h3>
        <p>{interaction.detail}</p>
        <div className="desktop-chat-actions">
          {interaction.options.map((option) => (
            <Button
              type="button"
              variant={option.decision.startsWith("allow")
                ? "default"
                : "outline"}
              size="sm"
              key={option.decision}
              disabled={busy}
              className={option.decision.startsWith("allow")
                ? "bg-brand text-white hover:bg-brand-strong"
                : undefined}
              onClick={() =>
                void command({
                  protocol: DESKTOP_CHAT_PROTOCOL,
                  requestId: requestId(),
                  command: "permission.resolve",
                  conversationId,
                  correlationId: interaction.correlationId,
                  decision: option.decision,
                })}
            >
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void command({
                protocol: DESKTOP_CHAT_PROTOCOL,
                requestId: requestId(),
                command: "permission.resolve",
                conversationId,
                correlationId: interaction.correlationId,
                decision: "cancel",
              })}
          >
            Cancel
          </Button>
        </div>
      </section>
    );
  }
  if (interaction.type === "elicitation-url") {
    return (
      <section className="desktop-chat-interaction is-elicitation rounded-lg border border-lane-req/25 border-l-4 border-l-lane-req bg-lane-req/5 p-3">
        <p className="desktop-chat-interaction-kind">External input request</p>
        <h3>{interaction.message}</h3>
        <p>Open the exact HTTPS destination, complete it, then return here.</p>
        <div className="desktop-chat-actions">
          <Button
            type="button"
            size="sm"
            className="bg-brand text-white hover:bg-brand-strong"
            disabled={busy}
            onClick={() =>
              void command({
                protocol: DESKTOP_CHAT_PROTOCOL,
                requestId: requestId(),
                command: "external.open",
                url: interaction.url,
              })}
          >
            Open in external browser
          </Button>
          <ResolveButton
            label="I returned — continue"
            action="accept"
            conversationId={conversationId}
            interaction={interaction}
            busy={busy}
            command={command}
          />
          <ResolveButton
            label="Decline"
            action="decline"
            conversationId={conversationId}
            interaction={interaction}
            busy={busy}
            command={command}
          />
          <ResolveButton
            label="Cancel"
            action="cancel"
            conversationId={conversationId}
            interaction={interaction}
            busy={busy}
            command={command}
          />
        </div>
      </section>
    );
  }
  return (
    <ElicitationForm
      conversationId={conversationId}
      interaction={interaction}
      busy={busy}
      command={command}
    />
  );
}

function ElicitationForm({
  conversationId,
  interaction,
  busy,
  command,
}: CommandProps & {
  readonly conversationId: string;
  readonly interaction: Extract<
    ChatPendingInteractionDto,
    { type: "elicitation-form" }
  >;
}): JSX.Element {
  const [values, setValues] = useState<
    Record<string, string | number | boolean | string[]>
  >(
    () => {
      const initial: Record<string, string | number | boolean | string[]> = {};
      for (const field of interaction.fields) {
        const value = field.defaultValue;
        if (value === undefined) continue;
        initial[field.name] = Array.isArray(value)
          ? Array.from(value as readonly string[])
          : value as string | number | boolean;
      }
      return initial;
    },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = Object.fromEntries(interaction.fields.flatMap((field) => {
      const value = values[field.name];
      if (value === undefined || value === "") return [];
      if (
        (field.type === "number" || field.type === "integer") &&
        typeof value === "string"
      ) {
        return [[field.name, Number(value)]];
      }
      return [[field.name, value]];
    })) as Record<string, string | number | boolean | string[]>;
    void command({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId: requestId(),
      command: "elicitation.resolve",
      conversationId,
      correlationId: interaction.correlationId,
      action: "accept",
      content,
    });
  };
  return (
    <form
      className="desktop-chat-interaction is-elicitation rounded-lg border border-lane-req/25 border-l-4 border-l-lane-req bg-lane-req/5 p-3"
      onSubmit={submit}
    >
      <p className="desktop-chat-interaction-kind">
        Server input request · may be MRTR
      </p>
      <h3>{interaction.title ?? interaction.message}</h3>
      {interaction.title && <p>{interaction.message}</p>}
      {interaction.description && <p>{interaction.description}</p>}
      <div className="desktop-chat-fields">
        {interaction.fields.map((field) => (
          <ChatField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}
      </div>
      <div className="desktop-chat-actions">
        <Button
          type="submit"
          size="sm"
          className="bg-brand text-white hover:bg-brand-strong"
          disabled={busy}
        >
          Accept and continue
        </Button>
        {(["decline", "cancel"] as const).map((action) => (
          <Button
            key={action}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void command({
                protocol: DESKTOP_CHAT_PROTOCOL,
                requestId: requestId(),
                command: "elicitation.resolve",
                conversationId,
                correlationId: interaction.correlationId,
                action,
              })}
          >
            {action === "decline" ? "Decline" : "Cancel"}
          </Button>
        ))}
      </div>
    </form>
  );
}

function ChatField({
  field,
  value,
  onChange,
}: {
  readonly field: ChatFormFieldDto;
  readonly value?: string | number | boolean | readonly string[];
  readonly onChange: (value: string | number | boolean | string[]) => void;
}): JSX.Element {
  const id = `chat-field-${field.name}`;
  if (field.type === "boolean") {
    return (
      <label className="desktop-chat-checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>
          <strong>{field.label}</strong>
          {field.description && <small>{field.description}</small>}
        </span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label htmlFor={id}>
        {field.label}
        <select
          id={id}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }
  if (field.type === "multiselect") {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <fieldset>
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label className="desktop-chat-checkbox" key={option.value}>
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.currentTarget.checked) {
                  next.add(option.value);
                } else next.delete(option.value);
                onChange([...next]);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  const inputType = field.type === "text"
    ? field.format === "uri" ? "url" : field.format ?? "text"
    : "number";
  return (
    <label htmlFor={id}>
      {field.label}
      <input
        id={id}
        type={inputType}
        required={field.required}
        value={typeof value === "string" || typeof value === "number"
          ? value
          : ""}
        min={field.type === "number" || field.type === "integer"
          ? field.minimum
          : undefined}
        max={field.type === "number" || field.type === "integer"
          ? field.maximum
          : undefined}
        step={field.type === "integer"
          ? 1
          : field.type === "number"
          ? "any"
          : undefined}
        minLength={field.type === "text" ? field.minLength : undefined}
        maxLength={field.type === "text" ? field.maxLength : undefined}
        pattern={field.type === "text" ? field.pattern : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {field.description && <small>{field.description}</small>}
    </label>
  );
}

function ResolveButton({
  label,
  action,
  conversationId,
  interaction,
  busy,
  command,
}: CommandProps & {
  readonly label: string;
  readonly action: "accept" | "decline" | "cancel";
  readonly conversationId: string;
  readonly interaction: Extract<
    ChatPendingInteractionDto,
    { type: "elicitation-url" }
  >;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant={action === "accept" ? "default" : "outline"}
      size="sm"
      disabled={busy}
      className={action === "accept"
        ? "bg-brand text-white hover:bg-brand-strong"
        : undefined}
      onClick={() =>
        void command({
          protocol: DESKTOP_CHAT_PROTOCOL,
          requestId: requestId(),
          command: "elicitation.resolve",
          conversationId,
          correlationId: interaction.correlationId,
          action,
        })}
    >
      {label}
    </Button>
  );
}

function selectedConversation(
  snapshot: ChatSnapshotDto | undefined,
  selectedId: string | null | undefined,
  projectId: string | undefined,
): ChatConversationDto | undefined {
  if (selectedId === null || projectId === undefined) return undefined;
  return snapshot?.conversations.find((conversation) =>
    conversation.projectId === projectId && conversation.id === selectedId
  );
}

function conversationStatusVariant(
  status: ChatConversationDto["status"],
): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "running":
      return "success";
    case "queued":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const media = globalThis.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function desktopChatRuntimeAvailable(): boolean {
  return desktopBindings() !== undefined;
}

function desktopBindings(): DesktopBindings | undefined {
  const candidate = globalThis.bindings;
  if (
    typeof candidate !== "object" || candidate === null ||
    typeof candidate.casysChatSnapshot !== "function" ||
    typeof candidate.casysChatCommand !== "function"
  ) return undefined;
  return candidate;
}

function requestId(): string {
  return `ui:${crypto.randomUUID()}`;
}

function readError(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "Desktop Chat is unavailable.";
}
