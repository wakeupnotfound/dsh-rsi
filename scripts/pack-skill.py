#!/usr/bin/env python3
"""
Package the RSI skill into a clean zip distribution for SkillHub / Agent Skill Registries.
Excludes macOS metadata, .DS_Store, and temporary files.
Sets deterministic Unix permissions and POSIX relative paths.
"""
import os
import sys
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SKILL_DIR = ROOT_DIR / "skills" / "rsi"
DEST_ZIP = ROOT_DIR / "skills" / "rsi.zip"

EXCLUDE_DIRS = {".git", ".idea", ".vscode", "node_modules", "__pycache__", "__MACOSX"}
EXCLUDE_EXTS = (".pyc", ".DS_Store", "Thumbs.db")


def pack_skill(skill_dir: Path, dest_zip: Path) -> None:
    if not skill_dir.is_dir():
        print(f"Error: Skill directory not found: {skill_dir}", file=sys.stderr)
        sys.exit(1)

    if dest_zip.exists():
        dest_zip.unlink()

    collected = []
    for root, dirs, files in os.walk(str(skill_dir)):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for fname in sorted(files):
            if any(fname.endswith(ext) for ext in EXCLUDE_EXTS) or fname.startswith("."):
                continue
            abs_path = Path(root) / fname
            rel_path = abs_path.relative_to(skill_dir).as_posix()
            collected.append((abs_path, rel_path))

    with zipfile.ZipFile(str(dest_zip), mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for abs_path, rel_path in collected:
            zi = zipfile.ZipInfo(filename=rel_path)
            zi.create_system = 3  # Unix
            zi.compress_type = zipfile.ZIP_DEFLATED
            st = abs_path.stat()
            zi.external_attr = (st.st_mode & 0xFFFF) << 16
            zf.writestr(zi, abs_path.read_bytes())

    print(f"Packed {len(collected)} files into {dest_zip} ({dest_zip.stat().st_size} bytes)")


if __name__ == "__main__":
    pack_skill(SKILL_DIR, DEST_ZIP)
