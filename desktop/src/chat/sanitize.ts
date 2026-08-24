import {
  type ChatFormFieldDto,
  type ChatFormOptionDto,
  type ChatPendingInteractionDto,
  validateExternalHttpsUrl,
  validateSafeRegexPattern,
} from "../../../src/presentation/desktop/chat/contracts.ts";
import type {
  RuntimeElicitationRequest,
  RuntimePermissionRequest,
} from "./runtime-port.ts";

const SAFE_PERMISSION_KINDS = new Set([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
]);
const SAFE_FORMATS = new Set(["email", "uri", "date", "date-time"]);
const MAX_FIELDS = 64;

export function sanitizePermissionRequest(
  request: RuntimePermissionRequest,
  correlationId: string,
): ChatPendingInteractionDto {
  const title = cleanText(request.raw.toolCall.title, "Agent tool request", 240);
  const kind = cleanText(
    request.inferredKind ?? request.raw.toolCall.kind,
    "unspecified",
    80,
  );
  const options = request.raw.options.flatMap((option) => {
    if (!SAFE_PERMISSION_KINDS.has(option.kind)) return [];
    return [{
      decision: option.kind as
        | "allow_once"
        | "allow_always"
        | "reject_once"
        | "reject_always",
      label: cleanText(option.name, option.kind.replaceAll("_", " "), 120),
    }];
  });
  if (options.length === 0) {
    throw new TypeError("permission request exposes no supported decision");
  }
  return Object.freeze({
    type: "permission",
    correlationId,
    title,
    detail: `Agent permission (${kind}). This is not an MRTR engineering decision.`,
    options: Object.freeze(options),
  });
}

export function sanitizeElicitationRequest(
  request: RuntimeElicitationRequest,
  correlationId: string,
): ChatPendingInteractionDto {
  const message = cleanText(request.message, "Input requested", 2_000);
  if (request.mode === "url") {
    if (typeof request.url !== "string" || typeof request.elicitationId !== "string") {
      throw new TypeError("URL elicitation is incomplete");
    }
    return Object.freeze({
      type: "elicitation-url",
      correlationId,
      message,
      url: validateExternalHttpsUrl(request.url),
    });
  }
  if (request.mode !== "form") {
    throw new TypeError("unsupported elicitation mode");
  }
  const schema = record(request.requestedSchema, "requestedSchema");
  if (schema.type !== undefined && schema.type !== "object") {
    throw new TypeError("elicitation schema must be an object");
  }
  const properties = schema.properties === undefined
    ? {}
    : record(schema.properties, "requestedSchema.properties");
  const entries = Object.entries(properties);
  if (entries.length > MAX_FIELDS) throw new TypeError("elicitation form is too large");
  const required = new Set(
    readStringArray(schema.required, "requestedSchema.required"),
  );
  const fields = entries.map(([name, raw]) =>
    sanitizeField(name, raw, required.has(name))
  );
  if ([...required].some((name) => !Object.hasOwn(properties, name))) {
    throw new TypeError("elicitation required field is undeclared");
  }
  return Object.freeze({
    type: "elicitation-form",
    correlationId,
    message,
    title: optionalCleanText(schema.title, 240),
    description: optionalCleanText(schema.description, 1_000),
    fields: Object.freeze(fields),
  });
}

export function validateElicitationContent(
  pending: Extract<ChatPendingInteractionDto, { type: "elicitation-form" }>,
  content: Readonly<Record<string, string | number | boolean | string[]>>,
): Readonly<Record<string, string | number | boolean | string[]>> {
  const output: Record<string, string | number | boolean | string[]> = {};
  const fields = new Map(pending.fields.map((field) => [field.name, field]));
  for (const key of Object.keys(content)) {
    if (!fields.has(key)) throw new TypeError(`unknown elicitation field ${key}`);
  }
  for (const field of pending.fields) {
    const value = content[field.name];
    if (value === undefined) {
      if (field.required) throw new TypeError(`${field.label} is required`);
      continue;
    }
    output[field.name] = validateFieldValue(field, value);
  }
  return Object.freeze(output);
}

function sanitizeField(
  name: string,
  value: unknown,
  required: boolean,
): ChatFormFieldDto {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    throw new TypeError("elicitation field name is invalid");
  }
  const schema = record(value, `field ${name}`);
  const base = {
    name,
    label: cleanText(schema.title, name, 160),
    ...(optionalCleanText(schema.description, 600) === undefined
      ? {}
      : { description: optionalCleanText(schema.description, 600) }),
    required,
  };
  if (schema.type === "string") {
    const options = stringOptions(schema);
    if (options !== undefined) {
      return Object.freeze({
        ...base,
        type: "select",
        options,
        ...(typeof schema.default === "string" ? { defaultValue: schema.default } : {}),
      });
    }
    return Object.freeze({
      ...base,
      type: "text",
      ...(typeof schema.format === "string" && SAFE_FORMATS.has(schema.format)
        ? { format: schema.format as "email" | "uri" | "date" | "date-time" }
        : {}),
      ...finiteBound(schema.minLength, "minLength"),
      ...finiteBound(schema.maxLength, "maxLength"),
      ...(schema.pattern === undefined
        ? {}
        : { pattern: validateSafeRegexPattern(schema.pattern) }),
      ...(typeof schema.default === "string" ? { defaultValue: schema.default } : {}),
    });
  }
  if (schema.type === "number" || schema.type === "integer") {
    return Object.freeze({
      ...base,
      type: schema.type,
      ...numberBound(schema.minimum, "minimum"),
      ...numberBound(schema.maximum, "maximum"),
      ...(typeof schema.default === "number" && Number.isFinite(schema.default)
        ? { defaultValue: schema.default }
        : {}),
    });
  }
  if (schema.type === "boolean") {
    return Object.freeze({
      ...base,
      type: "boolean",
      ...(typeof schema.default === "boolean" ? { defaultValue: schema.default } : {}),
    });
  }
  if (schema.type === "array") {
    const items = record(schema.items, `field ${name}.items`);
    const options = multiOptions(items);
    return Object.freeze({
      ...base,
      type: "multiselect",
      options,
      ...finiteBound(schema.minItems, "minItems"),
      ...finiteBound(schema.maxItems, "maxItems"),
      ...(Array.isArray(schema.default) &&
          schema.default.every((entry) => typeof entry === "string")
        ? { defaultValue: Object.freeze([...schema.default] as string[]) }
        : {}),
    });
  }
  throw new TypeError(`elicitation field ${name} has an unsupported type`);
}

