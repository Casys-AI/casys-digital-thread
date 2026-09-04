import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectAdmittedSpiceRunReviewRequest,
  ProjectAdmittedSpiceRunReviewUseCase,
} from "../../application/ports/in/electrical/spice/admitted-run-review.ts";
import type {
  ProjectElectricalObservationMethodSheetSealReviewCommand,
  ProjectElectricalObservationMethodSheetSealReviewUseCase,
} from "../../application/ports/in/electrical/observation-method-sheet/project-electrical-observation-method-sheet-seal-review.ts";
import type {
  ProjectAdmittedSpiceEvaluationReviewRequest,
  ProjectAdmittedSpiceEvaluationReviewUseCase,
} from "../../application/ports/in/electrical/spice/evaluation/project-admitted-spice-evaluation-review.ts";
import type {
  ProjectAdmittedSpiceEvaluationCloseoutReviewUseCase,
} from "../../application/ports/in/electrical/spice/evaluation/project-admitted-spice-evaluation-closeout-review.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectSpiceReviewToolDependencies {
  /** Provider-free preparation of one admitted SPICE execution review. */
  admittedSpiceRunReview?: ProjectAdmittedSpiceRunReviewUseCase;
  /** Provider-free preparation of one electrical method-sheet seal review. */
  electricalObservationMethodSheetSealReview?:
    ProjectElectricalObservationMethodSheetSealReviewUseCase;
  /** Provider-free preparation of one admitted SPICE observation evaluation. */
  admittedSpiceEvaluationReview?: ProjectAdmittedSpiceEvaluationReviewUseCase;
  /** Provider-free preparation of one human L5 closeout review. */
  admittedSpiceEvaluationCloseoutReview?:
    ProjectAdmittedSpiceEvaluationCloseoutReviewUseCase;
}

