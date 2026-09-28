#!/usr/bin/env python3
"""Securely replace X_BEARER_TOKEN in a Swartzit worker env file."""

from __future__ import annotations

import argparse
import os
import platform
import re
import shlex
import stat
import sys
import tempfile
from pathlib import Path


MAX_TOKEN_LENGTH = 8192
TOKEN_PATTERN = re.compile(r"(?:[A-Za-z0-9._~+/=-]|%[A-Fa-f0-9]{2})+\Z")


def default_env_file() -> Path:
    configured = os.environ.get("SWARTZIT_WORKER_ENV_FILE")
    if configured:
        return Path(configured).expanduser()
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Swartzit" / "worker.env"
    return Path("/etc/swartzit/worker.env")


def read_token() -> str:
    raw = sys.stdin.buffer.read(MAX_TOKEN_LENGTH + 3)
    if raw.endswith(b"\r\n"):
        raw = raw[:-2]
    elif raw.endswith(b"\n"):
        raw = raw[:-1]
    try:
        token = raw.decode("ascii")
    except UnicodeDecodeError:
        raise ValueError("X_BEARER_TOKEN must contain ASCII characters only") from None
    if not token or len(token) > MAX_TOKEN_LENGTH or TOKEN_PATTERN.fullmatch(token) is None:
        raise ValueError("X_BEARER_TOKEN is empty, too long, or has unsupported characters")
    return token


def replace_token(path: Path, token: str, create: bool) -> None:
    if not path.exists() and not create:
        raise FileNotFoundError(f"Worker environment file does not exist: {path}")

    original_stat = path.stat() if path.exists() else None
    if original_stat and not stat.S_ISREG(original_stat.st_mode):
        raise ValueError("Worker environment path is not a regular file")

    original = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = original.splitlines()
    retained = [line for line in lines if re.match(r"^\s*X_BEARER_TOKEN\s*=", line) is None]
    retained.append(f"X_BEARER_TOKEN={shlex.quote(token)}")
    updated = "\n".join(retained) + "\n"

    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(fd, 0o600)
        if original_stat is not None:
            try:
                os.fchown(fd, original_stat.st_uid, original_stat.st_gid)
            except PermissionError:
                pass
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, help="worker env file (defaults to the platform path)")
    parser.add_argument("--create", action="store_true", help="create the worker env file if it is missing")
    args = parser.parse_args()
    path = args.file.expanduser() if args.file else default_env_file()

    try:
        token = read_token()
        replace_token(path, token, args.create)
    except (OSError, ValueError) as error:
        print(f"Could not update worker X API token: {error}", file=sys.stderr)
        return 1

    print(f"Updated X_BEARER_TOKEN in {path} (mode 0600).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
