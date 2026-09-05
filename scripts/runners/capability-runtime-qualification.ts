/**
 * Private local operator CLI for Chrono runtime qualification.
 * It is not registered as an MCP operation and refuses provider, image,
 * digest, platform, mode, URL, tool, token, project, MRTR and Thread inputs.
 */

import {
  CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
} from "../../src/adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import {
  createLocalCapabilityRuntimeQualificationComposition,
} from "../../src/adapters/control-plane/local-capability-runtime-qualification-composition.ts";

const FORBIDDEN_FLAGS = [
  "provider",
  "image",
  "digest",
  "platform",
  "mode",
  "url",
  "tool",
  "token",
  "project",
  "project-id",
  "mrtr",
  "thread",
  "endpoint",
  "args",
  "binding",
  "unit-id",
  "launch-group-id",
] as const;

export interface CapabilityRuntimeQualificationCliRequest {
  readonly command: "review" | "apply" | "recover";
  readonly candidate: typeof CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID;
  readonly reviewFingerprint?: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly confirm: boolean;
}

export function parseCapabilityRuntimeQualificationCli(
  args: readonly string[],
): CapabilityRuntimeQualificationCliRequest {
  const [command, ...rest] = args;
  if (command !== "review" && command !== "apply" && command !== "recover") {
    throw new Error(
      "Usage: capability-runtime-qualification <review|apply|recover> " +
        "--candidate=chrono-arm64-emulation-v1 [--review-fingerprint=<sha256>] " +
        "[--confirm]",
    );
  }
  const flags = parseFlags(rest);
  assertAllowedFlags(command, flags);
  const candidate = required(flags, "candidate");
  if (candidate !== CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID) {
    throw new Error(
      "Capability runtime qualification accepts only the code-owned chrono-arm64-emulation-v1 candidate.",
    );
  }
  if (command === "review" || command === "recover") {
    return { command, candidate, confirm: false };
  }
  return {
    command,
    candidate,
    reviewFingerprint: fingerprint(flags, "review-fingerprint"),
    confirm: confirmed(flags),
  };
}

if (import.meta.main) {
  const request = parseCapabilityRuntimeQualificationCli(Deno.args);
  const service = await createLocalCapabilityRuntimeQualificationComposition();
  switch (request.command) {
    case "review":
      print(await service.review(request.candidate));
      break;
    case "apply":
      print(
        await service.apply(
          request.candidate,
          request.reviewFingerprint!,
          request.confirm,
        ),
      );
      break;
    case "recover":
      print(await service.recover(request.candidate));
      break;
  }
}

function parseFlags(values: readonly string[]): ReadonlyMap<string, string | true> {
  const result = new Map<string, string | true>();
  for (const value of values) {
    if (!value.startsWith("--")) {
      throw new Error(`Unsupported capability qualification argument ${value}.`);
    }
    const [name, ...rest] = value.slice(2).split("=");
    if (!name || result.has(name)) {
      throw new Error(`Invalid repeated capability qualification flag ${value}.`);
    }
    if (
      FORBIDDEN_FLAGS.includes(name as typeof FORBIDDEN_FLAGS[number]) ||
      /provider|image|digest|platform|mode|url|tool|token|project|mrtr|thread/i
        .test(name)
    ) {
      throw new Error(
        `--${name} is refused: capability qualification does not accept ` +
          "provider, image, digest, platform, mode, URL, tool, token, " +
          "project, MRTR or Thread inputs.",
      );
    }
    result.set(name, rest.length === 0 ? true : rest.join("="));
  }
  return result;
}

function assertAllowedFlags(
  command: "review" | "apply" | "recover",
  flags: ReadonlyMap<string, string | true>,
): void {
  const allowed = new Set<string>(
    command === "apply"
      ? ["candidate", "review-fingerprint", "confirm"]
      : ["candidate"],
  );
  for (const name of flags.keys()) {
    if (!allowed.has(name)) {
      throw new Error(
        `--${name} is not valid for capability qualification ${command}.`,
      );
    }
  }
}

function required(flags: ReadonlyMap<string, string | true>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name}=... is required.`);
  }
  return value;
}

function fingerprint(flags: ReadonlyMap<string, string | true>, name: string) {
  const digest = required(flags, name);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`--${name} must be one SHA-256 digest.`);
  }
  return { algorithm: "sha256" as const, digest };
}

function confirmed(flags: ReadonlyMap<string, string | true>): boolean {
  return flags.get("confirm") === true;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
