/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import type {
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import type {
  OperatorCommandCapabilities,
  ProjectCommandIntent,
  ProjectOperatorCommand,
} from "./command-contract.ts";
import {
  approvalMatchesDecisionScope,
  canQueueWorkItem,
  decisionApprovals,
  type DecisionParameterDraft,
  emptyDecisionParameterDraft,
  proposalFromDraft,
  unavailableCommandReason,
} from "./control-model.ts";

export interface ProjectCommandFeedback {
  readonly state: "idle" | "submitting" | "success" | "conflict" | "error";
  readonly commandKey?: string;
  readonly message?: string;
}

export interface ProjectControlProps {
  readonly project: EngineeringProjectSnapshot;
  readonly capability?: OperatorCommandCapabilities;
  readonly actorId: string;
  readonly onActorIdChange: (value: string) => void;
  readonly feedback: ProjectCommandFeedback;
  readonly onCommand: (
    commandKey: string,
    command: ProjectOperatorCommand,
  ) => Promise<void>;
}

export function DecisionCenter(props: ProjectControlProps): JSX.Element {
  const { project, capability, feedback } = props;
  const approved =
    project.decisions.filter((decision) => decision.status === "approved")
      .length;
  const readyItems = project.workItems.filter((item) =>
    canQueueWorkItem(project, item)
  );
  const commandsEnabled = capability?.enabled === true;

  return (
    <section class="decision-center" aria-labelledby="decision-center-title">
      <header class="decision-center-header">
        <div class="decision-center-index" aria-hidden="true">DC</div>
        <div>
          <p>HUMAN CONTROL GATE</p>
          <h3 id="decision-center-title">Decision Center</h3>
          <span>
            Review the exact proposal and its technical input scope before an
            agent run can enter the queue.
          </span>
        </div>
        <div
          class="decision-center-meter"
          data-complete={approved === project.decisions.length}
        >
          <strong>{approved}/{project.decisions.length}</strong>
          <span>approved</span>
        </div>
      </header>

      <OperatorIdentity
        actorId={props.actorId}
        onChange={props.onActorIdChange}
        enabled={commandsEnabled}
      />

      {!commandsEnabled && (
        <div class="decision-readonly-notice" role="status">
          <i aria-hidden="true" />
          <div>
            <strong>Read-only project surface</strong>
            <span>
              This source did not grant operator commands. Decisions and runs
              remain inspectable, but controls cannot mutate project truth.
            </span>
          </div>
        </div>
      )}

      {feedback.state !== "idle" && feedback.message && (
        <div
          class="decision-command-feedback"
          data-state={feedback.state}
          role={feedback.state === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <i aria-hidden="true" />
          <span>{feedback.message}</span>
        </div>
      )}

      {project.decisions.length
        ? (
          <ol class="decision-list">
            {project.decisions.map((decision, index) => (
              <li key={decision.id}>
                <DecisionCard
                  {...props}
                  decision={decision}
                  sequence={index + 1}
                />
              </li>
            ))}
          </ol>
        )
        : (
          <p class="decision-center-empty">
            No human decision gate is declared for this project.
          </p>
        )}

      {readyItems.length > 0 && (
        <section class="decision-queue-gate" aria-labelledby="queue-gate-title">
          <header>
            <span aria-hidden="true">✓</span>
            <div>
              <p>APPROVAL GATE SATISFIED</p>
              <h4 id="queue-gate-title">
                Release reviewed work to the agent queue
              </h4>
              <small>
                Queueing is the only human lifecycle action. Agents own claim,
                execution, publication and completion.
              </small>
            </div>
          </header>
          {readyItems.map((item) => (
            <QueueWorkItemControl key={item.id} {...props} item={item} />
          ))}
        </section>
      )}
    </section>
  );
}

export function OperatorIdentity({ actorId, onChange, enabled }: {
  actorId: string;
  onChange: (value: string) => void;
  enabled: boolean;
}): JSX.Element {
  return (
    <div class="decision-operator">
      <label>
        <span>LOCAL OPERATOR IDENTITY</span>
        <input
          type="text"
          value={actorId}
          onInput={(event) => onChange(event.currentTarget.value)}
          placeholder="Enter your name or operator ID"
          autocomplete="off"
          disabled={!enabled}
        />
      </label>
      <div>
        <strong>Self-declared · not authenticated</strong>
        <span>
          The identity is written to the audit record. This prototype does not
          prove who controls the browser.
        </span>
      </div>
    </div>
  );
}

function DecisionCard(
  props: ProjectControlProps & {
    decision: EngineeringDecision;
    sequence: number;
  },
): JSX.Element {
  const { project, decision, sequence, capability, feedback } = props;
  const phase = project.phases.find((candidate) =>
    candidate.id === decision.phaseId
  );
  const approvals = decisionApprovals(project, decision);
  const proposal = decision.proposal;
  const isBusy = feedback.state === "submitting";
  const isCurrentBusy = feedback.commandKey?.includes(decision.id) === true;

  return (
    <details
      class="decision-card"
      data-state={decision.status}
      open={decision.status === "proposed" || decision.status === "rejected" ||
        (decision.status === "required" && sequence === 1)}
    >
      <summary>
        <span class="decision-sequence">
          {String(sequence).padStart(2, "0")}
        </span>
        <div>
          <small>{phase?.name ?? decision.phaseId}</small>
          <strong>{decision.title}</strong>
        </div>
        <b>{decision.status}</b>
        <i aria-hidden="true">⌄</i>
      </summary>
      <div class="decision-card-body" aria-busy={isCurrentBusy}>
        <div class="decision-question">
          <span>CONTROL QUESTION</span>
          <blockquote>{decision.question}</blockquote>
          <small>Requested {formatDateTime(decision.requestedAt)}</small>
        </div>

        <DecisionScope decision={decision} approvals={approvals} />

        {proposal && <RecordedProposal decision={decision} />}

        {(!proposal || decision.status === "rejected") && (
          <ProposalForm
            decision={decision}
            revised={decision.status === "rejected"}
            actorId={props.actorId}
            enabled={capability?.enabled === true}
            allowedIntents={capability?.intents ?? []}
            busy={isBusy}
            onSubmit={(command) =>
              props.onCommand(`propose:${decision.id}`, command)}
          />
        )}

        {decision.status === "proposed" && proposal && (
          <DecisionReviewForm
            decision={decision}
            actorId={props.actorId}
            enabled={capability?.enabled === true}
            allowedIntents={capability?.intents ?? []}
            busy={isBusy}
            onSubmit={(command) =>
              props.onCommand(`${command.type}:${decision.id}`, command)}
          />
        )}

        {approvals.length > 0 && (
          <ApprovalJournal decision={decision} approvals={approvals} />
        )}
      </div>
    </details>
  );
}

function DecisionScope({ decision, approvals }: {
  decision: EngineeringDecision;
  approvals: readonly EngineeringApproval[];
}): JSX.Element {
  const matchingApprovals =
    approvals.filter((approval) =>
      approvalMatchesDecisionScope(decision, approval)
    )
      .length;
  return (
    <section class="decision-scope" aria-label="Exact decision input scope">
      <header>
        <span>EXACT INPUT SCOPE</span>
        <b data-state={decision.inputFingerprint ? "anchored" : "pending"}>
          {decision.inputFingerprint ? "fingerprinted" : "awaiting proposal"}
        </b>
      </header>
      <dl>
        <div>
          <dt>Base snapshot</dt>
          <dd>
            {decision.baseSnapshot
              ? `${decision.baseSnapshot.snapshotId}@${decision.baseSnapshot.revision}`
              : "Assigned by the server when proposed"}
          </dd>
        </div>
        <div>
          <dt>Input fingerprint</dt>
          <dd>
            {decision.inputFingerprint
              ? <code>{shortHash(decision.inputFingerprint.digest)}</code>
              : "Not recorded yet"}
          </dd>
        </div>
        <div>
          <dt>Approval scope</dt>
          <dd>
            {approvals.length
              ? `${matchingApprovals}/${approvals.length} exact matches`
              : "No review recorded"}
          </dd>
        </div>
      </dl>
      <details>
        <summary>
          {decision.inputEvidenceRefs.length} exact evidence reference
          {decision.inputEvidenceRefs.length === 1 ? "" : "s"}
        </summary>
        {decision.inputEvidenceRefs.length
          ? (
            <ul>
              {decision.inputEvidenceRefs.map((reference) => (
                <li
                  key={`${reference.snapshotId}:${reference.kind}:${reference.id}`}
                >
                  <code>{reference.kind}:{reference.id}</code>
                  <span>
                    {reference.snapshotId}@{reference.snapshotRevision}
                  </span>
                </li>
              ))}
            </ul>
          )
          : <p>No technical evidence reference is attached.</p>}
      </details>
    </section>
  );
}

function RecordedProposal({ decision }: {
  decision: EngineeringDecision;
}): JSX.Element | null {
  const proposal = decision.proposal;
  if (!proposal) return null;
  return (
    <section class="decision-proposal-record" aria-label="Recorded proposal">
      <header>
        <span>RECORDED PROPOSAL</span>
        <small>
          {proposal.proposedBy.id} · {formatDateTime(proposal.proposedAt)}
        </small>
      </header>
      <p>{proposal.summary}</p>
      <dl>
        {proposal.parameters.map((parameter) => (
          <div key={parameter.key}>
            <dt>{parameter.label}</dt>
            <dd>
              <code>{formatProposalValue(parameter.value)}</code>
              {parameter.unit && <span>{parameter.unit}</span>}
            </dd>
            <small>{parameter.key}</small>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ProposalForm({
  decision,
  revised,
  actorId,
  enabled,
  allowedIntents,
  busy,
  onSubmit,
}: {
  decision: EngineeringDecision;
  revised: boolean;
  actorId: string;
  enabled: boolean;
  allowedIntents: readonly ProjectCommandIntent[];
  busy: boolean;
  onSubmit: (command: ProjectOperatorCommand) => Promise<void>;
}): JSX.Element {
  const nextParameter = useRef(2);
  const [summary, setSummary] = useState("");
  const [parameters, setParameters] = useState<DecisionParameterDraft[]>([
    emptyDecisionParameterDraft("parameter-1"),
  ]);
  const [formError, setFormError] = useState<string>();
  const unavailable = unavailableCommandReason({
    enabled,
    intent: "decision.propose",
    allowedIntents,
    actorId,
    busy,
  });

  const updateParameter = (
    id: string,
    patch: Partial<DecisionParameterDraft>,
  ) => {
    setParameters((current) =>
      current.map((parameter) =>
        parameter.id === id
          ? {
            ...parameter,
            ...patch,
            ...(patch.valueType && patch.valueType !== "number"
              ? { unit: "" }
              : {}),
          }
          : parameter
      )
    );
  };

  const submit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(undefined);
    const result = proposalFromDraft(summary, parameters);
    if (!result.proposal) {
      setFormError(result.error ?? "The proposal is incomplete.");
      return;
    }
    if (unavailable) return;
    await onSubmit({
      type: "decision.propose",
      decisionId: decision.id,
      proposal: result.proposal,
    });
  };

  return (
    <form class="decision-proposal-form" onSubmit={submit}>
      <header>
        <div>
          <span>{revised ? "REVISED PROPOSAL" : "STRUCTURED PROPOSAL"}</span>
          <strong>
            {revised
              ? "Replace the rejected inputs — no value is assumed"
              : "Enter reviewed inputs — no value is assumed"}
          </strong>
        </div>
        <small>Manual input required</small>
      </header>
      <label class="decision-field is-summary">
        <span>Proposal summary</span>
        <textarea
          value={summary}
          onInput={(event) => setSummary(event.currentTarget.value)}
          placeholder="Explain the reviewed input and why it is appropriate"
          rows={2}
          disabled={!enabled || busy}
          required
        />
      </label>
      <div class="decision-parameter-stack">
        {parameters.map((parameter, index) => (
          <fieldset key={parameter.id}>
            <legend>Parameter {index + 1}</legend>
            <label class="decision-field">
              <span>Key</span>
              <input
                value={parameter.key}
                onInput={(event) =>
                  updateParameter(parameter.id, {
                    key: event.currentTarget.value,
                  })}
                placeholder="machine_readable_key"
                disabled={!enabled || busy}
                required
              />
            </label>
            <label class="decision-field">
              <span>Label</span>
              <input
                value={parameter.label}
                onInput={(event) =>
                  updateParameter(parameter.id, {
                    label: event.currentTarget.value,
                  })}
                placeholder="Human-readable label"
                disabled={!enabled || busy}
                required
              />
            </label>
            <label class="decision-field is-type">
              <span>Type</span>
              <select
                value={parameter.valueType}
                onChange={(event) =>
                  updateParameter(parameter.id, {
                    valueType: event.currentTarget
                      .value as DecisionParameterDraft["valueType"],
                    value: "",
                  })}
                disabled={!enabled || busy}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
              </select>
            </label>
            <label class="decision-field is-value">
              <span>Value</span>
              {parameter.valueType === "boolean"
                ? (
                  <select
                    value={parameter.value}
                    onChange={(event) =>
                      updateParameter(parameter.id, {
                        value: event.currentTarget.value,
                      })}
                    disabled={!enabled || busy}
                    required
                  >
                    <option value="" disabled>Select true or false</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                )
                : (
                  <input
                    type={parameter.valueType === "number" ? "number" : "text"}
                    step={parameter.valueType === "number" ? "any" : undefined}
                    value={parameter.value}
                    onInput={(event) =>
                      updateParameter(parameter.id, {
                        value: event.currentTarget.value,
                      })}
                    placeholder={parameter.valueType === "number"
                      ? "Enter a reviewed number"
                      : "Enter a reviewed value"}
                    disabled={!enabled || busy}
                    required
                  />
                )}
            </label>
            {parameter.valueType === "number" && (
              <label class="decision-field is-unit">
                <span>Unit</span>
                <input
                  value={parameter.unit}
                  onInput={(event) =>
                    updateParameter(parameter.id, {
                      unit: event.currentTarget.value,
                    })}
                  placeholder="Optional"
                  disabled={!enabled || busy}
                />
              </label>
            )}
            {parameters.length > 1 && (
              <button
                type="button"
                class="decision-remove-parameter"
                onClick={() =>
                  setParameters((current) =>
                    current.filter((candidate) => candidate.id !== parameter.id)
                  )}
                disabled={!enabled || busy}
                aria-label={`Remove parameter ${index + 1}`}
              >
                ×
              </button>
            )}
          </fieldset>
        ))}
      </div>
      <div class="decision-form-actions">
        <button
          type="button"
          class="decision-secondary-button"
          onClick={() => {
            const id = `parameter-${nextParameter.current++}`;
            setParameters((current) => [
              ...current,
              emptyDecisionParameterDraft(id),
            ]);
          }}
          disabled={!enabled || busy}
        >
          + Add parameter
        </button>
        <button
          type="submit"
          class="decision-primary-button"
          disabled={!!unavailable}
          title={unavailable}
        >
          {busy
            ? "Applying…"
            : revised
            ? "Record revised proposal"
            : "Record proposal"}
        </button>
      </div>
      {formError && <p class="decision-form-error" role="alert">{formError}</p>}
      {unavailable && !formError && (
        <p class="decision-form-hint">{unavailable}</p>
      )}
    </form>
  );
}

function DecisionReviewForm({
  decision,
  actorId,
  enabled,
  allowedIntents,
  busy,
  onSubmit,
}: {
  decision: EngineeringDecision;
  actorId: string;
  enabled: boolean;
  allowedIntents: readonly ProjectCommandIntent[];
  busy: boolean;
  onSubmit: (command: ProjectOperatorCommand) => Promise<void>;
}): JSX.Element {
  const [rationale, setRationale] = useState("");
  const [formError, setFormError] = useState<string>();

  const submit = async (intent: "decision.approve" | "decision.reject") => {
    setFormError(undefined);
    const normalizedRationale = rationale.trim();
    if (!normalizedRationale) {
      setFormError("Explain why this exact proposal is approved or rejected.");
      return;
    }
    if (!decision.inputFingerprint) {
      setFormError(
        "This proposal has no exact input fingerprint and cannot be reviewed.",
      );
      return;
    }
    const unavailable = unavailableCommandReason({
      enabled,
      intent,
      allowedIntents,
      actorId,
      busy,
    });
    if (unavailable) {
      setFormError(unavailable);
      return;
    }
    await onSubmit({
      type: intent,
      decisionId: decision.id,
      rationale: normalizedRationale,
      inputFingerprint: decision.inputFingerprint,
    });
  };

  const approveUnavailable = unavailableCommandReason({
    enabled,
    intent: "decision.approve",
    allowedIntents,
    actorId,
    busy,
  });
  const rejectUnavailable = unavailableCommandReason({
    enabled,
    intent: "decision.reject",
    allowedIntents,
    actorId,
    busy,
  });

  return (
    <section class="decision-review-form" aria-label="Human decision review">
      <label class="decision-field">
        <span>Review rationale</span>
        <textarea
          rows={2}
          value={rationale}
          onInput={(event) =>
            setRationale(event.currentTarget.value)}
          placeholder="State why the exact fingerprinted proposal is acceptable or must change"
          disabled={!enabled || busy}
        />
      </label>
      <div class="decision-review-actions">
        <button
          type="button"
          class="decision-reject-button"
          onClick={() =>
            submit("decision.reject")}
          disabled={!!rejectUnavailable || !decision.inputFingerprint}
          title={rejectUnavailable}
        >
          Reject proposal
        </button>
        <button
          type="button"
          class="decision-approve-button"
          onClick={() => submit("decision.approve")}
          disabled={!!approveUnavailable || !decision.inputFingerprint}
          title={approveUnavailable}
        >
          {busy ? "Applying…" : "Approve exact proposal"}
        </button>
      </div>
      <small>
        Approval is bound to{" "}
        <code>
          {decision.inputFingerprint
            ? shortHash(decision.inputFingerprint.digest)
            : "missing fingerprint"}
        </code>. A changed proposal must be reviewed again.
      </small>
      {formError && <p class="decision-form-error" role="alert">{formError}</p>}
    </section>
  );
}

function ApprovalJournal({ decision, approvals }: {
  decision: EngineeringDecision;
  approvals: readonly EngineeringApproval[];
}): JSX.Element {
  return (
    <section class="decision-approval-journal" aria-label="Approval journal">
      <header>
        <span>APPROVAL JOURNAL</span>
        <small>
          {approvals.length} record{approvals.length === 1 ? "" : "s"}
        </small>
      </header>
      <ol>
        {approvals.map((approval) => {
          const exact = approvalMatchesDecisionScope(decision, approval);
          return (
            <li key={approval.id} data-state={approval.status}>
              <i aria-hidden="true" />
              <div>
                <strong>{approval.status}</strong>
                <span>{approval.decidedBy ?? "Decision pending"}</span>
                {approval.rationale && <p>{approval.rationale}</p>}
              </div>
              <b data-exact={exact}>
                {exact ? "exact scope" : "scope changed"}
              </b>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function QueueWorkItemControl(
  props: ProjectControlProps & { item: EngineeringWorkItem; compact?: boolean },
): JSX.Element {
  const { project, item, capability, actorId, feedback, onCommand, compact } =
    props;
  const [summary, setSummary] = useState("");
  const [formError, setFormError] = useState<string>();
  const busy = feedback.state === "submitting";
  const unavailable = unavailableCommandReason({
    enabled: capability?.enabled === true,
    intent: "agent-run.queue",
    allowedIntents: capability?.intents ?? [],
    actorId,
    busy,
  });
  const eligible = canQueueWorkItem(project, item);

  const submit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(undefined);
    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      setFormError("Describe what the queued agent run must accomplish.");
      return;
    }
    if (!eligible || unavailable) return;
    await onCommand(`queue:${item.id}`, {
      type: "agent-run.queue",
      workItemId: item.id,
      summary: normalizedSummary,
    });
  };

  return (
    <form
      class={`decision-queue-form${compact ? " is-compact" : ""}`}
      onSubmit={submit}
    >
      <div>
        <strong>{item.title}</strong>
        <small>{item.id}</small>
      </div>
      <label class="decision-field">
        <span>Agent run objective</span>
        <input
          value={summary}
          onInput={(event) => setSummary(event.currentTarget.value)}
          placeholder="Describe the bounded work to queue"
          disabled={!eligible || capability?.enabled !== true || busy}
          required
        />
      </label>
      <button
        type="submit"
        class="decision-primary-button"
        disabled={!eligible || !!unavailable}
        title={!eligible
          ? "This work item is not ready to queue."
          : unavailable}
      >
        {busy && feedback.commandKey === `queue:${item.id}`
          ? "Queueing…"
          : "Queue agent run"}
      </button>
      {formError && <p class="decision-form-error" role="alert">{formError}</p>}
    </form>
  );
}

function formatProposalValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function shortHash(value: string): string {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
