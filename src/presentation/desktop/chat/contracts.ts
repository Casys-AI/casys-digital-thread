/**
 * Closed `casys-desktop-chat/1.0` presentation contract.
 *
 * Desktop host and Workbench UI reconstruct these DTOs. Host process, bindings,
 * and chat-runtime stay in `desktop/`.
 */

export const DESKTOP_CHAT_PROTOCOL = "casys-desktop-chat/1.0" as const;
export const CHAT_HOST_COMPONENT_ID = "chat-host" as const;
export const CHAT_HOST_COMPONENT_VERSION = "0.4.0" as const;

export type ChatConversationStatus =
  | "idle"
  | "queued"
  | "running"
  | "failed"
  | "closed";

export type ChatMessageKind = "text" | "thought" | "tool" | "status" | "error";

export interface ChatMessageDto {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly kind: ChatMessageKind;
  readonly text: string;
  readonly createdAt: string;
}

export interface ChatPermissionOptionDto {
  readonly decision:
    | "allow_once"
    | "allow_always"
    | "reject_once"
    | "reject_always";
  readonly label: string;
}

export interface ChatFormOptionDto {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface ChatFormFieldBaseDto {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
}

export type ChatFormFieldDto =
  | (ChatFormFieldBaseDto & {
    readonly type: "text";
    readonly format?: "email" | "uri" | "date" | "date-time";
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly pattern?: string;
    readonly defaultValue?: string;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "number";
    readonly minimum?: number;
    readonly maximum?: number;
    readonly defaultValue?: number;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "integer";
    readonly minimum?: number;
    readonly maximum?: number;
    readonly defaultValue?: number;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "boolean";
    readonly defaultValue?: boolean;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "select";
    readonly options: readonly ChatFormOptionDto[];
    readonly defaultValue?: string;
  })
  | (ChatFormFieldBaseDto & {
    readonly type: "multiselect";
    readonly options: readonly ChatFormOptionDto[];
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly defaultValue?: readonly string[];
  });

export type ChatPendingInteractionDto =
  | {
    readonly type: "permission";
    readonly correlationId: string;
    readonly title: string;
    readonly detail: string;
    readonly options: readonly ChatPermissionOptionDto[];
  }
  | {
    readonly type: "elicitation-form";
    readonly correlationId: string;
    readonly message: string;
    readonly title?: string;
    readonly description?: string;
    readonly fields: readonly ChatFormFieldDto[];
  }
  | {
    readonly type: "elicitation-url";
    readonly correlationId: string;
    readonly message: string;
    readonly url: string;
  };

export interface ChatConversationDto {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: ChatConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessageDto[];
  readonly pendingInteraction?: ChatPendingInteractionDto;
}

export interface ChatSnapshotRequest {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly conversationId?: string;
}

export interface ChatSnapshotDto {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly host: "ready" | "unavailable" | "shutting-down";
  readonly conversations: readonly ChatConversationDto[];
  readonly selectedConversationId?: string;
  readonly error?: string;
}

export type ChatCommandRequest =
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "conversation.create";
    readonly projectId: string;
    readonly title?: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "message.send";
    readonly conversationId: string;
    readonly text: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "turn.cancel" | "conversation.close";
    readonly conversationId: string;
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "permission.resolve";
    readonly conversationId: string;
    readonly correlationId: string;
    readonly decision:
      | "allow_once"
      | "allow_always"
      | "reject_once"
      | "reject_always"
      | "cancel";
  }
  | {
    readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
    readonly requestId: string;
    readonly command: "elicitation.resolve";
    readonly conversationId: string;
    readonly correlationId: string;
    readonly action: "accept" | "decline" | "cancel";
    readonly content?: Readonly<Record<string, string | number | boolean | string[]>>;
  };

export interface ChatCommandResponse {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly ok: boolean;
  readonly conversationId?: string;
  readonly error?: string;
}

export type DesktopChatBindingCommandRequest = ChatCommandRequest | {
  readonly protocol: typeof DESKTOP_CHAT_PROTOCOL;
  readonly requestId: string;
  readonly command: "external.open";
  readonly url: string;
};

const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const OPAQUE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export function parseChatSnapshotRequest(value: unknown): ChatSnapshotRequest {
  const input = record(value, "snapshot request");
  protocol(input.protocol);
  const conversationId = optionalOpaqueId(input.conversationId, "conversationId");
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    ...(conversationId === undefined ? {} : { conversationId }),
  });
}

