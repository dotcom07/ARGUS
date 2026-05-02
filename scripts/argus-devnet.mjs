#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_DIR = path.join(ROOT_DIR, "programs/argus-registry");
const DEVNET_KEYPAIR_ENV_PATH = ".argus-devnet-keypair.json";
const DEVNET_KEYPAIR_PATH = path.join(ROOT_DIR, ".argus-devnet-keypair.json");
const REGISTRY_PROGRAM_KEYPAIR_PATH = path.join(ROOT_DIR, ".argus-registry-program-keypair.json");
const ANCHOR_PROGRAM_KEYPAIR_PATH = path.join(
  ROOT_DIR,
  "target/deploy/argus_registry-keypair.json",
);
const LEGACY_ANCHOR_PROGRAM_KEYPAIR_PATH = path.join(
  REGISTRY_DIR,
  "target/deploy/argus_registry-keypair.json",
);
const ANCHOR_PROGRAM_SO_PATH = path.join(ROOT_DIR, "target/deploy/argus_registry.so");
const LEGACY_ANCHOR_PROGRAM_SO_PATH = path.join(REGISTRY_DIR, "target/deploy/argus_registry.so");
const DOTENV_PATH = path.join(ROOT_DIR, ".env");
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_DEMO_APP_IDENTITY_HASH =
  "c5f00555103b31cc35ccbd6119db30b93d1a8244302361acca205c01ff7d247e";
const CONFIRMED_COMMITMENT = "confirmed";
const SIGNATURE_CONFIRM_TIMEOUT_MS = 90_000;
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

