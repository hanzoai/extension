#!/usr/bin/env node
/**
 * hanzo-browser — Persistent Sandboxed Browser Manager & Social Automation CLI
 *
 * Lifecycle commands:
 *   hanzo-browser start [url]   Start (or resume) persistent sandboxed browser
 *   hanzo-browser stop          Stop sandboxed browser (preserving profile & logins)
 *   hanzo-browser suspend       Suspend (SIGSTOP) sandboxed browser in-place
 *   hanzo-browser resume        Resume (SIGCONT) suspended sandboxed browser
 *   hanzo-browser status        Show JSON status, CDP endpoint, profile & extensions
 *
 * Social & ZAP bridge commands:
 *   hanzo-browser sessions      Detect logged-in social accounts via ZAP bridge
 *   hanzo-browser sync          Sync logged-in social accounts to Hanzo Social / Post
 *   hanzo-browser post <p> <t>  Publish a post via logged-in browser session
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { spawn, execSync } from 'node:child_process';

const HOME = os.homedir();
const BASE_DIR = process.env.HANZO_BROWSER_DIR || path.join(HOME, '.hanzo', 'browser-sandbox');
const PROFILE_DIR = process.env.HANZO_BROWSER_PROFILE || path.join(BASE_DIR, 'profile');
const EXT_ROOT = process.env.HANZO_BROWSER_EXTENSIONS || path.join(BASE_DIR, 'extensions');
const STATE_FILE = path.join(BASE_DIR, 'state.json');
const CDP_PORT = Number(process.env.HANZO_BROWSER_CDP_PORT || 9222);
const DEFAULT_START_URL = process.env.HANZO_BROWSER_START_URL || 'https://post.hanzo.ai/launches';

const DEFAULT_EXTENSIONS = [
  { id: '1password', crxId: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', dir: path.join(EXT_ROOT, '1password') },
  { id: 'lastpass', crxId: 'hdokiejnpimakedhajhdlcegeplioahd', dir: path.join(EXT_ROOT, 'lastpass') },
  { id: 'hanzo-extension', crxId: 'biingenefmanpecedoafkfajbnlgdmbl', dir: path.join(EXT_ROOT, 'hanzo-extension') },
];

function ensureDirs() {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(EXT_ROOT, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { state: 'stopped', pid: null, cdpPort: CDP_PORT, updatedAt: null };
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessState(pid) {
  if (!isProcessAlive(pid)) return 'stopped';
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    const code = afterComm.split(' ')[0];
    if (code === 'T') return 'suspended';
    return 'running';
  } catch {
    return readState().state === 'suspended' ? 'suspended' : 'running';
  }
}

function findBrowserBinary() {
  const candidates = [
    process.env.HANZO_BROWSER_BIN,
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('No Chromium or Chrome binary found');
}

function getInstalledExtensions() {
  return DEFAULT_EXTENSIONS.map((ext) => {
    const manifestPath = path.join(ext.dir, 'manifest.json');
    let version = null;
    const installed = fs.existsSync(manifestPath);
    if (installed) {
      try {
        version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
      } catch {}
    }
    return { ...ext, installed, version };
  });
}

function signalProcessTree(rootPid, sig) {
  try {
    execSync(`pkill -${sig} -P ${rootPid} 2>/dev/null || true`);
  } catch {}
  try {
    execSync(`pkill -${sig} -f "--user-data-dir=${PROFILE_DIR}" 2>/dev/null || true`);
  } catch {}
  try {
    process.kill(rootPid, sig);
  } catch {}
}

function cleanSingletonLocks() {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      fs.rmSync(path.join(PROFILE_DIR, f), { force: true });
    } catch {}
  }
}

async function fetchCdpVersion(port = CDP_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1200 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function cmdStatus() {
  ensureDirs();
  const saved = readState();
  const procState = getProcessState(saved.pid);
  const cdp = procState === 'running' ? await fetchCdpVersion(saved.cdpPort || CDP_PORT) : null;
  const exts = getInstalledExtensions();
  const result = {
    state: procState,
    pid: procState === 'stopped' ? null : saved.pid,
    cdpPort: saved.cdpPort || CDP_PORT,
    cdpUrl: `http://127.0.0.1:${saved.cdpPort || CDP_PORT}`,
    webSocketDebuggerUrl: cdp?.webSocketDebuggerUrl || null,
    browserVersion: cdp?.Browser || null,
    profileDir: PROFILE_DIR,
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
    writeState({ state: procState, pid: result.pid });
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function cmdStart(startUrl = DEFAULT_START_URL) {
  ensureDirs();
  const saved = readState();
  const procState = getProcessState(saved.pid);
  if (procState === 'suspended' && saved.pid) {
    return cmdResume();
  }
  if (procState === 'running' && saved.pid) {
    return cmdStatus();
  }

  cleanSingletonLocks();
  const bin = findBrowserBinary();
  const exts = getInstalledExtensions().filter((e) => e.installed).map((e) => e.dir);
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--password-store=basic',
    '--noerrdialogs',
    '--hide-crash-restore-bubble',
    '--disable-features=Translate,TFLiteLanguageDetectionEnabled',
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
  ];
  if (exts.length > 0) {
    const joined = exts.join(',');
    args.push(`--disable-extensions-except=${joined}`, `--load-extension=${joined}`);
  }
  args.push(startUrl);

  const outLog = fs.openSync(path.join(BASE_DIR, 'browser.log'), 'a');
  const child = spawn(bin, args, {
    detached: true,
    stdio: ['ignore', outLog, outLog],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });
  child.unref();

  writeState({ state: 'running', pid: child.pid, cdpPort: CDP_PORT, startUrl });
  await new Promise((r) => setTimeout(r, 1200));
  return cmdStatus();
}

async function cmdSuspend() {
  ensureDirs();
  const saved = readState();
  if (!saved.pid || getProcessState(saved.pid) === 'stopped') {
    console.error('Sandboxed browser is not running');
    process.exit(1);
  }
  signalProcessTree(saved.pid, 'STOP');
  writeState({ state: 'suspended' });
  return cmdStatus();
}

async function cmdResume() {
  ensureDirs();
  const saved = readState();
  if (!saved.pid || getProcessState(saved.pid) === 'stopped') {
    return cmdStart();
  }
  signalProcessTree(saved.pid, 'CONT');
  writeState({ state: 'running' });
  await new Promise((r) => setTimeout(r, 400));
  return cmdStatus();
}

async function cmdStop() {
  ensureDirs();
  const saved = readState();
  if (saved.pid && isProcessAlive(saved.pid)) {
    signalProcessTree(saved.pid, 'CONT');
    signalProcessTree(saved.pid, 'TERM');
    await new Promise((r) => setTimeout(r, 800));
  }
  cleanSingletonLocks();
  writeState({ state: 'stopped', pid: null });
  return cmdStatus();
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function putU16(a, n) { a.push(n & 0xff, (n >> 8) & 0xff); }
function putU32(a, n) { a.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff); }
function putStr(a, s) {
  const b = enc.encode(s);
  putU16(a, b.length);
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}
function encodeHello(role, brand, caps) {
  const a = [role];
  putStr(a, brand);
  putU16(a, caps.length);
  for (const c of caps) putStr(a, c);
  putU16(a, 0);
  return new Uint8Array(a);
}
function encodeCmd(method, params = {}) {
  const a = [];
  putStr(a, method);
  const keys = Object.keys(params);
  putU16(a, keys.length);
  for (const k of keys) {
    putStr(a, k);
    const vb = enc.encode(typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]));
    putU32(a, vb.length);
    for (let i = 0; i < vb.length; i++) a.push(vb[i]);
  }
  return new Uint8Array(a);
}
function encodeFrame(t, from, to, payload = new Uint8Array(0)) {
  const f = enc.encode(from), d = enc.encode(to);
  const len = 11 + f.length + d.length + payload.length;
  const b = new Uint8Array(4 + len);
  const v = new DataView(b.buffer);
  v.setUint32(0, len, true);
  v.setUint8(4, t);
  v.setUint16(5, 0, true);
  v.setUint16(7, f.length, true);
  v.setUint16(9, d.length, true);
  v.setUint32(11, payload.length, true);
  b.set(f, 15);
  b.set(d, 15 + f.length);
  b.set(payload, 15 + f.length + d.length);
  return b;
}
function decodeProviders(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  let o = 0;
  const str = () => { const n = dv.getUint16(o, true); o += 2; const s = dec.decode(p.subarray(o, o + n)); o += n; return s; };
  const n = dv.getUint16(o, true); o += 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = str();
    const role = dv.getUint8(o); o += 1;
    const brand = str();
    const nc = dv.getUint16(o, true); o += 2;
    const caps = [];
    for (let c = 0; c < nc; c++) caps.push(str());
    const na = dv.getUint16(o, true); o += 2;
    const attrs = {};
    for (let j = 0; j < na; j++) { const k = str(); attrs[k] = str(); }
    out.push({ id, role, brand, caps, attrs });
  }
  return out;
}

async function callZap(method, params = {}) {
  const sockPath = `/run/user/${process.getuid?.() ?? 1000}/zap/zapd.sock`;
  if (!fs.existsSync(sockPath)) {
    throw new Error(`ZAP socket not found at ${sockPath}`);
  }
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(sockPath);
    let buf = Buffer.alloc(0);
    let myId = `agent/hanzo-${Math.random().toString(16).slice(2, 6)}`;
    let targetId = process.env.HANZO_ZAP_PROVIDER || '';
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('ZAP request timed out')); }, 15000);

    sock.on('connect', () => {
      sock.write(encodeFrame(1, myId, '', encodeHello(0, 'hanzo', [])));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) break;
        const raw = new Uint8Array(buf.subarray(0, 4 + len));
        buf = buf.subarray(4 + len);
        const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const t = v.getUint8(4);
        const fl = v.getUint16(7, true), tl = v.getUint16(9, true), pl = v.getUint32(11, true);
        const from = dec.decode(raw.subarray(15, 15 + fl));
        const to = dec.decode(raw.subarray(15 + fl, 15 + fl + tl));
        const payload = raw.slice(15 + fl + tl, 15 + fl + tl + pl);

        if (t === 2) {
          myId = to || myId;
          sock.write(encodeFrame(3, myId, ''));
        } else if (t === 4) {
          const providers = decodeProviders(payload);
          const browserProv = providers.find((p) => p.id.startsWith('browser/'));
          if (!browserProv) {
            clearTimeout(timer);
            sock.destroy();
            reject(new Error('No connected browser provider on ZAP router'));
            return;
          }
          targetId = browserProv.id;
          sock.write(encodeFrame(16, myId, targetId, encodeCmd(method, params)));
        } else if (t === 17) {
          clearTimeout(timer);
          sock.destroy();
          const text = dec.decode(payload);
          try { resolve(JSON.parse(text)); } catch { resolve(text); }
        } else if (t === 7) {
          clearTimeout(timer);
          sock.destroy();
          reject(new Error(dec.decode(payload)));
        }
      }
    });
    sock.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const [, , subcmd = 'status', ...rest] = process.argv;

switch (subcmd) {
  case 'start':
    await cmdStart(rest[0]);
    break;
  case 'stop':
    await cmdStop();
    break;
  case 'suspend':
  case 'pause':
    await cmdSuspend();
    break;
  case 'resume':
  case 'unpause':
    await cmdResume();
    break;
  case 'sessions':
    console.log(JSON.stringify(await callZap('social.sessions'), null, 2));
    break;
  case 'sync':
    console.log(JSON.stringify(await callZap('social.sync', { org: rest[0] || 'hanzo' }), null, 2));
    break;
  case 'post':
    console.log(JSON.stringify(await callZap('social.post', { provider: rest[0], content: rest.slice(1).join(' ') }), null, 2));
    break;
  case 'tabs':
    console.log(JSON.stringify(await callZap('Target.getTargets'), null, 2));
    break;
  case 'status':
  default:
    await cmdStatus();
    break;
}
