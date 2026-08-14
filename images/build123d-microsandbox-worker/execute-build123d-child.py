"""Fixed child: execute one qualified source and export one STEP artifact."""

from __future__ import annotations

import os
from pathlib import Path
import stat
import sys

from build123d import export_step


SOURCE_PATH = Path("/input/source.py")
OUTPUT_DIRECTORY = Path("/out")
OUTPUT_PATH = OUTPUT_DIRECTORY / "geometry.step"
TEMPORARY_OUTPUT_PATH = OUTPUT_DIRECTORY / ".geometry.step.tmp"
MAXIMUM_SOURCE_BYTES = 262_144
MAXIMUM_OUTPUT_BYTES = 33_554_432


def fail(code: str, status: int) -> "None":
    print(f"casys-build123d-child:{code}", file=sys.stderr, flush=True)
    raise SystemExit(status)


def read_source() -> str:
    flags = os.O_RDONLY
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW

    try:
        descriptor = os.open(SOURCE_PATH, flags)
    except OSError:
        fail("source_unavailable", 66)

    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            fail("source_not_regular", 66)
        if metadata.st_size <= 0 or metadata.st_size > MAXIMUM_SOURCE_BYTES:
            fail("source_size_rejected", 65)
        chunks: list[bytes] = []
        remaining = metadata.st_size
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                fail("source_read_incomplete", 74)
            chunks.append(chunk)
            remaining -= len(chunk)
        source_bytes = b"".join(chunks)
    finally:
        os.close(descriptor)

    try:
        return source_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        fail("source_not_utf8", 65)


def assert_output_directory() -> None:
    try:
        metadata = OUTPUT_DIRECTORY.lstat()
    except OSError:
        fail("output_directory_unavailable", 73)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        fail("output_directory_rejected", 73)


def export_result(result: object) -> None:
    try:
        TEMPORARY_OUTPUT_PATH.unlink(missing_ok=True)
        OUTPUT_PATH.unlink(missing_ok=True)
        exported = export_step(result, TEMPORARY_OUTPUT_PATH)
    except BaseException:
        fail("export_failed", 70)
    if exported is not True:
        fail("export_rejected", 70)

    try:
        metadata = TEMPORARY_OUTPUT_PATH.lstat()
    except OSError:
        fail("output_unavailable", 74)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_nlink != 1
    ):
        fail("output_not_regular", 74)
    if metadata.st_size <= 0 or metadata.st_size > MAXIMUM_OUTPUT_BYTES:
        fail("output_size_rejected", 74)

    try:
        os.replace(TEMPORARY_OUTPUT_PATH, OUTPUT_PATH)
        os.chmod(OUTPUT_PATH, 0o400)
    except OSError:
        fail("output_finalize_failed", 74)


def main() -> None:
    if len(sys.argv) != 1:
        fail("arguments_forbidden", 64)
    os.umask(0o077)
    assert_output_directory()
    source = read_source()
    namespace: dict[str, object] = {
        "__name__": "__casys_qualified_build123d__",
        "__file__": str(SOURCE_PATH),
        "__package__": None,
    }
    try:
        code = compile(source, str(SOURCE_PATH), "exec", dont_inherit=True)
        exec(code, namespace, namespace)
    except BaseException:
        fail("execution_failed", 70)
    if "result" not in namespace or namespace["result"] is None:
        fail("result_missing", 65)
    export_result(namespace["result"])


if __name__ == "__main__":
    main()
