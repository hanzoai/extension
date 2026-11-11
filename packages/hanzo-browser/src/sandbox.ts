/**
 * Persistent Sandboxed Browser Manager (`start`, `stop`, `suspend`, `resume`, `status`).
 *
 * Preserves `~/.hanzo/browser-sandbox/profile` across restarts, pre-loads installed
 * extensions (`1password`, `lastpass`, `hanzo-extension`), supports `SIGSTOP`/`SIGCONT`
 * zero-CPU suspension, and launches `chrome`, `lightpanda`, or `obscura` with
 * Chrome WebMCP flags enabled by default unless `--no-webmcp` or env disables it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { getCdpVersion } from './cdp.js';
import {
  buildEngineArgs,
  findEngineBinary,
  shouldEnableWebMCP,
  type BrowserEngine,
} from './engines.js';

const HOME = os.homedir();

export interface SandboxConfig {
  baseDir: string;
  profileDir: string;
  extRoot: string;
  stateFile: string;
  cdpPort: number;
  defaultStartUrl: string;
}

export function getSandboxConfig(): SandboxConfig {
  const baseDir = process.env.HANZO_BROWSER_DIR || path.join(HOME, '.hanzo', 'browser-sandbox');
  return {
    baseDir,
    profileDir: process.env.HANZO_BROWSER_PROFILE || path.join(baseDir, 'profile'),
    extRoot: process.env.HANZO_BROWSER_EXTENSIONS || path.join(baseDir, 'extensions'),
    stateFile: path.join(baseDir, 'state.json'),
    cdpPort: Number(process.env.HANZO_BROWSER_CDP_PORT || 9222),
    defaultStartUrl: process.env.HANZO_BROWSER_START_URL || 'https://post.hanzo.ai/launches',
  };
}

export interface SandboxState {
  state: 'running' | 'suspended' | 'stopped';
  pid: number | null;
  engine?: Exclude<BrowserEngine, 'extension'>;
  headless?: boolean;
  webmcp?: boolean;
  cdpPort: number;
  startUrl?: string;
  updatedAt: string | null;
}

export interface SandboxStartOptions {
  url?: string;
  headless?: boolean;
  webmcp?: boolean;
  engine?: Exclude<BrowserEngine, 'extension'>;
  cdpPort?: number;
}

function getDefaultExtensions(extRoot: string) {
  return [
    { id: '1password', crxId: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', dir: path.join(extRoot, '1password') },
    { id: 'lastpass', crxId: 'hdokiejnpimakedhajhdlcegeplioahd', dir: path.join(extRoot, 'lastpass') },
    { id: 'hanzo-extension', crxId: 'biingenefmanpecedoafkfajbnlgdmbl', dir: path.join(extRoot, 'hanzo-extension') },
  ];
}

function ensureDirs(cfg: SandboxConfig): void {
  fs.mkdirSync(cfg.baseDir, { recursive: true });
  fs.mkdirSync(cfg.profileDir, { recursive: true });
  fs.mkdirSync(cfg.extRoot, { recursive: true });
}

function readState(cfg: SandboxConfig): SandboxState {
  try {
    return JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
  } catch {
    return { state: 'stopped', pid: null, cdpPort: cfg.cdpPort, updatedAt: null };
  }
}

function writeState(cfg: SandboxConfig, patch: Partial<SandboxState>): SandboxState {
  const next: SandboxState = {
    ...readState(cfg),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(cfg.stateFile, JSON.stringify(next, null, 2));
  return next;
}

function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessState(cfg: SandboxConfig, pid: number | null | undefined): 'running' | 'suspended' | 'stopped' {
  if (!isProcessAlive(pid)) return 'stopped';
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    const code = afterComm.split(' ')[0];
    if (code === 'T') return 'suspended';
    return 'running';
  } catch {
    return readState(cfg).state === 'suspended' ? 'suspended' : 'running';
  }
}

function getInstalledExtensions(cfg: SandboxConfig) {
  return getDefaultExtensions(cfg.extRoot).map((ext) => {
    const manifestPath = path.join(ext.dir, 'manifest.json');
    let version: string | null = null;
    const installed = fs.existsSync(manifestPath);
    if (installed) {
      try {
        version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version ?? null;
      } catch { /* ignore */ }
    }
    return { ...ext, installed, version };
  });
}

function signalProcessTree(cfg: SandboxConfig, rootPid: number, sig: 'STOP' | 'CONT' | 'TERM'): void {
  try {
    execSync(`pkill -${sig} -P ${rootPid} 2>/dev/null || true`);
  } catch { /* ignore */ }
  try {
    execSync(`pkill -${sig} -f "--user-data-dir=${cfg.profileDir}" 2>/dev/null || true`);
  } catch { /* ignore */ }
  try {
    process.kill(rootPid, `SIG${sig}` as NodeJS.Signals);
  } catch { /* ignore */ }
}

