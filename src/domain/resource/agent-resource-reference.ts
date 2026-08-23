/**
 * Closed AgentResourceReference: the only public handle a later capture
 * tool may accept. Partial locators (URI alone, digest alone) are refused.
 *
 * MIME here is identity metadata, not a parser selector. Each text/JSON
 * domain names its compatible set after a generic exact reopen.
 */

import { exactRecord, literalValue, nonEmptyText } from "../kernel/case-validation.ts";
import type { AgentResourceReference } from "./agent-resource-capture.ts";
import {
  AGENT_RESOURCE_CAPTURE_SCHEMA,
  AGENT_RESOURCE_MAX_BYTES,
  parseAgentResourceMimeType,
  parseAgentResourceName,
} from "./agent-resource-envelope.ts";

export const AGENT_RESOURCE_URI_PREFIX =
  "casys://agent-resource-capture/sha256/" as const;
export const AGENT_RESOURCE_URI_PATTERN =
  /^casys:\/\/agent-resource-capture\/sha256\/[a-f0-9]{64}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const PYTHON_SOURCE_ACCEPTED_MIME_TYPES = [
  "text/x-python",
  "text/plain",
] as const;
export const MODELICA_SOURCE_ACCEPTED_MIME_TYPES = [
  "text/x-modelica",
  "text/plain",
] as const;
export const SPICE_SOURCE_ACCEPTED_MIME_TYPES = [
  "text/x-spice",
  "application/x-spice",
  "text/plain",
] as const;
export const SYSML_SOURCE_ACCEPTED_MIME_TYPES = [
  "text/x-sysml",
  "text/plain",
] as const;
export const JSON_SOURCE_ACCEPTED_MIME_TYPES = [
  "application/json",
  "text/plain",
] as const;

export function acceptedMimeTypesForTechnicalLanguage(
  language: "python" | "modelica" | "spice",
): readonly string[] {
  switch (language) {
    case "python":
      return PYTHON_SOURCE_ACCEPTED_MIME_TYPES;
    case "modelica":
      return MODELICA_SOURCE_ACCEPTED_MIME_TYPES;
    case "spice":
      return SPICE_SOURCE_ACCEPTED_MIME_TYPES;
  }
}

export const AGENT_RESOURCE_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: AGENT_RESOURCE_CAPTURE_SCHEMA },
    uri: {
      type: "string",
      pattern: "^casys://agent-resource-capture/sha256/[a-f0-9]{64}$",
    },
    name: { type: "string", minLength: 1, maxLength: 256 },
    mimeType: { type: "string", minLength: 1, maxLength: 256 },
    representation: { type: "string", enum: ["text", "blob"] },
    byteCount: {
      type: "integer",
      minimum: 1,
      maximum: AGENT_RESOURCE_MAX_BYTES,
    },
    fingerprint: {
      type: "object",
      properties: {
        algorithm: { const: "sha256" },
        digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
      required: ["algorithm", "digest"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "uri",
    "name",
    "mimeType",
    "representation",
    "byteCount",
    "fingerprint",
  ],
  additionalProperties: false,
} as const;

/** Parse the full closed reference. Extra or missing fields fail closed. */
export function parseAgentResourceReference(
  value: unknown,
  path = "$resourceRef",
): AgentResourceReference {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "uri",
      "name",
      "mimeType",
      "representation",
      "byteCount",
      "fingerprint",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    AGENT_RESOURCE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const uri = nonEmptyText(root.uri, `${path}.uri`);
  if (!AGENT_RESOURCE_URI_PATTERN.test(uri)) {
    throw new TypeError(
      `${path}.uri must be casys://agent-resource-capture/sha256/<digest>.`,
    );
  }
  if (root.representation !== "text" && root.representation !== "blob") {
    throw new TypeError(`${path}.representation must be text or blob.`);
  }
  if (
    typeof root.byteCount !== "number" ||
    !Number.isSafeInteger(root.byteCount) ||
    root.byteCount < 1 ||
    root.byteCount > AGENT_RESOURCE_MAX_BYTES
  ) {
    throw new TypeError(
      `${path}.byteCount must be an integer from 1 to ${AGENT_RESOURCE_MAX_BYTES}.`,
    );
  }
  const fingerprint = exactRecord(
    root.fingerprint,
    ["algorithm", "digest"],
    `${path}.fingerprint`,
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    `${path}.fingerprint.algorithm`,
  );
  const digest = nonEmptyText(fingerprint.digest, `${path}.fingerprint.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.fingerprint.digest must be lowercase sha256 hex.`);
  }
  const uriDigest = uri.slice(AGENT_RESOURCE_URI_PREFIX.length);
  if (uriDigest !== digest) {
    throw new TypeError(`${path}.uri digest does not match fingerprint.digest.`);
  }
  return {
    schemaVersion: AGENT_RESOURCE_CAPTURE_SCHEMA,
    uri,
    name: parseAgentResourceName(root.name, `${path}.name`),
    mimeType: parseAgentResourceMimeType(root.mimeType, `${path}.mimeType`),
    representation: root.representation,
    byteCount: root.byteCount,
    fingerprint: { algorithm: "sha256", digest },
  };
}

export function agentResourceReferencesEqual(
  left: AgentResourceReference,
  right: AgentResourceReference,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.uri === right.uri &&
    left.name === right.name &&
    left.mimeType === right.mimeType &&
    left.representation === right.representation &&
    left.byteCount === right.byteCount &&
    left.fingerprint.algorithm === right.fingerprint.algorithm &&
    left.fingerprint.digest === right.fingerprint.digest;
}
