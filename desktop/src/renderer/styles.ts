/** Static CSS only. View-model values never interpolate here. */
export const DESKTOP_SHELL_STYLES = `
:root {
  color-scheme: light;
  --paper: #f5f2ea;
  --sheet: #fbf8f1;
  --ink: #1c2126;
  --ink-soft: #3a3530;
  --mute: #5c564c;
  --rule: #d4cdc0;
  --rule-strong: #8a8274;
  --focus: #0e7490;
  --ready: #1a7f4e;
  --ready-wash: #e3efe8;
  --degraded: #9a5b12;
  --degraded-wash: #f6ecd8;
  --recovery: #c03e38;
  --recovery-wash: #f6e5e3;
  --unresolved: #3f68c4;
  --unresolved-wash: #e7eef8;
  --display: "New York", "Iowan Old Style", Palatino, Georgia, serif;
  --sans: ui-sans-serif, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

html {
  min-height: 100%;
  background: var(--paper);
}

body {
  margin: 0;
  min-height: 100dvh;
  color: var(--ink);
  background:
    linear-gradient(180deg, rgba(28, 33, 38, 0.03), transparent 8rem),
    var(--paper);
  font-family: var(--sans);
  font-size: 1rem;
  line-height: 1.55;
  text-rendering: optimizeLegibility;
}

.skip-link {
  position: absolute;
  left: 1rem;
  top: -4.5rem;
  z-index: 2;
  padding: 0.55rem 0.8rem;
  color: var(--sheet);
  background: var(--ink);
  font-weight: 650;
  text-decoration: none;
}

.skip-link:focus {
  top: 1rem;
}

.sheet {
  width: min(72rem, calc(100% - 2 * clamp(0.9rem, 3vw, 2rem)));
  margin: clamp(1rem, 3vh, 2.25rem) auto clamp(2rem, 5vh, 3.5rem);
  padding: clamp(1.15rem, 2.6vw, 2.35rem);
  border: 1px solid var(--rule);
  background: var(--sheet);
  box-shadow: 0 0 0 1px rgba(28, 33, 38, 0.02);
}

.title-block {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 3px solid var(--ink);
}

.title-block dl {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem 1.5rem;
  margin: 0;
}

.title-block div {
  min-width: 0;
}

.title-block dt {
  margin: 0 0 0.2rem;
  color: var(--mute);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.title-block dd {
  margin: 0;
  color: var(--ink);
  font-family: var(--display);
  font-size: clamp(1.2rem, 2.4vw, 1.7rem);
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.cell-meta dd {
  font-family: var(--mono);
  font-size: 0.92rem;
  font-weight: 550;
  letter-spacing: 0.01em;
}

.aggregate {
  display: grid;
  gap: 1.15rem;
  padding: 1.35rem 0 1.5rem;
  border-bottom: 1px solid var(--rule);
}

.kicker {
  margin: 0;
  color: var(--mute);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.aggregate-heading {
  margin: 0;
  max-width: 40rem;
  font-family: var(--display);
  font-size: clamp(1.55rem, 3.2vw, 2.35rem);
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.aggregate-summary,
.empty-note,
.footer-note,
.section-note,
.component-summary,
.field p {
  margin: 0;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}

.stamp {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  width: fit-content;
  max-width: 100%;
  margin: 0;
  padding: 0.7rem 0.9rem;
  border: 2px solid currentColor;
  color: var(--ink);
  background: var(--sheet);
}

.stamp-word,
.stamp-meaning-token {
  font-family: var(--mono);
  font-weight: 650;
  letter-spacing: 0.02em;
}

.stamp-word {
  font-size: clamp(1.35rem, 3.2vw, 2.15rem);
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.stamp-mark {
  display: inline-block;
  width: 0.85rem;
  height: 0.85rem;
  flex: 0 0 auto;
  border: 2px solid currentColor;
  background: transparent;
}

.stamp-meaning {
  margin: 0;
  color: var(--mute);
  font-size: 0.95rem;
}

.components {
  padding-top: 1.4rem;
}

.components-heading {
  margin: 0 0 0.35rem;
  font-family: var(--display);
  font-size: 1.35rem;
  font-weight: 600;
}

.section-note {
  margin-bottom: 1.1rem;
  max-width: 40rem;
}

.component-list {
  display: grid;
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.component {
  display: grid;
  gap: 0.75rem;
  padding: 0.95rem 0;
  border-top: 1px solid var(--rule);
}

.component-head {
  display: grid;
  gap: 0.65rem;
}

.component-label {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.component-id {
  margin: 0.15rem 0 0;
  color: var(--mute);
  font-family: var(--mono);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.component .stamp {
  padding: 0.35rem 0.55rem;
}

.component .stamp-word {
  font-size: 0.92rem;
}

.component .stamp-mark {
  width: 0.65rem;
  height: 0.65rem;
}

.fields {
  display: grid;
  gap: 0.7rem;
}

.field dt {
  margin: 0 0 0.15rem;
  color: var(--mute);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.field dd {
  margin: 0;
}

.field p {
  font-family: var(--mono);
  font-size: 0.86rem;
  line-height: 1.45;
}

.footer-note {
  margin: 1.4rem 0 0;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
  color: var(--mute);
  font-size: 0.9rem;
}

.stamp[data-shell-status="ready"],
.stamp[data-component-state="ready"] {
  border-style: solid;
  color: var(--ready);
  background: var(--ready-wash);
}

.stamp[data-shell-status="ready"] .stamp-mark,
.stamp[data-component-state="ready"] .stamp-mark {
  background: currentColor;
}

.stamp[data-shell-status="degraded"] {
  border-style: dashed;
  color: var(--degraded);
  background: var(--degraded-wash);
}

.stamp[data-shell-status="degraded"] .stamp-mark {
  background: linear-gradient(90deg, currentColor 50%, transparent 50%);
}

.stamp[data-shell-status="recovery-required"],
.stamp[data-component-state="error"] {
  border-style: double;
  border-width: 4px;
  color: var(--recovery);
  background: var(--recovery-wash);
}

.stamp[data-shell-status="recovery-required"] .stamp-mark,
.stamp[data-component-state="error"] .stamp-mark {
  background: currentColor;
  transform: rotate(45deg);
  border-width: 0;
}

.stamp[data-component-state="unavailable"] {
  border-style: dotted;
  color: var(--degraded);
  background: var(--sheet);
}

.stamp[data-component-state="unavailable"] .stamp-mark {
  border-radius: 50%;
}

.stamp[data-component-state="unresolved"] {
  border-style: dashed;
  border-image: none;
  color: var(--unresolved);
  background: var(--unresolved-wash);
}

.stamp[data-component-state="unresolved"] .stamp-mark {
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, currentColor 28%, transparent 30%);
}

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

@media (min-width: 40rem) {
  .title-block dl {
    grid-template-columns: minmax(0, 2.2fr) repeat(2, minmax(0, 1fr));
    align-items: end;
  }

  .component-head {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }
}

@media (min-width: 64rem) {
  .aggregate {
    grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
    align-items: start;
  }

  .aggregate .kicker,
  .aggregate-heading,
  .aggregate-summary {
    grid-column: 2;
  }

  .aggregate .kicker { grid-row: 1; }
  .aggregate-heading { grid-row: 2; }
  .aggregate-summary { grid-row: 3; }

  .aggregate-status {
    grid-column: 1;
    grid-row: 1 / span 4;
  }

  .fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`.trim();
