import type { JSX } from "react";
import { Button } from "../ui/button.tsx";
import type {
  ChatConversationDto,
  ChatRetentionDto,
  ChatToolViewerDto,
} from "../../../presentation/desktop/chat/contracts.ts";

export interface ChatSessionWorkListProps {
  readonly conversation: ChatConversationDto;
  readonly retention: ChatRetentionDto | undefined;
  readonly sendMessage: (text: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Date(time).toLocaleString();
}

/**
 * Per-session saved-work list (#51): one row per result version with its
 * revision, outcome, and retained exports. Hashes and protocol detail stay
 * in inspection; opening and exporting stay on the per-message viewer.
 */
export function ChatSessionWorkList({
  conversation,
  retention,
  sendMessage,
}: ChatSessionWorkListProps): JSX.Element {
  const versions = [...conversation.viewers].reverse();
  return (
    <section
      className="desktop-chat-session-work"
      aria-label="Saved session work"
    >
      <div className="desktop-chat-project-line">
        <span>Saved work</span>
        <strong>Session work — not Thread evidence</strong>
      </div>
      <p className="desktop-chat-viewer-status">
        {retention === undefined
          ? "Kept for this session."
          : `Kept about ${retention.days} days · at most ${retention.maxConversations} conversations.`}
        {" "}
        Trimming messages never deletes saved bytes; dropping a whole
        conversation deletes its bytes with it.
      </p>
      {versions.length === 0 && (
        <p className="desktop-chat-viewer-status">
          No tool results yet. Saved versions will list here.
        </p>
      )}
      <ol>
        {versions.map((viewer) => (
          <WorkVersionRow
            key={viewer.toolCallId}
            viewer={viewer}
            sendMessage={sendMessage}
          />
        ))}
      </ol>
    </section>
  );
}

function WorkVersionRow({
  viewer,
  sendMessage,
}: {
  readonly viewer: ChatToolViewerDto;
  readonly sendMessage: (text: string) => void;
}): JSX.Element {
  const archive = viewer.archive;
  const label = archive === undefined
    ? `${viewer.tool} · unsaved`
    : `v${archive.revision} · ${viewer.tool} · ${formatDate(archive.capturedAt)}`;
  return (
    <li className="desktop-chat-work-version">
      <div className="desktop-chat-project-line">
        <span>{label}</span>
        {archive?.failed === true && <strong>failed</strong>}
      </div>
      {archive === undefined && (
        <p className="desktop-chat-viewer-status">
          Captured before saving existed. Re-run the tool to save this result.
        </p>
      )}
      {archive !== undefined && archive.artifacts.length === 0 && (
        <p className="desktop-chat-viewer-status">
          No export files in this result. The exact result data stays saved with the
          conversation.
        </p>
      )}
      {archive !== undefined && archive.artifacts.length > 0 && (
        <ul>
          {archive.artifacts.map((artifact) => (
            <li key={artifact.sha256}>
              <span>
                {artifact.fileName} · {formatBytes(artifact.bytes)} · {artifact.state}
                {artifact.state === "missing" && artifact.reason !== undefined
                  ? ` — ${artifact.reason}`
                  : ""}
              </span>
              {artifact.state === "missing" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    sendMessage(
                      `Regenerate the saved result v${archive.revision} (${viewer.tool}) from its saved source; its retained ${artifact.fileName} bytes are missing (${
                        artifact.reason ?? "unknown cause"
                      }).`,
                    )}
                >
                  Regenerate with the agent
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {archive !== undefined && (
        <details>
          <summary>Inspection</summary>
          <dl>
            <dt>Server</dt>
            <dd>{archive.server}</dd>
            <dt>Result digest</dt>
            <dd>{archive.resultDigest}</dd>
            <dt>Tool call</dt>
            <dd>{viewer.toolCallId}</dd>
            <dt>App</dt>
            <dd>{viewer.appUri}</dd>
            {archive.artifacts.map((artifact) => (
              <div key={artifact.sha256}>
                <dt>{artifact.fileName}</dt>
                <dd>
                  {artifact.uri} · sha256 {artifact.sha256}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}
