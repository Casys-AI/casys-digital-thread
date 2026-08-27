# Reference: Build123d workspace-closure lowering v1

Status: active Build123d 3.0 capture, compilation and admission contract

`build123d-workspace-closure-lowering/1.0` is the server-side validation and lowering
contract for one exact sealed `project-source-closure/1.0`. The registered Build123d
3.0 profile uses it to create one executable effective unit for capture, preview,
admission and their exact replays. It does not create a Python import environment and
does not select or call a provider.

The authored closure and attachment remain evidence. The effective unit gets the
separate identity `technical-unit:<closure sha256>`; it is never a replacement for a
workspace `fileId`, logical name or path. A successful lower is not a real provider
run, canonical STEP, isolated output, product verdict or an authority to skip the
normal admission and MRTR path.

## Accepted v1 shape

- One exact root text plus every exact closure dependency text. A reopened descriptor
  contains only the sealed file id/revision and its text; each UTF-8 byte digest must
  equal the closure resource reference. Caller-supplied logical names or module paths
  are not part of this contract.
- The closure is only root to direct dependency leaf; transitive dependencies are
  refused.
- A virtual Python module is derived from the sealed file id only, never from revision,
  logical name, caller path, or latest: `casys_workspace.f_<UTF-8-file-id-hex>`. These
  are virtual names, never local filesystem paths. A closure that presents more than one
  revision of the same fileId, or that otherwise makes this stable module ambiguous, is
  refused. The exact `fileId@revision`, resource digest, and import-to-direct-edge
  mapping remain pinned in the sealed closure and the lowering manifest.
- The root may use one physical, module-level form per direct dependency:

      from casys_workspace.f_6465702d64696d656e73696f6e73 import width, depth

  Aliases, wildcard imports, relative imports, standalone imports, duplicate imports,
  undeclared modules, and absent dependency imports are refused. All workspace imports
  must form the leading root prelude: only comments may precede them, and no other root
  statement may appear between or before them.
- A dependency leaf is comments/blank lines plus unique module-level scalar bindings.
  Comments are non-semantic v1 annotation and are omitted from the lowered script. A
  binding may use finite decimal literals, + - * / // % **, parentheses, and earlier
  bindings only. Imports, result, calls, control flow, containers, forward references,
  division by zero, and non-finite results are refused.

## Profile-owned limits and persisted evidence

The caller does not set a lowerer or any limit. The registered Build123d 3.0 profile
owns these ceilings: at most 32 closure files, 262144 UTF-8 bytes for the root source,
524288 aggregate UTF-8 closure bytes, and 524288 UTF-8 bytes for the effective lowered
script. Exceeding a ceiling is a refusal, not an instruction to split, truncate or
choose another profile.

The V4 capture persists the complete lowering manifest, not merely its digest. It binds
the exact closure fingerprint; every `fileId@revision` and resource digest; virtual
module and direct-import mapping; removed import spans; source map; and the lowered
script and manifest SHA-256 fingerprints. The `technical-compilation/2.0` document,
`technical-compilation-admission/4.0`, and its capture retain that effective-unit
identity through the existing `compile.seal-admission@3` operation.

## Canonical result and isolation

The lowerer copies only the bindings explicitly imported by the root and the earlier
static bindings they require. It never copies a dependency module wholesale. A root
reference to an unimported dependency binding is refused. Collision with a dependency
binding is refused only for this closed V1 binder grammar. The guard is not a general
Python symbol table:

- assignment and update targets
- import bindings
- for/with/except aliases
- DeleteStatement targets
- module-level match/case CapturePattern names
- the VariableName after `as` in a module-level AsPattern
- the VariableName after `type` in a module-level TypeDefinition
- NamedExpression walrus left targets in a module-scope expression or comprehension
- the VariableName immediately before a `:=` that is a direct child of a module-scope
  ArgList, as in `Box(width := 5)`
- function or class definition names found after the `def` or `class` token, including
  `async def`
- `global` of a dependency name, including inside a function, even without assignment
- `nonlocal` when function nesting is ambiguous

A ClassPattern class name is not a binder. `nonlocal` cannot name the module. Function
and method parameters, ordinary local assignments or captures, a function- or
class-local type alias, a nested AsPattern, and a walrus inside a function or class are
not module binders.

The result is one deterministic Python script. It is passed through the existing D4
validator, then returned with:

- the exact closure fingerprint;
- source identities (exact `fileId@revision` and resource digest) and the resolved
  stable virtual modules;
- import-to-direct-edge mapping, including both the parsed statement span and the full
  removed physical line span (trailing comment plus CRLF/LF when present);
- a source map from copied UTF-16 spans to exact input source spans;
- SHA-256 digests of the lowered script and the versioned manifest.

Every replay during preview, admission or a downstream run recrosses the exact workspace
revision and closure, reopens every named byte sequence, re-lowers the closure, compares
the complete persisted manifest and effective script, then reanalyses the effective
script under the registered profile. Any drift fails closed. The same rule applies to
canonical and isolated paths once their separate reviews are authorized; their authority
and outputs remain unchanged.

Modelica and circuit-only SPICE have no multi-file lowering in this release. Their
multi-file closures remain literally `source.dependency-lowering-unavailable`.
