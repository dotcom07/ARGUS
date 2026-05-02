import { config as loadEnv } from "dotenv";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true });

const args = new Set(process.argv.slice(2));
const shouldDelete = args.has("--yes");
const allowOutsideRepo = args.has("--allow-outside-repo");
const showHelp = args.has("--help") || args.has("-h");
const defaultDataDir = path.join(repoRoot, ".argus-relayer-data");

if (showHelp) {
  printUsage();
  process.exit(0);
}

const targets = buildCleanupTargets();
const summaries = [];

for (const target of targets) {
  assertSafeTarget(target.path);
  summaries.push({
    ...target,
    stats: await collectStats(target.path),
  });
}

console.info(`Argus relayer data cleanup (${shouldDelete ? "delete" : "dry-run"})`);
for (const summary of summaries) {
  printSummary(summary);
}

if (!shouldDelete) {
  console.info("\nNo files removed. Run with --yes to delete these targets.");
  console.info("Example: npm run relayer:clear-data -- --yes");
  process.exit(0);
}

for (const summary of summaries) {
  if (!summary.stats.exists) {
    continue;
  }
  await rm(summary.path, { force: true, recursive: true });
}

console.info("\nRelayer data removed.");

function buildCleanupTargets() {
  const targetsByPath = new Map();
  addTarget(targetsByPath, defaultDataDir, "default relayer data root");

  const configuredProofDir = process.env.ARGUS_PROOF_BUNDLE_DIR?.trim();
  if (configuredProofDir) {
    addTarget(
      targetsByPath,
      resolveMaybeRelative(configuredProofDir),
      "ARGUS_PROOF_BUNDLE_DIR proof bundle store",
    );
  }

  return [...targetsByPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function addTarget(targetsByPath, targetPath, reason) {
  const resolvedPath = path.resolve(targetPath);
  const existing = targetsByPath.get(resolvedPath);
  targetsByPath.set(resolvedPath, {
    path: resolvedPath,
    reason: existing ? `${existing.reason}; ${reason}` : reason,
  });
}

function resolveMaybeRelative(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function assertSafeTarget(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const repoRelativePath = path.relative(repoRoot, resolvedPath);
  const insideRepo =
    repoRelativePath === "" ||
    (!repoRelativePath.startsWith("..") && !path.isAbsolute(repoRelativePath));

  if (!allowOutsideRepo && !insideRepo) {
    throw new Error(
      `Refusing to delete outside the repo without --allow-outside-repo: ${resolvedPath}`,
    );
  }

  const forbiddenTargets = new Set([
    path.parse(resolvedPath).root,
    path.resolve(repoRoot),
    path.resolve(repoRoot, ".."),
    path.resolve(process.env.HOME || ""),
  ]);
  if (forbiddenTargets.has(resolvedPath)) {
    throw new Error(`Refusing to delete unsafe target: ${resolvedPath}`);
  }

  if (insideRepo) {
    const normalizedRelativePath = repoRelativePath.split(path.sep).join("/");
    const isDefaultRelayerData =
      normalizedRelativePath === ".argus-relayer-data" ||
      normalizedRelativePath.startsWith(".argus-relayer-data/");
    const isConfiguredProofDir =
      process.env.ARGUS_PROOF_BUNDLE_DIR?.trim() &&
      resolvedPath === resolveMaybeRelative(process.env.ARGUS_PROOF_BUNDLE_DIR.trim());

    if (!isDefaultRelayerData && !isConfiguredProofDir) {
      throw new Error(`Refusing to delete unexpected repo path: ${resolvedPath}`);
    }
  }
}

async function collectStats(targetPath) {
  try {
    const entry = await lstat(targetPath);
    const stats = {
      bytes: 0,
      dirs: entry.isDirectory() ? 1 : 0,
      exists: true,
      files: entry.isDirectory() ? 0 : 1,
      symlinks: entry.isSymbolicLink() ? 1 : 0,
    };

    if (entry.isDirectory()) {
      await walkDirectory(targetPath, stats);
    } else {
      stats.bytes += entry.size;
    }

    return stats;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        bytes: 0,
        dirs: 0,
        exists: false,
        files: 0,
        symlinks: 0,
      };
    }
    throw error;
  }
}

async function walkDirectory(directoryPath, stats) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    const entryStats = await lstat(entryPath);

    if (entry.isSymbolicLink()) {
      stats.files += 1;
      stats.symlinks += 1;
      stats.bytes += entryStats.size;
      continue;
    }

    if (entry.isDirectory()) {
      stats.dirs += 1;
      await walkDirectory(entryPath, stats);
      continue;
    }

    stats.files += 1;
    stats.bytes += entryStats.size;
  }
}

function printSummary({ path: targetPath, reason, stats }) {
  const status = stats.exists ? "exists" : "missing";
  console.info(`- ${targetPath}`);
  console.info(`  reason: ${reason}`);
  console.info(
    `  status: ${status}, files: ${stats.files}, dirs: ${stats.dirs}, symlinks: ${stats.symlinks}, bytes: ${stats.bytes}`,
  );
}

function printUsage() {
  console.info(`Usage:
  npm run relayer:clear-data
  npm run relayer:clear-data -- --yes

Options:
  --yes                 Delete the listed relayer data targets.
  --allow-outside-repo  Allow ARGUS_PROOF_BUNDLE_DIR outside this checkout.
  --help                Show this help.

By default this is a dry-run. It clears .argus-relayer-data and, when set,
ARGUS_PROOF_BUNDLE_DIR. It does not delete .env, keypairs, target, or deploy files.`);
}
