import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const VSCODE_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_EXTENSION = path.join(VSCODE_ROOT, 'dist', 'extension.js');
const DIST_MCP_SERVER = path.join(VSCODE_ROOT, 'dist', 'mcp-server.js');
const DIST_VSIX = path.join(VSCODE_ROOT, 'dist', 'hanzo-ide.vsix');

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function readZipCentralEntries(zipPath: string): string[] {
  const buf = fs.readFileSync(zipPath);
  expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocdOffset).toBeGreaterThanOrEqual(0);
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let ptr = buf.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];
  for (let i = 0; i < entryCount; i++) {
    expect(buf.readUInt32LE(ptr)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    names.push(buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8'));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function ensureExtensionBundles(): void {
  if (fs.existsSync(DIST_EXTENSION) && fs.existsSync(DIST_MCP_SERVER)) {
    return;
  }
  execFileSync(process.execPath, [path.join(VSCODE_ROOT, 'scripts', 'build.js')], {
    cwd: VSCODE_ROOT,
    stdio: 'pipe',
  });
}

describe('hanzo-ide .vsix packaging & bundled stdio MCP QA', () => {
  it('packages a valid .vsix archive with extension.js, mcp-server.js, and zero node_modules', () => {
    ensureExtensionBundles();
    expect(fs.existsSync(DIST_EXTENSION)).toBe(true);
    expect(fs.existsSync(DIST_MCP_SERVER)).toBe(true);

    let vsixPath = DIST_VSIX;
    if (!fs.existsSync(vsixPath)) {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-vsix-qa-'));
      tempDirs.push(scratch);
      vsixPath = path.join(scratch, 'hanzo-ide.vsix');
      const vsceBin = require.resolve('@vscode/vsce/vsce');
      execFileSync(process.execPath, [vsceBin, 'package', '--no-dependencies', '--out', vsixPath], {
        cwd: VSCODE_ROOT,
        stdio: 'pipe',
      });
    }

    const entries = readZipCentralEntries(vsixPath);
    expect(entries).toContain('extension/package.json');
    expect(entries).toContain('extension/dist/extension.js');
    expect(entries).toContain('extension/dist/mcp-server.js');
    expect(entries.some((e) => e.startsWith('extension/node_modules/'))).toBe(false);
  }, 30_000);

  it('serves MCP tools cleanly over stdio JSON-RPC from dist/mcp-server.js', async () => {
    ensureExtensionBundles();

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-mcp-ws-'));
    tempDirs.push(workspace);
    const sampleFile = path.join(workspace, 'qa-sample.txt');
    fs.writeFileSync(sampleFile, 'hanzo-extension-qa-ok\n', 'utf8');

    const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_ROOT, 'package.json'), 'utf8'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST_MCP_SERVER],
      env: {
        ...process.env as Record<string, string>,
        HANZO_WORKSPACE: workspace,
        HANZO_CONFIG: JSON.stringify({ mcp: { enabled: true } }),
      },
      stderr: 'pipe',
    });

    const client = new Client({ name: 'hanzo-qa-harness', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toEqual({ name: 'hanzo-ide', version: pkg.version });

      const { tools } = await client.listTools();
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('read');

      const readResp = await client.callTool({
        name: 'read',
        arguments: { path: sampleFile },
      });
      const textContent = (readResp.content as Array<{ type: string; text?: string }>)
        .map((c) => c.text ?? '')
        .join('\n');
      expect(textContent).toContain('hanzo-extension-qa-ok');
    } finally {
      await client.close().catch(() => {});
    }
  });
});
