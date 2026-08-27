"""Stdlib decoder for geometry-module-input-bundle/1.0.

The TypeScript codec is the authority. This module only reopens and rehashes
the same closed bytes so the image-owned assembler can stage child STEP files.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path


SCHEMA = "geometry-module-input-bundle/1.0"
MAGIC = b"CASYS-GEOMETRY-MODULE-BUNDLE/1.0\n"
MAXIMUM_MANIFEST_BYTES = 1_048_576
MAXIMUM_OCCURRENCES = 32
MAXIMUM_CHILD_STEP_BYTES = 32 * 1_048_576
MAXIMUM_BUNDLE_BYTES = 256 * 1_048_576
PLACEMENT_CONVENTION = "right-handed-mm-extrinsic-xyz-degrees"
CHILD_CAPTURE_SCHEMAS = (
    "geometry-part-capture/1.0",
    "geometry-module-capture/1.0",
)
SHA256_HEX = tuple("0123456789abcdef")


class GeometryModuleBundleError(TypeError):
    """Closed-bundle rejection."""


def parse_bundle(raw: bytes) -> dict[str, object]:
    if not isinstance(raw, (bytes, bytearray)):
        fail("Bundle bytes are required.")
    bytes_value = bytes(raw)
    if len(bytes_value) > MAXIMUM_BUNDLE_BYTES:
        fail("The geometry-module input bundle exceeds its ceiling.")
    if not bytes_value.startswith(MAGIC):
        fail("The geometry-module input bundle has an invalid magic.")
    length_start = len(MAGIC)
    length_end = bytes_value.find(b"\n", length_start)
    if length_end < 0 or length_end - length_start > 10:
        fail("The geometry-module bundle length header is invalid.")
    length_text = decode_utf8(bytes_value[length_start:length_end], "bundle length")
    if not length_text.isdigit() or length_text.startswith("0"):
        fail("The geometry-module bundle length is not canonical.")
    manifest_length = int(length_text)
    if manifest_length < 1 or manifest_length > MAXIMUM_MANIFEST_BYTES:
        fail("The geometry-module bundle manifest length is invalid.")
    manifest_start = length_end + 1
    manifest_end = manifest_start + manifest_length
    if manifest_end > len(bytes_value):
        fail("The geometry-module bundle manifest is truncated.")
    manifest_text = decode_utf8(bytes_value[manifest_start:manifest_end], "bundle manifest")
    try:
        manifest = json.loads(
            manifest_text,
            object_pairs_hook=reject_duplicate_object_keys,
            parse_constant=reject_json_constant,
        )
    except json.JSONDecodeError:
        fail("The geometry-module bundle manifest is not JSON.")
    if not isinstance(manifest, dict):
        fail("The geometry-module bundle manifest is not an object.")
    occurrences = validate_manifest(manifest)
    payload = bytes_value[manifest_end:]
    steps = slice_steps(occurrences, payload)
    return {
        "manifest": manifest,
        "occurrences": occurrences,
        "steps": steps,
        "sha256": sha256_hex(bytes_value),
        "byte_count": len(bytes_value),
    }


def stage_child_steps(
    bundle: dict[str, object],
    directory: Path,
) -> list[Path]:
    occurrences = bundle["occurrences"]
    steps = bundle["steps"]
    if not isinstance(occurrences, list) or not isinstance(steps, list):
        fail("The decoded bundle STEP table is incomplete.")
    directory.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for index, step in enumerate(steps):
        if not isinstance(step, bytes):
            fail("A staged child STEP is not exact bytes.")
        path = directory / f"{index:03d}.step"
        path.write_bytes(step)
        path.chmod(0o400)
        paths.append(path)
    return paths


def validate_manifest(manifest: dict[str, object]) -> list[dict[str, object]]:
    exact_keys(manifest, ("occurrences", "placementConvention", "schemaVersion", "unitSystem"))
    if manifest["schemaVersion"] != SCHEMA:
        fail("Unsupported geometry-module bundle schema.")
    if manifest["unitSystem"] != "mm":
        fail("Geometry-module unitSystem must be mm.")
    if manifest["placementConvention"] != PLACEMENT_CONVENTION:
        fail("Geometry-module placementConvention is unsupported.")
    occurrences_value = manifest["occurrences"]
    if not isinstance(occurrences_value, list) or not occurrences_value:
        fail("The geometry-module bundle occurrences must not be empty.")
    if len(occurrences_value) > MAXIMUM_OCCURRENCES:
        fail("The geometry-module bundle exceeds the one-level occurrence ceiling.")
    occurrences: list[dict[str, object]] = []
    expected_offset = 0
    usage_ids: list[str] = []
    for index, item in enumerate(occurrences_value):
        occurrence = validate_occurrence(item, index)
        step = occurrence["step"]
        if not isinstance(step, dict) or step["byteOffset"] != expected_offset:
            fail(f"Occurrence {index} STEP offset is not densely packed.")
        expected_offset += int(step["byteCount"])
        usage_ids.append(str(occurrence["usageElementId"]))
        occurrences.append(occurrence)
    if len(set(usage_ids)) != len(usage_ids):
        fail("Geometry-module usage identities must be unique.")
    if usage_ids != sorted(usage_ids):
        fail("Occurrences must be ordered by exact usage identity.")
    return occurrences


def validate_occurrence(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(f"Occurrence {index} must be an object.")
    exact_keys(
        value,
        (
            "childCapture",
            "partDefinitionElementId",
            "placement",
            "step",
            "usageElementId",
        ),
    )
    usage = text(value["usageElementId"], f"occurrences[{index}].usageElementId")
    part = text(
        value["partDefinitionElementId"],
        f"occurrences[{index}].partDefinitionElementId",
    )
    return {
        "usageElementId": usage,
        "partDefinitionElementId": part,
        "placement": validate_placement(value["placement"], index),
        "childCapture": validate_child_capture(value["childCapture"], index),
        "step": validate_step(value["step"], index),
    }


def validate_placement(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(f"Occurrence {index} placement must be an object.")
    exact_keys(value, ("rotationDeg", "translationMm"))
    return {
        "translationMm": triple(value["translationMm"], f"occurrences[{index}].translationMm"),
        "rotationDeg": triple(value["rotationDeg"], f"occurrences[{index}].rotationDeg"),
    }


def validate_child_capture(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(f"Occurrence {index} childCapture must be an object.")
    exact_keys(value, ("artifactId", "fingerprint", "schemaVersion"))
    schema = text(value["schemaVersion"], f"occurrences[{index}].childCapture.schemaVersion")
    if schema not in CHILD_CAPTURE_SCHEMAS:
        fail(f"Occurrence {index} childCapture schema is unsupported.")
    fingerprint = value["fingerprint"]
    if not isinstance(fingerprint, dict):
        fail(f"Occurrence {index} childCapture fingerprint must be an object.")
    exact_keys(fingerprint, ("algorithm", "digest"))
    if fingerprint["algorithm"] != "sha256":
        fail(f"Occurrence {index} childCapture fingerprint algorithm is unsupported.")
    return {
        "schemaVersion": schema,
        "artifactId": text(value["artifactId"], f"occurrences[{index}].childCapture.artifactId"),
        "fingerprint": {
            "algorithm": "sha256",
            "digest": digest(fingerprint["digest"], f"occurrences[{index}].childCapture.digest"),
        },
    }


def validate_step(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(f"Occurrence {index} step must be an object.")
    exact_keys(value, ("byteCount", "byteOffset", "mediaType", "sha256"))
    if value["mediaType"] != "model/step":
        fail(f"Occurrence {index} step mediaType must be model/step.")
    byte_count = positive_int(value["byteCount"], f"occurrences[{index}].step.byteCount")
    if byte_count > MAXIMUM_CHILD_STEP_BYTES:
        fail(f"Occurrence {index} step exceeds the child STEP ceiling.")
    return {
        "mediaType": "model/step",
        "byteOffset": non_negative_int(value["byteOffset"], f"occurrences[{index}].step.byteOffset"),
        "byteCount": byte_count,
        "sha256": digest(value["sha256"], f"occurrences[{index}].step.sha256"),
    }


def slice_steps(
    occurrences: list[dict[str, object]],
    payload: bytes,
) -> list[bytes]:
    expected = sum(int(occurrence["step"]["byteCount"]) for occurrence in occurrences)
    if len(payload) != expected:
        fail("The geometry-module bundle STEP payload length is not exact.")
    steps: list[bytes] = []
    for index, occurrence in enumerate(occurrences):
        step_identity = occurrence["step"]
        start = int(step_identity["byteOffset"])
        end = start + int(step_identity["byteCount"])
        step = payload[start:end]
        if len(step) != int(step_identity["byteCount"]):
            fail(f"Occurrence {index} STEP is truncated.")
        validate_part21(step, f"occurrences[{index}].step")
        if sha256_hex(step) != step_identity["sha256"]:
            fail(f"Occurrence {index} STEP failed exact rehash.")
        steps.append(step)
    return steps


def validate_part21(value: bytes, path: str) -> None:
    text_value = decode_utf8(value, path)
    if (
        not text_value.startswith("ISO-10303-21;")
        or not text_value.rstrip().endswith("END-ISO-10303-21;")
        or "\x00" in text_value
    ):
        fail(f"{path} is not one complete STEP Part 21 exchange file.")


def reject_duplicate_object_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            fail("The geometry-module bundle manifest contains a duplicate key.")
        result[key] = value
    return result


def reject_json_constant(value: str) -> object:
    fail(f"The geometry-module bundle manifest contains unsupported constant {value}.")


def exact_keys(value: dict[str, object], keys: tuple[str, ...]) -> None:
    if tuple(sorted(value)) != tuple(sorted(keys)):
        fail("A geometry-module record has an unsupported shape.")


def text(value: object, path: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        fail(f"{path} is invalid.")
    return value


def digest(value: object, path: str) -> str:
    result = text(value, path)
    if len(result) != 64 or any(character not in SHA256_HEX for character in result):
        fail(f"{path} is not SHA-256.")
    return result


def triple(value: object, path: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        fail(f"{path} must contain three finite numbers.")
    numbers: list[float] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
            fail(f"{path} must contain three finite numbers.")
        numbers.append(float(item))
    return numbers


def positive_int(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        fail(f"{path} must be a positive integer.")
    return value


def non_negative_int(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail(f"{path} must be a non-negative integer.")
    return value


def decode_utf8(value: bytes, path: str) -> str:
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"{path} is not exact UTF-8.")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def fail(message: str) -> None:
    raise GeometryModuleBundleError(message)
