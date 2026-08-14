/** One code-owned ProjectBrief source shared by both spike compilers. */

import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

export const INTEGRATED_SUPPORT_BLOCK_BRIEF = Object.freeze({
  contractVersion: "2.0" as const,
  briefId: "generic-support:brief",
  id: "generic-support-brief-revision-1",
  revision: 1,
  items: Object.freeze([
    Object.freeze({
      id: "architecture",
      kind: "objective",
      statement: "Create a generic support architecture around one SupportBlock.",
      sourceRefs: Object.freeze([Object.freeze({
        kind: "intent",
        reference: "conversation:admission-spike",
      })]),
    }),
    Object.freeze({
      id: "system",
      kind: "mission-scenario",
      statement:
        "Exercise the bounded engineering admission chain for GenericSupportSystem.",
      sourceRefs: Object.freeze([Object.freeze({
        kind: "intent",
        reference: "conversation:admission-spike",
      })]),
    }),
    Object.freeze({
      id: "support-block",
      kind: "constraint",
      statement: "The bounded fixture contains one 20 mm SupportBlock cube.",
      sourceRefs: Object.freeze([Object.freeze({
        kind: "document",
        reference: "spike:code-owned-support-block-fixture",
      })]),
    }),
    Object.freeze({
      id: "mechanical-verification",
      kind: "verification-activity",
      statement: "Run one linear-static mechanical provider-conformance proof.",
      sourceRefs: Object.freeze([Object.freeze({
        kind: "document",
        reference: "spike:code-owned-mechanical-recipe",
      })]),
      dependsOnItemIds: Object.freeze(["architecture", "system", "support-block"]),
    }),
    Object.freeze({
      id: "max-displacement",
      kind: "success-criterion",
      statement: "Maximum SupportBlock displacement is at most 2 mm.",
      sourceRefs: Object.freeze([Object.freeze({
        kind: "intent",
        reference: "conversation:admission-spike",
      })]),
      dependsOnItemIds: Object.freeze(["support-block", "mechanical-verification"]),
    }),
    Object.freeze({
      id: "max-von-mises",
      kind: "success-criterion",
      statement: "Maximum SupportBlock von Mises stress is at most 100 MPa.",
      sourceRefs: Object.freeze([Object.freeze({
        kind: "intent",
        reference: "conversation:admission-spike",
      })]),
      dependsOnItemIds: Object.freeze(["support-block", "mechanical-verification"]),
    }),
  ]),
  proposedAt: "2026-08-13T05:00:00.000Z",
  proposedBy: Object.freeze({ id: "agent:admission-spike", origin: "agent" as const }),
});

export const INTEGRATED_SUPPORT_BLOCK_BRIEF_SOURCE_TEXT = deterministicJson(
  INTEGRATED_SUPPORT_BLOCK_BRIEF,
);
