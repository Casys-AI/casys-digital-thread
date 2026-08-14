"""Bounded supervisor for the qualified Build123d child process."""

from __future__ import annotations

from dataclasses import dataclass, field
import ctypes
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time


CHILD_PATH = "/opt/casys/bin/execute-build123d-child.py"
SOURCE_PATH = Path("/input/source.py")
OUTPUT_PATH = Path("/out/geometry.step")
QUIESCENCE_PATH = Path("/run/casys/quiesced.json")
STDOUT_CAPTURE_PATH = Path("/run/casys/stdout.bin")
STDERR_CAPTURE_PATH = Path("/run/casys/stderr.bin")
QUIESCENCE_SCHEMA = "casys-build123d-worker-quiescence/1.0"
PR_SET_CHILD_SUBREAPER = 36
MAXIMUM_WALL_TIME_SECONDS = 30.0
MAXIMUM_SOURCE_BYTES = 262_144
MAXIMUM_STDOUT_BYTES = 65_536
MAXIMUM_STDERR_BYTES = 65_536
MAXIMUM_OUTPUT_BYTES = 33_554_432
MAXIMUM_PROCESSES = 32
MAXIMUM_OPEN_FILES = 128
MAXIMUM_CPU_TIME_SECONDS = 20


@dataclass
class BoundedCapture:
    limit: int
    byte_count: int = 0
    truncated: bool = False
    digest: object = field(default_factory=hashlib.sha256)
    chunks: list[bytes] = field(default_factory=list)

    def observe(self, chunk: bytes) -> None:
        remaining = max(0, self.limit - self.byte_count)
        captured = chunk[:remaining]
        self.digest.update(captured)
        if captured:
            self.chunks.append(captured)
        self.byte_count += len(captured)
        if len(chunk) > remaining:
            self.truncated = True

    def receipt(self) -> dict[str, object]:
        return {
            "byteCount": self.byte_count,
            "sha256": self.digest.hexdigest(),
            "truncated": self.truncated,
        }

    def bytes(self) -> bytes:
        return b"".join(self.chunks)


def prepare_child() -> None:
    resource.setrlimit(
        resource.RLIMIT_CPU,
        (MAXIMUM_CPU_TIME_SECONDS, MAXIMUM_CPU_TIME_SECONDS),
    )
    resource.setrlimit(
        resource.RLIMIT_FSIZE,
        (MAXIMUM_OUTPUT_BYTES, MAXIMUM_OUTPUT_BYTES),
    )
    resource.setrlimit(
        resource.RLIMIT_NOFILE,
        (MAXIMUM_OPEN_FILES, MAXIMUM_OPEN_FILES),
    )
    resource.setrlimit(
        resource.RLIMIT_NPROC,
        (MAXIMUM_PROCESSES, MAXIMUM_PROCESSES),
    )
    os.setgroups([])
    os.setgid(65_532)
    os.setuid(65_532)


def prepare_source() -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(SOURCE_PATH, flags)
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_size <= 0
            or metadata.st_size > MAXIMUM_SOURCE_BYTES
        ):
            raise OSError("source validation failed")
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o444)
    finally:
        os.close(descriptor)


def fixed_environment() -> dict[str, str]:
    return {
        "HOME": "/nonexistent",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONNOUSERSITE": "1",
        "PYTHONUNBUFFERED": "1",
        "TMPDIR": "/tmp",
    }


def kill_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def enable_child_subreaper() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER failed")


def direct_child_pids() -> list[int]:
    children_path = Path(f"/proc/{os.getpid()}/task/{os.getpid()}/children")
    value = children_path.read_text(encoding="ascii").strip()
    if not value:
        return []
    return [int(raw_pid) for raw_pid in value.split()]


def terminate_and_reap_descendants() -> bool:
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        for pid in direct_child_pids():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        while True:
            try:
                waited_pid, _ = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                waited_pid = 0
            if waited_pid <= 0:
                break

        if not direct_child_pids():
            return True
        time.sleep(0.01)
    return False


def remove_untrusted_output() -> None:
    for path in (
        OUTPUT_PATH,
        QUIESCENCE_PATH,
        QUIESCENCE_PATH.with_suffix(".tmp"),
        STDOUT_CAPTURE_PATH,
        STDOUT_CAPTURE_PATH.with_suffix(".tmp"),
        STDERR_CAPTURE_PATH,
        STDERR_CAPTURE_PATH.with_suffix(".tmp"),
    ):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def write_atomic_regular(path: Path, payload: bytes) -> None:
    temporary = path.with_suffix(".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        temporary.unlink(missing_ok=True)
        descriptor = os.open(temporary, flags, 0o400)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o400)
        os.replace(temporary, path)
        metadata = path.lstat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_size != len(payload)
        ):
            raise OSError("atomic control file validation failed")
    except OSError:
        temporary.unlink(missing_ok=True)
        raise


def write_quiescence_marker() -> None:
    payload = {
        "schemaVersion": QUIESCENCE_SCHEMA,
        "status": "descendants-killed-and-reaped",
    }
    write_atomic_regular(
        QUIESCENCE_PATH,
        (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode(
            "ascii"
        ),
    )


def write_bounded_capture(path: Path, capture: BoundedCapture) -> None:
    write_atomic_regular(path, capture.bytes())


def emit_status(
    status: str,
    exit_code: int,
    child_exit_code: int | None,
    stdout: BoundedCapture,
    stderr: BoundedCapture,
) -> "None":
    payload = {
        "schemaVersion": "casys-build123d-worker-status/1.0",
        "status": status,
        "childExitCode": child_exit_code,
        "logs": {
            "stdout": stdout.receipt(),
            "stderr": stderr.receipt(),
        },
    }
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True), flush=True)
    raise SystemExit(exit_code)