export function parseChatCommandRequest(value: unknown): ChatCommandRequest {
  const input = record(value, "chat command");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  const command = text(input.command, "command", 64);

  if (command === "conversation.create") {
    const projectId = parseCasysProjectId(input.projectId);
    const title = optionalText(input.title, "title", 120);
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      projectId,
      ...(title === undefined ? {} : { title }),
    });
  }

  const conversationId = opaqueId(input.conversationId, "conversationId");
  if (command === "message.send") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      text: text(input.text, "text", 32_000),
    });
  }
  if (command === "turn.cancel" || command === "conversation.close") {
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
    });
  }
  const correlationId = opaqueId(input.correlationId, "correlationId");
  if (command === "permission.resolve") {
    const decision = input.decision;
    if (
      decision !== "allow_once" && decision !== "allow_always" &&
      decision !== "reject_once" && decision !== "reject_always" &&
      decision !== "cancel"
    ) {
      throw new TypeError("permission decision is invalid");
    }
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      correlationId,
      decision,
    });
  }
  if (command === "elicitation.resolve") {
    const action = input.action;
    if (action !== "accept" && action !== "decline" && action !== "cancel") {
      throw new TypeError("elicitation action is invalid");
    }
    const content = input.content === undefined
      ? undefined
      : elicitationContent(input.content);
    return Object.freeze({
      protocol: DESKTOP_CHAT_PROTOCOL,
      requestId,
      command,
      conversationId,
      correlationId,
      action,
      ...(content === undefined ? {} : { content }),
    });
  }
  throw new TypeError("chat command is not supported");
}

/** Shared closed project identity contract for renderer commands and host focus. */
export function parseCasysProjectId(value: unknown): string {
  const projectId = text(value, "projectId", 128);
  if (!PROJECT_ID.test(projectId)) {
    throw new TypeError("projectId must be an explicit Casys project identifier");
  }
  return projectId;
}

export function parseDesktopChatBindingCommandRequest(
  value: unknown,
): DesktopChatBindingCommandRequest {
  const input = record(value, "desktop chat binding command");
  if (input.command !== "external.open") return parseChatCommandRequest(value);
  protocol(input.protocol);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: opaqueId(input.requestId, "requestId"),
    command: "external.open",
    url: validateExternalHttpsUrl(input.url),
  });
}

export function validateExternalHttpsUrl(value: unknown): string {
  const input = text(value, "external URL", 4_000);
  const url = new URL(input);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.hostname === ""
  ) {
    throw new TypeError("external URL must be an HTTPS URL without credentials");
  }
  return url.toString();
}

export function validateSafeRegexPattern(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) {
    throw new TypeError("pattern is outside the safe renderer subset");
  }
  if (
    /\\[1-9]|\(\?/.test(value) ||
    /(?:\*|\+|\{\d*,?\d*\})\s*(?:\*|\+|\{)/.test(value) ||
    /\([^)]*\)\s*(?:\*|\+|\{)/.test(value)
  ) throw new TypeError("pattern is outside the safe renderer subset");
  try {
    new RegExp(value);
  } catch {
    throw new TypeError("pattern is not a valid regular expression");
  }
  return value;
}

/** Reconstructs the renderer DTO and drops every unregistered sidecar field. */
export function parseChatSnapshotDto(value: unknown): ChatSnapshotDto {
  const input = record(value, "chat snapshot");
  protocol(input.protocol);
  const host = input.host;
  if (host !== "ready" && host !== "unavailable" && host !== "shutting-down") {
    throw new TypeError("chat host state is invalid");
  }
  if (!Array.isArray(input.conversations) || input.conversations.length > 100) {
    throw new TypeError("chat conversation list is invalid");
  }
  const conversations = Object.freeze(input.conversations.map(parseConversationDto));
  const selectedConversationId = optionalOpaqueId(
    input.selectedConversationId,
    "selectedConversationId",
  );
  const error = optionalText(input.error, "error", 1_000);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    host,
    conversations,
    ...(selectedConversationId === undefined ? {} : { selectedConversationId }),
    ...(error === undefined ? {} : { error }),
  });
}