const command = process.argv[2] ?? "help";
const commandArgs = process.argv.slice(3);

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "prepare") {
    await prepareDevnetDeployment();
  } else if (command === "deploy") {
    await deployDevnet({ initializeAfterDeploy: commandArgs.includes("--init") });
  } else if (command === "init" || command === "initialize") {
    await initializeRegistryConfig();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Argus devnet helper

Usage:
  node scripts/argus-devnet.mjs prepare
  node scripts/argus-devnet.mjs deploy
  node scripts/argus-devnet.mjs deploy --init
  node scripts/argus-devnet.mjs init

prepare      Generates/syncs the ignored program keypair, source program id, and .env.
deploy       Runs Anchor build + Solana CLI deploy against devnet with the synced program keypair.
deploy --init Runs deploy, then initialize_config/update_authorized_relayer.
init         Idempotently initializes or updates the registry config PDA.
`);
}

async function prepareDevnetDeployment() {
  const relayerKeypair = await readKeypair(DEVNET_KEYPAIR_PATH, ".argus-devnet-keypair.json");
  const programKeypair = await ensureRegistryProgramKeypair();
  const programId = programKeypair.publicKey.toBase58();
  const authorizedRelayer = relayerKeypair.publicKey.toBase58();

  await syncSourceProgramIds({ programId, authorizedRelayer });
  await syncDotEnv({ programId, authorizedRelayer });

  console.log(`Argus devnet deployment prepared`);
  console.log(`Program ID: ${programId}`);
  console.log(`Authorized relayer: ${authorizedRelayer}`);
  console.log(`Relayer keypair: ${DEVNET_KEYPAIR_PATH}`);
}

async function deployDevnet({ initializeAfterDeploy }) {
  await prepareDevnetDeployment();
  assertCommandAvailable("anchor");
  assertCommandAvailable("solana");
  assertCommandAvailable("cargo", ["build-sbf", "--version"], "cargo build-sbf");

  runCommand("anchor", [
    "build",
    "--provider.cluster",
    "devnet",
    "--provider.wallet",
    DEVNET_KEYPAIR_PATH,
  ]);
  const programSoPath = await findAnchorProgramSoPath();
  const rpcUrl = await resolveRpcUrl();

  runCommand("solana", [
    "program",
    "deploy",
    programSoPath,
    "--program-id",
    REGISTRY_PROGRAM_KEYPAIR_PATH,
    "--keypair",
    DEVNET_KEYPAIR_PATH,
    "--url",
    rpcUrl,
  ]);

  if (initializeAfterDeploy) {
    await initializeRegistryConfig();
  }
}

async function initializeRegistryConfig() {
  const relayerKeypair = await readKeypair(DEVNET_KEYPAIR_PATH, ".argus-devnet-keypair.json");
  const programKeypair = await ensureRegistryProgramKeypair();
  const programId = programKeypair.publicKey;
  const rpcUrl = await resolveRpcUrl();
  const connection = new Connection(rpcUrl, CONFIRMED_COMMITMENT);
  const [configAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("argus-config")],
    programId,
  );
  const existingConfig = await connection.getAccountInfo(configAccount, "confirmed");

  if (!existingConfig) {
    const signature = await sendAndConfirmViaHttp(
      connection,
      new Transaction().add(buildInitializeConfigInstruction({ programId, relayerKeypair, configAccount })),
      [relayerKeypair],
    );
    console.log(`Initialized Argus registry config: ${signature}`);
    console.log(`Config PDA: ${configAccount.toBase58()}`);
    return;
  }

  const config = decodeRegistryConfig(existingConfig.data);
  if (config.authorizedRelayer.equals(relayerKeypair.publicKey)) {
    console.log(`Argus registry config already initialized`);
    console.log(`Config PDA: ${configAccount.toBase58()}`);
    console.log(`Authorized relayer: ${config.authorizedRelayer.toBase58()}`);
    return;
  }

  if (!config.admin.equals(relayerKeypair.publicKey)) {
    throw new Error(
      `Registry config admin is ${config.admin.toBase58()}, but ${DEVNET_KEYPAIR_PATH} is ${relayerKeypair.publicKey.toBase58()}`,
    );
  }

  const signature = await sendAndConfirmViaHttp(
    connection,
    new Transaction().add(buildUpdateAuthorizedRelayerInstruction({ programId, relayerKeypair, configAccount })),
    [relayerKeypair],
  );
  console.log(`Updated Argus registry authorized relayer: ${signature}`);
  console.log(`Config PDA: ${configAccount.toBase58()}`);
}

async function sendAndConfirmViaHttp(connection, transaction, signers) {
  const latestBlockhash = await connection.getLatestBlockhash(CONFIRMED_COMMITMENT);
  transaction.feePayer = signers[0].publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.sign(...signers);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: CONFIRMED_COMMITMENT,
    maxRetries: 5,
  });
  await waitForSignatureViaHttp(connection, signature, latestBlockhash.lastValidBlockHeight);
  return signature;
}

async function waitForSignatureViaHttp(connection, signature, lastValidBlockHeight) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SIGNATURE_CONFIRM_TIMEOUT_MS) {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = response.value[0];

    if (status?.err) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized" ||
      status?.confirmations === null
    ) {
      return;
    }

    const currentBlockHeight = await connection.getBlockHeight(CONFIRMED_COMMITMENT);
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error(`Transaction ${signature} expired before confirmation`);
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for transaction ${signature} confirmation`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildInitializeConfigInstruction({ programId, relayerKeypair, configAccount }) {
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: configAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator("global:initialize_config"),
      relayerKeypair.publicKey.toBuffer(),
    ]),
  });
}

function buildUpdateAuthorizedRelayerInstruction({ programId, relayerKeypair, configAccount }) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configAccount, isSigner: false, isWritable: true },
      { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator("global:update_authorized_relayer"),
      relayerKeypair.publicKey.toBuffer(),
    ]),
  });
}

function anchorDiscriminator(name) {
  return createHash("sha256").update(name).digest().subarray(0, 8);
}

function decodeRegistryConfig(data) {
  if (data.byteLength < 73) {
    throw new Error("Argus registry config account is too small");
  }

  return {
    admin: new PublicKey(data.subarray(8, 40)),
    authorizedRelayer: new PublicKey(data.subarray(40, 72)),
    bump: data[72],
  };
}

async function ensureRegistryProgramKeypair() {
  const programKeypair = await readOrCreateKeypair(
    REGISTRY_PROGRAM_KEYPAIR_PATH,
    ".argus-registry-program-keypair.json",
  );
  await mkdir(path.dirname(ANCHOR_PROGRAM_KEYPAIR_PATH), { recursive: true });
  await mkdir(path.dirname(LEGACY_ANCHOR_PROGRAM_KEYPAIR_PATH), { recursive: true });
  const keypairJson = `${JSON.stringify(Array.from(programKeypair.secretKey))}\n`;
  await writeFile(ANCHOR_PROGRAM_KEYPAIR_PATH, keypairJson, { mode: 0o600 });
  await writeFile(LEGACY_ANCHOR_PROGRAM_KEYPAIR_PATH, keypairJson, { mode: 0o600 });
  return programKeypair;
}

