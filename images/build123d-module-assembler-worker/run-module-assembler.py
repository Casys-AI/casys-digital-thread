"""Image-owned Build123d module assembler.

Decodes and rehashes one geometry-module-input-bundle/1.0, stages each child
STEP on a fixed path, applies right-handed mm extrinsic XYZ placements, builds
one compound, and writes the server-fixed assembly STEP and binary GLB.
The caller supplies no program. Success does not assert collision freedom.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sys


def load_image_owned_sibling(module_name: str):
    """Load one code-owned sibling next to this wrapper.

    Isolated `python -I` ignores PYTHONPATH and the script directory, so a
    normal import of geometry_module_bundle would fail.
    """
    path = Path(__file__).resolve().with_name(f"{module_name}.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(
            f"casys-module-assembler:The image-owned sibling {module_name} is missing."
        )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


geometry_module_bundle = load_image_owned_sibling("geometry_module_bundle")
GeometryModuleBundleError = geometry_module_bundle.GeometryModuleBundleError
parse_bundle = geometry_module_bundle.parse_bundle
stage_child_steps = geometry_module_bundle.stage_child_steps

from build123d import Compound, Location, export_gltf, export_step, import_step
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec


BUNDLE_PATH = Path("/input/geometry-module.bundle")
OUTPUT_DIRECTORY = Path("/out")
WORK_DIRECTORY = Path("/work")
CHILD_DIRECTORY = WORK_DIRECTORY / "children"
CONTROL_DIRECTORY = WORK_DIRECTORY / ".casys"
QUIESCENCE_PATH = CONTROL_DIRECTORY / "quiesced.json"
STDOUT_PATH = CONTROL_DIRECTORY / "stdout.bin"
STDERR_PATH = CONTROL_DIRECTORY / "stderr.bin"
ASSEMBLY_STEP_PATH = OUTPUT_DIRECTORY / "assembly.step"
ASSEMBLY_GLB_PATH = OUTPUT_DIRECTORY / "assembly.glb"
# SOURCE_DATE_EPOCH=0 convention. The wrapper never reads the caller environment.
CANONICAL_FILE_NAME_TIMESTAMP = b"1970-01-01T00:00:00"
assert len(CANONICAL_FILE_NAME_TIMESTAMP) == 19
FILE_NAME_TOKEN_RE = re.compile(rb"\bFILE_NAME\b")
OCC_FILE_NAME_TIMESTAMP_RE = re.compile(
    rb"FILE_NAME\s*\(\s*'Open CASCADE Shape Model'\s*,\s*'"
    rb"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})'"
)
QUOTED_ISO_SECOND_TIMESTAMP_RE = re.compile(
    rb"'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})'"
)
QUIESCENCE_TEXT = (
    '{"schemaVersion":"casys-geometry-module-assembler-quiescence/1.0",'
    '"status":"bundle-decoded-compound-exported"}\n'
)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != str(BUNDLE_PATH) or sys.argv[2] != str(OUTPUT_DIRECTORY):
        fail("The fixed module assembler requires its registered paths.")
    os.umask(0o077)
    bundle_bytes = BUNDLE_PATH.read_bytes()
    try:
        bundle = parse_bundle(bundle_bytes)
    except GeometryModuleBundleError as error:
        fail(str(error))
    assert_empty_directory(OUTPUT_DIRECTORY)
    CHILD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    staged = stage_child_steps(bundle, CHILD_DIRECTORY)
    occurrences = bundle["occurrences"]
    if not isinstance(occurrences, list) or len(occurrences) != len(staged):
        fail("The staged child STEP table is incomplete.")
    placed = []
    for index, occurrence in enumerate(occurrences):
        if not isinstance(occurrence, dict):
            fail(f"Occurrence {index} is not an object.")
        imported = import_step(str(staged[index]))
        if imported is None:
            fail(f"Child STEP {index} could not be imported from its staged path.")
        location = extrinsic_xyz_location(occurrence["placement"])
        placed_shape = location * imported
        label_placed_occurrence(placed_shape, occurrence)
        placed.append(placed_shape)
    compound = Compound(children=placed)
    if export_step(compound, ASSEMBLY_STEP_PATH) is not True:
        fail("Assembly STEP export was rejected.")
    normalize_assembly_step_file_name_timestamp(ASSEMBLY_STEP_PATH)
    if export_gltf(compound, str(ASSEMBLY_GLB_PATH), binary=True) is not True:
        fail("Assembly GLB export was rejected.")
    ASSEMBLY_STEP_PATH.chmod(0o400)
    ASSEMBLY_GLB_PATH.chmod(0o400)
    assert_exact_outputs()
    write_control_evidence()


def label_placed_occurrence(shape: object, occurrence: object) -> object:
    """Stamp usageElementId on the already-transformed child. Location may drop labels."""
    if not isinstance(occurrence, dict):
        fail("An occurrence record is required.")
    usage = occurrence.get("usageElementId")
    if not isinstance(usage, str) or usage == "":
        fail("An occurrence usageElementId is required.")
    try:
        setattr(shape, "label", usage)
    except Exception:
        fail("The placed shape refused the occurrence usage label.")
    if getattr(shape, "label", None) != usage:
        fail("The placed shape usage label readback differs.")
    return shape


def extrinsic_xyz_location(placement: object) -> Location:
    """Right-handed mm pose: R = Rz Ry Rx about fixed axes, then p' = R p + t."""
    if not isinstance(placement, dict):
        fail("A placement record is required.")
    translation = placement.get("translationMm")
    rotation = placement.get("rotationDeg")
    if not isinstance(translation, list) or not isinstance(rotation, list):
        fail("Placement vectors must be triples.")
    rx, ry, rz = [math.radians(float(angle)) for angle in rotation]
    rx_t = gp_Trsf()
    rx_t.SetRotation(gp_Ax1(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(1.0, 0.0, 0.0)), rx)
    ry_t = gp_Trsf()
    ry_t.SetRotation(gp_Ax1(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 1.0, 0.0)), ry)
    rz_t = gp_Trsf()
    rz_t.SetRotation(gp_Ax1(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 0.0, 1.0)), rz)
    rotation_trsf = rz_t.Multiplied(ry_t).Multiplied(rx_t)
    translation_trsf = gp_Trsf()
    translation_trsf.SetTranslation(
        gp_Vec(float(translation[0]), float(translation[1]), float(translation[2])),
    )
    return Location(translation_trsf.Multiplied(rotation_trsf))


