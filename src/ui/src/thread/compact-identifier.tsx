import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { compactTechnicalIdentifier } from "./compact-identifier-model.ts";

export interface CompactIdentifierProps {
  readonly value: string;
  readonly label: string;
  /** Disable inside another interactive control; nested buttons are invalid. */
  readonly copyable?: boolean;
  readonly className?: string;
}

export function CompactIdentifier({
  value,
  label,
  copyable = true,
  className,
}: CompactIdentifierProps): JSX.Element {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimer = useRef<ReturnType<typeof globalThis.setTimeout>>();

  useEffect(() => () => {
    if (resetTimer.current !== undefined) {
      globalThis.clearTimeout(resetTimer.current);
    }
  }, []);

  const copy = async () => {
    try {
      await writeClipboard(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current !== undefined) {
      globalThis.clearTimeout(resetTimer.current);
    }
    resetTimer.current = globalThis.setTimeout(
      () => setCopyState("idle"),
      1800,
    );
  };

  return (
    <span
      className={`compact-identifier${className ? ` ${className}` : ""}`}
      data-copy-state={copyState}
    >
      <code title={value} aria-label={`${label}: ${value}`}>
        {compactTechnicalIdentifier(value)}
      </code>
      {copyable && (
        <button
          type="button"
          className="compact-identifier-copy"
          aria-label={`Copy full ${label}`}
          title={`Copy full ${label}`}
          onClick={copy}
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
            ? "Retry"
            : "Copy"}
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {copyState === "copied"
          ? `${label} copied.`
          : copyState === "failed"
          ? `${label} could not be copied.`
          : ""}
      </span>
    </span>
  );
}

async function writeClipboard(value: string): Promise<void> {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy was rejected.");
}