export function parseChatCommandResponse(value: unknown): ChatCommandResponse {
  const input = record(value, "chat command response");
  protocol(input.protocol);
  const requestId = opaqueId(input.requestId, "requestId");
  if (typeof input.ok !== "boolean") {
    throw new TypeError("command response ok is invalid");
  }
  const conversationId = optionalOpaqueId(input.conversationId, "conversationId");
  const error = optionalText(input.error, "error", 1_000);
  return Object.freeze({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId,
    ok: input.ok,
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(error === undefined ? {} : { error }),
  });
}

function parseConversationDto(value: unknown): ChatConversationDto {
  const input = record(value, "chat conversation");
  const status = input.status;
  if (
    status !== "idle" && status !== "queued" && status !== "running" &&
    status !== "failed" && status !== "closed"
  ) {
    throw new TypeError("conversation status is invalid");
  }
  if (!Array.isArray(input.messages) || input.messages.length > 400) {
    throw new TypeError("conversation messages are invalid");
  }
  const pendingInteraction = input.pendingInteraction === undefined
    ? undefined
    : parsePendingInteractionDto(input.pendingInteraction);
  return Object.freeze({
    id: opaqueId(input.id, "conversation id"),
    projectId: text(input.projectId, "projectId", 128),
    title: text(input.title, "conversation title", 120),
    status,
    createdAt: isoDate(input.createdAt, "createdAt"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
    messages: Object.freeze(input.messages.map(parseMessageDto)),
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  });
}

function parseMessageDto(value: unknown): ChatMessageDto {
  const input = record(value, "chat message");
  const role = input.role;
  const kind = input.kind;
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
    id: opaqueId(input.id, "message id"),
    role,
    kind,
    text: boundedText(input.text, "message text", 32_000),
    createdAt: isoDate(input.createdAt, "message createdAt"),
  });
}

function parsePendingInteractionDto(value: unknown): ChatPendingInteractionDto {
  const input = record(value, "pending interaction");
  const correlationId = opaqueId(input.correlationId, "correlationId");
  if (input.type === "permission") {
    if (!Array.isArray(input.options) || input.options.length > 8) {
      throw new TypeError("permission options are invalid");
    }
    return Object.freeze({
      type: "permission",
      correlationId,
      title: text(input.title, "permission title", 240),
      detail: text(input.detail, "permission detail", 1_000),
      options: Object.freeze(input.options.map((value) => {
        const option = record(value, "permission option");
        const decision = option.decision;
        if (
          decision !== "allow_once" && decision !== "allow_always" &&
          decision !== "reject_once" && decision !== "reject_always"
        ) {
          throw new TypeError("permission option is invalid");
        }
        return Object.freeze({
          decision,
          label: text(option.label, "permission option label", 120),
        });
      })),
    });
  }
  if (input.type === "elicitation-url") {
    const urlText = text(input.url, "elicitation URL", 4_000);
    const url = new URL(urlText);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      throw new TypeError("elicitation URL is invalid");
    }
    return Object.freeze({
      type: "elicitation-url",
      correlationId,
      message: text(input.message, "elicitation message", 2_000),
      url: url.toString(),
    });
  }
  if (
    input.type !== "elicitation-form" || !Array.isArray(input.fields) ||
    input.fields.length > 64
  ) {
    throw new TypeError("elicitation form is invalid");
  }
  return Object.freeze({
    type: "elicitation-form",
    correlationId,
    message: text(input.message, "elicitation message", 2_000),
    ...(optionalText(input.title, "elicitation title", 240) === undefined
      ? {}
      : { title: optionalText(input.title, "elicitation title", 240) }),
    ...(optionalText(input.description, "elicitation description", 1_000) === undefined
      ? {}
      : {
        description: optionalText(input.description, "elicitation description", 1_000),
      }),
    fields: Object.freeze(input.fields.map(parseFormFieldDto)),
  });
}

