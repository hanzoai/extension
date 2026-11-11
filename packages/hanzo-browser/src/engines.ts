/**
 * Browser engine resolution and argument builder for `@hanzo/browser`.
 *
 * Supported engines:
 *   - `chrome`     Local Chrome / Chromium (passes Chrome WebMCP flags by default)
 *   - `lightpanda` Lightpanda ultra-fast headless Zig/V8 CDP engine
 *   - `obscura`    Obscura stealth / anti-fingerprinting CDP engine
 *   - `extension`  Live user browser over ZAP (`zapd.sock`)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { isWebMCPDisabled } from './webmcp.js';
import { getCdpVersion } from './cdp.js';

export type BrowserEngine = 'chrome' | 'lightpanda' | 'obscura' | 'extension';

export const WEBMCP_CHROME_FLAGS = [
  '--enable-features=WebMCP,ModelContextProtocol',
  '--enable-experimental-web-platform-features',
] as const;

export interface EngineLaunchOptions {
  engine?: BrowserEngine;
  headless?: boolean;
  /** Set false (`--no-webmcp`) to omit Chrome WebMCP flags and disable WebMCP hooks. */
  webmcp?: boolean;
  port?: number;
  userDataDir?: string;
  extensions?: string[];
  startUrl?: string;
  executablePath?: string;
  extraArgs?: string[];
  detached?: boolean;
  logFile?: string;
  env?: Record<string, string | undefined>;
}

function whichBinary(names: string[]): string | null {
  for (const name of names) {
    try {
      const p = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (p && fs.existsSync(p)) return p;
    } catch { /* not on PATH */ }
  }
  return null;
}

export function findEngineBinary(engine: Exclude<BrowserEngine, 'extension'> = 'chrome', explicit?: string): string {
  if (explicit && fs.existsSync(explicit)) return explicit;

  if (engine === 'lightpanda') {
    const candidates = [
      process.env.HANZO_LIGHTPANDA_BIN,
      path.join(os.homedir(), '.local', 'bin', 'lightpanda'),
      '/usr/local/bin/lightpanda',
      '/usr/bin/lightpanda',
    ].filter(Boolean) as string[];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    const fromPath = whichBinary(['lightpanda']);
    if (fromPath) return fromPath;
    throw new Error('Lightpanda binary not found. Set HANZO_LIGHTPANDA_BIN or install `lightpanda` in ~/.local/bin.');
  }

  if (engine === 'obscura') {
    const candidates = [
      process.env.HANZO_OBSCURA_BIN,
      path.join(os.homedir(), '.local', 'bin', 'obscura'),
      '/usr/local/bin/obscura',
      '/usr/bin/obscura',
    ].filter(Boolean) as string[];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    const fromPath = whichBinary(['obscura', 'obscura-browser']);
    if (fromPath) return fromPath;
    // Fallback: Chromium with Obscura stealth flags when dedicated binary is absent
    return findEngineBinary('chrome');
  }

  const chromeCandidates = [
    process.env.HANZO_BROWSER_BIN,
    process.env.CHROME_BIN,
    '/usr/local/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome',
    '/usr/local/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean) as string[];

  for (const c of chromeCandidates) {
    if (fs.existsSync(c)) return c;
  }

  const fromPath = whichBinary(['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']);
  if (fromPath) return fromPath;

  throw new Error('No Chrome or Chromium binary found. Set HANZO_BROWSER_BIN.');
}

export function shouldEnableWebMCP(opts?: { webmcp?: boolean; env?: Record<string, string | undefined> }): boolean {
  if (opts?.webmcp === false) return false;
  if (isWebMCPDisabled(false, opts?.env as NodeJS.ProcessEnv | undefined)) return false;
  return true;
}

export function buildEngineArgs(opts: EngineLaunchOptions): string[] {
  const engine = opts.engine ?? 'chrome';
  const port = opts.port ?? 9222;
  const headless = opts.headless ?? true;
  const webmcp = shouldEnableWebMCP({ webmcp: opts.webmcp, env: opts.env });

  if (engine === 'lightpanda') {
    return ['serve', '--host', '127.0.0.1', '--port', String(port), ...(opts.extraArgs || [])];
  }

  const features = new Set<string>();
  const disabledFeatures = new Set<string>(['Translate', 'TFLiteLanguageDetectionEnabled']);

  if (webmcp) {
    features.add('WebMCP');
    features.add('ModelContextProtocol');
  }

  const args: string[] = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--password-store=basic',
    '--noerrdialogs',
    '--hide-crash-restore-bubble',
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
  ];

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox');
  } else if (process.env.HANZO_BROWSER_NO_SANDBOX === '1' || process.env.CI === 'true') {
    args.push('--no-sandbox');
  }

  if (headless) {
    args.push('--headless=new', '--window-size=1280,800', '--disable-gpu');
  }

  if (engine === 'obscura') {
    args.push('--disable-blink-features=AutomationControlled');
  }

  if (features.size > 0) {
    args.push(`--enable-features=${Array.from(features).join(',')}`);
  }
  if (webmcp) {
    args.push('--enable-experimental-web-platform-features');
  }
  if (disabledFeatures.size > 0) {
    args.push(`--disable-features=${Array.from(disabledFeatures).join(',')}`);
  }

  if (opts.userDataDir) {
    args.push(`--user-data-dir=${opts.userDataDir}`);
  }

  if (opts.extensions && opts.extensions.length > 0) {
    const joined = opts.extensions.join(',');
    args.push(`--disable-extensions-except=${joined}`, `--load-extension=${joined}`);
  }

  if (opts.extraArgs?.length) {
    args.push(...opts.extraArgs);
  }

  if (opts.startUrl) {
    args.push(opts.startUrl);
  }

  return args;
}

