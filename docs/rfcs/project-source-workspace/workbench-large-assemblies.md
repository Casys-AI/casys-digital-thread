# Workbench for large assemblies

Status: proposed · not implemented

## Read-only projection

The Workbench remains a read-only consumer of server projections and Thread evidence. It
does not parse CAD files, mutate SysML, resolve source dependencies, queue builds or hold
provider credentials.

Its primary navigation always starts from one exact SysML/SysON `System`, `PartUsage` or
`PartDefinition` graph node. It expands only immediate children from the native SysON
traversal or the server's disposable Graphology index. Child lists are bounded and
paginated. Expanding a nested assembly fetches its derived scope on demand; the browser
does not materialize the complete occurrence tree.

There is no parallel product-shaped file explorer. After selecting a semantic node, the
Workbench may reveal its exact attached source roots and let the user drill into the
workspace dependency closure for imports or includes.

## Definition and occurrence views

The UI distinguishes:

- the selected SysML/SysON semantic node and occurrence path;
- attached source roots and their exact workspace revision;
- reusable definition geometry, keyed by exact `PartDefinition` identity and capture;
- occurrence placement, keyed by exact `PartUsage` identity and structure basis;
- physics and solver evidence attached to the exact semantic target;
- verdict evidence with its exact evaluated bases;
- module evidence, keyed by the exact composite definition and its Thread lineage.

Geometry for a reused definition is resolved once and instantiated at each occurrence
placement. A composite or leaf label is derived from the exact SysML projection, never
from a filename, artifact ID shape or array position.

## Progress and gaps

Each semantic row may summarize its attached source, geometry, physics and verdict
availability. Detail is loaded on selection instead of repeating every descendant gate
at the root. Missing attachment evidence does not remove the SysML node.

Contract labels remain literal: `unavailable`, `unresolved`, `error`, `provisional`,
`documentary`, `unverified`, `demo`, `TRACE GAP` and `UNLINKED` are not collapsed into a
green aggregate. A pending successor does not hide the exact older capture on which a
previous result was based.

Workbench caches are disposable. Reloading from the exact SysON capture and Thread
evidence must reproduce the same semantic view without any browser-owned product state.