function parseFormFieldDto(value: unknown): ChatFormFieldDto {
  const input = record(value, "elicitation field");
  const base = {
    name: text(input.name, "field name", 128),
    label: text(input.label, "field label", 160),
    ...(optionalText(input.description, "field description", 600) === undefined
      ? {}
      : { description: optionalText(input.description, "field description", 600) }),
    required: input.required === true,
  };
  if (input.type === "text") {
    const format = input.format;
    if (
      format !== undefined && format !== "email" && format !== "uri" &&
      format !== "date" && format !== "date-time"
    ) {
      throw new TypeError("text field format is invalid");
    }
    return Object.freeze({
      ...base,
      type: "text",
      ...(format === undefined ? {} : { format }),
      ...optionalNonNegativeInteger(input.minLength, "minLength"),
      ...optionalNonNegativeInteger(input.maxLength, "maxLength"),
      ...(input.pattern === undefined
        ? {}
        : { pattern: validateSafeRegexPattern(input.pattern) }),
      ...(typeof input.defaultValue === "string"
        ? { defaultValue: input.defaultValue.slice(0, 8_000) }
        : {}),
    });
  }
  if (input.type === "number" || input.type === "integer") {
    return Object.freeze({
      ...base,
      type: input.type,
      ...optionalFiniteNumber(input.minimum, "minimum"),
      ...optionalFiniteNumber(input.maximum, "maximum"),
      ...optionalFiniteNumber(input.defaultValue, "defaultValue"),
    });
  }
  if (input.type === "boolean") {
    return Object.freeze({
      ...base,
      type: "boolean",
      ...(typeof input.defaultValue === "boolean"
        ? { defaultValue: input.defaultValue }
        : {}),
    });
  }
  if (input.type !== "select" && input.type !== "multiselect") {
    throw new TypeError("elicitation field type is invalid");
  }
  if (!Array.isArray(input.options) || input.options.length > 128) {
    throw new TypeError("elicitation field options are invalid");
  }
  const options = Object.freeze(input.options.map((value) => {
    const option = record(value, "form option");
    return Object.freeze({
      value: text(option.value, "option value", 1_000),
      label: text(option.label, "option label", 160),
      ...(optionalText(option.description, "option description", 600) === undefined
        ? {}
        : { description: optionalText(option.description, "option description", 600) }),
    });
  }));
  if (input.type === "select") {
    return Object.freeze({
      ...base,
      type: "select",
      options,
      ...(typeof input.defaultValue === "string"
        ? { defaultValue: input.defaultValue.slice(0, 1_000) }
        : {}),
    });
  }
  return Object.freeze({
    ...base,
    type: "multiselect",
    options,
    ...optionalNonNegativeInteger(input.minItems, "minItems"),
    ...optionalNonNegativeInteger(input.maxItems, "maxItems"),
    ...(Array.isArray(input.defaultValue) &&
        input.defaultValue.every((entry) => typeof entry === "string")
      ? { defaultValue: Object.freeze([...input.defaultValue] as string[]) }
      : {}),
  });
}

function optionalNonNegativeInteger(
  value: unknown,
  name: string,
): Record<string, number> {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return { [name]: value as number };
}

function optionalFiniteNumber(value: unknown, name: string): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return { [name]: value };
}

function isoDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO date`);
  }
  return value;
}

function protocol(value: unknown): void {
  if (value !== DESKTOP_CHAT_PROTOCOL) {
    throw new TypeError(`protocol must be ${DESKTOP_CHAT_PROTOCOL}`);
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new TypeError(`${name} must be non-empty text of at most ${max} characters`);
  }
  return value.trim();
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`${name} must contain at most ${max} characters`);
  }
  return value;
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  return value === undefined ? undefined : text(value, name, max);
}

function opaqueId(value: unknown, name: string): string {
  const candidate = text(value, name, 160);
  if (!OPAQUE_ID.test(candidate)) throw new TypeError(`${name} is invalid`);
  return candidate;
}

function optionalOpaqueId(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : opaqueId(value, name);
}

function elicitationContent(
  value: unknown,
): Readonly<Record<string, string | number | boolean | string[]>> {
  const input = record(value, "elicitation content");
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key)) {
      throw new TypeError("elicitation content contains an invalid field name");
    }
    if (typeof entry === "string") {
      if (entry.length > 8_000) throw new TypeError("elicitation text is too long");
      output[key] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      output[key] = entry;
    } else if (typeof entry === "boolean") {
      output[key] = entry;
    } else if (
      Array.isArray(entry) && entry.length <= 128 &&
      entry.every((item) => typeof item === "string" && item.length <= 1_000)
    ) {
      output[key] = [...entry] as string[];
    } else {
      throw new TypeError("elicitation content contains an unsupported value");
    }
  }
  return Object.freeze(output);
}