function cleanSingletonLocks(cfg: SandboxConfig): void {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      fs.rmSync(path.join(cfg.profileDir, f), { force: true });
    } catch { /* ignore */ }
  }
}

export async function sandboxStatus() {
  const cfg = getSandboxConfig();
  ensureDirs(cfg);
  const saved = readState(cfg);
  const procState = getProcessState(cfg, saved.pid);
  const port = saved.cdpPort || cfg.cdpPort;
  const cdp = procState === 'running' ? await getCdpVersion(`http://127.0.0.1:${port}`, 1200) : null;
  const exts = getInstalledExtensions(cfg);

  const result = {
    state: procState,
    pid: procState === 'stopped' ? null : saved.pid,
    engine: saved.engine || 'chrome',
    headless: Boolean(saved.headless),
    webmcp: saved.webmcp !== undefined ? saved.webmcp : shouldEnableWebMCP(),
    cdpPort: port,
    cdpUrl: `http://127.0.0.1:${port}`,
    webSocketDebuggerUrl: cdp?.webSocketDebuggerUrl || null,
    browserVersion: cdp?.Browser || null,
    profileDir: cfg.profileDir,
    extensions: exts.map((e) => ({
      id: e.id,
      crxId: e.crxId,
      installed: e.installed,
      version: e.version,
      path: e.dir,
    })),
    updatedAt: saved.updatedAt,
  };

  if (procState !== saved.state) {
    writeState(cfg, { state: procState, pid: result.pid });
  }
  return result;
}

export type SandboxStatusResult = Awaited<ReturnType<typeof sandboxStatus>>;

export async function sandboxStart(opts: SandboxStartOptions = {}): Promise<SandboxStatusResult> {
  const cfg = getSandboxConfig();
  ensureDirs(cfg);
  const saved = readState(cfg);
  const procState = getProcessState(cfg, saved.pid);

  if (procState === 'suspended' && saved.pid) {
    return sandboxResume();
  }
  if (procState === 'running' && saved.pid) {
    return sandboxStatus();
  }

  cleanSingletonLocks(cfg);
  const engine = opts.engine ?? 'chrome';
  const headless = opts.headless ?? false;
  const webmcp = shouldEnableWebMCP({ webmcp: opts.webmcp });
  const cdpPort = opts.cdpPort ?? cfg.cdpPort;
  const startUrl = opts.url || cfg.defaultStartUrl;

  const bin = findEngineBinary(engine);
  const exts = headless
    ? []
    : getInstalledExtensions(cfg).filter((e) => e.installed).map((e) => e.dir);

  const args = buildEngineArgs({
    engine,
    headless,
    webmcp,
    port: cdpPort,
    userDataDir: cfg.profileDir,
    extensions: exts,
    startUrl: engine === 'lightpanda' ? undefined : startUrl,
  });

  const outLog = fs.openSync(path.join(cfg.baseDir, 'browser.log'), 'a');
  const child = spawn(bin, args, {
    detached: true,
    stdio: ['ignore', outLog, outLog],
    env: {
      ...process.env,
      ...(headless ? {} : { DISPLAY: process.env.DISPLAY || ':0' }),
    },
  });
  child.unref();
  try { fs.closeSync(outLog); } catch { /* ignore */ }

  writeState(cfg, {
    state: 'running',
    pid: child.pid ?? null,
    engine,
    headless,
    webmcp,
    cdpPort,
    startUrl,
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const ver = await getCdpVersion(`http://127.0.0.1:${cdpPort}`, 600);
    if (ver?.webSocketDebuggerUrl) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  return sandboxStatus();
}

export async function sandboxSuspend() {
  const cfg = getSandboxConfig();
  ensureDirs(cfg);
  const saved = readState(cfg);
  if (!saved.pid || getProcessState(cfg, saved.pid) === 'stopped') {
    throw new Error('Sandboxed browser is not running');
  }
  signalProcessTree(cfg, saved.pid, 'STOP');
  writeState(cfg, { state: 'suspended' });
  return sandboxStatus();
}

export async function sandboxResume(): Promise<SandboxStatusResult> {
  const cfg = getSandboxConfig();
  ensureDirs(cfg);
  const saved = readState(cfg);
  if (!saved.pid || getProcessState(cfg, saved.pid) === 'stopped') {
    return sandboxStart();
  }
  signalProcessTree(cfg, saved.pid, 'CONT');
  writeState(cfg, { state: 'running' });
  await new Promise((r) => setTimeout(r, 400));
  return sandboxStatus();
}

export async function sandboxStop() {
  const cfg = getSandboxConfig();
  ensureDirs(cfg);
  const saved = readState(cfg);
  if (saved.pid && isProcessAlive(saved.pid)) {
    signalProcessTree(cfg, saved.pid, 'CONT');
    signalProcessTree(cfg, saved.pid, 'TERM');
    await new Promise((r) => setTimeout(r, 800));
  }
  cleanSingletonLocks(cfg);
  writeState(cfg, { state: 'stopped', pid: null });
  return sandboxStatus();
}