def validate_output() -> bool:
    # The untrusted child owns /out and may try to create arbitrarily many
    # decoys. Stream the directory and stop at the second entry, so the
    # root-owned supervisor proves an exact one-file manifest with bounded
    # host/guest memory before it publishes the quiescence marker.
    try:
        with os.scandir(OUTPUT_PATH.parent) as entries:
            first = next(entries, None)
            second = next(entries, None)
            if first is None or second is not None or first.name != OUTPUT_PATH.name:
                return False
            metadata = first.stat(follow_symlinks=False)
    except OSError:
        return False
    return (
        stat.S_ISREG(metadata.st_mode)
        and not stat.S_ISLNK(metadata.st_mode)
        and metadata.st_nlink == 1
        and 0 < metadata.st_size <= MAXIMUM_OUTPUT_BYTES
    )


def supervise() -> None:
    stdout = BoundedCapture(MAXIMUM_STDOUT_BYTES)
    stderr = BoundedCapture(MAXIMUM_STDERR_BYTES)
    remove_untrusted_output()
    try:
        prepare_source()
    except OSError:
        emit_status("source_rejected", 66, None, stdout, stderr)
    try:
        enable_child_subreaper()
    except OSError:
        emit_status("subreaper_unavailable", 70, None, stdout, stderr)

    try:
        process = subprocess.Popen(
            [sys.executable, "-I", "-B", CHILD_PATH],
            cwd="/work",
            env=fixed_environment(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            close_fds=True,
            start_new_session=True,
            preexec_fn=prepare_child,
        )
    except BaseException:
        emit_status("child_start_failed", 70, None, stdout, stderr)

    assert process.stdout is not None
    assert process.stderr is not None
    stream_captures = {
        process.stdout.fileno(): stdout,
        process.stderr.fileno(): stderr,
    }
    selector = selectors.DefaultSelector()
    for stream in (process.stdout, process.stderr):
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)

    deadline = time.monotonic() + MAXIMUM_WALL_TIME_SECONDS
    terminal_status: str | None = None
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                terminal_status = "wall_time_exceeded"
                kill_process_group(process)
                remaining = 0.1

            events = selector.select(timeout=min(0.1, max(0.0, remaining)))
            for key, _ in events:
                descriptor = key.fileobj.fileno()
                try:
                    chunk = os.read(descriptor, 8_192)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                capture = stream_captures[descriptor]
                capture.observe(chunk)
                if capture.truncated and terminal_status is None:
                    terminal_status = "log_limit_exceeded"
                    kill_process_group(process)

            if terminal_status is not None and process.poll() is not None:
                for key in list(selector.get_map().values()):
                    try:
                        selector.unregister(key.fileobj)
                    except KeyError:
                        pass
                break
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()

    if process.poll() is None:
        kill_process_group(process)
    try:
        child_exit_code = process.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        kill_process_group(process)
        child_exit_code = process.wait(timeout=1.0)

    # First kill same-session descendants, then kill and reap any daemon that
    # escaped with setsid(). As a subreaper, this process adopts every orphan.
    try:
        descendants_closed = terminate_and_reap_descendants()
    except (OSError, ValueError):
        descendants_closed = False
        terminal_status = "descendant_inventory_failed"
    if not descendants_closed and terminal_status is None:
        terminal_status = "descendant_cleanup_failed"

    if terminal_status is not None:
        remove_untrusted_output()
        emit_status(terminal_status, 75, child_exit_code, stdout, stderr)
    if child_exit_code != 0:
        remove_untrusted_output()
        emit_status("child_failed", 70, child_exit_code, stdout, stderr)
    if not validate_output():
        remove_untrusted_output()
        emit_status("output_rejected", 74, child_exit_code, stdout, stderr)

    try:
        write_bounded_capture(STDOUT_CAPTURE_PATH, stdout)
        write_bounded_capture(STDERR_CAPTURE_PATH, stderr)
        write_quiescence_marker()
    except OSError:
        remove_untrusted_output()
        emit_status("quiescence_marker_failed", 74, child_exit_code, stdout, stderr)

    emit_status("ok", 0, child_exit_code, stdout, stderr)


def main() -> None:
    if len(sys.argv) != 1:
        empty_stdout = BoundedCapture(MAXIMUM_STDOUT_BYTES)
        empty_stderr = BoundedCapture(MAXIMUM_STDERR_BYTES)
        emit_status("arguments_forbidden", 64, None, empty_stdout, empty_stderr)
    if os.geteuid() != 0 or os.getegid() != 0:
        empty_stdout = BoundedCapture(MAXIMUM_STDOUT_BYTES)
        empty_stderr = BoundedCapture(MAXIMUM_STDERR_BYTES)
        emit_status(
            "supervisor_privilege_missing", 77, None, empty_stdout, empty_stderr
        )
    os.umask(0o077)
    supervise()


if __name__ == "__main__":
    main()
