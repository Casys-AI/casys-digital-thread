import pins from "../../chat-runtime/pins.json" with { type: "json" };
import type { DesktopPlatform } from "../host/mod.ts";

export type ChatHostTarget = keyof typeof pins.targets;
export type ChatHostImplementedTarget = "darwin-arm64";

export interface ChatHostTargetArtifacts {
  readonly target: ChatHostImplementedTarget;
  readonly nodeArchive: string;
  readonly nodeArchiveSha256: string;
  readonly nodeBinarySha256: string;
  readonly acpxLifelineSha256: string;
  readonly codexPackage: string;
  readonly codexPackageIntegrity: string;
  readonly codexBinaryPath: string;
  readonly codexBinarySha256: string;
}

export function chatHostTarget(
  platform: DesktopPlatform,
  arch: "aarch64" | "x86_64",
): ChatHostTarget {
  if (platform === "macOS" && arch === "aarch64") return "darwin-arm64";
  if (platform === "Linux" && arch === "x86_64") return "linux-x64";
  if (platform === "Windows" && arch === "x86_64") return "windows-x64";
  throw new Error(`Chat Host target is not modelled for ${platform}/${arch}.`);
}

export function resolveTargetArtifacts(
  target: ChatHostTarget,
): ChatHostTargetArtifacts {
  if (target !== "darwin-arm64") {
    throw new Error(`Chat Host target ${target} has no packaged artifact pins.`);
  }
  const targetPins = pins.targets[target];
  if (targetPins.status !== "implemented-tested") {
    throw new Error(`Chat Host target ${target} has no packaged artifact pins.`);
  }
  return { target, ...targetPins };
}

export function parseImplementedTarget(value: unknown): ChatHostImplementedTarget {
  if (value !== "darwin-arm64") {
    throw new TypeError("Packaged Chat Host target is unsupported or unpinned");
  }
  resolveTargetArtifacts(value);
  return value;
}
