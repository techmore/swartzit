#!/usr/bin/env python3
"""Keep updater/application code owned by root while preserving runtime data."""
import os
import stat
import sys
from pathlib import Path

# These directories contain service data, downloaded browsers or build caches.
# Their ownership is retained; they are never used as root updater sources.
RUNTIME_DIRS = {"state", ".cache", ".cargo", ".config", ".local", ".npm", "browsers", "gravedancer"}


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run this code ownership repair as root.")
    if len(sys.argv) != 2:
        raise SystemExit("Usage: swartzit-protect-code.py /var/lib/swartzit")
    app = Path(sys.argv[1])
    if not app.is_absolute() or app.is_symlink() or not (app / ".git").is_dir():
        raise SystemExit("Expected an absolute, real Swartzit Git checkout directory.")
    for name in ("scripts", "deploy", ".git"):
        if (app / name).is_symlink():
            raise SystemExit(f"Refusing a symbolic link for code directory: {name}")
    count = 0

    def protect(path):
        nonlocal count
        mode = path.lstat().st_mode
        os.chown(path, 0, 0, follow_symlinks=False)
        if not stat.S_ISLNK(mode):
            os.chmod(path, stat.S_IMODE(mode) & ~0o022)
        count += 1

    def fail(error):
        raise error

    for directory, dirs, files in os.walk(app, followlinks=False, onerror=fail):
        parent = Path(directory)
        protect(parent)
        kept = []
        for name in dirs:
            path = parent / name
            if (parent == app and name in RUNTIME_DIRS) or path.is_mount():
                continue
            if path.is_symlink():
                protect(path)
            else:
                kept.append(name)
        dirs[:] = kept
        for name in files:
            protect(parent / name)
    print(f"Protected {count} code paths under {app}; retained runtime directory ownership.")


if __name__ == "__main__":
    main()
