import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { TigerBeetleConfig } from '../src/index.js';

const execFileAsync = promisify(execFile);

// Pinned to the client version (`tigerbeetle-node`): server and client must match,
// so this is the single place the engine version is stated [LAW:one-source-of-truth].
const TB_VERSION = '0.17.7';

const assetUrl = (): string => {
  const base = `https://github.com/tigerbeetle/tigerbeetle/releases/download/${TB_VERSION}`;
  if (process.platform === 'darwin') return `${base}/tigerbeetle-universal-macos.zip`;
  if (process.platform === 'linux') {
    return process.arch === 'arm64'
      ? `${base}/tigerbeetle-aarch64-linux.zip`
      : `${base}/tigerbeetle-x86_64-linux.zip`;
  }
  throw new Error(`no tigerbeetle binary mapping for ${process.platform}/${process.arch}`);
};

/**
 * The tigerbeetle binary, provisioned once and cached under the gitignored
 * `.data/`. An explicit `TIGERBEETLE_BINARY` wins (a CI image can pre-stage it);
 * otherwise it is downloaded. There is no silent skip: if the binary cannot be
 * obtained the integration suite fails loudly, because "the money path could not be
 * verified" must look like a failure, never like success [LAW:no-silent-failure].
 */
const ensureBinary = async (): Promise<string> => {
  const override = process.env.TIGERBEETLE_BINARY;
  if (override !== undefined && override.length > 0) {
    await access(override);
    return override;
  }

  const cacheDir = join(process.cwd(), '.data', 'tigerbeetle', TB_VERSION);
  const binPath = join(cacheDir, 'tigerbeetle');
  try {
    await access(binPath);
    return binPath;
  } catch {
    // not cached yet — download it below
  }

  await mkdir(cacheDir, { recursive: true });
  const url = assetUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download tigerbeetle ${TB_VERSION} from ${url}: ${response.status}`);
  }
  const zipPath = join(cacheDir, 'tigerbeetle.zip');
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  await execFileAsync('unzip', ['-o', zipPath, '-d', cacheDir]);
  await chmod(binPath, 0o755);
  return binPath;
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not acquire an ephemeral port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

const waitForListening = (proc: ChildProcess, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes('listening on')) finish();
    };
    const onExit = (code: number | null): void =>
      fail(new Error(`tigerbeetle exited before listening (code ${String(code)}):\n${output}`));
    const timer = setTimeout(
      () => fail(new Error(`tigerbeetle did not start within ${timeoutMs}ms:\n${output}`)),
      timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
    };
    const finish = (): void => {
      cleanup();
      resolve();
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', onExit);
  });

export interface RunningTigerBeetle {
  readonly config: TigerBeetleConfig;
  stop(): Promise<void>;
}

/**
 * Boots a fresh single-replica TigerBeetle cluster on an ephemeral port over a
 * throwaway data file, and returns the config to point a ledger at it plus a
 * `stop()` that kills the server and removes the file. Each call is fully isolated
 * (its own data file), so a suite's tests never see each other's movements through
 * the engine.
 */
export const startTigerBeetle = async (): Promise<RunningTigerBeetle> => {
  const binary = await ensureBinary();
  const dir = await mkdtemp(join(tmpdir(), 'tb-it-'));
  const dataFile = join(dir, '0_0.tigerbeetle');
  await execFileAsync(binary, ['format', '--cluster=0', '--replica=0', '--replica-count=1', dataFile]);

  const port = await freePort();
  const address = `127.0.0.1:${port}`;
  const server = spawn(binary, ['start', `--addresses=${address}`, dataFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListening(server, 30_000);

  return {
    config: { clusterId: 0n, replicaAddresses: [address] },
    stop: async (): Promise<void> => {
      server.kill('SIGKILL');
      await rm(dir, { recursive: true, force: true });
    },
  };
};
