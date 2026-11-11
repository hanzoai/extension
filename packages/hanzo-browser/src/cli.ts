#!/usr/bin/env node
/**
 * `hanzo-browser` — CLI for `@hanzo/browser` (ZAP + raw CDP + WebMCP + LastPass + Vault + E2E test runner).
 *
 * Lifecycle:
 *   hanzo-browser start [url] [--headless] [--no-webmcp] [--engine chrome|lightpanda|obscura]
 *   hanzo-browser stop | suspend | resume | status
 *
 * Automation:
 *   hanzo-browser navigate <url> | open <url>
 *   hanzo-browser snapshot [--interactive] [--compact]
 *   hanzo-browser click <sel>
 *   hanzo-browser fill <sel> <text>
 *   hanzo-browser press <key>
 *   hanzo-browser read [--selector <sel>]
 *   hanzo-browser screenshot [path]
 *   hanzo-browser tabs
 *
 * WebMCP:
 *   hanzo-browser webmcp list [tool] [--frame <frame-id>] [--json]
 *   hanzo-browser webmcp call <tool> [json-args] [--frame <frame-id>] [--json]
 *   hanzo-browser webmcp invoke <tool> [--params <json|@file>] [--frame <id>] [--detach] [--json]
 *   hanzo-browser webmcp result <invocation-id> [--json]
 *   hanzo-browser webmcp cancel <invocation-id> [--json]
 *
 * Social, LastPass & Vault:
 *   hanzo-browser sessions
 *   hanzo-browser sync [org]
 *   hanzo-browser post <provider> <text>
 *   hanzo-browser lastpass status|accounts|open-icon|fill
 *   hanzo-browser vault status|autofill|fill-kms|capture-kms|egress
 *   hanzo-browser post-setup
 *   hanzo-browser test [files...]
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BrowserSession,
  ZapTransport,
  getSessionsViaZap,
  sandboxResume,
  sandboxStart,
  sandboxStatus,
  sandboxStop,
  sandboxSuspend,
  type BrowserEngine,
} from './index.js';
import { delimitUntrusted, formatWebMcpSummaryText } from './webmcp.js';
import { runTestSuite } from './test.js';

export interface ParsedCli {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const VALUE_FLAGS = new Set([
  'frame',
  'params',
  'tab',
  'cdp',
  'browser',
  'engine',
  'selector',
  'provider',
  'path',
  'name',
  'env',
  'org',
  'url',
  'config',
  'query',
  'username',
  'user-selector',
  'pass-selector',
]);

export function parseArgv(argv: string[]): ParsedCli {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--') && VALUE_FLAGS.has(key)) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function readJsonParam(raw: string | boolean | undefined): Record<string, unknown> {
  if (!raw || typeof raw === 'boolean') return {};
  const str = raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw;
  return JSON.parse(str);
}

function printOutput(data: Record<string, any>, asJson: boolean, textSummary?: string): void {
  if (asJson) {
    console.log(JSON.stringify({ data }, null, 2));
    return;
  }
  if (textSummary !== undefined) console.log(textSummary);
  else console.log(JSON.stringify(data, null, 2));
  if (data && typeof data === 'object' && data.webmcp) {
    console.log(formatWebMcpSummaryText(data.webmcp));
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const { positionals, flags } = parseArgv(argv);
  const cmd = positionals[0] || (flags.help ? 'help' : 'status');
  const asJson = Boolean(flags.json);
  const noWebmcp = Boolean(flags['no-webmcp']);

  if (cmd === 'help' || flags.help) {
    console.log(`hanzo-browser — Sovereign ZAP + CDP + WebMCP + LastPass + Vault Browser CLI

Lifecycle:
  start [url] [--headless] [--no-webmcp] [--engine chrome|lightpanda|obscura]
  stop | suspend | resume | status

Automation:
  navigate <url> | open <url>              Open URL and announce WebMCP delta summary
  snapshot [--interactive] [--compact]     Accessibility snapshot with [ref=eN]
  click <ref|selector>                     Click ref (@e2) or CSS/shadow (>>>) selector
  fill <ref|selector> <text>               Fill input (with React _valueTracker sync)
  type <ref|selector> <text>               Type characters into input
  press <key> [selector]                   Dispatch key press
  read [--selector <sel>]                  Extract page content as clean Markdown
  screenshot [path]                        Save PNG screenshot
  tabs                                     List open browser tabs

WebMCP:
  webmcp list [tool] [--frame <frame-id>] [--json]
  webmcp call <tool> [json-args] [--frame <frame-id>] [--json]
  webmcp invoke <tool> [--params <json|@f>] [--frame <id>] [--detach] [--json]
  webmcp result <invocation-id> [--json]
  webmcp cancel <invocation-id> [--json]

Social, LastPass & Vault:
  sessions                                 Detect active logins across social & app networks
  sync [org]                               Sync connected social accounts to Hanzo Social / Post
  post <provider> <text>                   Publish via logged-in browser session
  lastpass status|accounts|open-icon|fill  Sovereign LastPass integration (zero secret leakage)
  vault status|autofill|fill-kms|capture-kms|egress
  post-setup                               1-click Hanzo Post / Social channel & vault check
  test [files...] [--config <path>]        Run zero-Playwright E2E test suite

Global flags:
  --no-webmcp    Disable WebMCP discovery & invocation (or HANZO_BROWSER_NO_WEBMCP=1 / AGENT_BROWSER_NO_WEBMCP=1)
  --json         Emit structured { "data": ... } JSON output
  --tab <id>     Target tab ID on connected browser
  --cdp <ws|port> Connect directly to CDP endpoint
  --engine <e>   Engine: chrome | lightpanda | obscura | extension
  --headless     Launch ephemeral headless Chrome via native CDP`);
    return;
  }

  // Lifecycle commands
  if (cmd === 'sandbox' || ['start', 'stop', 'suspend', 'pause', 'resume', 'unpause', 'status'].includes(cmd)) {
    const rawSub = cmd === 'sandbox' ? (positionals[1] || 'status') : cmd;
    const sub = rawSub === 'pause' ? 'suspend' : rawSub === 'unpause' ? 'resume' : rawSub;
    const engine = typeof flags.engine === 'string' && flags.engine !== 'extension'
      ? (flags.engine as Exclude<BrowserEngine, 'extension'>)
      : undefined;
    const res =
      sub === 'start'
        ? await sandboxStart({
            url: typeof flags.url === 'string' ? flags.url : positionals[cmd === 'sandbox' ? 2 : 1],
            headless: Boolean(flags.headless),
            webmcp: !noWebmcp,
            engine,
          })
        : sub === 'stop'
          ? await sandboxStop()
          : sub === 'suspend'
            ? await sandboxSuspend()
            : sub === 'resume'
              ? await sandboxResume()
              : await sandboxStatus();
    printOutput(res, asJson);
    return;
  }

  if (cmd === 'test') {
    const res = await runTestSuite({
      files: positionals.slice(1),
      configPath: typeof flags.config === 'string' ? flags.config : undefined,
      headless: flags.headed ? false : true,
    });
    if (res.failed > 0) process.exitCode = 1;
    return;
  }

  // Fast-path ZAP-native social/tabs/lastpass commands (avoids spawning Chrome if ZAP is the intended transport)
  if (cmd === 'sessions') {
    const zap = new ZapTransport();
    const res = await getSessionsViaZap(zap, {
      filter: typeof flags.browser === 'string' ? flags.browser : undefined,
    });
    printOutput(res, asJson);
    return;
  }

  const engineOpt = typeof flags.engine === 'string' ? (flags.engine as BrowserEngine) : undefined;
  const cdpEndpoint = typeof flags.cdp === 'string' ? flags.cdp : undefined;

  // If sandbox browser is already running on local CDP port and no ZAP provider is active, connect to it automatically when not `--headless`
  let resolvedCdp = cdpEndpoint;
  if (!resolvedCdp && !flags.headless && engineOpt !== 'extension') {
    const zap = new ZapTransport();
    const prov = await zap.resolveProvider(typeof flags.browser === 'string' ? flags.browser : undefined);
    if (!prov) {
      const sb = await sandboxStatus().catch(() => null);
      if (sb?.state === 'running' && sb.webSocketDebuggerUrl) {
        resolvedCdp = sb.webSocketDebuggerUrl;
      }
    }
  }

  const session = await BrowserSession.create({
    noWebmcp,
    tabId: typeof flags.tab === 'string' ? flags.tab : undefined,
    cdpEndpoint: resolvedCdp,
    targetBrowser: typeof flags.browser === 'string' ? flags.browser : undefined,
    engine: engineOpt,
    headless: Boolean(flags.headless),
  });

  try {
    switch (cmd) {
      case 'open':
      case 'navigate': {
        const url = positionals[1];
        if (!url) throw new Error('Usage: hanzo-browser navigate <url>');
        const res = await session.open(url);
        printOutput(res, asJson, `${res.title || ''} — ${res.url || url}`);
        break;
      }

      case 'snapshot': {
        const res = await session.snapshot({
          interactive: Boolean(flags.interactive),
          compact: Boolean(flags.compact),
          selector: typeof flags.selector === 'string' ? flags.selector : undefined,
        });
        printOutput(res, asJson, `${res.title || ''} — ${res.url || ''} (${res.refs ?? 0} refs)\n${res.tree || ''}`);
        break;
      }

      case 'read': {
        const res = await session.read({
          selector: typeof flags.selector === 'string' ? flags.selector : positionals[1],
          main: flags.main !== undefined ? Boolean(flags.main) : undefined,
        });
        printOutput(res, asJson, typeof res.markdown === 'string' ? res.markdown : JSON.stringify(res, null, 2));
        break;
      }

      case 'click': {
        const sel = positionals[1];
        if (!sel) throw new Error('Usage: hanzo-browser click <ref|selector>');
        const res = await session.click(sel);
        printOutput(res, asJson);
        break;
      }

      case 'fill': {
        const sel = positionals[1];
        const val = positionals.slice(2).join(' ');
        if (!sel) throw new Error('Usage: hanzo-browser fill <ref|selector> <value>');
        const res = await session.fill(sel, val);
        printOutput(res, asJson);
        break;
      }

      case 'type': {
        const sel = positionals[1];
        const val = positionals.slice(2).join(' ');
        if (!sel) throw new Error('Usage: hanzo-browser type <ref|selector> <text>');
        const res = await session.type(sel, val);
        printOutput(res, asJson);
        break;
      }

      case 'press': {
        const key = positionals[1];
        if (!key) throw new Error('Usage: hanzo-browser press <key> [selector]');
        const res = await session.press(key, positionals[2]);
        printOutput(res, asJson);
        break;
      }

      case 'tabs': {
        const tabs = await session.tabs();
        printOutput({ tabs }, asJson);
        break;
      }

      case 'eval':
      case 'evaluate': {
        const expr = positionals.slice(1).join(' ');
        const value = await session.evaluate(expr);
        printOutput({ value }, asJson, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
        break;
      }

      case 'screenshot': {
        const outPath = positionals[1] || `screenshot-${Date.now()}.png`;
        const buf = await session.screenshot({ path: outPath, fullPage: Boolean(flags['full-page']) });
        printOutput({ path: outPath, bytes: buf.length }, asJson, `Saved screenshot (${buf.length} bytes) -> ${outPath}`);
        break;
      }

      case 'webmcp': {
        const sub = positionals[1] || 'list';
        const frame = typeof flags.frame === 'string' ? flags.frame : undefined;
        if (sub === 'list') {
          const tool = positionals[2];
          const res = await session.webmcpList(tool, frame);
          if (asJson) console.log(JSON.stringify({ data: res }, null, 2));
          else console.log(delimitUntrusted(JSON.stringify(res, null, 2)));
        } else if (sub === 'call' || sub === 'invoke') {
          const tool = positionals[2];
          if (!tool) {
            throw new Error('Usage: hanzo-browser webmcp call <tool> [json-args] [--frame <frame-id>] [--json]');
          }
          const rawArgs = flags.params !== undefined ? flags.params : positionals[3];
          const params = readJsonParam(rawArgs);
          const res = await session.webmcpInvoke(tool, params, { frame, detach: Boolean(flags.detach) });
          if (asJson) console.log(JSON.stringify({ data: res }, null, 2));
          else console.log(delimitUntrusted(JSON.stringify(res, null, 2)));
        } else if (sub === 'result') {
          const id = positionals[2];
          if (!id) throw new Error('Usage: hanzo-browser webmcp result <invocation-id>');
          const res = await session.webmcpResult(id);
          if (asJson) console.log(JSON.stringify({ data: res }, null, 2));
          else console.log(delimitUntrusted(JSON.stringify(res, null, 2)));
        } else if (sub === 'cancel') {
          const id = positionals[2];
          if (!id) throw new Error('Usage: hanzo-browser webmcp cancel <invocation-id>');
          const res = await session.webmcpCancel(id);
          if (asJson) console.log(JSON.stringify({ data: res }, null, 2));
          else console.log(JSON.stringify(res, null, 2));
        } else {
          throw new Error(`Unknown webmcp subcommand: ${sub}`);
        }
        break;
      }

      case 'lastpass': {
        const sub = positionals[1] || 'status';
        if (sub === 'status') {
          const res = await session.lastpass('status');
          printOutput(res, asJson);
        } else if (sub === 'accounts') {
          const query = typeof flags.query === 'string' ? flags.query : positionals[2];
          const res = await session.lastpass('accounts', {
            ...(query ? { query } : {}),
            ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
            ...(flags['open-vault'] ? { openVaultIfNeeded: true } : {}),
          });
          printOutput(res, asJson);
        } else if (sub === 'open-icon' || sub === 'openIcon') {
          const selector = typeof flags.selector === 'string' ? flags.selector : positionals[2];
          const res = await session.lastpass('openIcon', {
            ...(selector ? { selector } : {}),
          });
          printOutput(res, asJson);
        } else if (sub === 'fill') {
          const query = typeof flags.query === 'string' ? flags.query : positionals[2];
          const res = await session.lastpass('fill', {
            ...(query ? { query } : {}),
            ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
            ...(typeof flags.username === 'string' ? { username: flags.username } : {}),
            ...(typeof flags['user-selector'] === 'string' ? { usernameSelector: flags['user-selector'] } : {}),
            ...(typeof flags['pass-selector'] === 'string' ? { passwordSelector: flags['pass-selector'] } : {}),
            ...(flags['open-vault'] ? { openVaultIfNeeded: true } : {}),
          });
          printOutput(res, asJson);
        } else {
          throw new Error(`Unknown lastpass subcommand: ${sub}. Expected status | accounts | open-icon | fill`);
        }
        break;
      }

      case 'vault': {
        const sub = positionals[1] || 'status';
        if (sub === 'status') {
          const res = await session.callExtension('vault.status');
          printOutput(res, asJson);
        } else if (sub === 'autofill') {
          const res = await session.callExtension('vault.autofill', {
            ...(typeof flags.provider === 'string' ? { provider: flags.provider } : {}),
            ...(typeof flags.selector === 'string' ? { selector: flags.selector } : {}),
            ...(flags.submit ? { submit: true } : {}),
          });
          printOutput(res, asJson);
        } else if (sub === 'fill-kms') {
          const res = await session.callExtension('vault.fillFromKms', {
            selector: String(flags.selector || positionals[2] || ''),
            name: String(flags.name || positionals[3] || ''),
            ...(typeof flags.path === 'string' ? { path: flags.path } : {}),
            ...(typeof flags.env === 'string' ? { env: flags.env } : {}),
            ...(typeof flags.org === 'string' ? { org: flags.org } : {}),
          });
          printOutput(res, asJson);
        } else if (sub === 'capture-kms') {
          const res = await session.callExtension('vault.captureToKms', {
            selector: String(flags.selector || positionals[2] || ''),
            name: String(flags.name || positionals[3] || ''),
            ...(typeof flags.path === 'string' ? { path: flags.path } : {}),
            ...(typeof flags.env === 'string' ? { env: flags.env } : {}),
            ...(typeof flags.org === 'string' ? { org: flags.org } : {}),
          });
          printOutput(res, asJson);
        } else if (sub === 'egress') {
          const res = await session.callExtension('vault.egressFetch', readJsonParam(flags.params || positionals[2]));
          printOutput(res, asJson);
        } else {
          throw new Error(`Unknown vault subcommand: ${sub}`);
        }
        break;
      }

      case 'post-setup': {
        const res = await session.callExtension('post.setup');
        printOutput(res, asJson);
        break;
      }

      case 'sync': {
        const org = typeof flags.org === 'string' ? flags.org : (positionals[1] || 'hanzo');
        const res = await session.callExtension('social.sync', { org });
        printOutput(res, asJson);
        break;
      }

      case 'post': {
        const provider = positionals[1] || 'x';
        const content = positionals.slice(2).join(' ');
        const res = await session.callExtension('social.post', { provider, content, dryRun: Boolean(flags['dry-run']) });
        printOutput(res, asJson);
        break;
      }

      case 'call': {
        const method = positionals[1];
        if (!method) throw new Error('Usage: hanzo-browser call <method> [jsonParams]');
        const params = positionals[2] ? JSON.parse(positionals[2]) : {};
        const res = await session.callExtension(method, params);
        printOutput(res, asJson);
        break;
      }

      default:
        throw new Error(`Unknown command: ${cmd}. Run 'hanzo-browser --help' for usage.`);
    }
  } finally {
    await session.close();
  }
}

const isDirectEntry = (() => {
  try {
    if (!process.argv[1]) return false;
    const realArgv1 = fs.realpathSync(process.argv[1]);
    const realSelf = fs.realpathSync(new URL(import.meta.url));
    return pathToFileURL(realArgv1).href === pathToFileURL(realSelf).href;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  }
})();

if (isDirectEntry) {
  runCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
