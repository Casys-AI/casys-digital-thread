/**
 * Draft CAS identity of one captured agent resource and its closed review.
 *
 * Interpretation is optional and never grants Thread, MRTR or microVM
 * authority. Typed fingerprints come from existing domain-specific stores.
 */

import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { AgentResourceRepresentation } from "./agent-resource-envelope.ts";
import {
  AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA,
  AGENT_RESOURCE_CAPTURE_SCHEMA,
} from "./agent-resource-envelope.ts";

export interface AgentResourceReference {
  readonly schemaVersion: typeof AGENT_RESOURCE_CAPTURE_SCHEMA;
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly representation: AgentResourceRepresentation;
  readonly byteCount: number;
  readonly fingerprint: ContentFingerprint;
}

export type AgentResourceInterpretationStatus = "typed" | "raw" | "unresolved";

export interface AgentResourceTypedInterpretation {
  readonly schemaVersion: string;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface AgentResourceInterpretationDiagnostic {
  readonly code: "known-schema-invalid" | "interpretation-failed";
  readonly message: string;
}

export interface AgentResourceInterpretation {
  readonly status: AgentResourceInterpretationStatus;
  readonly schemaVersion: string | null;
  readonly typed?: AgentResourceTypedInterpretation;
  readonly diagnostics?: readonly AgentResourceInterpretationDiagnostic[];
}

export type AgentResourceCaptureReviewStatus = "captured" | "unresolved";

export interface AgentResourceCaptureReview {
  readonly schemaVersion: typeof AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA;
  readonly status: AgentResourceCaptureReviewStatus;
  readonly grants: "none";
  readonly reference: AgentResourceReference;
  readonly interpretation: AgentResourceInterpretation;
}

export function rawAgentResourceInterpretation(
  schemaVersion: string | null = null,
): AgentResourceInterpretation {
  return { status: "raw", schemaVersion };
}

export function unresolvedAgentResourceInterpretation(
  schemaVersion: string,
  diagnostic: AgentResourceInterpretationDiagnostic,
): AgentResourceInterpretation {
  return {
    status: "unresolved",
    schemaVersion,
    diagnostics: [diagnostic],
  };
}

export function typedAgentResourceInterpretation(
  typed: AgentResourceTypedInterpretation,
): AgentResourceInterpretation {
  return {
    status: "typed",
    schemaVersion: typed.schemaVersion,
    typed,
  };
}
