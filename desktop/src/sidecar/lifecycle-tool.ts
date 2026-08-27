import {
  DESKTOP_LIFECYCLE_TOOL_NAME,
  LIFECYCLE_SCHEMA,
  type LifecycleIdentity,
  PRODUCT_VERSION,
  SERVER_VERSION,
} from "./contracts.ts";

export const DESKTOP_LIFECYCLE_TOOL = Object.freeze({
  name: DESKTOP_LIFECYCLE_TOOL_NAME,
  description:
    "Read the exact Desktop-owned control-plane lifecycle identity. This tool is read-only and grants no command, provider, or filesystem authority.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      schema: { type: "string", const: LIFECYCLE_SCHEMA },
      productVersion: { type: "string", const: PRODUCT_VERSION },
      serverVersion: { type: "string", const: SERVER_VERSION },
      launchId: {
        type: "string",
        pattern:
          "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      },
      configDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
      },
    },
    required: [
      "schema",
      "productVersion",
      "serverVersion",
      "launchId",
      "configDigest",
    ],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

export function createLifecycleIdentity(
  launchId: string,
  configDigest: string,
): LifecycleIdentity {
  return {
    schema: LIFECYCLE_SCHEMA,
    productVersion: PRODUCT_VERSION,
    serverVersion: SERVER_VERSION,
    launchId,
    configDigest,
  };
}

export function lifecycleToolResult(identity: LifecycleIdentity) {
  return {
    content: "Desktop control-plane lifecycle identity observed.",
    structuredContent: identity,
  };
}
