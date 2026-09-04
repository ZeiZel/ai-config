import { lstatSync, renameSync } from "node:fs";

const [source, destination] = process.argv.slice(2);
if (!source || !destination || process.argv.length !== 4) {
  console.error("usage: atomic-rename <source> <destination>");
  process.exit(64);
}

try {
  lstatSync(destination);
  console.error(`destination already exists: ${destination}`);
  process.exit(73);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

// Both paths are checkout-local. rename(2) is same-filesystem and cannot
// silently nest source inside a destination that appeared during the check.
renameSync(source, destination);
