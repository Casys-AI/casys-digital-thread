/** @jsxImportSource preact */

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import { Button, installMcpViewTheme } from "../mcp-view-primitives.ts";
import {
  HttpProjectDiscoveryClient,
  type ProjectDiscoveryClient,
  ProjectDiscoveryConflictError,
  type ProjectDiscoveryStreamStatus,
} from "./discovery-client.ts";
import { createProjectDiscoveryCommandRequest } from "./discovery-command-contract.ts";
import {
  type DiscoveryAnswerSelection,
  type DiscoveryBriefReviewSelection,
  DiscoveryWorkbench,
} from "./discovery-workbench.tsx";
import "../styles.css";

export interface DiscoveryPreviewAppProps {
  readonly client: ProjectDiscoveryClient;
  readonly actorId: string;
}

type DiscoveryFeedback =
  | { readonly tone: "success" | "danger"; readonly message: string }
  | undefined;

type DiscoveryTransportState = ProjectDiscoveryStreamStatus | "error";

export function DiscoveryPreviewApp({
  client,
  actorId,
}: DiscoveryPreviewAppProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProjectDiscoverySnapshot>();
  const [streamStatus, setStreamStatus] = useState<
    ProjectDiscoveryStreamStatus
  >(
    "connecting",
  );
  const [loadingError, setLoadingError] = useState<string>();
  const [feedback, setFeedback] = useState<DiscoveryFeedback>();
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const snapshotRef = useRef<ProjectDiscoverySnapshot>();

  const acceptSnapshot = (incoming: ProjectDiscoverySnapshot): boolean => {
    const current = snapshotRef.current;
    if (
      current &&
      (incoming.discoveryId !== current.discoveryId ||
        incoming.revision < current.revision)
    ) {
      return false;
    }
    snapshotRef.current = incoming;
    setSnapshot(incoming);
    return true;
  };

  useEffect(() => {
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    snapshotRef.current = undefined;
    setSnapshot(undefined);
    setLoadingError(undefined);
    setStreamStatus("connecting");

    client.load(controller.signal).then((initial) => {
      if (controller.signal.aborted) return;
      acceptSnapshot(initial);
      unsubscribe = client.subscribe(acceptSnapshot, setStreamStatus);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setLoadingError(
        reason instanceof Error
          ? reason.message
          : "The project discovery could not be loaded.",
      );
    });

    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [client, loadAttempt]);

  const runCommand = async (
    buildCommand: (
      current: ProjectDiscoverySnapshot,
    ) => ReturnType<typeof createProjectDiscoveryCommandRequest>["command"],
  ): Promise<void> => {
    const current = snapshotRef.current;
    if (!current || busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const next = await client.command(
        createProjectDiscoveryCommandRequest({
          commandId: createStableId("discovery-command"),
          discoveryId: current.discoveryId,
          expectedRevision: current.revision,
          issuedAt: new Date().toISOString(),
          actorId,
          command: buildCommand(current),
        }),
      );
      acceptSnapshot(next);
      setFeedback({ tone: "success", message: "Your review was recorded." });
    } catch (reason: unknown) {
      if (reason instanceof ProjectDiscoveryConflictError) {
        try {
          const latest = await client.load();
          acceptSnapshot(latest);
          setFeedback({
            tone: "danger",
            message:
              "The brief changed while you were reviewing it. The latest version is now shown.",
          });
        } catch {
          setFeedback({
            tone: "danger",
            message:
              "The brief changed and the latest version could not be reloaded.",
          });
        }
      } else {
        setFeedback({
          tone: "danger",
          message: reason instanceof Error
            ? reason.message
            : "Your review could not be recorded.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const answerQuestion = (selection: DiscoveryAnswerSelection) =>
    runCommand(() => ({
      type: "answer.record",
      answer: {
        id: createStableId("answer"),
        questionId: selection.questionId,
        kind: selection.kind,
        ...(selection.value === undefined ? {} : { value: selection.value }),
      },
    }));

  const reviewBrief = (selection: DiscoveryBriefReviewSelection) =>
    runCommand(() => ({
      type: selection.action === "approve" ? "brief.approve" : "brief.reject",
      briefId: selection.briefId,
      inputFingerprint: selection.inputFingerprint,
      rationale: selection.action === "approve"
        ? "Approved by the human reviewer in the Discovery Workbench."
        : "The human reviewer requested a revised brief in the Discovery Workbench.",
    }));

  return (
    <div class="discovery-preview-shell">
      <header class="discovery-preview-bar">
        <div>
          <span aria-hidden="true">C</span>
          <p>
            <small>CASYS / PROJECT GUIDE</small>
            <strong>Guided project framing</strong>
          </p>
        </div>
        <div
          class="discovery-transport-state"
          data-state={loadingError ? "error" : streamStatus}
          aria-live="polite"
        >
          <i aria-hidden="true" />
          <span>
            {streamStatusLabel(loadingError ? "error" : streamStatus)}
          </span>
        </div>
      </header>

      {loadingError
        ? (
          <section class="discovery-load-state" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Project framing is temporarily unavailable</strong>
              <p>{loadingError}</p>
              <Button onClick={() => setLoadAttempt((value) => value + 1)}>
                Try again
              </Button>
            </div>
          </section>
        )
        : !snapshot
        ? (
          <section class="discovery-load-state" aria-busy="true">
            <span class="is-loading" aria-hidden="true" />
            <div>
              <strong>Opening your project conversation</strong>
              <p>Reading the latest reviewed context. No tool is being run.</p>
            </div>
          </section>
        )
        : (
          <>
            {feedback && (
              <p
                class="discovery-command-feedback"
                data-tone={feedback.tone}
                role={feedback.tone === "danger" ? "alert" : "status"}
              >
                {feedback.message}
              </p>
            )}
            <DiscoveryWorkbench
              discovery={snapshot}
              busy={busy}
              onAnswer={answerQuestion}
              onReviewBrief={reviewBrief}
            />
          </>
        )}
    </div>
  );
}

function streamStatusLabel(status: DiscoveryTransportState): string {
  if (status === "live") return "Live";
  if (status === "reconnecting") return "Restoring live updates";
  if (status === "error") return "Unavailable";
  return "Connecting";
}

function createStableId(prefix: string): string {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const root = document.querySelector<HTMLElement>("#discovery-preview");
if (!root) throw new Error("Missing #discovery-preview mount point");

installMcpViewTheme(document);

const requestedDiscovery = new URLSearchParams(globalThis.location.search).get(
  "discovery",
)?.trim();
const discoveryId = requestedDiscovery || root.dataset.discoveryId ||
  "drone-concept";
const actorId = root.dataset.actorId || "local-reviewer";
const endpoint = `/api/project-discoveries/${encodeURIComponent(discoveryId)}`;
const client = new HttpProjectDiscoveryClient(
  endpoint,
  `${endpoint}/commands`,
  `${endpoint}/events`,
);

render(<DiscoveryPreviewApp client={client} actorId={actorId} />, root);
