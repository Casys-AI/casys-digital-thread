# Versioned project baselines

Files in this directory are exact, domain-validated `ThreadSnapshot` captures referenced
by tracked `EngineeringProjectSnapshot` manifests.

They are observed integration evidence, not synthetic fixtures and not proof that a
provider is currently running. The active local snapshot store has read priority. A
baseline is consulted only for the same exact canonical snapshot ID; it is never used as
a substitute for `latest`, a missing ID, or a new engineering run.

`coffee-machine-cm01.r5.thread-snapshot.json` is the clean CM-01 baseline captured on
2026-08-01. It contains SysON, Modelica, ERPNext and whole-machine build123d evidence,
but no legacy support-bracket attachment and no CalculiX result.

`assets/coffee-machine-8208d581f067.stl.base64` is a lossless text transport of the
binary STL used by that preview. The BFF decodes it without geometry conversion and
serves bytes with SHA-256
`8208d581f06796b4e6b6c5f6f6dc4e3785245c251b355859d31ea69445ccaf7e` only when the active
local asset directory does not contain the requested exact filename.
