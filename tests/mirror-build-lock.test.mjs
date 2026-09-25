import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The mirror must fail closed under a concurrent build instead of using the
// absent live-host lock or allowing two writers into generated output.
test("mirror build refuses a second writer while its local lock is held", () => {
  const code = `import fcntl, subprocess
from pathlib import Path
root = Path.cwd()
with (root / '.mirror-build.lock').open('a+b') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    result = subprocess.run(['python3', 'scripts/mirror-build.py'], capture_output=True, text=True)
    assert result.returncode == 75, (result.returncode, result.stdout, result.stderr)
    assert 'mirror_build_lock_held' in result.stderr
`;
  const result = spawnSync("python3", ["-c", code], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
