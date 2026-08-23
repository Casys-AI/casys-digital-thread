Audience: agent · Diátaxis: none · Kind: RFC

Status: implemented

# RFC record: acpx 0.13.1 elicitation alignment

This page records the completed alignment in the separate acpx workspace and the exact
consumer pin used by Desktop Lot 4. Desktop packages a reviewed build; it does not
vendor a checkout or consume a moving branch at runtime.

## Outcome

The Casys fork retains upstream `v0.13.1` elicitation plus three reviewed process-tree
lifeline commits. Local `main` and `origin/main` are therefore intentionally ahead of
`upstream/main`. Desktop packages exact commit `3c927fc` and exact adapter
`@agentclientprotocol/codex-acp@1.1.5`; it neither reimplements ACP nor resolves a
moving `main`, tag, or `latest` at runtime.

## Verified aligned state — 2026-08-22

- Upstream
  [`openclaw/acpx` v0.13.1](https://github.com/openclaw/acpx/releases/tag/v0.13.1)
  includes elicitation through [PR #508](https://github.com/openclaw/acpx/pull/508).
- Upstream runtime exposes `elicitationModes` and a per-turn `onElicitation` handler for
  `form` and `url` modes, with `accept`, `decline`, and `cancel` responses.
- Tag `v0.13.1` and `upstream/main` resolve to exact upstream commit
  `2d735cf18220e539bf7961a996bff0aceefcf3b0`.
- Local `main` and `origin/main` resolve to exact Casys commit
  `3c927fcee1b300f9d2a604abd38cbaa9422713ea`, containing lifeline commits
  `21dd089`, `b8b6509`, and `3c927fc` above the upstream release.
- `/Users/erwanpesle/Documents/GitHub/acpx/package.json` declares `0.13.1`.
- `/opt/homebrew/bin/acpx --version` reports `0.13.1`.
- The repository contains focused runtime tests for form/URL advertisement,
  request/session/tool-call correlation, `accept`/`decline`/`cancel`, abort and late
  responses, and exclusion from generic taps.
- The three lifeline changes are on the fork default branch. They are not described as
  separate patches or as equality with upstream.

The earlier proposed upstream issue is obsolete and must not be created.

## Completed alignment

The completed work occurred in `/Users/erwanpesle/Documents/GitHub/acpx`, not in this
repository:

1. The fork retains exact upstream release commit `2d735cf` as its reviewed base.
2. The three process-tree lifeline changes were reviewed and retained on fork `main`,
   whose exact consumer commit is `3c927fc`.
3. The intended local/global CLI reports `0.13.1`, and the public runtime source exposes
   the aligned elicitation types and handlers.
4. No duplicate upstream issue or Casys-specific elicitation implementation was added.

Desktop Lot 4 separately proves that exact fork/runtime build and adapter through its
packaged Chat Host. This alignment record alone still does not prove a Desktop package;
the consumer tests and bundle manifest do.

## Required runtime behavior

The aligned public surface must retain:

- opt-in `form` and `url` capability advertisement;
- per-prompt ownership of the elicitation handler;
- exact `sessionId`, optional `toolCallId`, and JSON-RPC request correlation;
- `accept`, `decline`, and `cancel` without fabricated values;
- abort propagation for prompt cancellation, replacement, shutdown, and late responses;
- fail-closed handling for missing handlers, unsupported modes, mismatched sessions, and
  stale requests; and
- exclusion of form schemas and human answers from generic ACP taps/logs.

Advertising no mode when none is configured, and failing closed when an active turn has
no handler, are correct behavior rather than evidence that elicitation is missing.

## Non-goals

- No upstream issue or duplicate implementation.
- No Casys-specific ACP extension.
- No form renderer or Desktop UI in the acpx repository.
- No conflation of elicitation with `session/request_permission`.
- No persistence of engineering truth or human MRTR inside acpx session history.
- No provider credentials or direct engineering-provider access in acpx.

## Alignment completion evidence

- **Satisfied:** the intended CLI reports `0.13.1`; fork `main` is exact `3c927fc` and
  its reviewed upstream base is exact `2d735cf`.
- **Satisfied in the aligned source:** `elicitationModes` and `onElicitation` are public
  without a local type patch; focused tests cover form and URL modes,
  `accept`/`decline`/`cancel`, correlation, abort/late response, and sensitive tap
  suppression.
- **Preserved:** a consumer with no configured modes advertises no elicitation
  capability; a request with no active handler remains fail-closed.
- **Satisfied by Desktop Lot 4:** the packaged consumer imports `acpx/runtime`, creates
  a registry/store/runtime, starts a turn, crosses form elicitation, streams output,
  closes the session, and verifies that the fixture agent process tree is reaped.

## Handoff

This completed alignment feeds the exact packaged dependency recorded by the
[embedded chat RFC](embedded-acpx-chat.md). Host, IPC, UI, privacy, lifecycle, and the
server-validated human-decision path remain claims of that consumer lot, not of the
alignment alone.
