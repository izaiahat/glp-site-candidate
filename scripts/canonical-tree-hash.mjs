#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const EXCLUDED_COMPONENTS = new Set([
  ".git",
  ".pytest_cache",
  ".wrangler",
  "__pycache__",
  "node_modules",
  "test-results",
]);

function excluded(parts) {
  return parts.some((part) => EXCLUDED_COMPONENTS.has(part)) || parts.at(-1)?.endsWith(".pyc");
}

async function collect(root, directory = root, parts = [], output = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const nextParts = [...parts, entry.name];
    if (excluded(nextParts)) continue;
    const absolute = path.join(directory, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`canonical_tree_symlink_rejected:${nextParts.join("/")}`);
    if (stat.isDirectory()) {
      await collect(root, absolute, nextParts, output);
    } else if (stat.isFile()) {
      output.push({ absolute, relative: nextParts.join("/") });
    } else {
      throw new Error(`canonical_tree_special_rejected:${nextParts.join("/")}`);
    }
  }
  return output;
}

export async function canonicalTreeHash(rootInput) {
  const root = path.resolve(rootInput);
  const files = await collect(root);
  files.sort((left, right) => Buffer.compare(Buffer.from(left.relative, "utf8"), Buffer.from(right.relative, "utf8")));
  const aggregate = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const pathBytes = Buffer.from(file.relative, "utf8");
    if (pathBytes.length > 0xffffffff) throw new Error("canonical_tree_path_too_long");
    const content = await readFile(file.absolute);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(pathBytes.length);
    aggregate.update(length);
    aggregate.update(pathBytes);
    aggregate.update(createHash("sha256").update(content).digest());
    bytes += content.length;
  }
  return {
    schema: "canonical-tree-sha256-v1",
    root,
    files: files.length,
    bytes,
    sha256: aggregate.digest("hex"),
    algorithm: {
      entries: "regular_files_only; reject_symlinks_and_specials",
      exclusions: [...EXCLUDED_COMPONENTS, "*.pyc"],
      path_encoding: "UTF-8 relative POSIX path",
      ordering: "ascending raw UTF-8 path bytes",
      record: "uint32be(path_byte_length) || path_bytes || sha256(file_bytes)",
      aggregate: "sha256(concatenated_records)",
    },
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = process.argv[2];
  if (!root || process.argv.length !== 3) {
    console.error("usage: canonical-tree-hash.mjs ROOT");
    process.exit(2);
  }
  console.log(JSON.stringify(await canonicalTreeHash(root)));
}