def normalize_assembly_step_file_name_timestamp(path: Path) -> None:
    original = path.read_bytes()
    offset = locate_unique_file_name_timestamp(original)
    with path.open("r+b") as handle:
        handle.seek(offset)
        written = handle.write(CANONICAL_FILE_NAME_TIMESTAMP)
        if written != len(CANONICAL_FILE_NAME_TIMESTAMP):
            fail("The assembly STEP FILE_NAME timestamp rewrite was incomplete.")
    rewritten = path.read_bytes()
    stamp_end = offset + len(CANONICAL_FILE_NAME_TIMESTAMP)
    if len(rewritten) != len(original):
        fail("The assembly STEP byte count changed during FILE_NAME timestamp rewrite.")
    if rewritten[:offset] != original[:offset] or rewritten[stamp_end:] != original[stamp_end:]:
        fail("Assembly STEP bytes outside the FILE_NAME timestamp changed.")
    reread_offset = locate_unique_file_name_timestamp(rewritten)
    if (
        reread_offset != offset
        or rewritten[offset:stamp_end] != CANONICAL_FILE_NAME_TIMESTAMP
    ):
        fail("The assembly STEP FILE_NAME timestamp reread is not the canonical field.")


def locate_unique_file_name_timestamp(data: bytes) -> int:
    header_mark = b"HEADER;"
    endsec_mark = b"ENDSEC;"
    header_at = data.find(header_mark)
    if header_at < 0:
        fail("The assembly STEP header is missing.")
    start = header_at + len(header_mark)
    end = data.find(endsec_mark, start)
    if end < 0:
        fail("The assembly STEP header is not terminated.")
    header = data[start:end]
    token_count = len(FILE_NAME_TOKEN_RE.findall(header))
    if token_count != 1:
        fail(
            "The assembly STEP header FILE_NAME token is missing."
            if token_count == 0
            else "The assembly STEP header FILE_NAME token is duplicated."
        )
    field_matches = list(OCC_FILE_NAME_TIMESTAMP_RE.finditer(header))
    if len(field_matches) != 1:
        fail(
            "The assembly STEP header FILE_NAME timestamp field is missing or malformed."
            if len(field_matches) == 0
            else "The assembly STEP header FILE_NAME timestamp field is duplicated."
        )
    quoted = list(QUOTED_ISO_SECOND_TIMESTAMP_RE.finditer(header))
    field = field_matches[0]
    if len(quoted) != 1 or quoted[0].start(1) != field.start(1):
        fail("The assembly STEP header FILE_NAME timestamp is ambiguous.")
    return start + field.start(1)


def assert_empty_directory(path: Path) -> None:
    if any(path.iterdir()):
        fail("The output directory is not empty.")


def assert_exact_outputs() -> None:
    observed = sorted(
        entry.name
        for entry in OUTPUT_DIRECTORY.iterdir()
        if entry.is_file() and not entry.is_symlink()
    )
    if observed != ["assembly.glb", "assembly.step"]:
        fail("The module assembler emitted an unexpected output set.")
    if ASSEMBLY_STEP_PATH.stat().st_size <= 0 or ASSEMBLY_GLB_PATH.stat().st_size <= 0:
        fail("An assembly output is empty.")


def write_control_evidence() -> None:
    CONTROL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    STDOUT_PATH.write_bytes(b"")
    STDERR_PATH.write_bytes(b"")
    STDOUT_PATH.chmod(0o400)
    STDERR_PATH.chmod(0o400)
    QUIESCENCE_PATH.write_text(QUIESCENCE_TEXT, encoding="ascii")
    QUIESCENCE_PATH.chmod(0o400)
    observed = sorted(entry.name for entry in CONTROL_DIRECTORY.iterdir())
    if (
        observed != ["quiesced.json", "stderr.bin", "stdout.bin"]
        or QUIESCENCE_PATH.read_text(encoding="ascii") != QUIESCENCE_TEXT
        or STDOUT_PATH.stat().st_size != 0
        or STDERR_PATH.stat().st_size != 0
    ):
        fail("The module-assembler control evidence failed its exact reread.")


def fail(message: str) -> None:
    raise SystemExit(f"casys-module-assembler:{message}")


if __name__ == "__main__":
    main()