export async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface SpawnedEngine {
  engine: Exclude<BrowserEngine, 'extension'>;
  binary: string;
  args: string[];
  port: number;
  baseUrl: string;
  webSocketDebuggerUrl: string;
  process: ChildProcess;
  tempUserDataDir?: string;
  close: () => Promise<void>;
}

export async function launchEngine(opts: EngineLaunchOptions = {}): Promise<SpawnedEngine> {
  const engine = (opts.engine && opts.engine !== 'extension' ? opts.engine : 'chrome') as Exclude<BrowserEngine, 'extension'>;
  const binary = findEngineBinary(engine, opts.executablePath);
  const port = opts.port ?? (await findFreePort());
  let tempUserDataDir: string | undefined;
  let userDataDir = opts.userDataDir;
  if (!userDataDir && engine !== 'lightpanda') {
    const baseTmp = process.platform !== 'win32' && fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
    tempUserDataDir = fs.mkdtempSync(path.join(baseTmp, 'hanzo-browser-'));
    userDataDir = tempUserDataDir;
  }

  const args = buildEngineArgs({
    ...opts,
    engine,
    port,
    userDataDir,
    startUrl: opts.startUrl ?? (engine === 'lightpanda' ? undefined : 'about:blank'),
  });

  let stdio: any = 'ignore';
  let logFd: number | undefined;
  if (opts.logFile) {
    fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
    logFd = fs.openSync(opts.logFile, 'a');
    stdio = ['ignore', logFd, logFd];
  }

  const child = spawn(binary, args, {
    detached: Boolean(opts.detached),
    stdio,
    env: {
      ...process.env,
      ...(opts.env || {}),
      ...(opts.headless === false ? { DISPLAY: process.env.DISPLAY || ':0' } : {}),
    },
  });

  if (opts.detached) {
    child.unref();
  }
  if (logFd !== undefined) {
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 12_000;
  let wsUrl = '';
  let exitErr: string | null = null;
  child.once('exit', (code, sig) => {
    exitErr = `Browser process (${path.basename(binary)}) exited early (code=${code}, signal=${sig})`;
  });

  while (Date.now() < deadline && !exitErr) {
    const ver = await getCdpVersion(baseUrl, 800);
    if (ver?.webSocketDebuggerUrl) {
      wsUrl = ver.webSocketDebuggerUrl;
      break;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const close = async () => {
    try {
      if (child.pid && !child.killed) {
        child.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 150));
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    } catch { /* ignore */ }
    if (tempUserDataDir) {
      try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  };

  if (!wsUrl) {
    await close();
    throw new Error(exitErr || `Timed out waiting for CDP endpoint on ${baseUrl}`);
  }

  return {
    engine,
    binary,
    args,
    port,
    baseUrl,
    webSocketDebuggerUrl: wsUrl,
    process: child,
    tempUserDataDir,
    close,
  };
}
