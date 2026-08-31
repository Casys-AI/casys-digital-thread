import type { CSSProperties, JSX, ReactNode } from "react";
import {
  type OverviewThreadInstrument as InstrumentModel,
  overviewThreadInstrumentCaption,
  type OverviewThreadInstrumentPresentation,
} from "./overview-thread-instrument-model.ts";

/**
 * One artefact, read on the board.
 *
 * There is no title bar: the whole card is the handle, the title sits over the
 * surface rather than above it, and the only chrome that is always visible is
 * a status dot and a time. Actions are ghosts that appear on hover. The card
 * itself states failure — nothing is announced elsewhere.
 *
 * The same component is mounted full-frame by an MCP app, with the identical
 * props; only its container differs.
 */
export function OverviewThreadInstrument({
  instrument,
  presentation,
  x,
  y,
  color,
  actions,
  children,
  onOpen,
}: {
  readonly instrument: InstrumentModel;
  readonly presentation: OverviewThreadInstrumentPresentation;
  /** Anchor in board percentage units, like every other world object. */
  readonly x: string;
  readonly y: string;
  readonly color: string;
  readonly actions?: ReactNode;
  /** The reading itself. This is the instrument; the rest is skin. */
  readonly children?: ReactNode;
  readonly onOpen?: () => void;
}): JSX.Element {
  const caption = overviewThreadInstrumentCaption(instrument);
  const anchorStyle = {
    "--flow-x": x,
    "--flow-y": y,
    "--flow-color": color,
  } as CSSProperties;

  if (presentation === "chip") {
    return (
      <button
        type="button"
        className="overview-thread-instrument-chip"
        data-state={instrument.state}
        style={anchorStyle}
        onClick={onOpen}
        title={`${instrument.title} · ${caption}`}
      >
        <span
          className="overview-thread-instrument-dot"
          aria-hidden="true"
        />
        <span className="overview-thread-instrument-chip-title">
          {instrument.title}
        </span>
      </button>
    );
  }

  return (
    <article
      className="overview-thread-instrument"
      data-chrome={instrument.chrome}
      data-state={instrument.state}
      style={anchorStyle}
      aria-label={`${instrument.title} — ${caption}`}
    >
      <div className="overview-thread-instrument-surface">
        {children}
      </div>
      <header className="overview-thread-instrument-overlay">
        <span className="overview-thread-instrument-title">
          {instrument.title}
        </span>
        {instrument.detail && (
          <span className="overview-thread-instrument-detail">
            {instrument.detail}
          </span>
        )}
      </header>
      <footer className="overview-thread-instrument-status">
        <span
          className="overview-thread-instrument-dot"
          aria-hidden="true"
        />
        <span className="overview-thread-instrument-caption">{caption}</span>
      </footer>
      {actions && (
        <div className="overview-thread-instrument-actions">{actions}</div>
      )}
    </article>
  );
}