async function readOrCreateKeypair(filePath, label) {
  try {
    return await readKeypair(filePath, label);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("does not exist")) {
      throw error;
    }

    const keypair = Keypair.generate();
    await writeFile(filePath, `${JSON.stringify(Array.from(keypair.secretKey))}\n`, {
      mode: 0o600,
    });
    return keypair;
  }
}

async function readKeypair(filePath, label) {
  let rawKeypair;
  try {
    rawKeypair = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} does not exist at ${filePath}`);
    }

    throw error;
  }

  const parsed = JSON.parse(rawKeypair);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a Solana JSON keypair array`);
  }

  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

async function syncSourceProgramIds({ programId, authorizedRelayer }) {
  const replacements = [
    {
      file: "programs/argus-registry/src/lib.rs",
      patterns: [[/declare_id!\("[^"]+"\);/, `declare_id!("${programId}");`]],
    },
    {
      file: "Anchor.toml",
      patterns: [[/(argus_registry\s*=\s*")[^"]+(")/g, `$1${programId}$2`]],
    },
    {
      file: "programs/argus-registry/Anchor.toml",
      patterns: [[/(argus_registry\s*=\s*")[^"]+(")/g, `$1${programId}$2`]],
    },
    {
      file: "packages/argus-rn-sdk/src/proofStatus.ts",
      patterns: [
        [/export const ARGUS_REGISTRY_PROGRAM_ID = "[^"]+";/, `export const ARGUS_REGISTRY_PROGRAM_ID = "${programId}";`],
        [/export const ARGUS_AUTHORIZED_RELAYER = "[^"]+";/, `export const ARGUS_AUTHORIZED_RELAYER = "${authorizedRelayer}";`],
      ],
    },
    {
      file: "packages/argus-rn-sdk/src/demoProof.mjs",
      patterns: [
        [/const ARGUS_REGISTRY_PROGRAM_ID = "[^"]+";/, `const ARGUS_REGISTRY_PROGRAM_ID = "${programId}";`],
        [/const ARGUS_AUTHORIZED_RELAYER = "[^"]+";/, `const ARGUS_AUTHORIZED_RELAYER = "${authorizedRelayer}";`],
      ],
    },
    {
      file: "packages/argus-rn-sdk/src/demoProof.security.test.mjs",
      patterns: [
        [/const ARGUS_REGISTRY_PROGRAM_ID = "[^"]+";/, `const ARGUS_REGISTRY_PROGRAM_ID = "${programId}";`],
        [/const ARGUS_AUTHORIZED_RELAYER = "[^"]+";/, `const ARGUS_AUTHORIZED_RELAYER = "${authorizedRelayer}";`],
      ],
    },
    {
      file: "api/relayer/submitRegisterProof.mjs",
      patterns: [[/const TRUSTED_REGISTRY_PROGRAM_ID = "[^"]+";/, `const TRUSTED_REGISTRY_PROGRAM_ID = "${programId}";`]],
    },
    {
      file: "api/relayer/submitRegisterProof.security.test.mjs",
      patterns: [[/const TRUSTED_REGISTRY_PROGRAM_ID = "[^"]+";/, `const TRUSTED_REGISTRY_PROGRAM_ID = "${programId}";`]],
    },
    {
      file: "api/relayer/registerProof.mjs",
      patterns: [[/const DEFAULT_REGISTRY_ADDRESS = "[^"]+";/, `const DEFAULT_REGISTRY_ADDRESS = "${programId}";`]],
    },
    {
      file: ".env.example",
      patterns: [[/^ARGUS_REGISTRY_PROGRAM_ID=.*$/m, `ARGUS_REGISTRY_PROGRAM_ID=${programId}`]],
    },
  ];

  for (const { file, patterns } of replacements) {
    const filePath = path.join(ROOT_DIR, file);
    let source = await readFile(filePath, "utf8");
    for (const [pattern, replacement] of patterns) {
      if (!pattern.test(source)) {
        throw new Error(`Could not sync ${file}: pattern ${pattern} was not found`);
      }
      source = source.replace(pattern, replacement);
    }
    await writeFile(filePath, source, "utf8");
  }
}

async function syncDotEnv({ programId, authorizedRelayer }) {
  const envText = await readOptionalText(DOTENV_PATH);
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    getEnvValue(envText, "SOLANA_RPC_URL") ||
    getEnvValue(envText, "ANCHOR_PROVIDER_URL") ||
    DEFAULT_RPC_URL;
  const verifierAllowlist =
    getEnvValue(envText, "ARGUS_VERIFIER_BASE_URL_ALLOWLIST") ||
    JSON.stringify([await readConfiguredDemoBackendUrl()]);
  const partnerAllowlist =
    getEnvValue(envText, "ARGUS_PARTNER_APP_ALLOWLIST") ||
    JSON.stringify([
      {
        partnerId: "recommerce-demo",
        useCases: ["marketplace_listing"],
        appIdentityHashes: [DEFAULT_DEMO_APP_IDENTITY_HASH],
      },
    ]);

  const nextEnv = upsertEnvValues(envText, {
    SOLANA_CLUSTER: "devnet",
    SOLANA_RPC_URL: rpcUrl,
    ANCHOR_PROVIDER_URL: rpcUrl,
    ANCHOR_WALLET: DEVNET_KEYPAIR_ENV_PATH,
    SOLANA_KEYPAIR_PATH: DEVNET_KEYPAIR_ENV_PATH,
    SOLANA_PUBLIC_KEY: authorizedRelayer,
    ARGUS_RELAYER_MODE: "solana",
    ARGUS_RELAYER_KEYPAIR: DEVNET_KEYPAIR_ENV_PATH,
    ARGUS_AUTHORIZED_RELAYER_PUBLIC_KEY: authorizedRelayer,
    ARGUS_REGISTRY_PROGRAM_ID: programId,
    ARGUS_VERIFIER_BASE_URL_ALLOWLIST: verifierAllowlist,
    ARGUS_PARTNER_APP_ALLOWLIST: partnerAllowlist,
  });

  await writeFile(DOTENV_PATH, nextEnv, "utf8");
}

async function resolveRpcUrl() {
  const envText = await readOptionalText(DOTENV_PATH);
  return (
    process.env.SOLANA_RPC_URL ||
    getEnvValue(envText, "SOLANA_RPC_URL") ||
    getEnvValue(envText, "ANCHOR_PROVIDER_URL") ||
    DEFAULT_RPC_URL
  );
}

async function readConfiguredDemoBackendUrl() {
  const configPath = path.join(ROOT_DIR, "apps/shared/argusDemoConfig.ts");
  const source = await readOptionalText(configPath);
  const match = source.match(/ARGUS_DEMO_BACKEND_URL\s*=\s*["']([^"']+)["']/);
  return match?.[1] ?? "https://verify.argus.dev";
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function getEnvValue(envText, key) {
  const line = envText
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) {
    return undefined;
  }

  return line.slice(key.length + 1).trim();
}

function upsertEnvValues(envText, values) {
  const lines = envText.split(/\r?\n/).filter((line, index, array) => line.length > 0 || index < array.length - 1);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(values, match[1])) {
      return line;
    }

    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  return `${nextLines.join("\n")}\n`;
}

function assertCommandAvailable(name, args = ["--version"], label = name) {
  const result = spawnSync(name, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} CLI is required before devnet deploy`);
  }
}

function runCommand(name, args) {
  const result = spawnSync(name, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${name} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function assertFileExists(filePath, message) {
  try {
    await access(filePath);
    return true;
  } catch {
    if (message) {
      throw new Error(message);
    }
    return false;
  }
}

async function findAnchorProgramSoPath() {
  if (await assertFileExists(ANCHOR_PROGRAM_SO_PATH)) {
    return ANCHOR_PROGRAM_SO_PATH;
  }

  if (await assertFileExists(LEGACY_ANCHOR_PROGRAM_SO_PATH)) {
    return LEGACY_ANCHOR_PROGRAM_SO_PATH;
  }

  throw new Error(
    `Anchor build did not create argus_registry.so in ${ANCHOR_PROGRAM_SO_PATH} or ${LEGACY_ANCHOR_PROGRAM_SO_PATH}`,
  );
}