function validateFieldValue(
  field: ChatFormFieldDto,
  value: string | number | boolean | string[],
): string | number | boolean | string[] {
  if (field.type === "text") {
    if (typeof value !== "string") throw new TypeError(`${field.label} must be text`);
    if (field.minLength !== undefined && value.length < field.minLength) {
      throw new TypeError(`${field.label} is too short`);
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      throw new TypeError(`${field.label} is too long`);
    }
    if (
      field.pattern !== undefined &&
      !new RegExp(validateSafeRegexPattern(field.pattern)).test(value)
    ) {
      throw new TypeError(`${field.label} does not match its required format`);
    }
    if (field.format === "uri") {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") {
        throw new TypeError(`${field.label} must use HTTPS`);
      }
    }
    return value;
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${field.label} must be a number`);
    }
    if (field.type === "integer" && !Number.isInteger(value)) {
      throw new TypeError(`${field.label} must be an integer`);
    }
    if (field.minimum !== undefined && value < field.minimum) {
      throw new TypeError(`${field.label} is below its minimum`);
    }
    if (field.maximum !== undefined && value > field.maximum) {
      throw new TypeError(`${field.label} is above its maximum`);
    }
    return value;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new TypeError(`${field.label} must be boolean`);
    }
    return value;
  }
  if (field.type === "select") {
    if (
      typeof value !== "string" || !field.options.some((item) => item.value === value)
    ) {
      throw new TypeError(`${field.label} has an invalid selection`);
    }
    return value;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError(`${field.label} must be a string selection list`);
  }
  const allowed = new Set(field.options.map((item) => item.value));
  if (value.some((entry) => !allowed.has(entry))) {
    throw new TypeError(`${field.label} has an invalid selection`);
  }
  if (field.minItems !== undefined && value.length < field.minItems) {
    throw new TypeError(`${field.label} has too few selections`);
  }
  if (field.maxItems !== undefined && value.length > field.maxItems) {
    throw new TypeError(`${field.label} has too many selections`);
  }
  return [...value];
}

function stringOptions(
  schema: Record<string, unknown>,
): readonly ChatFormOptionDto[] | undefined {
  if (Array.isArray(schema.oneOf)) return titledOptions(schema.oneOf, "oneOf");
  if (Array.isArray(schema.enum)) {
    return Object.freeze(
      readStringArray(schema.enum, "enum").map((value) => ({
        value,
        label: value,
      })),
    );
  }
  return undefined;
}

function multiOptions(items: Record<string, unknown>): readonly ChatFormOptionDto[] {
  if (Array.isArray(items.anyOf)) return titledOptions(items.anyOf, "anyOf");
  if (items.type !== "string" || !Array.isArray(items.enum)) {
    throw new TypeError("multi-select items must be a closed string enum");
  }
  return Object.freeze(
    readStringArray(items.enum, "items.enum").map((value) => ({
      value,
      label: value,
    })),
  );
}

function titledOptions(
  value: readonly unknown[],
  name: string,
): readonly ChatFormOptionDto[] {
  if (value.length > 128) throw new TypeError(`${name} has too many options`);
  return Object.freeze(value.map((entry) => {
    const option = record(entry, name);
    if (typeof option.const !== "string" || option.const.length > 1_000) {
      throw new TypeError(`${name} option value is invalid`);
    }
    return Object.freeze({
      value: option.const,
      label: cleanText(option.title, option.const, 160),
      ...(optionalCleanText(option.description, 600) === undefined
        ? {}
        : { description: optionalCleanText(option.description, 600) }),
    });
  }));
}

function readStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) || value.length > 128 ||
    !value.every((entry) => typeof entry === "string" && entry.length <= 1_000)
  ) {
    throw new TypeError(`${name} must be a bounded string array`);
  }
  return [...value] as string[];
}

function finiteBound(value: unknown, name: string): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return { [name]: value as number };
}

function numberBound(value: unknown, name: string): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return { [name]: value };
}

function cleanText(value: unknown, fallback: string, max: number): string {
  return optionalCleanText(value, max) ?? fallback;
}

function optionalCleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("").trim();
  if (cleaned === "") return undefined;
  return cleaned.slice(0, max);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}
