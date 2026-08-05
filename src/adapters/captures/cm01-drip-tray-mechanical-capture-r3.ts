import { sha256Fingerprint } from "../../domain/deterministic-json.ts";
import {
  type Cm01DripTrayMechanicalProofR3,
  parseCm01DripTrayMechanicalProofR3,
} from "../../domain/cm01-drip-tray-mechanical-proof.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";
import type { McpToolClient } from "../http-mcp-tool-client.ts";
import {
  captureCm01DripTrayMechanicalR2,
  type Cm01DripTrayMechanicalR2Capture,
  parseCm01DripTrayMechanicalR2Capture,
} from "./cm01-drip-tray-mechanical-capture-r2.ts";

/** Durable recovery capture: it is a new evidence contract, never an R2 replay. */
export const CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R3_SCHEMA =
  "cm01-v3-drip-tray-mechanical-capture/3.0" as const;
export const CM01_DRIP_TRAY_MECHANICAL_R3_PROOF_ID =
  "coffee-machine-cm01-v3-drip-tray-height-30-static-proof-r3" as const;

export interface Cm01DripTrayMechanicalR3Capture
  extends
    Omit<Cm01DripTrayMechanicalR2Capture, "schemaVersion" | "proofId" | "fingerprint"> {
  readonly schemaVersion: typeof CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R3_SCHEMA;
  readonly proofId: typeof CM01_DRIP_TRAY_MECHANICAL_R3_PROOF_ID;
  readonly fingerprint: ContentFingerprint;
}

/**
 * Calls the same isolated-only provider handoff as R2, but wraps it in a
 * separately fingerprinted R3 capture. R2's failed attempt store is never
 * read or written by this path; its execution receives distinct directories.
 */
export async function captureCm01DripTrayMechanicalR3(
  build123d: McpToolClient,
  calculix: McpToolClient,
  input: Cm01DripTrayMechanicalProofR3,
  now: () => string = () => new Date().toISOString(),
): Promise<Cm01DripTrayMechanicalR3Capture> {
  const proof = parseCm01DripTrayMechanicalProofR3(input);
  const r2 = await captureCm01DripTrayMechanicalR2(
    build123d,
    calculix,
    r2Equivalent(proof),
    now,
  );
  const unsigned = {
    ...r2,
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R3_SCHEMA,
    proofId: CM01_DRIP_TRAY_MECHANICAL_R3_PROOF_ID,
  };
  const { fingerprint: _fingerprint, ...withoutFingerprint } = unsigned;
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: await sha256Fingerprint(withoutFingerprint),
  });
}

export async function parseCm01DripTrayMechanicalR3Capture(
  value: unknown,
): Promise<Cm01DripTrayMechanicalR3Capture> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("CM-01 R3 mechanical capture must be an object.");
  }
  const root = value as Record<string, unknown>;
  if (
    root.schemaVersion !== CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R3_SCHEMA ||
    root.proofId !== CM01_DRIP_TRAY_MECHANICAL_R3_PROOF_ID
  ) throw new Error("CM-01 R3 mechanical capture has an unsupported contract.");
  const candidateWithoutFingerprint: Record<string, unknown> = {
    ...root,
    schemaVersion: "cm01-v3-drip-tray-mechanical-capture/2.0",
    proofId: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof",
  };
  const { fingerprint: _r3Fingerprint, ...r2Unsigned } = candidateWithoutFingerprint;
  const candidate = {
    ...r2Unsigned,
    fingerprint: await sha256Fingerprint(r2Unsigned),
  };
  const r2 = await parseCm01DripTrayMechanicalR2Capture(candidate);
  const { fingerprint: _old, ...withoutFingerprint } = {
    ...r2,
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R3_SCHEMA,
    proofId: CM01_DRIP_TRAY_MECHANICAL_R3_PROOF_ID,
  };
  const actual = await sha256Fingerprint(withoutFingerprint);
  const supplied = fingerprint(root.fingerprint);
  if (supplied.digest !== actual.digest) {
    throw new Error(
      "CM-01 R3 mechanical capture fingerprint does not match its content.",
    );
  }
  return Object.freeze({ ...withoutFingerprint, fingerprint: supplied });
}

function r2Equivalent(proof: Cm01DripTrayMechanicalProofR3) {
  return {
    ...proof,
    schemaVersion: "cm01-v3-drip-tray-static-proof/2.0" as const,
    id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof" as const,
  };
}

function fingerprint(value: unknown): ContentFingerprint {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (value as Record<string, unknown>).digest !== "string" ||
    !/^[a-f0-9]{64}$/.test((value as Record<string, unknown>).digest as string)
  ) throw new Error("CM-01 R3 mechanical capture fingerprint must be a SHA-256.");
  return {
    algorithm: "sha256",
    digest: (value as Record<string, unknown>).digest as string,
  };
}
