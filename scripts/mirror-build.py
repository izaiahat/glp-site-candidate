#!/usr/bin/env python3
"""Serialize an isolated mirror build; do not use the live candidate's host lock."""
import fcntl
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / ".mirror-build.lock"


def main() -> int:
    with LOCK.open("a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("mirror_build_lock_held", file=sys.stderr)
            return 75
        # Keep the descriptor in the command process as well, so a terminated
        # wrapper cannot release the lock while generation is still running.
        # Refresh the existing registered email-link producer before the build
        # imports its generated module. Raw current HOLD changes must reach this
        # consumer too; build-staging still enforces full manifest equality.
        generated = subprocess.run(
            ["node", "scripts/migrate-cost-affiliate-email-manifest.mjs", "--current-holds-only"], cwd=ROOT,
            pass_fds=(lock.fileno(),), check=False)
        if generated.returncode:
            return generated.returncode
        return subprocess.run(["npm", "run", "build:validated"], cwd=ROOT,
                              pass_fds=(lock.fileno(),), check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