/** Register the provider-free SPICE review surfaces. */
export function registerProjectSpiceReviewTools(
  app: McpApp,
  dependencies: ProjectSpiceReviewToolDependencies,
): void {
  if (dependencies.admittedSpiceRunReview) {
    const review = dependencies.admittedSpiceRunReview;
    app.registerTool(projectAdmittedSpiceRunReviewTool, async (args) => {
      const command = admittedSpiceRunReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          "Admitted SPICE execution review for the unique fresh sealed SPICE admission on the current Thread tip was prepared from exact server-reopened facts. Reuse the returned operation and its compilationAdmission binding verbatim on the later work item; do not reconstruct that thread-entity reference from a historical compile.seal-admission@3 creation snapshot. The returned admission, decisionParameters and operation are review material only: they contain no source bytes or runtime capability, no code was executed, and no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority was created. This is not mcp-spice and not the LED-driver fiche.",
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }

  if (dependencies.admittedSpiceEvaluationReview) {
    const review = dependencies.admittedSpiceEvaluationReview;
    app.registerTool(projectAdmittedSpiceEvaluationReviewTool, async (args) => {
      const command = admittedSpiceEvaluationReviewCommand(args);
      const result = await review.execute(command);
      return {
        content:
          "Admitted SPICE observation evaluation review was prepared from the unique Thread tip, sealed electrical method sheet and admitted evidence. The returned admission and decisionParameters are review material only: they contain no SPICE source bytes, no ngspice capability, no SysON envelope, no EngineeringProject or Thread state, and no L4 verdict. Construct a later verify.evaluate-admitted-spice-observations@1 proposal only from decisionParameters.",
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }

  if (dependencies.admittedSpiceEvaluationCloseoutReview) {
    const review = dependencies.admittedSpiceEvaluationCloseoutReview;
    app.registerTool(
      projectAdmittedSpiceEvaluationCloseoutReviewTool,
      async (args) => {
        const command = admittedSpiceEvaluationCloseoutReviewCommand(args);
        const result = await review.execute(command);
        const content = result.status === "resolved"
          ? "Admitted SPICE evaluation closeout review was prepared from the unique current L4 document. Both accept and reject decisionParameters name the same exact project, subject, Thread basis, sheet and capture; they differ only in the declared human consequence. An L4 pass is never implicit L5. This provider-free read performed no ngspice or SysON call and mutated no EngineeringProject or Thread state."
          : result.status === "unavailable"
          ? "Unavailable: the unique current L4 admitted SPICE evaluation cannot be reopened. No human closeout parameters were generated."
          : "Unresolved: current L4 closeout evidence is ambiguous, noncanonical, or has divergent provenance. No human closeout parameters were generated.";
        return {
          content,
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
  }

  if (dependencies.electricalObservationMethodSheetSealReview) {
    const review = dependencies.electricalObservationMethodSheetSealReview;
    app.registerTool(
      projectElectricalObservationMethodSheetSealReviewTool,
      async (args) => {
        const command = electricalObservationMethodSheetSealReviewCommand(args);
        const result = await review.execute(command);
        return {
          content: result.mode === "preparation"
            ? "Resolved the exact current admitted SPICE L3 authoring basis. Copy methodSheet into the agent-authored electrical-observation-method-sheet/1.0 resource, use only the displayed literal observation names/values/units and limitations as facts, and author human-sourced criteria separately. After project_resource_capture interprets the completed sheet, call this review again with its exact typed fingerprint. No threshold or verdict was invented; no provider, runtime, source bytes, project write, Thread write, MRTR proposal, approval or dispatch occurred."
            : "Electrical observation method-sheet seal review for the named sheet fingerprint was prepared from exact server-reopened identities. The returned admission and decisionParameters are review material only: they contain no SPICE source bytes, no ngspice capability, no EngineeringProject or Thread state, no MRTR decision, and no provider or dispatch authority. This is not an admitted run and not an L4 evaluation.",
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
  }
}

const TECHNICAL_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const projectAdmittedSpiceEvaluationCloseoutReviewTool: MCPTool = {
  name: "project_admitted_spice_evaluation_closeout_review",
  description:
    "Prepare the exact human-review identities and canonical MRTR parameters for one later decide.accept-admitted-spice-evaluation@1 or decide.reject-admitted-spice-evaluation@1 closeout. The caller names only projectId. The server reopens the unique current Thread tip and the unique fresh non-archived L4 document produced by verify.evaluate-admitted-spice-observations@1, plus the exact method sheet and selected L3 run/capture/evidence/result. Both accept and reject parameters are always derived from those exact identities; L4 pass/fail/unresolved/error stay literal and never imply a closeout. This provider-free read performs no ngspice or SysON call, mutates no EngineeringProject or Thread state, and grants no CAD, correction, rerun or provider action.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectAdmittedSpiceEvaluationReviewTool: MCPTool = {
  name: "project_admitted_spice_evaluation_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one later verify.evaluate-admitted-spice-observations@1 evaluation. The caller names only projectId. The server reopens the unique current Thread tip, unique sealed electrical observation method sheet, and unique admitted SPICE evidence. This provider-free read performs no ngspice or SysON call, returns no source bytes or observation values as caller authority, mutates no EngineeringProject or Thread state, and grants no MRTR or L4 verdict. Values, units, native names, provider, tool and args remain server-owned.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectElectricalObservationMethodSheetSealReviewTool: MCPTool = {
  name: "project_electrical_observation_method_sheet_seal_review",
  description:
    "Read-only preparation/review for verify.seal-electrical-observation-method-sheet@1. With projectId alone, the server reopens the unique current completed simulate.run-admitted-spice@1 branch and returns its exact Thread basis fingerprint, capture/evidence/result identities, approved Brief item identities, literal native observation names/values/units, and L3 limitations so the agent can author the method resource without reading host state. With sheetFingerprint, it reopens the typed electrical-observation-method-sheet/1.0 and recrosses its brief gates, selected L3 identities and current Thread basis before returning canonical MRTR parameters. Neither mode invents thresholds or verdicts. Provider, runtime, image, endpoint, source bytes, args and caller observations are refused; no ngspice execution, project/Thread mutation, MRTR, evaluation or dispatch occurs.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
      sheetFingerprint: FINGERPRINT_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectAdmittedSpiceRunReviewTool: MCPTool = {
  name: "project_admitted_spice_run_review",
  description:
    "Prepare the exact human-review identity, canonical MRTR parameters, and registered work-item operation for one future admitted SPICE closed-subset operating-point execution. The caller names only projectId; the server reopens the unique current Thread tip, selects its unique fresh non-archived canonical digital-thread compile.seal-admission@3 document whose compilation target/source is spice-circuit-source, and joins it to the server-owned execution profile. Reuse the returned operation verbatim: compilationAdmission is that selected admission artifact on the current review Thread basis, never a historical creation snapshot. Concurrent CAD or Modelica admissions are not candidates. Missing, stale, archived, malformed, foreign-producer, CAD-only, Modelica-only, or ambiguous SPICE admissions fail closed. This provider-free read performs no code execution, returns no source bytes or runtime capability, mutates no EngineeringProject or Thread state, and grants no MRTR, provider, or dispatch authority. SPICE text, Thread and artifact identities, runtime, isolation, output, profile, command, tool, image, path, observations and transport facts remain server-owned. This is not mcp-spice and not project_led_driver_source_capture.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: TECHNICAL_ID_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

function admittedSpiceEvaluationCloseoutReviewCommand(
  value: Record<string, unknown>,
): { readonly projectId: string } {
  exactKeys(
    value,
    ["projectId"],
    [],
    "admittedSpiceEvaluationCloseoutReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
  };
}

function admittedSpiceEvaluationReviewCommand(
  value: Record<string, unknown>,
): ProjectAdmittedSpiceEvaluationReviewRequest {
  exactKeys(
    value,
    ["projectId"],
    [],
    "admittedSpiceEvaluationReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
  };
}

function electricalObservationMethodSheetSealReviewCommand(
  value: Record<string, unknown>,
): ProjectElectricalObservationMethodSheetSealReviewCommand {
  const includesSheet = "sheetFingerprint" in value;
  exactKeys(
    value,
    includesSheet ? ["projectId", "sheetFingerprint"] : ["projectId"],
    [],
    "electricalObservationMethodSheetSealReview",
  );
  const projectId = technicalId(value.projectId, "projectId");
  return includesSheet
    ? {
      projectId,
      sheetFingerprint: fingerprintInput(
        value.sheetFingerprint,
        "sheetFingerprint",
      ),
    }
    : { projectId };
}

function fingerprintInput(value: unknown, name: string) {
  const record = exactRecord(value, name);
  exactKeys(record, ["algorithm", "digest"], [], name);
  if (record.algorithm !== "sha256") {
    throw new TypeError(`${name}.algorithm must be sha256`);
  }
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) {
    throw new TypeError(`${name}.digest must be 64 lowercase hex characters`);
  }
  return { algorithm: "sha256" as const, digest: record.digest };
}

function exactRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function admittedSpiceRunReviewCommand(
  value: Record<string, unknown>,
): ProjectAdmittedSpiceRunReviewRequest {
  exactKeys(
    value,
    ["projectId"],
    [],
    "admittedSpiceRunReview",
  );
  return {
    projectId: technicalId(value.projectId, "projectId"),
  };
}

function technicalId(value: unknown, name: string): string {
  const id = exactNonEmptyText(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id)) {
    throw new TypeError(`${name} must be a stable technical identifier`);
  }
  return id;
}

function exactNonEmptyText(value: unknown, name: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim()
  ) {
    throw new TypeError(`${name} must be non-empty without edge whitespace`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(`${name} has unsupported field(s): ${extras.join(", ")}`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing field(s): ${missing.join(", ")}`);
  }
}
