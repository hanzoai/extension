#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/tools/tool-registry.ts
function registerTool(tool) {
  toolRegistry.set(tool.name, tool);
}
function getAllRegisteredTools() {
  return Array.from(toolRegistry.values());
}
var toolRegistry;
var init_tool_registry = __esm({
  "src/tools/tool-registry.ts"() {
    "use strict";
    toolRegistry = /* @__PURE__ */ new Map();
  }
});

// src/tools/unified/fs.ts
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { glob } from "glob";
function contentHash(content) {
  return "sha256:" + crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
function envelope(data, action, paging) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, data, error: null, meta: { tool: "fs", action, paging: paging || { cursor: null, more: false } } }, null, 2) }]
  };
}
function fail(code, message, details) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, data: null, error: { code, message, ...details }, meta: { tool: "fs" } }, null, 2) }],
    isError: true
  };
}
var execAsync, fsTool;
var init_fs = __esm({
  "src/tools/unified/fs.ts"() {
    "use strict";
    execAsync = promisify(exec);
    fsTool = {
      name: "fs",
      description: "Filesystem operations: read, write, stat, list, mkdir, rm, mv, apply_patch, search_text",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["read", "write", "stat", "list", "mkdir", "rm", "mv", "apply_patch", "search_text"], description: "Filesystem action" },
          uri: { type: "string", description: "File or directory path" },
          content: { type: "string", description: "Content for write" },
          encoding: { type: "string", default: "utf8" },
          depth: { type: "number", description: "List depth", default: 1 },
          pattern: { type: "string", description: "Glob pattern for list or search" },
          show_hidden: { type: "boolean", default: false },
          patch: { type: "string", description: "Patch content (old_text for simple replace)" },
          new_text: { type: "string", description: "Replacement text for apply_patch" },
          base_hash: { type: "string", description: "Content hash precondition for apply_patch" },
          edits: { type: "array", description: "Array of {old_text, new_text} for multi-edit patch", items: { type: "object" } },
          confirm: { type: "boolean", description: "Required for rm", default: false },
          destination: { type: "string", description: "Destination for mv" },
          overwrite: { type: "boolean", default: false },
          query: { type: "string", description: "Search pattern for search_text" },
          ignore_case: { type: "boolean", default: false },
          context_lines: { type: "number", default: 0 },
          max_results: { type: "number", default: 50 },
          offset: { type: "number", description: "Line offset for read" },
          limit: { type: "number", description: "Line limit for read" },
          recursive: { type: "boolean", default: false }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const uri = args.uri || args.path || ".";
          switch (args.action) {
            case "read": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              const raw = await fs.readFile(uri, args.encoding || "utf8");
              const text = raw.toString();
              const hash = contentHash(text);
              const lines = text.split("\n");
              let content = text;
              if (args.offset || args.limit) {
                const start = args.offset || 0;
                const end = args.limit ? start + args.limit : lines.length;
                content = lines.slice(start, end).join("\n");
              }
              return envelope({ uri, content, hash, lines: lines.length, size: Buffer.byteLength(text) }, "read");
            }
            case "write": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              if (args.content === void 0)
                return fail("INVALID_PARAMS", "content required");
              if (!args.overwrite) {
                try {
                  await fs.access(uri);
                  return fail("CONFLICT", "File exists. Use overwrite: true or apply_patch to edit.");
                } catch {
                }
              }
              await fs.mkdir(path.dirname(uri), { recursive: true });
              await fs.writeFile(uri, args.content, args.encoding || "utf8");
              const hash = contentHash(args.content);
              return envelope({ uri, hash, size: Buffer.byteLength(args.content) }, "write");
            }
            case "stat": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              const stats = await fs.stat(uri);
              let hash;
              if (stats.isFile()) {
                hash = contentHash(await fs.readFile(uri, "utf8"));
              }
              return envelope({
                uri,
                size: stats.size,
                hash,
                is_file: stats.isFile(),
                is_dir: stats.isDirectory(),
                mtime: stats.mtime.toISOString(),
                mode: stats.mode.toString(8)
              }, "stat");
            }
            case "list": {
              const depth = args.depth || 1;
              if (args.pattern) {
                const globPattern = path.join(uri, args.pattern);
                const files = await glob(globPattern, { ignore: ["**/node_modules/**", "**/.git/**"] });
                return envelope({ uri, entries: files, count: files.length }, "list");
              }
              if (depth === 1) {
                const entries = await fs.readdir(uri, { withFileTypes: true });
                const filtered = args.show_hidden ? entries : entries.filter((e) => !e.name.startsWith("."));
                const items = filtered.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
                return envelope({ uri, entries: items, count: items.length }, "list");
              }
              const buildTree = async (dir, prefix = "", d = 0) => {
                if (d >= depth)
                  return "";
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const filtered = args.show_hidden ? entries : entries.filter((e) => !e.name.startsWith("."));
                let tree2 = "";
                for (let i = 0; i < filtered.length; i++) {
                  const e = filtered[i];
                  const last = i === filtered.length - 1;
                  tree2 += prefix + (last ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ") + e.name + "\n";
                  if (e.isDirectory())
                    tree2 += await buildTree(path.join(dir, e.name), prefix + (last ? "    " : "\u2502   "), d + 1);
                }
                return tree2;
              };
              const tree = uri + "\n" + await buildTree(uri);
              return envelope({ uri, tree, depth }, "list");
            }
            case "mkdir": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              await fs.mkdir(uri, { recursive: true });
              return envelope({ uri }, "mkdir");
            }
            case "rm": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              if (!args.confirm)
                return fail("CONFIRM_REQUIRED", "rm requires confirm: true");
              const stats = await fs.stat(uri);
              if (stats.isDirectory()) {
                await fs.rm(uri, { recursive: args.recursive !== false, force: true });
              } else {
                await fs.unlink(uri);
              }
              return envelope({ uri, removed: true }, "rm");
            }
            case "mv": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              if (!args.destination)
                return fail("INVALID_PARAMS", "destination required");
              if (!args.overwrite) {
                try {
                  await fs.access(args.destination);
                  return fail("CONFLICT", "Destination exists. Use overwrite: true.");
                } catch {
                }
              }
              await fs.mkdir(path.dirname(args.destination), { recursive: true });
              await fs.rename(uri, args.destination);
              return envelope({ from: uri, to: args.destination }, "mv");
            }
            case "apply_patch": {
              if (!uri || uri === ".")
                return fail("INVALID_PARAMS", "uri required");
              let content = await fs.readFile(uri, "utf8");
              const currentHash = contentHash(content);
              if (args.base_hash && args.base_hash !== currentHash) {
                return fail("CONFLICT", "base_hash mismatch \u2014 file changed since read", { expected: args.base_hash, actual: currentHash });
              }
              if (args.edits && Array.isArray(args.edits)) {
                const results = [];
                for (const edit of args.edits) {
                  if (!content.includes(edit.old_text || edit.oldText)) {
                    results.push(`MISS: "${(edit.old_text || edit.oldText || "").substring(0, 40)}..."`);
                    continue;
                  }
                  content = content.replace(edit.old_text || edit.oldText, edit.new_text || edit.newText);
                  results.push(`OK: replaced ${(edit.old_text || edit.oldText || "").substring(0, 30)}...`);
                }
                await fs.writeFile(uri, content, "utf8");
                return envelope({ uri, hash: contentHash(content), edits: results }, "apply_patch");
              }
              const oldText = args.patch || args.old_text || args.oldText;
              const newText = args.new_text || args.newText;
              if (!oldText || newText === void 0)
                return fail("INVALID_PARAMS", "patch (old_text) and new_text required, or edits array");
              if (!content.includes(oldText))
                return fail("NOT_FOUND", "patch text not found in file");
              const count = content.split(oldText).length - 1;
              if (count > 1)
                return fail("AMBIGUOUS", `patch text found ${count} times \u2014 include more context`);
              content = content.replace(oldText, newText);
              await fs.writeFile(uri, content, "utf8");
              return envelope({ uri, hash: contentHash(content) }, "apply_patch");
            }
            case "search_text": {
              const query = args.query || args.pattern;
              if (!query)
                return fail("INVALID_PARAMS", "query required");
              let hasRg = false;
              try {
                await execAsync("which rg");
                hasRg = true;
              } catch {
              }
              let cmd;
              if (hasRg) {
                cmd = `rg -n --max-count ${args.max_results || 50}`;
                if (args.ignore_case)
                  cmd += " -i";
                if (args.context_lines)
                  cmd += ` -C ${args.context_lines}`;
                if (args.pattern && args.pattern !== query)
                  cmd += ` -g "${args.pattern}"`;
                cmd += ` "${query}" "${uri}"`;
              } else {
                cmd = `grep -rn`;
                if (args.ignore_case)
                  cmd += " -i";
                if (args.context_lines)
                  cmd += ` -C ${args.context_lines}`;
                cmd += ` "${query}" "${uri}" | head -${args.max_results || 50}`;
              }
              try {
                const { stdout } = await execAsync(cmd);
                const lines = stdout.trim().split("\n").filter(Boolean);
                return envelope({ query, matches: lines, count: lines.length, backend: hasRg ? "ripgrep" : "grep" }, "search_text");
              } catch (e) {
                if (e.code === 1)
                  return envelope({ query, matches: [], count: 0, backend: hasRg ? "ripgrep" : "grep" }, "search_text");
                throw e;
              }
            }
            default:
              return fail("UNKNOWN_ACTION", `Unknown action: ${args.action}`, { available: ["read", "write", "stat", "list", "mkdir", "rm", "mv", "apply_patch", "search_text"] });
          }
        } catch (error) {
          if (error.code === "ENOENT")
            return fail("NOT_FOUND", `Not found: ${args.uri || args.path}`);
          if (error.code === "EACCES")
            return fail("PERMISSION_DENIED", error.message);
          return fail("ERROR", error.message);
        }
      }
    };
  }
});

// src/tools/unified/exec.ts
import { exec as exec2, spawn } from "child_process";
import { promisify as promisify2 } from "util";
function envelope2(data, action) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, data, error: null, meta: { tool: "exec", action } }, null, 2) }]
  };
}
function fail2(code, message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, data: null, error: { code, message }, meta: { tool: "exec" } }, null, 2) }],
    isError: true
  };
}
var execAsync2, processes, procCounter, execTool;
var init_exec = __esm({
  "src/tools/unified/exec.ts"() {
    "use strict";
    execAsync2 = promisify2(exec2);
    processes = /* @__PURE__ */ new Map();
    procCounter = 0;
    execTool = {
      name: "exec",
      description: "Process execution: exec, ps, kill, logs, wait",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["exec", "ps", "kill", "logs", "wait"], description: "Process action" },
          command: { type: "string", description: "Command to execute" },
          cwd: { type: "string", description: "Working directory" },
          env: { type: "object", description: "Environment variables" },
          timeout: { type: "number", description: "Timeout in ms", default: 3e4 },
          background: { type: "boolean", description: "Run in background", default: false },
          proc_id: { type: "string", description: "Process ID for ps/kill/logs" },
          signal: { type: "string", description: "Signal for kill", default: "SIGTERM" },
          tail: { type: "number", description: "Lines from end for logs", default: 50 }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          switch (args.action) {
            case "exec": {
              if (!args.command)
                return fail2("INVALID_PARAMS", "command required");
              if (args.background) {
                procCounter++;
                const id = args.proc_id || `proc_${procCounter}`;
                if (processes.has(id))
                  return fail2("CONFLICT", `Process ${id} already exists`);
                const [cmd, ...cmdArgs] = args.command.split(" ");
                const proc = spawn(cmd, cmdArgs, { cwd: args.cwd, detached: true, stdio: "pipe", env: { ...process.env, ...args.env } });
                const entry = { process: proc, stdout: [], stderr: [], exitCode: void 0, started: (/* @__PURE__ */ new Date()).toISOString(), command: args.command };
                processes.set(id, entry);
                proc.stdout?.on("data", (d) => entry.stdout.push(d.toString()));
                proc.stderr?.on("data", (d) => entry.stderr.push(d.toString()));
                proc.on("exit", (code) => {
                  entry.exitCode = code ?? -1;
                });
                return envelope2({ proc_id: id, pid: proc.pid, background: true }, "exec");
              }
              const { stdout, stderr } = await execAsync2(args.command, {
                cwd: args.cwd,
                timeout: args.timeout || 3e4,
                env: { ...process.env, ...args.env },
                maxBuffer: 10 * 1024 * 1024
              });
              return envelope2({
                stdout: stdout || "",
                stderr: stderr || "",
                exit_code: 0
              }, "exec");
            }
            case "ps": {
              const list = [];
              for (const [id, data] of processes.entries()) {
                if (args.proc_id && id !== args.proc_id)
                  continue;
                list.push({
                  proc_id: id,
                  pid: data.process.pid,
                  command: data.command,
                  running: data.exitCode === void 0,
                  exit_code: data.exitCode,
                  started: data.started
                });
              }
              return envelope2({ processes: list, count: list.length }, "ps");
            }
            case "kill": {
              if (!args.proc_id)
                return fail2("INVALID_PARAMS", "proc_id required");
              const entry = processes.get(args.proc_id);
              if (!entry)
                return fail2("NOT_FOUND", `No process: ${args.proc_id}`);
              try {
                const sig = args.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM";
                entry.process.kill(sig);
                processes.delete(args.proc_id);
                return envelope2({ proc_id: args.proc_id, killed: true, signal: sig }, "kill");
              } catch (e) {
                return fail2("ERROR", e.message);
              }
            }
            case "logs": {
              if (!args.proc_id)
                return fail2("INVALID_PARAMS", "proc_id required");
              const entry = processes.get(args.proc_id);
              if (!entry)
                return fail2("NOT_FOUND", `No process: ${args.proc_id}`);
              const tail = args.tail || 50;
              return envelope2({
                proc_id: args.proc_id,
                stdout: entry.stdout.slice(-tail).join(""),
                stderr: entry.stderr.slice(-tail).join(""),
                running: entry.exitCode === void 0,
                exit_code: entry.exitCode
              }, "logs");
            }
            case "wait": {
              if (!args.proc_id)
                return fail2("INVALID_PARAMS", "proc_id required");
              const waitEntry = processes.get(args.proc_id);
              if (!waitEntry)
                return fail2("NOT_FOUND", `No process: ${args.proc_id}`);
              if (waitEntry.exitCode !== void 0) {
                return envelope2({
                  proc_id: args.proc_id,
                  exit_code: waitEntry.exitCode,
                  stdout: waitEntry.stdout.join(""),
                  stderr: waitEntry.stderr.join(""),
                  waited: false
                }, "wait");
              }
              const waitTimeout = args.timeout || 3e4;
              return new Promise((resolve) => {
                const timer = setTimeout(() => {
                  resolve(fail2("TIMEOUT", `Process ${args.proc_id} did not finish within ${waitTimeout}ms`));
                }, waitTimeout);
                waitEntry.process.on("exit", () => {
                  clearTimeout(timer);
                  resolve(envelope2({
                    proc_id: args.proc_id,
                    exit_code: waitEntry.exitCode,
                    stdout: waitEntry.stdout.join(""),
                    stderr: waitEntry.stderr.join(""),
                    waited: true
                  }, "wait"));
                });
              });
            }
            default:
              return fail2("UNKNOWN_ACTION", `Unknown action: ${args.action}`);
          }
        } catch (error) {
          return fail2("ERROR", `${error.message}
${error.stdout || ""}${error.stderr || ""}`);
        }
      }
    };
  }
});

// src/tools/unified/code.ts
import * as fs2 from "fs/promises";
import * as path2 from "path";
import { exec as exec3 } from "child_process";
import { promisify as promisify3 } from "util";
import { glob as glob2 } from "glob";
function envelope3(data, action) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, data, error: null, meta: { tool: "code", action } }, null, 2) }] };
}
function fail3(code, message) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, data: null, error: { code, message }, meta: { tool: "code" } }, null, 2) }], isError: true };
}
var execAsync3, SYMBOL_RE, IMPORT_RE, codeTool;
var init_code = __esm({
  "src/tools/unified/code.ts"() {
    "use strict";
    execAsync3 = promisify3(exec3);
    SYMBOL_RE = /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var|def|fn|pub\s+fn|pub\s+struct|struct|impl)\s+(\w+)/g;
    IMPORT_RE = /^(?:import|from|require|use)\b.*/gm;
    codeTool = {
      name: "code",
      description: "Semantic code operations: parse, serialize, symbols, outline, definition, search_symbol, references, summarize, metrics, exports, types, hierarchy, rename, grep_replace, transform",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["parse", "serialize", "symbols", "outline", "definition", "search_symbol", "references", "summarize", "metrics", "exports", "types", "hierarchy", "rename", "grep_replace", "transform"], description: "Code action" },
          query: { type: "string", description: "Symbol name or search query" },
          uri: { type: "string", description: "File or directory path" },
          path: { type: "string", description: "File path (alias for uri)" },
          text: { type: "string", description: "Raw text input" },
          scope: { type: "string", description: "Search scope (file, directory, project)", default: "project" },
          pattern: { type: "string", description: "File glob pattern" },
          new_name: { type: "string", description: "New name for rename" },
          replacement: { type: "string", description: "Replacement for grep_replace" },
          max_results: { type: "number", default: 20 },
          language: { type: "string", description: "Filter by language" },
          kind: { type: "string", description: "Transform kind: rename, codemod" },
          old_name: { type: "string", description: "Old name for transform rename" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const uri = args.uri || args.path || ".";
          switch (args.action) {
            case "search_symbol": {
              if (!args.query)
                return fail3("INVALID_PARAMS", "query required");
              const filePattern = args.pattern || "**/*.{ts,js,py,rs,go,java,c,cpp,h}";
              const files = await glob2(path2.join(uri, filePattern), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/target/**"] });
              const results = [];
              for (const file of files) {
                if (results.length >= (args.max_results || 20))
                  break;
                try {
                  const content = await fs2.readFile(file, "utf-8");
                  const lines = content.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(args.query)) {
                      const match = lines[i].match(SYMBOL_RE);
                      if (match || lines[i].match(new RegExp(`\\b${args.query}\\b`))) {
                        results.push({ uri: file, line: i + 1, text: lines[i].trim(), type: match ? "definition" : "reference" });
                        if (results.length >= (args.max_results || 20))
                          break;
                      }
                    }
                  }
                } catch {
                }
              }
              return envelope3({ query: args.query, results, count: results.length }, "search_symbol");
            }
            case "outline": {
              if (!uri || uri === ".")
                return fail3("INVALID_PARAMS", "uri (file) required");
              const content = await fs2.readFile(uri, "utf-8");
              const lines = content.split("\n");
              const symbols = [];
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                SYMBOL_RE.lastIndex = 0;
                let m;
                while ((m = SYMBOL_RE.exec(line)) !== null) {
                  const kind = line.match(/\b(class|interface|type|enum|function|const|struct|impl|fn|def)\b/)?.[1] || "symbol";
                  symbols.push({ name: m[1], kind, line: i + 1, exported: /^export\b/.test(line.trim()) || /^pub\b/.test(line.trim()) });
                }
              }
              const imports = (content.match(IMPORT_RE) || []).length;
              return envelope3({ uri, symbols, imports, lines: lines.length }, "outline");
            }
            case "symbols": {
              const filePath = args.path || args.uri;
              if (!filePath || filePath === ".")
                return fail3("INVALID_PARAMS", "path or uri required");
              let content;
              if (args.text) {
                content = args.text;
              } else {
                content = await fs2.readFile(filePath, "utf-8");
              }
              const lines = content.split("\n");
              const symbols = [];
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                SYMBOL_RE.lastIndex = 0;
                let m;
                while ((m = SYMBOL_RE.exec(line)) !== null) {
                  const kind = line.match(/\b(class|interface|type|enum|function|const|struct|impl|fn|def)\b/)?.[1] || "symbol";
                  symbols.push({ name: m[1], kind, line: i + 1 });
                }
              }
              return envelope3({ symbols, count: symbols.length, path: filePath }, "symbols");
            }
            case "summarize": {
              const text = args.text || "";
              const wordCount = text.split(/\s+/).filter(Boolean).length;
              const lineCount = text.split("\n").length;
              const isDiff = text.includes("---") && text.includes("+++");
              const summary = isDiff ? `Diff: ${lineCount} lines, ${text.split("\n").filter((l) => l.startsWith("+")).length - 1} additions, ${text.split("\n").filter((l) => l.startsWith("-")).length - 1} deletions` : `Text: ${wordCount} words`;
              return envelope3({ summary, lines: lineCount, words: wordCount }, "summarize");
            }
            case "references": {
              if (!args.query)
                return fail3("INVALID_PARAMS", "query (symbol name) required");
              let hasRg = false;
              try {
                await execAsync3("which rg");
                hasRg = true;
              } catch {
              }
              const pattern = args.pattern ? `-g "${args.pattern}"` : '-g "*.{ts,js,py,rs,go,java}"';
              const cmd = hasRg ? `rg -n --max-count ${args.max_results || 30} ${pattern} "\\b${args.query}\\b" "${uri}"` : `grep -rn "\\b${args.query}\\b" "${uri}" | head -${args.max_results || 30}`;
              try {
                const { stdout } = await execAsync3(cmd);
                const refs = stdout.trim().split("\n").filter(Boolean).map((line) => {
                  const [file, num, ...rest] = line.split(":");
                  return { uri: file, line: parseInt(num) || 0, text: rest.join(":").trim() };
                });
                return envelope3({ query: args.query, references: refs, count: refs.length }, "references");
              } catch (e) {
                if (e.code === 1)
                  return envelope3({ query: args.query, references: [], count: 0 }, "references");
                throw e;
              }
            }
            case "metrics": {
              const filePattern = args.pattern || "**/*.{ts,js,py,rs,go}";
              const files = await glob2(path2.join(uri, filePattern), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"] });
              const byExt = {};
              let totalLines = 0, totalFiles = 0;
              for (const file of files) {
                try {
                  const content = await fs2.readFile(file, "utf-8");
                  const ext = path2.extname(file) || "other";
                  if (!byExt[ext])
                    byExt[ext] = { files: 0, lines: 0 };
                  const lines = content.split("\n").length;
                  byExt[ext].files++;
                  byExt[ext].lines += lines;
                  totalFiles++;
                  totalLines += lines;
                } catch {
                }
              }
              return envelope3({ total_files: totalFiles, total_lines: totalLines, by_extension: byExt }, "metrics");
            }
            case "exports": {
              if (!uri || uri === ".")
                return fail3("INVALID_PARAMS", "uri (file) required");
              const content = await fs2.readFile(uri, "utf-8");
              const exports = [];
              const lines = content.split("\n");
              for (const line of lines) {
                if (/^export\s/.test(line.trim()) || /^pub\s/.test(line.trim())) {
                  exports.push(line.trim());
                }
              }
              return envelope3({ uri, exports, count: exports.length }, "exports");
            }
            case "types": {
              if (!uri || uri === ".")
                return fail3("INVALID_PARAMS", "uri (file) required");
              const content = await fs2.readFile(uri, "utf-8");
              const types = [];
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (/(?:interface|type|enum|struct)\s+\w+/.test(lines[i])) {
                  const name = lines[i].match(/(?:interface|type|enum|struct)\s+(\w+)/)?.[1];
                  if (name)
                    types.push({ name, line: i + 1, text: lines[i].trim() });
                }
              }
              return envelope3({ uri, types, count: types.length }, "types");
            }
            case "hierarchy": {
              if (!args.query)
                return fail3("INVALID_PARAMS", "query (class name) required");
              const filePattern = args.pattern || "**/*.{ts,js,py,rs,go,java}";
              const files = await glob2(path2.join(uri, filePattern), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"] });
              const classes = {};
              for (const file of files) {
                try {
                  const content = await fs2.readFile(file, "utf-8");
                  const classRe = /class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
                  let m;
                  while ((m = classRe.exec(content)) !== null) {
                    if (m[2]) {
                      if (!classes[m[2]])
                        classes[m[2]] = [];
                      classes[m[2]].push(m[1]);
                    }
                    if (!classes[m[1]])
                      classes[m[1]] = [];
                  }
                } catch {
                }
              }
              const build = (name, depth = 0) => {
                let out = "  ".repeat(depth) + name + "\n";
                for (const child of classes[name] || [])
                  out += build(child, depth + 1);
                return out;
              };
              return envelope3({ root: args.query, tree: build(args.query), children: classes[args.query] || [] }, "hierarchy");
            }
            case "rename": {
              if (!args.query || !args.new_name)
                return fail3("INVALID_PARAMS", "query (old name) and new_name required");
              const filePattern = args.pattern || "**/*.{ts,js,py,rs,go}";
              const files = await glob2(path2.join(uri, filePattern), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"] });
              let totalChanges = 0;
              const changed = [];
              const re = new RegExp(`\\b${args.query}\\b`, "g");
              for (const file of files) {
                try {
                  const content = await fs2.readFile(file, "utf-8");
                  if (re.test(content)) {
                    const updated = content.replace(re, args.new_name);
                    await fs2.writeFile(file, updated, "utf-8");
                    const count = (content.match(re) || []).length;
                    totalChanges += count;
                    changed.push(`${file}: ${count} replacements`);
                  }
                } catch {
                }
              }
              return envelope3({ old_name: args.query, new_name: args.new_name, files_changed: changed.length, total_replacements: totalChanges, changed }, "rename");
            }
            case "grep_replace": {
              if (!args.query || args.replacement === void 0)
                return fail3("INVALID_PARAMS", "query (pattern) and replacement required");
              const filePattern = args.pattern || "**/*.{ts,js,py,rs,go}";
              const files = await glob2(path2.join(uri, filePattern), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"] });
              let totalChanges = 0;
              const changed = [];
              const re = new RegExp(args.query, "g");
              for (const file of files) {
                try {
                  const content = await fs2.readFile(file, "utf-8");
                  if (re.test(content)) {
                    re.lastIndex = 0;
                    const count = (content.match(re) || []).length;
                    const updated = content.replace(re, args.replacement);
                    await fs2.writeFile(file, updated, "utf-8");
                    totalChanges += count;
                    changed.push(`${file}: ${count}`);
                  }
                } catch {
                }
              }
              return envelope3({ pattern: args.query, replacement: args.replacement, files_changed: changed.length, total_replacements: totalChanges, changed }, "grep_replace");
            }
            case "parse": {
              if (!uri || uri === ".")
                return fail3("INVALID_PARAMS", "uri (file) required");
              const content = args.text || await fs2.readFile(uri, "utf-8");
              const lines = content.split("\n");
              const ext = path2.extname(uri).slice(1) || "text";
              const syms = [];
              for (let i = 0; i < lines.length; i++) {
                SYMBOL_RE.lastIndex = 0;
                let m;
                while ((m = SYMBOL_RE.exec(lines[i])) !== null) {
                  syms.push({ name: m[1], line: i + 1 });
                }
              }
              const imps = (content.match(IMPORT_RE) || []).length;
              return envelope3({ uri, language: args.language || ext, lines: lines.length, symbols: syms.length, imports: imps }, "parse");
            }
            case "serialize": {
              return envelope3({ hint: "Serialization requires CST preservation. Use the original source text.", supported: false }, "serialize");
            }
            case "definition": {
              if (!args.query)
                return fail3("INVALID_PARAMS", "query (symbol name) required");
              const defPath = args.uri || args.path;
              if (!defPath || defPath === ".")
                return fail3("INVALID_PARAMS", "uri (file) required");
              const defContent = await fs2.readFile(defPath, "utf-8");
              const defLines = defContent.split("\n");
              for (let i = 0; i < defLines.length; i++) {
                if (defLines[i].includes(args.query) && /\b(function|class|def|fn|struct|interface|type|enum|const|let|var)\b/.test(defLines[i])) {
                  return envelope3({ uri: defPath, symbol: args.query, line: i + 1, text: defLines[i].trim() }, "definition");
                }
              }
              return fail3("NOT_FOUND", `Symbol '${args.query}' definition not found`);
            }
            case "transform": {
              const tfPath = args.uri || args.path;
              if (!tfPath || tfPath === ".")
                return fail3("INVALID_PARAMS", "uri (file) required");
              const tfContent = args.text || await fs2.readFile(tfPath, "utf-8");
              const tfKind = args.kind || "rename";
              if (tfKind === "rename") {
                const oldName = args.query || args.old_name;
                if (!oldName || !args.new_name)
                  return fail3("INVALID_PARAMS", "query/old_name and new_name required");
                const re = new RegExp(`\\b${oldName}\\b`, "g");
                const newContent = tfContent.replace(re, args.new_name);
                const count = (tfContent.match(re) || []).length;
                const diffLines = [`--- a/${tfPath}`, `+++ b/${tfPath}`];
                const origLines = tfContent.split("\n");
                const newLines = newContent.split("\n");
                for (let i = 0; i < Math.max(origLines.length, newLines.length); i++) {
                  if (origLines[i] !== newLines[i]) {
                    diffLines.push(`@@ -${i + 1} +${i + 1} @@`);
                    if (origLines[i] !== void 0)
                      diffLines.push(`-${origLines[i]}`);
                    if (newLines[i] !== void 0)
                      diffLines.push(`+${newLines[i]}`);
                  }
                }
                return envelope3({ patch: diffLines.join("\n"), changes_count: count, kind: "rename" }, "transform");
              } else if (tfKind === "codemod") {
                if (!args.query || args.replacement === void 0)
                  return fail3("INVALID_PARAMS", "query (pattern) and replacement required");
                const re = new RegExp(args.query, "g");
                const count = (tfContent.match(re) || []).length;
                return envelope3({ patch: `${count} replacements of /${args.query}/`, changes_count: count, kind: "codemod" }, "transform");
              }
              return fail3("INVALID_PARAMS", `Unknown transform kind: ${tfKind}`);
            }
            default:
              return fail3("UNKNOWN_ACTION", `Unknown action: ${args.action}`);
          }
        } catch (error) {
          return fail3("ERROR", error.message);
        }
      }
    };
  }
});

// src/tools/unified/fetch.ts
import * as fs3 from "fs/promises";
import * as path3 from "path";
import { exec as exec4 } from "child_process";
import { promisify as promisify4 } from "util";
function envelope4(data, action) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, data, error: null, meta: { tool: "fetch", action } }, null, 2) }] };
}
function fail4(code, message) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, data: null, error: { code, message }, meta: { tool: "fetch" } }, null, 2) }], isError: true };
}
var execAsync4, fetchTool;
var init_fetch = __esm({
  "src/tools/unified/fetch.ts"() {
    "use strict";
    execAsync4 = promisify4(exec4);
    fetchTool = {
      name: "fetch",
      description: "Network operations: request, fetch, head, download, open, search, crawl",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["request", "fetch", "head", "download", "open", "search", "crawl"], description: "Network action" },
          url: { type: "string", description: "URL" },
          method: { type: "string", description: "HTTP method", default: "GET" },
          headers: { type: "object", description: "HTTP headers" },
          body: { type: "string", description: "Request body" },
          output: { type: "string", description: "Output file for download" },
          timeout: { type: "number", default: 3e4 },
          query: { type: "string", description: "Search query" },
          depth: { type: "number", description: "Crawl depth", default: 2 },
          limit: { type: "number", description: "Max results/pages", default: 10 }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          switch (args.action) {
            case "request": {
              const opts = {
                method: args.method || "GET",
                headers: args.headers || {},
                signal: AbortSignal.timeout(args.timeout || 3e4)
              };
              if (args.body)
                opts.body = args.body;
              const resp = await fetch(args.url, opts);
              const contentType = resp.headers.get("content-type") || "";
              let data;
              if (contentType.includes("json")) {
                data = await resp.json();
              } else {
                data = await resp.text();
              }
              return envelope4({
                status: resp.status,
                headers: Object.fromEntries(resp.headers.entries()),
                body: typeof data === "string" ? data.substring(0, 5e4) : data
              }, "request");
            }
            case "fetch": {
              const opts = {
                method: args.method || "GET",
                headers: args.headers || {},
                signal: AbortSignal.timeout(args.timeout || 3e4)
              };
              if (args.body)
                opts.body = args.body;
              const resp = await fetch(args.url, opts);
              const contentType = resp.headers.get("content-type") || "";
              let data;
              if (contentType.includes("json")) {
                data = await resp.json();
              } else {
                data = await resp.text();
              }
              return envelope4({
                text: typeof data === "string" ? data.substring(0, 5e4) : JSON.stringify(data),
                status: resp.status,
                headers: Object.fromEntries(resp.headers.entries())
              }, "fetch");
            }
            case "head": {
              const resp = await fetch(args.url, {
                method: "HEAD",
                headers: args.headers || {},
                signal: AbortSignal.timeout(args.timeout || 3e4)
              });
              return envelope4({
                status: resp.status,
                headers: Object.fromEntries(resp.headers.entries())
              }, "head");
            }
            case "download": {
              if (!args.output)
                return fail4("INVALID_PARAMS", "output path required");
              const resp = await fetch(args.url, { signal: AbortSignal.timeout(args.timeout || 6e4) });
              if (!resp.ok)
                return fail4("HTTP_ERROR", `${resp.status} ${resp.statusText}`);
              const buffer = Buffer.from(await resp.arrayBuffer());
              await fs3.mkdir(path3.dirname(args.output), { recursive: true });
              await fs3.writeFile(args.output, buffer);
              return envelope4({ url: args.url, output: args.output, size: buffer.length, status: resp.status }, "download");
            }
            case "open": {
              const platform2 = process.platform;
              const cmd = platform2 === "darwin" ? "open" : platform2 === "win32" ? "start" : "xdg-open";
              await execAsync4(`${cmd} "${args.url}"`);
              return envelope4({ url: args.url, opened: true }, "open");
            }
            case "search": {
              if (!args.query)
                return fail4("INVALID_PARAMS", "query required");
              const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
              const searchResp = await fetch(searchUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; HanzoBot/1.0)" },
                signal: AbortSignal.timeout(args.timeout || 15e3)
              });
              const searchHtml = await searchResp.text();
              const resultRe = /class="result__title"[^>]*>[\s\S]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\//g;
              const results = [];
              let match;
              const maxResults = args.limit || 10;
              while ((match = resultRe.exec(searchHtml)) !== null && results.length < maxResults) {
                results.push({
                  url: match[1].replace(/&amp;/g, "&"),
                  title: match[2].replace(/<[^>]+>/g, "").trim(),
                  snippet: match[3].replace(/<[^>]+>/g, "").trim()
                });
              }
              return envelope4({ query: args.query, results, count: results.length }, "search");
            }
            case "crawl": {
              if (!args.url)
                return fail4("INVALID_PARAMS", "url required");
              if (!args.output)
                return fail4("INVALID_PARAMS", "output directory required");
              const maxDepth = args.depth || 2;
              const maxPages = args.limit || 100;
              const startUrl = new URL(args.url);
              const visited = /* @__PURE__ */ new Set();
              const pages = [];
              const queue = [{ url: args.url, depth: 0 }];
              await fs3.mkdir(args.output, { recursive: true });
              while (queue.length > 0 && pages.length < maxPages) {
                const item = queue.shift();
                if (visited.has(item.url) || item.depth > maxDepth)
                  continue;
                try {
                  const pageUrl = new URL(item.url);
                  if (pageUrl.hostname !== startUrl.hostname)
                    continue;
                } catch {
                  continue;
                }
                visited.add(item.url);
                try {
                  const resp = await fetch(item.url, { signal: AbortSignal.timeout(1e4) });
                  const body = await resp.text();
                  const parsed = new URL(item.url);
                  let filePath = parsed.pathname.replace(/\/$/, "/index.html");
                  if (!path3.extname(filePath))
                    filePath += ".html";
                  const fullPath = path3.join(args.output, filePath);
                  await fs3.mkdir(path3.dirname(fullPath), { recursive: true });
                  await fs3.writeFile(fullPath, body);
                  pages.push(fullPath);
                  if (resp.headers.get("content-type")?.includes("html")) {
                    const linkRe = /href=["']([^"']+)["']/g;
                    let lm;
                    while ((lm = linkRe.exec(body)) !== null) {
                      try {
                        const absUrl = new URL(lm[1], item.url).href;
                        if (!visited.has(absUrl)) {
                          queue.push({ url: absUrl, depth: item.depth + 1 });
                        }
                      } catch {
                      }
                    }
                  }
                } catch {
                }
              }
              return envelope4({ pages, count: pages.length, dest: args.output, depth: maxDepth }, "crawl");
            }
            default:
              return fail4("UNKNOWN_ACTION", `Unknown action: ${args.action}`);
          }
        } catch (error) {
          return fail4("ERROR", error.message);
        }
      }
    };
  }
});

// src/tools/unified/workspace.ts
import * as fs4 from "fs/promises";
import * as path4 from "path";
import { exec as exec5 } from "child_process";
import { promisify as promisify5 } from "util";
function envelope5(data, action) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, data, error: null, meta: { tool: "workspace", action } }, null, 2) }] };
}
function fail5(code, message) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, data: null, error: { code, message }, meta: { tool: "workspace" } }, null, 2) }], isError: true };
}
async function fileExists(p) {
  try {
    await fs4.access(p);
    return true;
  } catch {
    return false;
  }
}
var execAsync5, workspaceTool;
var init_workspace = __esm({
  "src/tools/unified/workspace.ts"() {
    "use strict";
    execAsync5 = promisify5(exec5);
    workspaceTool = {
      name: "workspace",
      description: "Workspace context: detect, capabilities, help, schema",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["detect", "capabilities", "help", "schema"], description: "Workspace action" },
          path: { type: "string", description: "Project root", default: "." }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const root = args.path || process.cwd();
          switch (args.action) {
            case "detect": {
              const languages = [];
              const build = [];
              const test = [];
              let vcs = null;
              if (await fileExists(path4.join(root, ".git")))
                vcs = "git";
              if (await fileExists(path4.join(root, "package.json"))) {
                languages.push("typescript", "javascript");
                build.push("npm");
              }
              if (await fileExists(path4.join(root, "tsconfig.json")))
                languages.push("typescript");
              if (await fileExists(path4.join(root, "pyproject.toml"))) {
                languages.push("python");
                build.push("uv");
              }
              if (await fileExists(path4.join(root, "Cargo.toml"))) {
                languages.push("rust");
                build.push("cargo");
              }
              if (await fileExists(path4.join(root, "go.mod"))) {
                languages.push("go");
                build.push("go");
              }
              if (await fileExists(path4.join(root, "Makefile")))
                build.push("make");
              if (await fileExists(path4.join(root, "compose.yml")))
                build.push("docker-compose");
              if (await fileExists(path4.join(root, "Dockerfile")))
                build.push("docker");
              if (await fileExists(path4.join(root, "jest.config.ts")) || await fileExists(path4.join(root, "jest.config.js")))
                test.push("jest");
              if (await fileExists(path4.join(root, "vitest.config.ts")))
                test.push("vitest");
              if (await fileExists(path4.join(root, "pytest.ini")) || await fileExists(path4.join(root, "conftest.py")))
                test.push("pytest");
              return envelope5({
                root,
                languages: [...new Set(languages)],
                build: [...new Set(build)],
                test,
                vcs
              }, "detect");
            }
            case "capabilities": {
              let hasRg = false, hasGit = false, hasNode = false, hasPython = false, hasCargo = false;
              try {
                await execAsync5("which rg");
                hasRg = true;
              } catch {
              }
              try {
                await execAsync5("which git");
                hasGit = true;
              } catch {
              }
              try {
                await execAsync5("which node");
                hasNode = true;
              } catch {
              }
              try {
                await execAsync5("which python3");
                hasPython = true;
              } catch {
              }
              try {
                await execAsync5("which cargo");
                hasCargo = true;
              } catch {
              }
              return envelope5({
                search: hasRg ? "ripgrep" : "grep",
                vcs: hasGit ? "git" : null,
                runtimes: {
                  node: hasNode,
                  python: hasPython,
                  rust: hasCargo
                },
                tools: ["fs", "exec", "code", "git", "fetch", "computer", "workspace", "browser", "think", "llm", "memory", "hanzo", "plan", "tasks", "mode"]
              }, "capabilities");
            }
            case "help": {
              return envelope5({
                tools: {
                  fs: "Filesystem: read, write, stat, list, mkdir, rm, mv, apply_patch, search_text",
                  exec: "Processes: exec, ps, kill, logs",
                  code: "Semantics: search_symbol, outline, references, metrics, exports, types, hierarchy, rename, grep_replace",
                  git: "Version control: status, diff, log, commit, branch, tag, remote, merge, rebase, and more",
                  fetch: "Network: request, download, open",
                  workspace: "Workspace: detect, capabilities, help, schema",
                  computer: "Native OS control: click, type, screenshot, window management",
                  browser: "Web automation: navigate, click, fill, screenshot (Playwright)",
                  think: "Structured reasoning: think, critic, review, summarize, classify, explain",
                  llm: "LLM operations: query, consensus, models, enable, disable, test",
                  memory: "Memory: store, recall, list, delete, search, stats, clear, export, import, merge, tag, untag",
                  hanzo: "Hanzo Cloud: iam, kms, paas, commerce, storage, auth, api",
                  plan: "Planning: create, show, update, list, next, archive, add_step, remove_step, estimate, progress"
                }
              }, "help");
            }
            case "schema": {
              return envelope5({
                message: 'Use ws(action="help") for tool summaries, or call any tool with no action to see its schema.'
              }, "schema");
            }
            default:
              return fail5("UNKNOWN_ACTION", `Unknown action: ${args.action}`);
          }
        } catch (error) {
          return fail5("ERROR", error.message);
        }
      }
    };
  }
});

// src/tools/git.ts
import { exec as exec6 } from "child_process";
import { promisify as promisify6 } from "util";
async function git(args, cwd) {
  const { stdout } = await execAsync6(`git ${args}`, { cwd: cwd || ".", maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}
var execAsync6, gitTool, gitTools;
var init_git = __esm({
  "src/tools/git.ts"() {
    "use strict";
    execAsync6 = promisify6(exec6);
    gitTool = {
      name: "git",
      description: "Git version control: status, diff, log, branch, commit, blame, stash, show, tag, remote, merge, rebase, cherry_pick, reset, clean, worktree, bisect, reflog, init, clone, fetch, pull, push, config, shortlog, apply, checkout",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "status",
              "diff",
              "log",
              "branch",
              "commit",
              "blame",
              "stash",
              "show",
              "tag",
              "remote",
              "merge",
              "rebase",
              "cherry_pick",
              "reset",
              "clean",
              "worktree",
              "bisect",
              "reflog",
              "init",
              "clone",
              "fetch",
              "pull",
              "push",
              "config",
              "shortlog",
              "rev_parse",
              "describe",
              "apply",
              "checkout"
            ],
            description: "Git action"
          },
          path: { type: "string", description: "Repository path", default: "." },
          file: { type: "string", description: "File path (diff, blame, log)" },
          files: { type: "array", items: { type: "string" }, description: "Files to stage/add" },
          staged: { type: "boolean", description: "Staged changes (diff)", default: false },
          stat: { type: "boolean", description: "Show diffstat only", default: false },
          limit: { type: "number", description: "Number of entries (log, reflog)", default: 20 },
          author: { type: "string", description: "Filter by author" },
          since: { type: "string", description: "Since date (e.g., 1.week, 2024-01-01)" },
          until: { type: "string", description: "Until date" },
          oneline: { type: "boolean", default: true },
          graph: { type: "boolean", description: "Show graph (log)", default: false },
          name: { type: "string", description: "Branch/tag/remote/worktree name" },
          message: { type: "string", description: "Commit/tag/stash message" },
          ref: { type: "string", description: "Commit ref", default: "HEAD" },
          target: { type: "string", description: "Target branch/ref (merge, rebase, reset)" },
          all: { type: "boolean", default: false },
          force: { type: "boolean", default: false },
          lines: { type: "string", description: "Line range (blame, e.g., 10,20)" },
          sub_action: { type: "string", description: "Sub-action: list, create, delete, checkout, add, remove, show, start, good, bad, run, push, pop, apply, drop" },
          index: { type: "number", description: "Stash index", default: 0 },
          url: { type: "string", description: "Remote URL (clone, remote add)" },
          key: { type: "string", description: "Config key" },
          value: { type: "string", description: "Config value" },
          mode: { type: "string", enum: ["soft", "mixed", "hard"], description: "Reset mode", default: "mixed" },
          cherry: { type: "string", description: "Commit SHA for cherry-pick" },
          pattern: { type: "string", description: "Clean pattern / grep pattern" },
          format: { type: "string", description: "Log format (short, medium, full, fuller, oneline, format:...)" },
          patch: { type: "string", description: "Unified diff patch content (for apply)" },
          create: { type: "boolean", description: "Create new branch on checkout", default: false }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const cwd = args.path || ".";
          let out;
          switch (args.action) {
            case "status":
              out = args.all ? await git("status", cwd) : await git("status -sb", cwd) || "Clean";
              break;
            case "diff": {
              let cmd = "diff";
              if (args.staged)
                cmd += " --staged";
              if (args.stat)
                cmd += " --stat";
              if (args.target)
                cmd += ` ${args.target}`;
              if (args.file)
                cmd += ` -- ${args.file}`;
              out = await git(cmd, cwd) || "No changes";
              break;
            }
            case "log": {
              let cmd = `log -${args.limit || 20}`;
              if (args.oneline !== false && !args.format)
                cmd += " --oneline";
              if (args.graph)
                cmd += " --graph --decorate";
              if (args.author)
                cmd += ` --author="${args.author}"`;
              if (args.since)
                cmd += ` --since="${args.since}"`;
              if (args.until)
                cmd += ` --until="${args.until}"`;
              if (args.format)
                cmd += ` --format=${args.format}`;
              if (args.pattern)
                cmd += ` --grep="${args.pattern}"`;
              if (args.all)
                cmd += " --all";
              if (args.file)
                cmd += ` -- ${args.file}`;
              out = await git(cmd, cwd) || "No commits";
              break;
            }
            case "branch": {
              const sa = args.sub_action || "list";
              if (sa === "create") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name required" }], isError: true };
                out = await git(`checkout -b ${args.name}${args.target ? ` ${args.target}` : ""}`, cwd);
              } else if (sa === "checkout") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name required" }], isError: true };
                out = await git(`checkout ${args.name}`, cwd);
              } else if (sa === "delete") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name required" }], isError: true };
                out = await git(`branch ${args.force ? "-D" : "-d"} ${args.name}`, cwd);
              } else {
                out = await git(`branch${args.all ? " -a" : ""} -v`, cwd);
              }
              break;
            }
            case "commit": {
              if (!args.message)
                return { content: [{ type: "text", text: "message required" }], isError: true };
              if (args.files?.length)
                await git(`add ${args.files.join(" ")}`, cwd);
              else if (args.all)
                await git("add -A", cwd);
              out = await git(`commit -m "${args.message.replace(/"/g, '\\"')}"`, cwd);
              break;
            }
            case "blame": {
              if (!args.file)
                return { content: [{ type: "text", text: "file required" }], isError: true };
              let cmd = `blame ${args.file}`;
              if (args.lines)
                cmd += ` -L ${args.lines}`;
              out = await git(cmd, cwd);
              break;
            }
            case "stash": {
              const sa = args.sub_action || "push";
              if (sa === "push")
                out = await git(args.message ? `stash push -m "${args.message}"` : "stash push", cwd);
              else if (sa === "list")
                out = await git("stash list", cwd) || "No stashes";
              else if (sa === "show")
                out = await git(`stash show -p stash@{${args.index || 0}}`, cwd);
              else
                out = await git(`stash ${sa} stash@{${args.index || 0}}`, cwd);
              break;
            }
            case "show": {
              const fmt = args.stat ? "--stat" : "-p";
              out = await git(`show ${args.ref || "HEAD"} ${fmt}`, cwd);
              if (out.length > 5e3)
                out = out.substring(0, 5e3) + "\n... (truncated)";
              break;
            }
            case "tag": {
              const sa = args.sub_action || "list";
              if (sa === "create") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name required" }], isError: true };
                out = args.message ? await git(`tag -a ${args.name} -m "${args.message}" ${args.ref || ""}`, cwd) : await git(`tag ${args.name} ${args.ref || ""}`, cwd);
              } else if (sa === "delete") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name required" }], isError: true };
                out = await git(`tag -d ${args.name}`, cwd);
              } else if (sa === "show") {
                out = await git(`tag -l -n${args.limit || 20}`, cwd);
              } else {
                out = await git(`tag -l --sort=-version:refname`, cwd) || "No tags";
              }
              break;
            }
            case "remote": {
              const sa = args.sub_action || "list";
              if (sa === "add") {
                if (!args.name || !args.url)
                  return { content: [{ type: "text", text: "name and url required" }], isError: true };
                out = await git(`remote add ${args.name} ${args.url}`, cwd);
              } else if (sa === "remove") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name required" }], isError: true };
                out = await git(`remote remove ${args.name}`, cwd);
              } else if (sa === "show") {
                out = await git(`remote show ${args.name || "origin"}`, cwd);
              } else {
                out = await git("remote -v", cwd) || "No remotes";
              }
              break;
            }
            case "merge": {
              if (!args.target)
                return { content: [{ type: "text", text: "target branch required" }], isError: true };
              out = await git(`merge ${args.target}${args.message ? ` -m "${args.message}"` : ""}`, cwd);
              break;
            }
            case "rebase": {
              if (!args.target)
                return { content: [{ type: "text", text: "target branch required" }], isError: true };
              out = await git(`rebase ${args.target}`, cwd);
              break;
            }
            case "cherry_pick": {
              const sha = args.cherry || args.ref;
              if (!sha)
                return { content: [{ type: "text", text: "cherry (commit SHA) required" }], isError: true };
              out = await git(`cherry-pick ${sha}`, cwd);
              break;
            }
            case "reset": {
              const mode = args.mode || "mixed";
              out = await git(`reset --${mode} ${args.ref || "HEAD~1"}`, cwd);
              break;
            }
            case "clean": {
              if (args.force) {
                out = await git(`clean -fd${args.pattern ? ` -e "${args.pattern}"` : ""}`, cwd);
              } else {
                out = await git(`clean -nd`, cwd) || "Nothing to clean";
              }
              break;
            }
            case "worktree": {
              const sa = args.sub_action || "list";
              if (sa === "add") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name (path) required" }], isError: true };
                out = await git(`worktree add ${args.name}${args.target ? ` ${args.target}` : ""}`, cwd);
              } else if (sa === "remove") {
                if (!args.name)
                  return { content: [{ type: "text", text: "name (path) required" }], isError: true };
                out = await git(`worktree remove ${args.name}${args.force ? " --force" : ""}`, cwd);
              } else {
                out = await git("worktree list", cwd);
              }
              break;
            }
            case "bisect": {
              const sa = args.sub_action || "start";
              if (sa === "start")
                out = await git("bisect start", cwd);
              else if (sa === "good")
                out = await git(`bisect good ${args.ref || ""}`, cwd);
              else if (sa === "bad")
                out = await git(`bisect bad ${args.ref || ""}`, cwd);
              else if (sa === "run") {
                if (!args.value)
                  return { content: [{ type: "text", text: "value (script) required" }], isError: true };
                out = await git(`bisect run ${args.value}`, cwd);
              } else {
                out = await git("bisect reset", cwd);
              }
              break;
            }
            case "reflog":
              out = await git(`reflog -${args.limit || 20}`, cwd);
              break;
            case "init":
              out = await git(`init${args.name ? ` ${args.name}` : ""}`, cwd);
              break;
            case "clone": {
              if (!args.url)
                return { content: [{ type: "text", text: "url required" }], isError: true };
              out = await git(`clone ${args.url}${args.name ? ` ${args.name}` : ""}`, cwd);
              break;
            }
            case "fetch":
              out = await git(`fetch ${args.name || "--all"}${args.all ? " --prune" : ""}`, cwd);
              break;
            case "pull":
              out = await git(`pull ${args.name || "origin"} ${args.target || ""}`, cwd);
              break;
            case "push":
              out = await git(`push ${args.name || "origin"} ${args.target || ""}${args.force ? " --force" : ""}`, cwd);
              break;
            case "config": {
              if (args.key && args.value)
                out = await git(`config ${args.key} "${args.value}"`, cwd);
              else if (args.key)
                out = await git(`config --get ${args.key}`, cwd);
              else
                out = await git("config --list --local", cwd);
              break;
            }
            case "shortlog":
              out = await git(`shortlog -sn${args.since ? ` --since="${args.since}"` : ""}${args.all ? " --all" : ""}`, cwd);
              break;
            case "rev_parse":
              out = await git(`rev-parse ${args.ref || "HEAD"}`, cwd);
              break;
            case "describe":
              out = await git(`describe --tags --always ${args.ref || ""}`, cwd).catch(() => "No tags");
              break;
            case "apply": {
              if (!args.patch)
                return { content: [{ type: "text", text: "patch content required" }], isError: true };
              const { execSync } = await import("child_process");
              try {
                execSync(`git apply -`, { cwd, input: args.patch, maxBuffer: 5 * 1024 * 1024 });
                out = "Patch applied successfully";
              } catch (e) {
                return { content: [{ type: "text", text: `Patch failed: ${e.stderr?.toString() || e.message}` }], isError: true };
              }
              break;
            }
            case "checkout": {
              if (!args.name && !args.ref)
                return { content: [{ type: "text", text: "name or ref required" }], isError: true };
              const target = args.name || args.ref;
              if (args.create) {
                out = await git(`checkout -b ${target}`, cwd);
              } else {
                out = await git(`checkout ${target}`, cwd);
              }
              break;
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
          return { content: [{ type: "text", text: out || "Done" }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    gitTools = [gitTool];
  }
});

// src/tools/ui-github-api.ts
import * as https from "https";
var GITHUB_API_BASE, GITHUB_RAW_BASE, FRAMEWORK_CONFIGS, Cache, CircuitBreaker, GitHubAPIClient, githubClient, fetchComponentTool, fetchComponentDemoTool, fetchBlockTool, listComponentsTool, listBlocksTool, getComponentMetadataTool, getBlockTool, listBlocksTool2, getDirectoryStructureTool2, getDirectoryStructureTool, getComponentDemoTool, getComponentMetadataTool2, getRateLimitTool, githubUITools;
var init_ui_github_api = __esm({
  "src/tools/ui-github-api.ts"() {
    "use strict";
    GITHUB_API_BASE = "https://api.github.com";
    GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
    FRAMEWORK_CONFIGS = {
      hanzo: {
        owner: "hanzoai",
        repo: "ui",
        branch: "main",
        componentsPath: "packages/ui/src/components",
        blocksPath: "packages/ui/src/blocks",
        extension: ".tsx",
        defaultFramework: true
      },
      react: {
        owner: "shadcn-ui",
        repo: "ui",
        branch: "main",
        componentsPath: "apps/v4/registry/new-york-v4/ui",
        blocksPath: "apps/v4/registry/new-york-v4/blocks",
        examplesPath: "apps/v4/registry/new-york-v4/examples",
        extension: ".tsx"
      },
      svelte: {
        owner: "huntabyte",
        repo: "shadcn-svelte",
        branch: "main",
        componentsPath: "apps/www/src/lib/registry/new-york/ui",
        blocksPath: "apps/www/src/lib/registry/new-york/blocks",
        extension: ".svelte"
      },
      vue: {
        owner: "unovue",
        repo: "shadcn-vue",
        branch: "main",
        componentsPath: "apps/www/src/lib/registry/new-york/ui",
        blocksPath: "apps/www/src/lib/registry/new-york/blocks",
        extension: ".vue"
      },
      "react-native": {
        owner: "founded-labs",
        repo: "react-native-reusables",
        branch: "main",
        componentsPath: "packages/reusables/src",
        extension: ".tsx"
      }
    };
    Cache = class {
      cache = /* @__PURE__ */ new Map();
      ttl;
      constructor(ttlMinutes = 15) {
        this.ttl = ttlMinutes * 60 * 1e3;
      }
      get(key) {
        const entry = this.cache.get(key);
        if (!entry)
          return null;
        if (Date.now() - entry.timestamp > this.ttl) {
          this.cache.delete(key);
          return null;
        }
        return entry.data;
      }
      set(key, data) {
        this.cache.set(key, {
          data,
          timestamp: Date.now()
        });
      }
      clear() {
        this.cache.clear();
      }
    };
    CircuitBreaker = class {
      failures = 0;
      lastFailureTime = 0;
      state = "closed";
      threshold = 5;
      timeout = 6e4;
      // 1 minute
      async execute(fn) {
        if (this.state === "open") {
          if (Date.now() - this.lastFailureTime > this.timeout) {
            this.state = "half-open";
          } else {
            throw new Error("Circuit breaker is open - service unavailable");
          }
        }
        try {
          const result = await fn();
          if (this.state === "half-open") {
            this.state = "closed";
            this.failures = 0;
          }
          return result;
        } catch (error) {
          this.failures++;
          this.lastFailureTime = Date.now();
          if (this.failures >= this.threshold) {
            this.state = "open";
          }
          throw error;
        }
      }
      reset() {
        this.state = "closed";
        this.failures = 0;
        this.lastFailureTime = 0;
      }
    };
    GitHubAPIClient = class {
      token;
      cache = new Cache();
      circuitBreaker = new CircuitBreaker();
      rateLimitRemaining = 60;
      rateLimitReset = Date.now();
      constructor() {
        this.token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || null;
      }
      async makeRequest(url) {
        if (this.rateLimitRemaining <= 0 && Date.now() < this.rateLimitReset) {
          const waitTime = Math.ceil((this.rateLimitReset - Date.now()) / 1e3);
          throw new Error(`GitHub API rate limit exceeded. Reset in ${waitTime} seconds.`);
        }
        const cacheKey = url;
        const cached = this.cache.get(cacheKey);
        if (cached) {
          return cached;
        }
        return this.circuitBreaker.execute(async () => {
          return new Promise((resolve, reject) => {
            const options = {
              headers: {
                "User-Agent": "Hanzo-MCP-UI-Tool",
                "Accept": "application/vnd.github.v3+json"
              }
            };
            if (this.token) {
              options.headers.Authorization = `token ${this.token}`;
            }
            https.get(url, options, (res) => {
              if (res.headers["x-ratelimit-remaining"]) {
                this.rateLimitRemaining = parseInt(res.headers["x-ratelimit-remaining"], 10);
              }
              if (res.headers["x-ratelimit-reset"]) {
                this.rateLimitReset = parseInt(res.headers["x-ratelimit-reset"], 10) * 1e3;
              }
              let data = "";
              res.on("data", (chunk) => data += chunk);
              res.on("end", () => {
                if (res.statusCode === 200) {
                  try {
                    const parsed = JSON.parse(data);
                    this.cache.set(cacheKey, parsed);
                    resolve(parsed);
                  } catch (e) {
                    this.cache.set(cacheKey, data);
                    resolve(data);
                  }
                } else if (res.statusCode === 403) {
                  reject(new Error(`GitHub API rate limit exceeded or authentication required`));
                } else if (res.statusCode === 404) {
                  reject(new Error(`Resource not found`));
                } else {
                  reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
                }
              });
            }).on("error", reject);
          });
        });
      }
      async getRawContent(owner, repo, path19, branch) {
        const url = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${path19}`;
        const cacheKey = url;
        const cached = this.cache.get(cacheKey);
        if (cached) {
          return cached;
        }
        return new Promise((resolve, reject) => {
          https.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
              if (res.statusCode === 200) {
                this.cache.set(cacheKey, data);
                resolve(data);
              } else if (res.statusCode === 404) {
                reject(new Error(`File not found: ${path19}`));
              } else {
                reject(new Error(`Failed to fetch raw content: ${res.statusCode}`));
              }
            });
          }).on("error", reject);
        });
      }
      async getDirectoryContents(owner, repo, path19, branch) {
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path19}?ref=${branch}`;
        return this.makeRequest(url);
      }
      async searchCode(owner, repo, query) {
        const url = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(query)}+repo:${owner}/${repo}`;
        return this.makeRequest(url);
      }
      // Component fetching methods
      async fetchComponent(name, framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        const componentPath = `${config.componentsPath}/${name}${config.extension}`;
        try {
          return await this.getRawContent(config.owner, config.repo, componentPath, config.branch);
        } catch (error) {
          const indexPath = `${config.componentsPath}/${name}/index${config.extension}`;
          try {
            return await this.getRawContent(config.owner, config.repo, indexPath, config.branch);
          } catch {
            throw new Error(`Component '${name}' not found in ${framework} repository`);
          }
        }
      }
      async fetchComponentDemo(name, framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        if (!config.examplesPath && framework !== "hanzo") {
          throw new Error(`Demo/examples not available for ${framework}`);
        }
        const demoPath = framework === "hanzo" ? `${config.componentsPath}/${name}/demo${config.extension}` : `${config.examplesPath}/${name}-demo${config.extension}`;
        try {
          return await this.getRawContent(config.owner, config.repo, demoPath, config.branch);
        } catch (error) {
          throw new Error(`Demo for component '${name}' not found in ${framework} repository`);
        }
      }
      async fetchComponentMetadata(name, framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        const metadataPath = `${config.componentsPath}/${name}/metadata.json`;
        try {
          const content = await this.getRawContent(config.owner, config.repo, metadataPath, config.branch);
          return JSON.parse(content);
        } catch {
          return {
            name,
            framework,
            extension: config.extension,
            path: `${config.componentsPath}/${name}`
          };
        }
      }
      async fetchBlock(name, framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        if (!config.blocksPath) {
          throw new Error(`Blocks not available for ${framework}`);
        }
        const blockPath = `${config.blocksPath}/${name}${config.extension}`;
        try {
          return await this.getRawContent(config.owner, config.repo, blockPath, config.branch);
        } catch (error) {
          const indexPath = `${config.blocksPath}/${name}/index${config.extension}`;
          try {
            return await this.getRawContent(config.owner, config.repo, indexPath, config.branch);
          } catch {
            throw new Error(`Block '${name}' not found in ${framework} repository`);
          }
        }
      }
      async listComponents(framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        try {
          const contents = await this.getDirectoryContents(
            config.owner,
            config.repo,
            config.componentsPath,
            config.branch
          );
          return contents.filter(
            (item) => item.type === "dir" || item.type === "file" && item.name.endsWith(config.extension)
          ).map((item) => item.name.replace(config.extension, ""));
        } catch (error) {
          throw new Error(`Failed to list components for ${framework}: ${error}`);
        }
      }
      async listBlocks(framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        if (!config.blocksPath) {
          return [];
        }
        try {
          const contents = await this.getDirectoryContents(
            config.owner,
            config.repo,
            config.blocksPath,
            config.branch
          );
          return contents.filter(
            (item) => item.type === "dir" || item.type === "file" && item.name.endsWith(config.extension)
          ).map((item) => item.name.replace(config.extension, ""));
        } catch {
          return [];
        }
      }
      async getDirectoryStructure(dirPath, framework = "hanzo") {
        const config = FRAMEWORK_CONFIGS[framework];
        try {
          const contents = await this.getDirectoryContents(
            config.owner,
            config.repo,
            dirPath,
            config.branch
          );
          const structure = {
            path: dirPath,
            children: []
          };
          for (const item of contents) {
            if (item.type === "dir") {
              structure.children.push({
                name: item.name,
                type: "directory",
                path: item.path
              });
            } else if (item.type === "file") {
              structure.children.push({
                name: item.name,
                type: "file",
                path: item.path,
                size: item.size
              });
            }
          }
          return structure;
        } catch (error) {
          throw new Error(`Failed to get directory structure: ${error}`);
        }
      }
      // Utility methods
      clearCache() {
        this.cache.clear();
      }
      resetCircuitBreaker() {
        this.circuitBreaker.reset();
      }
      getRateLimitInfo() {
        return {
          remaining: this.rateLimitRemaining,
          reset: new Date(this.rateLimitReset)
        };
      }
    };
    githubClient = new GitHubAPIClient();
    fetchComponentTool = {
      name: "ui_fetch_component",
      description: "Fetch a UI component from GitHub repositories (shadcn/ui, Hanzo UI, etc)",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name (e.g., button, card, dialog)"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const content = await githubClient.fetchComponent(args.name, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: content
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching component: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    fetchComponentDemoTool = {
      name: "ui_fetch_demo",
      description: "Fetch a demo/example for a UI component",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const content = await githubClient.fetchComponentDemo(args.name, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: content
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching demo: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    fetchBlockTool = {
      name: "ui_fetch_block",
      description: "Fetch a UI block/section from GitHub repositories",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Block name (e.g., hero, features, pricing)"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const content = await githubClient.fetchBlock(args.name, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: content
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching block: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    listComponentsTool = {
      name: "ui_list_github_components",
      description: "List available components from a framework repository",
      inputSchema: {
        type: "object",
        properties: {
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        }
      },
      handler: async (args) => {
        try {
          const components = await githubClient.listComponents(args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: `Available components in ${args.framework || "hanzo"}:
${components.join("\n")}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error listing components: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    listBlocksTool = {
      name: "ui_list_github_blocks",
      description: "List available blocks from a framework repository",
      inputSchema: {
        type: "object",
        properties: {
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        }
      },
      handler: async (args) => {
        try {
          const blocks = await githubClient.listBlocks(args.framework || "hanzo");
          if (blocks.length === 0) {
            return {
              content: [{
                type: "text",
                text: `No blocks available for ${args.framework || "hanzo"}`
              }]
            };
          }
          return {
            content: [{
              type: "text",
              text: `Available blocks in ${args.framework || "hanzo"}:
${blocks.join("\n")}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error listing blocks: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getComponentMetadataTool = {
      name: "ui_component_metadata",
      description: "Get metadata for a UI component",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const metadata = await githubClient.fetchComponentMetadata(args.name, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: JSON.stringify(metadata, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching metadata: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getBlockTool = {
      name: "ui_get_block",
      description: "Get a UI block implementation with support for complex compositions",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Block name (e.g., dashboard-01, authentication-01, chart-01)"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          },
          includeFiles: {
            type: "boolean",
            description: "Include all related files if block has multiple components",
            default: false
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const framework = args.framework || "hanzo";
          const config = FRAMEWORK_CONFIGS[framework];
          if (!config.blocksPath) {
            return {
              content: [{
                type: "text",
                text: `Blocks not available for ${framework}`
              }],
              isError: true
            };
          }
          let content;
          let isDirectory = false;
          try {
            content = await githubClient.fetchBlock(args.name, framework);
          } catch {
            try {
              const structure = await githubClient.getDirectoryStructure(
                `${config.blocksPath}/${args.name}`,
                framework
              );
              isDirectory = true;
              if (args.includeFiles && structure.children && structure.children.length > 0) {
                const files = [];
                for (const child of structure.children) {
                  if (child.type === "file" && child.name.endsWith(config.extension)) {
                    try {
                      const fileContent = await githubClient.getRawContent(
                        config.owner,
                        config.repo,
                        child.path,
                        config.branch
                      );
                      files.push({
                        path: child.path,
                        name: child.name,
                        content: fileContent
                      });
                    } catch {
                    }
                  }
                }
                if (files.length > 0) {
                  const output = files.map(
                    (f) => `// File: ${f.name}
// Path: ${f.path}

${f.content}`
                  ).join("\n\n" + "=".repeat(80) + "\n\n");
                  return {
                    content: [{
                      type: "text",
                      text: output
                    }]
                  };
                }
              }
              content = JSON.stringify(structure, null, 2);
            } catch (error) {
              throw new Error(`Block '${args.name}' not found in ${framework} repository`);
            }
          }
          return {
            content: [{
              type: "text",
              text: content
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching block: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    listBlocksTool2 = {
      name: "ui_list_blocks",
      description: "List all available UI blocks with categories (dashboard, authentication, charts, etc)",
      inputSchema: {
        type: "object",
        properties: {
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          },
          category: {
            type: "string",
            description: "Filter by category (e.g., dashboard, authentication, chart, sidebar)"
          }
        }
      },
      handler: async (args) => {
        try {
          const framework = args.framework || "hanzo";
          const blocks = await githubClient.listBlocks(framework);
          if (blocks.length === 0) {
            return {
              content: [{
                type: "text",
                text: `No blocks available for ${framework}`
              }]
            };
          }
          const categorized = {};
          const uncategorized = [];
          for (const block of blocks) {
            const match = block.match(/^([a-z-]+)-\d+$/);
            if (match) {
              const category = match[1];
              if (!categorized[category]) {
                categorized[category] = [];
              }
              categorized[category].push(block);
            } else if (block.includes("-")) {
              const category = block.split("-")[0];
              if (!categorized[category]) {
                categorized[category] = [];
              }
              categorized[category].push(block);
            } else {
              uncategorized.push(block);
            }
          }
          if (args.category) {
            const categoryBlocks = categorized[args.category] || [];
            if (categoryBlocks.length === 0) {
              return {
                content: [{
                  type: "text",
                  text: `No blocks found in category '${args.category}' for ${framework}

Available categories: ${Object.keys(categorized).join(", ")}`
                }]
              };
            }
            return {
              content: [{
                type: "text",
                text: `${framework} blocks in category '${args.category}':
${categoryBlocks.join("\n")}`
              }]
            };
          }
          let output = `Available blocks in ${framework}:

`;
          const sortedCategories = Object.keys(categorized).sort();
          for (const category of sortedCategories) {
            output += `\u{1F4C1} ${category}:
`;
            categorized[category].sort().forEach((block) => {
              output += `  \u2022 ${block}
`;
            });
            output += "\n";
          }
          if (uncategorized.length > 0) {
            output += `\u{1F4C4} Other:
`;
            uncategorized.sort().forEach((block) => {
              output += `  \u2022 ${block}
`;
            });
          }
          return {
            content: [{
              type: "text",
              text: output.trim()
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error listing blocks: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getDirectoryStructureTool2 = {
      name: "ui_get_directory_structure",
      description: "Browse repository structure to explore available UI components and blocks",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Directory path in the repository (e.g., "apps/www/src/lib/registry/new-york/ui")'
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          },
          depth: {
            type: "number",
            description: "Maximum depth to traverse (default: 1)",
            default: 1
          }
        },
        required: ["path"]
      },
      handler: async (args) => {
        try {
          let formatTree2 = function(node, indent = "") {
            let output = "";
            if (node.children) {
              for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const isLast = i === node.children.length - 1;
                const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
                const extension = isLast ? "    " : "\u2502   ";
                if (child.type === "directory") {
                  output += `${indent}${connector}\u{1F4C1} ${child.name}/
`;
                  if (child.children) {
                    output += formatTree2(child, indent + extension);
                  }
                } else {
                  const icon = child.name.endsWith(".tsx") ? "\u269B\uFE0F" : child.name.endsWith(".ts") ? "\u{1F4D8}" : child.name.endsWith(".jsx") ? "\u269B\uFE0F" : child.name.endsWith(".js") ? "\u{1F4DC}" : child.name.endsWith(".vue") ? "\u{1F49A}" : child.name.endsWith(".svelte") ? "\u{1F525}" : child.name.endsWith(".css") ? "\u{1F3A8}" : child.name.endsWith(".json") ? "\u{1F4CB}" : child.name.endsWith(".md") ? "\u{1F4DD}" : "\u{1F4C4}";
                  const size = child.size ? ` (${(child.size / 1024).toFixed(1)}kb)` : "";
                  output += `${indent}${connector}${icon} ${child.name}${size}
`;
                }
              }
            }
            return output;
          };
          var formatTree = formatTree2;
          const framework = args.framework || "hanzo";
          const depth = args.depth || 1;
          async function getStructureRecursive(path19, currentDepth) {
            if (currentDepth > depth) {
              return null;
            }
            const structure2 = await githubClient.getDirectoryStructure(path19, framework);
            if (currentDepth < depth && structure2.children) {
              for (let i = 0; i < structure2.children.length; i++) {
                const child = structure2.children[i];
                if (child.type === "directory") {
                  const subStructure = await getStructureRecursive(child.path, currentDepth + 1);
                  if (subStructure && subStructure.children) {
                    structure2.children[i] = {
                      ...child,
                      children: subStructure.children
                    };
                  }
                }
              }
            }
            return structure2;
          }
          const structure = await getStructureRecursive(args.path, 1);
          const treeOutput = formatTree2(structure);
          const header = `\u{1F4E6} ${args.path}
${treeOutput}`;
          return {
            content: [{
              type: "text",
              text: header
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting directory structure: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getDirectoryStructureTool = {
      name: "ui_directory_structure",
      description: "Get directory structure from a UI framework repository",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path in the repository"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["path"]
      },
      handler: async (args) => {
        try {
          const structure = await githubClient.getDirectoryStructure(args.path, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: JSON.stringify(structure, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting directory structure: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getComponentDemoTool = {
      name: "ui_get_component_demo",
      description: "Get component demo/example code from GitHub repositories",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const content = await githubClient.fetchComponentDemo(args.name, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: content
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching component demo: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getComponentMetadataTool2 = {
      name: "ui_get_component_metadata",
      description: "Get component dependencies and registry info from GitHub repositories",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name"
          },
          framework: {
            type: "string",
            enum: ["hanzo", "react", "svelte", "vue", "react-native"],
            description: "UI framework (default: hanzo)",
            default: "hanzo"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        try {
          const metadata = await githubClient.fetchComponentMetadata(args.name, args.framework || "hanzo");
          return {
            content: [{
              type: "text",
              text: JSON.stringify(metadata, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error fetching component metadata: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getRateLimitTool = {
      name: "ui_github_rate_limit",
      description: "Get current GitHub API rate limit information",
      inputSchema: {
        type: "object",
        properties: {}
      },
      handler: async () => {
        const info = githubClient.getRateLimitInfo();
        return {
          content: [{
            type: "text",
            text: `GitHub API Rate Limit:
Remaining: ${info.remaining}
Reset: ${info.reset.toISOString()}`
          }]
        };
      }
    };
    githubUITools = [
      fetchComponentTool,
      fetchComponentDemoTool,
      fetchBlockTool,
      getBlockTool,
      listComponentsTool,
      listBlocksTool,
      listBlocksTool2,
      getComponentMetadataTool,
      getComponentDemoTool,
      getComponentMetadataTool2,
      getDirectoryStructureTool,
      getDirectoryStructureTool2,
      getRateLimitTool
    ];
  }
});

// src/tools/unified-ui.ts
import { exec as exec7 } from "child_process";
import { promisify as promisify7 } from "util";
function getGitHubClient() {
  return new GitHubAPIClient();
}
async function checkHanzoRegistry() {
  try {
    const response = await fetch("https://ui.hanzo.ai/registry/index.json");
    return response.ok;
  } catch {
    try {
      const response = await fetch("https://ui.hanzo.ai/api/registry");
      return response.ok;
    } catch {
      return false;
    }
  }
}
var execAsync7, HANZO_FRAMEWORKS, currentFramework, CACHE_TTL, methodHandlers, unifiedUITool;
var init_unified_ui = __esm({
  "src/tools/unified-ui.ts"() {
    "use strict";
    init_ui_github_api();
    execAsync7 = promisify7(exec7);
    HANZO_FRAMEWORKS = {
      // Hanzo implementations
      "hanzo": {
        name: "Hanzo UI (React)",
        registry: "https://ui.hanzo.ai/registry",
        github: {
          owner: "hanzoai",
          repo: "ui",
          branch: "main",
          componentsPath: "packages/ui/src/components",
          blocksPath: "packages/ui/src/blocks",
          extension: ".tsx"
        }
      },
      "hanzo-native": {
        name: "Hanzo UI Native (React Native)",
        registry: "https://ui.hanzo.ai/registry/native",
        github: {
          owner: "hanzoai",
          repo: "ui-native",
          branch: "main",
          componentsPath: "packages/native/src/components",
          extension: ".tsx"
        }
      },
      "hanzo-vue": {
        name: "Hanzo UI Vue",
        registry: "https://ui.hanzo.ai/registry/vue",
        github: {
          owner: "hanzoai",
          repo: "ui-vue",
          branch: "main",
          componentsPath: "packages/vue/src/components",
          extension: ".vue"
        }
      },
      "hanzo-svelte": {
        name: "Hanzo UI Svelte",
        registry: "https://ui.hanzo.ai/registry/svelte",
        github: {
          owner: "hanzoai",
          repo: "ui-svelte",
          branch: "main",
          componentsPath: "packages/svelte/src/components",
          extension: ".svelte"
        }
      },
      // External frameworks
      "shadcn": {
        name: "shadcn/ui",
        registry: "https://ui.shadcn.com/registry",
        github: FRAMEWORK_CONFIGS.react
      },
      "react": {
        name: "shadcn/ui (React)",
        registry: "https://ui.shadcn.com/registry",
        github: FRAMEWORK_CONFIGS.react
      },
      "svelte": {
        name: "Svelte (shadcn)",
        github: FRAMEWORK_CONFIGS.svelte
      },
      "vue": {
        name: "Vue (shadcn)",
        github: FRAMEWORK_CONFIGS.vue
      },
      "react-native": {
        name: "React Native Reusables",
        github: FRAMEWORK_CONFIGS["react-native"]
      }
    };
    currentFramework = "hanzo";
    CACHE_TTL = 5 * 60 * 1e3;
    methodHandlers = {
      // List available components
      async list_components(args) {
        const framework = args.framework || currentFramework;
        const category = args.category;
        const client = getGitHubClient();
        const components = await client.listComponents(framework);
        let filtered = components;
        if (category) {
          filtered = components.filter((c) => c.category === category);
        }
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          total: filtered.length,
          components: filtered
        };
      },
      // Get component details
      async get_component(args) {
        const name = args.component || args.name;
        const framework = args.framework || currentFramework;
        if (!name) {
          throw new Error("Component name is required");
        }
        const client = getGitHubClient();
        const component = await client.fetchComponent(name, framework);
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          component: name,
          source: component
        };
      },
      // Get component demo/examples
      async get_demo(args) {
        const name = args.component || args.name;
        const framework = args.framework || currentFramework;
        if (!name) {
          throw new Error("Component name is required");
        }
        const client = getGitHubClient();
        const demo = await client.fetchComponentDemo(name, framework);
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          component: name,
          demo
        };
      },
      // Get component metadata
      async get_metadata(args) {
        const name = args.component || args.name;
        const framework = args.framework || currentFramework;
        if (!name) {
          throw new Error("Component name is required");
        }
        const client = getGitHubClient();
        const metadata = await client.fetchComponentMetadata(name, framework);
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          component: name,
          metadata
        };
      },
      // List UI blocks
      async list_blocks(args) {
        const framework = args.framework || currentFramework;
        const category = args.category;
        const client = getGitHubClient();
        const blocks = await client.listBlocks(framework);
        let filtered = blocks;
        if (category) {
          filtered = blocks.filter((b) => b.category === category);
        }
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          total: filtered.length,
          blocks: filtered
        };
      },
      // Get block implementation
      async get_block(args) {
        const name = args.block || args.name;
        const framework = args.framework || currentFramework;
        const includeFiles = args.include_files !== false;
        if (!name) {
          throw new Error("Block name is required");
        }
        const client = getGitHubClient();
        const block = await client.fetchBlock(name, framework);
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          block: name,
          implementation: block
        };
      },
      // Search components
      async search(args) {
        const query = args.query || args.search;
        const framework = args.framework || currentFramework;
        if (!query) {
          throw new Error("Search query is required");
        }
        const client = getGitHubClient();
        const components = await client.listComponents(framework);
        const matches = components.filter(
          (c) => c.name?.toLowerCase().includes(query.toLowerCase()) || c.description?.toLowerCase().includes(query.toLowerCase()) || c.category?.toLowerCase().includes(query.toLowerCase())
        );
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          query,
          results: matches
        };
      },
      // Get directory structure
      async get_structure(args) {
        const path19 = args.path || "";
        const framework = args.framework || currentFramework;
        const depth = args.depth || 3;
        const client = getGitHubClient();
        const structure = await client.getDirectoryStructure(path19, framework);
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          path: path19 || "/",
          structure
        };
      },
      // Install component
      async install(args) {
        const name = args.component || args.name;
        const framework = args.framework || currentFramework;
        const overwrite = args.overwrite || false;
        if (!name) {
          throw new Error("Component name is required");
        }
        let command = "";
        if (framework.startsWith("hanzo")) {
          command = `npx @hanzo/ui add ${name}${overwrite ? " --overwrite" : ""}`;
        } else if (framework === "shadcn" || framework === "react") {
          command = `npx shadcn@latest add ${name}${overwrite ? " --overwrite" : ""}`;
        } else {
          throw new Error(`Installation not supported for framework: ${framework}`);
        }
        const { stdout, stderr } = await execAsync7(command);
        return {
          framework: HANZO_FRAMEWORKS[framework]?.name || framework,
          component: name,
          command,
          output: stdout,
          warnings: stderr
        };
      },
      // Set current framework
      async set_framework(args) {
        const framework = args.framework;
        if (!framework) {
          throw new Error("Framework is required");
        }
        if (!HANZO_FRAMEWORKS[framework]) {
          throw new Error(`Unknown framework: ${framework}. Available: ${Object.keys(HANZO_FRAMEWORKS).join(", ")}`);
        }
        currentFramework = framework;
        return {
          success: true,
          framework: HANZO_FRAMEWORKS[framework].name,
          message: `Switched to ${HANZO_FRAMEWORKS[framework].name}`
        };
      },
      // Get current framework
      async get_framework(args) {
        const isHanzoRegistryLive = await checkHanzoRegistry();
        return {
          current: HANZO_FRAMEWORKS[currentFramework].name,
          framework: currentFramework,
          available: Object.entries(HANZO_FRAMEWORKS).map(([key, config]) => ({
            key,
            name: config.name,
            hasRegistry: !!config.registry
          })),
          hanzoRegistryStatus: isHanzoRegistryLive ? "online" : "offline"
        };
      },
      // Create composition
      async create_composition(args) {
        const name = args.name;
        const components = args.components || [];
        const description = args.description;
        const framework = args.framework || currentFramework;
        if (!name) {
          throw new Error("Composition name is required");
        }
        let code = `/**
 * ${name}
`;
        if (description) {
          code += ` * ${description}
`;
        }
        code += ` * Framework: ${HANZO_FRAMEWORKS[framework].name}
`;
        code += ` * Components: ${components.join(", ")}
`;
        code += ` */

`;
        if (framework.startsWith("hanzo")) {
          for (const comp of components) {
            const pascalCase = comp.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
            code += `import { ${pascalCase} } from "@hanzo/ui/${comp}"
`;
          }
        } else if (framework === "shadcn" || framework === "react") {
          for (const comp of components) {
            const pascalCase = comp.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
            code += `import { ${pascalCase} } from "@/components/ui/${comp}"
`;
          }
        }
        code += `
export function ${name}() {
`;
        code += `  return (
`;
        code += `    <div className="container mx-auto p-6">
`;
        for (const comp of components) {
          const pascalCase = comp.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
          code += `      <${pascalCase} />
`;
        }
        code += `    </div>
`;
        code += `  )
`;
        code += `}
`;
        return {
          framework: HANZO_FRAMEWORKS[framework].name,
          name,
          code,
          components
        };
      }
    };
    unifiedUITool = {
      name: "ui",
      description: "Unified tool for UI component operations - browse, search, install, and manage UI components from Hanzo and other registries",
      inputSchema: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description: "The operation to perform",
            enum: [
              "list_components",
              "get_component",
              "get_demo",
              "get_metadata",
              "list_blocks",
              "get_block",
              "search",
              "get_structure",
              "install",
              "set_framework",
              "get_framework",
              "create_composition"
            ]
          },
          // Common parameters
          framework: {
            type: "string",
            description: "UI framework to use (default: hanzo)",
            enum: Object.keys(HANZO_FRAMEWORKS)
          },
          component: {
            type: "string",
            description: "Component name (alias: name)"
          },
          name: {
            type: "string",
            description: "Component or block name (alias for component/block)"
          },
          block: {
            type: "string",
            description: "Block name"
          },
          category: {
            type: "string",
            description: "Filter by category"
          },
          query: {
            type: "string",
            description: "Search query (alias: search)"
          },
          search: {
            type: "string",
            description: "Search query (alias for query)"
          },
          path: {
            type: "string",
            description: "Directory path for structure"
          },
          depth: {
            type: "number",
            description: "Directory traversal depth (default: 3)"
          },
          overwrite: {
            type: "boolean",
            description: "Overwrite existing files during installation"
          },
          include_files: {
            type: "boolean",
            description: "Include all files when fetching blocks (default: true)"
          },
          components: {
            type: "array",
            description: "List of components for composition",
            items: { type: "string" }
          },
          description: {
            type: "string",
            description: "Description for composition"
          }
        },
        required: ["method"]
      },
      handler: async (args) => {
        const method = args.method;
        if (!method) {
          return {
            content: [{
              type: "text",
              text: "Error: method is required. Available methods: " + Object.keys(methodHandlers).join(", ")
            }],
            isError: true
          };
        }
        const handler = methodHandlers[method];
        if (!handler) {
          return {
            content: [{
              type: "text",
              text: `Error: Unknown method "${method}". Available methods: ${Object.keys(methodHandlers).join(", ")}`
            }],
            isError: true
          };
        }
        try {
          const result = await handler(args);
          let output = "";
          switch (method) {
            case "list_components":
              output = `\u{1F4E6} ${result.framework} Components (${result.total} total)

`;
              for (const comp of result.components) {
                output += `\u2022 ${comp.name}`;
                if (comp.description)
                  output += ` - ${comp.description}`;
                output += "\n";
              }
              break;
            case "get_component":
              output = `\u{1F4E6} ${result.component} (${result.framework})

`;
              output += "```tsx\n" + result.source + "\n```";
              break;
            case "get_demo":
              output = `\u{1F4E6} ${result.component} Demo (${result.framework})

`;
              output += "```tsx\n" + result.demo + "\n```";
              break;
            case "get_metadata":
              output = `\u{1F4E6} ${result.component} Metadata (${result.framework})

`;
              output += JSON.stringify(result.metadata, null, 2);
              break;
            case "list_blocks":
              output = `\u{1F3A8} ${result.framework} Blocks (${result.total} total)

`;
              for (const block of result.blocks) {
                output += `\u2022 ${block.name}`;
                if (block.category)
                  output += ` [${block.category}]`;
                output += "\n";
              }
              break;
            case "search":
              output = `\u{1F50D} Search Results for "${result.query}" (${result.framework})

`;
              if (result.results.length === 0) {
                output += "No components found.";
              } else {
                for (const comp of result.results) {
                  output += `\u2022 ${comp.name}`;
                  if (comp.description)
                    output += ` - ${comp.description}`;
                  output += "\n";
                }
              }
              break;
            case "install":
              output = `\u2705 Installed ${result.component} (${result.framework})

`;
              output += `Command: ${result.command}
`;
              if (result.output)
                output += `
Output:
${result.output}`;
              break;
            case "set_framework":
              output = result.message;
              break;
            case "get_framework":
              output = `Current Framework: ${result.current}
`;
              output += `Hanzo Registry: ${result.hanzoRegistryStatus}

`;
              output += "Available Frameworks:\n";
              for (const fw of result.available) {
                output += `\u2022 ${fw.key}: ${fw.name}`;
                if (fw.hasRegistry)
                  output += " [registry]";
                output += "\n";
              }
              break;
            default:
              output = JSON.stringify(result, null, 2);
          }
          return {
            content: [{
              type: "text",
              text: output
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error in ${method}: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
  }
});

// src/tools/think.ts
var thinkTool, thinkTools;
var init_think = __esm({
  "src/tools/think.ts"() {
    "use strict";
    thinkTool = {
      name: "think",
      description: "LLM reasoning & intelligence: think (structured reasoning), critic (code review), consensus (multi-model), agent (delegate), summarize, classify, embed, explain, translate, compare, chain (multi-step)",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "think",
            "critic",
            "consensus",
            "agent",
            "summarize",
            "classify",
            "embed",
            "explain",
            "translate",
            "compare",
            "chain"
          ], description: "AI action" },
          // think/critic
          thought: { type: "string", description: "What to think about / critique" },
          context: { type: "string", description: "Additional context" },
          code: { type: "string", description: "Code to analyze (critic)" },
          language: { type: "string", description: "Programming or natural language" },
          // consensus
          question: { type: "string", description: "Question for reasoning / consensus" },
          models: { type: "array", items: { type: "string" }, description: "Model IDs for consensus", default: ["claude-sonnet-4-20250514", "gpt-4o"] },
          // agent
          task: { type: "string", description: "Task for agent delegation" },
          model: { type: "string", default: "claude-sonnet-4-20250514" },
          system: { type: "string", description: "System prompt" },
          maxTokens: { type: "number", default: 1e3 },
          temperature: { type: "number" },
          // summarize
          text: { type: "string", description: "Text to summarize/classify/translate/explain" },
          maxLength: { type: "number", description: "Max summary length in words", default: 100 },
          format: { type: "string", description: "Output format: bullets, paragraph, json", default: "bullets" },
          // classify
          categories: { type: "array", items: { type: "string" }, description: "Classification categories" },
          // translate
          targetLanguage: { type: "string", description: "Target language for translation" },
          // compare
          texts: { type: "array", items: { type: "string" }, description: "Texts to compare" },
          // chain
          steps: { type: "array", items: { type: "object", properties: { prompt: { type: "string" }, model: { type: "string" } } }, description: "Chain steps" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        const apiKey = process.env.HANZO_API_KEY || process.env.API_KEY || process.env.OPENAI_API_KEY;
        const baseUrl = (process.env.API_URL || "https://api.hanzo.ai") + "/v1";
        async function llm(prompt, opts = {}) {
          if (!apiKey)
            throw new Error("HANZO_API_KEY required");
          const msgs = [];
          if (opts.system)
            msgs.push({ role: "system", content: opts.system });
          msgs.push({ role: "user", content: prompt });
          const body = { model: opts.model || args.model || "auto", messages: msgs, max_tokens: opts.maxTokens || args.maxTokens || 1e3 };
          if (opts.temperature !== void 0 || args.temperature !== void 0)
            body.temperature = opts.temperature ?? args.temperature;
          const r = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(body) });
          if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          return d.choices?.[0]?.message?.content || "(empty)";
        }
        try {
          switch (args.action) {
            case "think":
              return { content: [{ type: "text", text: `Thinking: ${args.thought || args.question || ""}
${args.context ? `Context: ${args.context}` : ""}

Use this tool to structure reasoning, break down problems, evaluate tradeoffs, and plan before acting. Not an LLM call \u2014 a scratchpad for the agent's own reasoning.` }] };
            case "critic":
              return { content: [{ type: "text", text: `Critical Analysis: ${args.thought || ""}
${args.code ? `
Code:
\`\`\`${args.language || ""}
${args.code}
\`\`\`
` : ""}
Consider: edge cases, security, error handling, performance, readability, patterns, tests, simplicity, OWASP, race conditions, resource leaks.` }] };
            case "consensus": {
              if (!args.question)
                return { content: [{ type: "text", text: "question required" }], isError: true };
              if (!apiKey)
                return { content: [{ type: "text", text: "HANZO_API_KEY required" }], isError: true };
              const models = args.models || ["claude-sonnet-4-20250514", "gpt-4o"];
              const responses = {};
              const errors = {};
              await Promise.allSettled(models.map(async (m) => {
                try {
                  responses[m] = await llm(args.question, { model: m });
                } catch (e) {
                  errors[m] = e.message;
                }
              }));
              const out = [`Consensus: "${args.question}"
`];
              for (const [m, r] of Object.entries(responses))
                out.push(`**${m}:**
${r}
`);
              for (const [m, e] of Object.entries(errors))
                out.push(`${m}: ${e}`);
              if (Object.keys(responses).length > 1) {
                out.push("\n---\nAgreement points and divergences are highlighted above. Cross-reference for confidence.");
              }
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "agent": {
              if (!args.task)
                return { content: [{ type: "text", text: "task required" }], isError: true };
              if (!apiKey)
                return { content: [{ type: "text", text: "HANZO_API_KEY required" }], isError: true };
              const result = await llm(args.task, { system: args.system || `You are a specialized agent. Complete the following task thoroughly and return the result.`, model: args.model, maxTokens: args.maxTokens });
              return { content: [{ type: "text", text: `Agent (${args.model || "auto"}):

${result}` }] };
            }
            case "summarize": {
              if (!args.text)
                return { content: [{ type: "text", text: "text required" }], isError: true };
              const result = await llm(args.text, { system: `Summarize the following in ${args.maxLength || 100} words or fewer. Format: ${args.format || "bullets"}. Be concise and capture key points.` });
              return { content: [{ type: "text", text: result }] };
            }
            case "classify": {
              if (!args.text)
                return { content: [{ type: "text", text: "text required" }], isError: true };
              const cats = args.categories?.length ? `Categories: ${args.categories.join(", ")}` : "Determine the most appropriate categories.";
              const result = await llm(args.text, { system: `Classify the following text. ${cats}
Return: category, confidence (0-1), reasoning.` });
              return { content: [{ type: "text", text: result }] };
            }
            case "embed": {
              if (!args.text)
                return { content: [{ type: "text", text: "text required" }], isError: true };
              if (!apiKey)
                return { content: [{ type: "text", text: "HANZO_API_KEY required" }], isError: true };
              const r = await fetch(`${baseUrl}/embeddings`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify({ model: args.model || "text-embedding-3-small", input: args.text }) });
              if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
              const d = await r.json();
              const emb = d.data?.[0]?.embedding || [];
              return { content: [{ type: "text", text: `Embedding (${emb.length} dims): [${emb.slice(0, 8).map((x) => x.toFixed(4)).join(", ")}...]` }] };
            }
            case "explain": {
              const input = args.text || args.code || args.thought;
              if (!input)
                return { content: [{ type: "text", text: "text, code, or thought required" }], isError: true };
              const lang = args.language ? ` (${args.language})` : "";
              const result = await llm(input, { system: `Explain the following${lang} clearly and concisely. Target audience: experienced developer. Cover what it does, how it works, and why.` });
              return { content: [{ type: "text", text: result }] };
            }
            case "translate": {
              if (!args.text)
                return { content: [{ type: "text", text: "text required" }], isError: true };
              if (!args.targetLanguage)
                return { content: [{ type: "text", text: "targetLanguage required" }], isError: true };
              const result = await llm(args.text, { system: `Translate to ${args.targetLanguage}. Preserve tone, technical terms, and formatting.` });
              return { content: [{ type: "text", text: result }] };
            }
            case "compare": {
              const items = args.texts || [];
              if (items.length < 2)
                return { content: [{ type: "text", text: "texts array with 2+ items required" }], isError: true };
              const prompt = items.map((t, i) => `--- Item ${i + 1} ---
${t}`).join("\n\n");
              const result = await llm(prompt, { system: "Compare the following items. Identify: similarities, differences, strengths, weaknesses, and recommendation." });
              return { content: [{ type: "text", text: result }] };
            }
            case "chain": {
              if (!args.steps?.length)
                return { content: [{ type: "text", text: "steps array required" }], isError: true };
              if (!apiKey)
                return { content: [{ type: "text", text: "HANZO_API_KEY required" }], isError: true };
              const results = [];
              let context = "";
              for (const [i, step] of args.steps.entries()) {
                const prompt = context ? `Previous context:
${context}

---

${step.prompt}` : step.prompt;
                const result = await llm(prompt, { model: step.model, system: args.system });
                results.push(`Step ${i + 1}: ${result}`);
                context = result;
              }
              return { content: [{ type: "text", text: results.join("\n\n---\n\n") }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
      }
    };
    thinkTools = [thinkTool];
  }
});

// src/tools/memory.ts
import * as fs5 from "fs/promises";
import * as path5 from "path";
import * as os from "os";
async function load() {
  try {
    return JSON.parse(await fs5.readFile(storePath(), "utf-8"));
  } catch {
    return { entries: [], lastId: 0 };
  }
}
async function save(s) {
  await fs5.mkdir(path5.dirname(storePath()), { recursive: true });
  await fs5.writeFile(storePath(), JSON.stringify(s, null, 2));
}
function isExpired(e) {
  if (!e.ttl)
    return false;
  return new Date(e.ttl) < /* @__PURE__ */ new Date();
}
var storePath, memoryTool, memoryTools;
var init_memory = __esm({
  "src/tools/memory.ts"() {
    "use strict";
    storePath = () => process.env.MEMORY_PATH || path5.join(os.homedir(), ".hanzo", "memory.json");
    memoryTool = {
      name: "memory",
      description: "Persistent key-value memory with search, tags, namespaces, TTL: store, recall, list, delete, search, stats, clear, export, import, merge, tag, untag, namespaces, history",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "store",
            "recall",
            "list",
            "delete",
            "search",
            "stats",
            "clear",
            "export",
            "import",
            "merge",
            "tag",
            "untag",
            "namespaces",
            "history"
          ], description: "Memory action" },
          key: { type: "string", description: "Memory key" },
          value: { type: "string", description: "Content to store" },
          query: { type: "string", description: "Search query (full-text across keys, values, tags)" },
          tag: { type: "string", description: "Filter/assign tag" },
          tags: { type: "array", items: { type: "string" } },
          namespace: { type: "string", default: "default" },
          metadata: { type: "object" },
          ttl: { type: "string", description: "Expiry ISO date (auto-delete after)" },
          limit: { type: "number", default: 50 },
          file: { type: "string", description: "File path for export/import" },
          data: { type: "object", description: "Key-value map for bulk import" },
          append: { type: "boolean", description: "Append to existing value", default: false },
          sort: { type: "string", enum: ["key", "created", "updated", "namespace"], default: "updated" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const ns = args.namespace || "default";
          const store = await load();
          store.entries = store.entries.filter((e) => !isExpired(e));
          switch (args.action) {
            case "store": {
              if (!args.key || !args.value)
                return { content: [{ type: "text", text: "key and value required" }], isError: true };
              const now = (/* @__PURE__ */ new Date()).toISOString();
              const idx = store.entries.findIndex((e) => e.key === args.key && e.namespace === ns);
              if (idx >= 0) {
                const e = store.entries[idx];
                e.value = args.append ? e.value + "\n" + args.value : args.value;
                e.updated = now;
                if (args.tags)
                  e.tags = args.tags;
                if (args.metadata)
                  e.metadata = { ...e.metadata, ...args.metadata };
                if (args.ttl)
                  e.ttl = args.ttl;
                await save(store);
                return { content: [{ type: "text", text: `Updated: ${args.key} (${e.value.length} chars)` }] };
              }
              store.lastId++;
              store.entries.push({ id: String(store.lastId), key: args.key, value: args.value, tags: args.tags || [], namespace: ns, created: now, updated: now, metadata: args.metadata, ttl: args.ttl });
              await save(store);
              return { content: [{ type: "text", text: `Stored: ${args.key} (${args.value.length} chars)` }] };
            }
            case "recall": {
              let r = store.entries.filter((e) => e.namespace === ns || !args.namespace);
              if (args.key)
                r = r.filter((e) => e.key === args.key);
              if (args.tag)
                r = r.filter((e) => e.tags.includes(args.tag));
              r = r.slice(0, args.limit || 10);
              if (!r.length)
                return { content: [{ type: "text", text: "No memories found" }] };
              const out = r.map((e) => `[${e.namespace}] ${e.key}${e.tags.length ? ` [${e.tags.join(", ")}]` : ""} (${e.updated.split("T")[0]}):
  ${e.value.substring(0, 300)}${e.value.length > 300 ? "..." : ""}`);
              return { content: [{ type: "text", text: out.join("\n\n") }] };
            }
            case "list": {
              let entries = store.entries;
              if (args.namespace)
                entries = entries.filter((e) => e.namespace === ns);
              if (args.tag)
                entries = entries.filter((e) => e.tags.includes(args.tag));
              const sortKey = args.sort || "updated";
              entries.sort((a, b) => {
                if (sortKey === "key")
                  return a.key.localeCompare(b.key);
                if (sortKey === "namespace")
                  return a.namespace.localeCompare(b.namespace);
                return (b[sortKey] || "").localeCompare(a[sortKey] || "");
              });
              const limited = entries.slice(0, args.limit || 50);
              const namespaces = [...new Set(store.entries.map((e) => e.namespace))];
              const out = [`${store.entries.length} entries, namespaces: [${namespaces.join(", ")}]`, ""];
              for (const e of limited)
                out.push(`  ${e.key}${e.tags.length ? ` [${e.tags.join(",")}]` : ""} (${e.namespace}) ${e.value.length}ch`);
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "delete": {
              if (!args.key && !args.tag)
                return { content: [{ type: "text", text: "key or tag required" }], isError: true };
              let count = 0;
              if (args.key) {
                const i = store.entries.findIndex((e) => e.key === args.key && e.namespace === ns);
                if (i < 0)
                  return { content: [{ type: "text", text: `Not found: ${args.key}` }], isError: true };
                store.entries.splice(i, 1);
                count = 1;
              } else if (args.tag) {
                const before = store.entries.length;
                store.entries = store.entries.filter((e) => !e.tags.includes(args.tag));
                count = before - store.entries.length;
              }
              await save(store);
              return { content: [{ type: "text", text: `Deleted ${count} entries` }] };
            }
            case "search": {
              if (!args.query)
                return { content: [{ type: "text", text: "query required" }], isError: true };
              const q = args.query.toLowerCase();
              const terms = q.split(/\s+/);
              let results = store.entries.filter((e) => {
                const text = `${e.key} ${e.value} ${e.tags.join(" ")} ${e.namespace}`.toLowerCase();
                return terms.every((t) => text.includes(t));
              });
              if (args.namespace)
                results = results.filter((e) => e.namespace === ns);
              if (args.tag)
                results = results.filter((e) => e.tags.includes(args.tag));
              results = results.slice(0, args.limit || 20);
              if (!results.length)
                return { content: [{ type: "text", text: `No results for: ${args.query}` }] };
              const out = results.map((e) => `[${e.namespace}] ${e.key}${e.tags.length ? ` [${e.tags.join(",")}]` : ""}:
  ${e.value.substring(0, 200)}${e.value.length > 200 ? "..." : ""}`);
              return { content: [{ type: "text", text: `Found ${results.length}:

${out.join("\n\n")}` }] };
            }
            case "stats": {
              const namespaces = [...new Set(store.entries.map((e) => e.namespace))];
              const tags = [...new Set(store.entries.flatMap((e) => e.tags))];
              const totalSize = store.entries.reduce((s, e) => s + e.value.length, 0);
              const byNs = {};
              for (const e of store.entries)
                byNs[e.namespace] = (byNs[e.namespace] || 0) + 1;
              return { content: [{ type: "text", text: `Memory Stats:
  Entries: ${store.entries.length}
  Size: ${(totalSize / 1024).toFixed(1)}KB
  Namespaces: ${namespaces.join(", ")}
  Tags: ${tags.join(", ")}
  By namespace: ${Object.entries(byNs).map(([k, v]) => `${k}:${v}`).join(" ")}` }] };
            }
            case "clear": {
              const before = store.entries.length;
              if (args.namespace) {
                store.entries = store.entries.filter((e) => e.namespace !== ns);
              } else {
                store.entries = [];
              }
              await save(store);
              return { content: [{ type: "text", text: `Cleared ${before - store.entries.length} entries${args.namespace ? ` from namespace: ${ns}` : ""}` }] };
            }
            case "export": {
              const filePath = args.file || path5.join(os.homedir(), ".hanzo", "memory-export.json");
              let entries = store.entries;
              if (args.namespace)
                entries = entries.filter((e) => e.namespace === ns);
              if (args.tag)
                entries = entries.filter((e) => e.tags.includes(args.tag));
              await fs5.mkdir(path5.dirname(filePath), { recursive: true });
              await fs5.writeFile(filePath, JSON.stringify(entries, null, 2));
              return { content: [{ type: "text", text: `Exported ${entries.length} entries to ${filePath}` }] };
            }
            case "import": {
              if (args.data) {
                const now = (/* @__PURE__ */ new Date()).toISOString();
                for (const [k, v] of Object.entries(args.data)) {
                  store.lastId++;
                  store.entries.push({ id: String(store.lastId), key: k, value: String(v), tags: args.tags || [], namespace: ns, created: now, updated: now });
                }
                await save(store);
                return { content: [{ type: "text", text: `Imported ${Object.keys(args.data).length} entries` }] };
              }
              if (!args.file)
                return { content: [{ type: "text", text: "file or data required" }], isError: true };
              const imported = JSON.parse(await fs5.readFile(args.file, "utf-8"));
              for (const e of imported) {
                store.lastId++;
                e.id = String(store.lastId);
                store.entries.push(e);
              }
              await save(store);
              return { content: [{ type: "text", text: `Imported ${imported.length} entries from ${args.file}` }] };
            }
            case "merge": {
              if (!args.key)
                return { content: [{ type: "text", text: "key required" }], isError: true };
              const entries = store.entries.filter((e) => e.key === args.key);
              if (entries.length < 2)
                return { content: [{ type: "text", text: `Only ${entries.length} entries with key '${args.key}', nothing to merge` }] };
              const merged = entries.map((e) => e.value).join("\n---\n");
              const allTags = [...new Set(entries.flatMap((e) => e.tags))];
              const keep = entries[0];
              keep.value = merged;
              keep.tags = allTags;
              keep.updated = (/* @__PURE__ */ new Date()).toISOString();
              store.entries = store.entries.filter((e) => e.key !== args.key || e.id === keep.id);
              await save(store);
              return { content: [{ type: "text", text: `Merged ${entries.length} entries into key '${args.key}'` }] };
            }
            case "tag": {
              if (!args.key || !args.tag)
                return { content: [{ type: "text", text: "key and tag required" }], isError: true };
              const entry = store.entries.find((e) => e.key === args.key && e.namespace === ns);
              if (!entry)
                return { content: [{ type: "text", text: `Not found: ${args.key}` }], isError: true };
              if (!entry.tags.includes(args.tag))
                entry.tags.push(args.tag);
              entry.updated = (/* @__PURE__ */ new Date()).toISOString();
              await save(store);
              return { content: [{ type: "text", text: `Tagged ${args.key} with '${args.tag}'` }] };
            }
            case "untag": {
              if (!args.key || !args.tag)
                return { content: [{ type: "text", text: "key and tag required" }], isError: true };
              const entry = store.entries.find((e) => e.key === args.key && e.namespace === ns);
              if (!entry)
                return { content: [{ type: "text", text: `Not found: ${args.key}` }], isError: true };
              entry.tags = entry.tags.filter((t) => t !== args.tag);
              entry.updated = (/* @__PURE__ */ new Date()).toISOString();
              await save(store);
              return { content: [{ type: "text", text: `Removed tag '${args.tag}' from ${args.key}` }] };
            }
            case "namespaces": {
              const nss = [...new Set(store.entries.map((e) => e.namespace))];
              const counts = {};
              for (const e of store.entries)
                counts[e.namespace] = (counts[e.namespace] || 0) + 1;
              return { content: [{ type: "text", text: `Namespaces (${nss.length}):
${nss.map((n) => `  ${n}: ${counts[n]} entries`).join("\n")}` }] };
            }
            case "history": {
              if (!args.key)
                return { content: [{ type: "text", text: "key required" }], isError: true };
              const entries = store.entries.filter((e) => e.key === args.key);
              if (!entries.length)
                return { content: [{ type: "text", text: `No history for: ${args.key}` }] };
              return { content: [{ type: "text", text: entries.map((e) => `[${e.namespace}] ${e.updated}: ${e.value.substring(0, 100)}${e.value.length > 100 ? "..." : ""}`).join("\n") }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    memoryTools = [memoryTool];
  }
});

// src/tools/plan.ts
import * as fs6 from "fs/promises";
import * as path6 from "path";
import * as os2 from "os";
async function loadPlans() {
  try {
    return JSON.parse(await fs6.readFile(planPath(), "utf-8"));
  } catch {
    return { plans: [], lastId: 0 };
  }
}
async function savePlans(s) {
  await fs6.mkdir(path6.dirname(planPath()), { recursive: true });
  await fs6.writeFile(planPath(), JSON.stringify(s, null, 2));
}
var planPath, planTool, planTools;
var init_plan = __esm({
  "src/tools/plan.ts"() {
    "use strict";
    planPath = () => process.env.PLAN_PATH || path6.join(os2.homedir(), ".hanzo", "plans.json");
    planTool = {
      name: "plan",
      description: "Execution plans with DAG dependencies: create, show, update, list, next, archive, add_step, remove_step, estimate, visualize, clone, cancel, notes, progress",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "create",
            "show",
            "update",
            "list",
            "next",
            "archive",
            "add_step",
            "remove_step",
            "estimate",
            "visualize",
            "clone",
            "cancel",
            "notes",
            "progress"
          ], description: "Plan action" },
          name: { type: "string" },
          goal: { type: "string" },
          steps: { type: "array", items: { type: "object", properties: { description: { type: "string" }, dependencies: { type: "array", items: { type: "string" } }, tools: { type: "array", items: { type: "string" } }, estimate: { type: "string" }, assignee: { type: "string" } }, required: ["description"] } },
          id: { type: "string", description: 'Plan ID (or "latest")' },
          stepId: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked", "skipped"] },
          output: { type: "string", description: "Step result" },
          filter: { type: "string", enum: ["all", "active", "completed", "draft", "cancelled", "archived"], default: "all" },
          limit: { type: "number", default: 20 },
          description: { type: "string", description: "Step description (add_step)" },
          dependencies: { type: "array", items: { type: "string" }, description: "Step dependencies (add_step)" },
          after: { type: "string", description: "Insert after step ID (add_step)" },
          text: { type: "string", description: "Notes text" },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          let findPlan2 = function(id) {
            if (id === "latest")
              return store.plans.filter((p) => p.status === "active").pop() || store.plans[store.plans.length - 1];
            return store.plans.find((p) => p.id === id);
          };
          var findPlan = findPlan2;
          const store = await loadPlans();
          const icons = { pending: "[ ]", in_progress: "[~]", completed: "[x]", blocked: "[!]", skipped: "[-]" };
          switch (args.action) {
            case "create": {
              if (!args.name || !args.goal || !args.steps?.length)
                return { content: [{ type: "text", text: "name, goal, steps required" }], isError: true };
              store.lastId++;
              const pid = String(store.lastId);
              const now = (/* @__PURE__ */ new Date()).toISOString();
              const steps = args.steps.map((s, i) => ({
                id: `${pid}.${i + 1}`,
                description: s.description,
                status: "pending",
                dependencies: s.dependencies || [],
                tools: s.tools,
                estimate: s.estimate,
                assignee: s.assignee
              }));
              store.plans.push({ id: pid, name: args.name, goal: args.goal, steps, created: now, updated: now, status: "active", tags: args.tags });
              await savePlans(store);
              const out = [`Plan #${pid}: ${args.name}`, `Goal: ${args.goal}`, `Steps: ${steps.length}`, ""];
              for (const s of steps) {
                const deps = s.dependencies.length ? ` (after: ${s.dependencies.join(", ")})` : "";
                const est = s.estimate ? ` [${s.estimate}]` : "";
                out.push(`  ${s.id}. ${s.description}${deps}${est}`);
              }
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "show": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const done = plan.steps.filter((s) => s.status === "completed").length;
              const out = [`Plan #${plan.id}: ${plan.name} [${plan.status}]`, `Goal: ${plan.goal}`, `Progress: ${done}/${plan.steps.length} (${Math.round(done / plan.steps.length * 100)}%)`, ""];
              if (plan.tags?.length)
                out.push(`Tags: ${plan.tags.join(", ")}`);
              if (plan.notes)
                out.push(`Notes: ${plan.notes.substring(0, 200)}`);
              out.push("");
              for (const s of plan.steps) {
                const deps = s.dependencies.length ? ` \u2190 ${s.dependencies.join(",")}` : "";
                const est = s.estimate ? ` [${s.estimate}]` : "";
                const assignee = s.assignee ? ` @${s.assignee}` : "";
                out.push(`  ${icons[s.status] || "[ ]"} ${s.id}. ${s.description}${deps}${est}${assignee}`);
                if (s.output)
                  out.push(`       \u2192 ${s.output.substring(0, 120)}`);
              }
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "update": {
              if (!args.id || !args.stepId || !args.status)
                return { content: [{ type: "text", text: "id, stepId, status required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const step = plan.steps.find((s) => s.id === args.stepId);
              if (!step)
                return { content: [{ type: "text", text: `Step '${args.stepId}' not found` }], isError: true };
              step.status = args.status;
              if (args.output)
                step.output = args.output;
              plan.updated = (/* @__PURE__ */ new Date()).toISOString();
              if (plan.steps.every((s) => s.status === "completed" || s.status === "skipped"))
                plan.status = "completed";
              await savePlans(store);
              const done = plan.steps.filter((s) => s.status === "completed").length;
              const next = plan.steps.find((s) => s.status === "pending" && s.dependencies.every((d) => plan.steps.find((x) => x.id === d)?.status === "completed"));
              let text = `Updated ${args.stepId}: ${args.status} (${done}/${plan.steps.length})`;
              if (next)
                text += `
Next: ${next.id}. ${next.description}`;
              if (plan.status === "completed")
                text += "\nPlan completed!";
              return { content: [{ type: "text", text }] };
            }
            case "list": {
              let plans = store.plans;
              if (args.filter && args.filter !== "all")
                plans = plans.filter((p) => p.status === args.filter);
              plans = plans.slice(-(args.limit || 20));
              if (!plans.length)
                return { content: [{ type: "text", text: "No plans" }] };
              const out = plans.map((p) => {
                const done = p.steps.filter((s) => s.status === "completed").length;
                return `#${p.id} [${p.status}] ${p.name} \u2014 ${done}/${p.steps.length} ${p.tags?.length ? `[${p.tags.join(",")}]` : ""}`;
              });
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "next": {
              const plan = findPlan2(args.id || "latest");
              if (!plan)
                return { content: [{ type: "text", text: "No active plan" }], isError: true };
              const doneIds = new Set(plan.steps.filter((s) => s.status === "completed").map((s) => s.id));
              const actionable = plan.steps.filter((s) => s.status === "pending" && s.dependencies.every((d) => doneIds.has(d)));
              if (!actionable.length) {
                const blocked = plan.steps.filter((s) => s.status === "blocked");
                const inProgress = plan.steps.filter((s) => s.status === "in_progress");
                return { content: [{ type: "text", text: `No actionable steps. In progress: ${inProgress.length}, Blocked: ${blocked.length}` }] };
              }
              const out = actionable.map((s) => {
                const est = s.estimate ? ` [${s.estimate}]` : "";
                const tools = s.tools?.length ? ` (tools: ${s.tools.join(", ")})` : "";
                return `${s.id}. ${s.description}${est}${tools}`;
              });
              return { content: [{ type: "text", text: `Next steps:
${out.join("\n")}` }] };
            }
            case "archive": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              plan.status = "archived";
              plan.updated = (/* @__PURE__ */ new Date()).toISOString();
              await savePlans(store);
              return { content: [{ type: "text", text: `Archived plan #${plan.id}: ${plan.name}` }] };
            }
            case "add_step": {
              if (!args.id || !args.description)
                return { content: [{ type: "text", text: "id and description required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const maxStep = Math.max(...plan.steps.map((s) => parseInt(s.id.split(".")[1]) || 0));
              const newStep = {
                id: `${plan.id}.${maxStep + 1}`,
                description: args.description,
                status: "pending",
                dependencies: args.dependencies || [],
                estimate: args.text
              };
              if (args.after) {
                const idx = plan.steps.findIndex((s) => s.id === args.after);
                if (idx >= 0)
                  plan.steps.splice(idx + 1, 0, newStep);
                else
                  plan.steps.push(newStep);
              } else {
                plan.steps.push(newStep);
              }
              plan.updated = (/* @__PURE__ */ new Date()).toISOString();
              await savePlans(store);
              return { content: [{ type: "text", text: `Added step ${newStep.id}: ${args.description}` }] };
            }
            case "remove_step": {
              if (!args.id || !args.stepId)
                return { content: [{ type: "text", text: "id and stepId required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const idx = plan.steps.findIndex((s) => s.id === args.stepId);
              if (idx < 0)
                return { content: [{ type: "text", text: `Step '${args.stepId}' not found` }], isError: true };
              for (const s of plan.steps)
                s.dependencies = s.dependencies.filter((d) => d !== args.stepId);
              plan.steps.splice(idx, 1);
              plan.updated = (/* @__PURE__ */ new Date()).toISOString();
              await savePlans(store);
              return { content: [{ type: "text", text: `Removed step ${args.stepId}` }] };
            }
            case "estimate": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const estimated = plan.steps.filter((s) => s.estimate);
              const pending = plan.steps.filter((s) => s.status === "pending" || s.status === "in_progress");
              return { content: [{ type: "text", text: `Plan #${plan.id}: ${plan.name}
  Total steps: ${plan.steps.length}
  Estimated: ${estimated.length}/${plan.steps.length}
  Remaining: ${pending.length}
  Estimates: ${estimated.map((s) => `${s.id}: ${s.estimate}`).join(", ")}` }] };
            }
            case "visualize": {
              let getLevel2 = function(stepId) {
                if (levels.has(stepId))
                  return levels.get(stepId);
                const step = plan.steps.find((s) => s.id === stepId);
                if (!step || !step.dependencies.length) {
                  levels.set(stepId, 0);
                  return 0;
                }
                const maxDep = Math.max(...step.dependencies.map((d) => getLevel2(d)));
                levels.set(stepId, maxDep + 1);
                return maxDep + 1;
              };
              var getLevel = getLevel2;
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const maybePlan = findPlan2(args.id);
              if (!maybePlan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const plan = maybePlan;
              const lines = [`Plan #${plan.id}: ${plan.name}
`];
              const levels = /* @__PURE__ */ new Map();
              for (const s of plan.steps)
                getLevel2(s.id);
              const maxLevel = Math.max(...[...levels.values()], 0);
              for (let l = 0; l <= maxLevel; l++) {
                const atLevel = plan.steps.filter((s) => levels.get(s.id) === l);
                if (atLevel.length) {
                  lines.push(`Level ${l}:`);
                  for (const s of atLevel) {
                    const arrow = s.dependencies.length ? ` \u2190 [${s.dependencies.join(",")}]` : "";
                    lines.push(`  ${icons[s.status]} ${s.id}. ${s.description}${arrow}`);
                  }
                }
              }
              return { content: [{ type: "text", text: lines.join("\n") }] };
            }
            case "clone": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              store.lastId++;
              const newId = String(store.lastId);
              const now = (/* @__PURE__ */ new Date()).toISOString();
              const newSteps = plan.steps.map((s, i) => ({
                ...s,
                id: `${newId}.${i + 1}`,
                status: "pending",
                output: void 0
              }));
              store.plans.push({
                id: newId,
                name: args.name || `${plan.name} (copy)`,
                goal: plan.goal,
                steps: newSteps,
                created: now,
                updated: now,
                status: "draft",
                tags: plan.tags
              });
              await savePlans(store);
              return { content: [{ type: "text", text: `Cloned plan #${plan.id} \u2192 #${newId}` }] };
            }
            case "cancel": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              plan.status = "cancelled";
              plan.updated = (/* @__PURE__ */ new Date()).toISOString();
              await savePlans(store);
              return { content: [{ type: "text", text: `Cancelled plan #${plan.id}: ${plan.name}` }] };
            }
            case "notes": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              if (args.text) {
                plan.notes = (plan.notes || "") + "\n" + args.text;
                plan.updated = (/* @__PURE__ */ new Date()).toISOString();
                await savePlans(store);
                return { content: [{ type: "text", text: `Added note to plan #${plan.id}` }] };
              }
              return { content: [{ type: "text", text: plan.notes || "(no notes)" }] };
            }
            case "progress": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const plan = findPlan2(args.id);
              if (!plan)
                return { content: [{ type: "text", text: `Plan '${args.id}' not found` }], isError: true };
              const byStatus = {};
              for (const s of plan.steps)
                byStatus[s.status] = (byStatus[s.status] || 0) + 1;
              const done = byStatus.completed || 0;
              const total = plan.steps.length;
              const bar = "\u2588".repeat(Math.round(done / total * 20)) + "\u2591".repeat(20 - Math.round(done / total * 20));
              return { content: [{ type: "text", text: `Plan #${plan.id}: ${plan.name}
${bar} ${Math.round(done / total * 100)}%
${Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(" | ")}` }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    planTools = [planTool];
  }
});

// src/tools/tasks.ts
import * as fs7 from "fs/promises";
import * as path7 from "path";
import * as os3 from "os";
async function load2() {
  try {
    const data = JSON.parse(await fs7.readFile(todoPath(), "utf-8"));
    return { items: Array.isArray(data.items) ? data.items : [], lastId: typeof data.lastId === "number" ? data.lastId : 0 };
  } catch {
    return { items: [], lastId: 0 };
  }
}
async function save2(t) {
  await fs7.mkdir(path7.dirname(todoPath()), { recursive: true });
  await fs7.writeFile(todoPath(), JSON.stringify(t, null, 2));
}
var todoPath, tasksTool, tasksTools;
var init_tasks = __esm({
  "src/tools/tasks.ts"() {
    "use strict";
    todoPath = () => process.env.TODO_PATH || path7.join(os3.homedir(), ".hanzo", "todos.json");
    tasksTool = {
      name: "tasks",
      description: "Task tracking: add, list, update, delete, stats, search, batch, archive, move, prioritize, assign, subtasks, notes, export, import",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "add",
            "list",
            "update",
            "delete",
            "stats",
            "search",
            "batch",
            "archive",
            "move",
            "prioritize",
            "assign",
            "subtasks",
            "notes",
            "export",
            "import"
          ] },
          content: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
          due: { type: "string", description: "Due date (ISO or YYYY-MM-DD)" },
          tags: { type: "array", items: { type: "string" } },
          project: { type: "string" },
          assignee: { type: "string" },
          parent: { type: "string", description: "Parent task ID (subtasks)" },
          id: { type: "string" },
          ids: { type: "array", items: { type: "string" }, description: "Multiple IDs (batch)" },
          query: { type: "string", description: "Search query" },
          tag: { type: "string" },
          limit: { type: "number", default: 50 },
          text: { type: "string", description: "Note text" },
          file: { type: "string", description: "File path for export/import" },
          sort: { type: "string", enum: ["priority", "due", "created", "status"], default: "priority" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const todos = await load2();
          switch (args.action) {
            case "add": {
              if (!args.content)
                return { content: [{ type: "text", text: "content required" }], isError: true };
              todos.lastId++;
              const now = (/* @__PURE__ */ new Date()).toISOString();
              todos.items.push({
                id: String(todos.lastId),
                content: args.content,
                status: "pending",
                priority: args.priority || "medium",
                created: now,
                updated: now,
                due: args.due,
                tags: args.tags,
                project: args.project,
                assignee: args.assignee,
                parent: args.parent
              });
              await save2(todos);
              return { content: [{ type: "text", text: `Added #${todos.lastId}: ${args.content}` }] };
            }
            case "list": {
              let items = todos.items;
              if (args.status)
                items = items.filter((t) => t.status === args.status);
              if (args.priority)
                items = items.filter((t) => t.priority === args.priority);
              if (args.project)
                items = items.filter((t) => t.project === args.project);
              if (args.tag)
                items = items.filter((t) => t.tags?.includes(args.tag));
              if (args.assignee)
                items = items.filter((t) => t.assignee === args.assignee);
              if (args.parent !== void 0)
                items = items.filter((t) => t.parent === args.parent);
              const po = { high: 0, medium: 1, low: 2 };
              const so = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 };
              const sortKey = args.sort || "priority";
              items.sort((a, b) => {
                if (sortKey === "due")
                  return (a.due || "z").localeCompare(b.due || "z");
                if (sortKey === "created")
                  return b.created.localeCompare(a.created);
                if (sortKey === "status")
                  return so[a.status] - so[b.status];
                return so[a.status] - so[b.status] || po[a.priority] - po[b.priority];
              });
              items = items.slice(0, args.limit || 50);
              if (!items.length)
                return { content: [{ type: "text", text: "No todos" }] };
              const out = items.map((t) => {
                let line = `#${t.id} [${t.priority}] [${t.status}] ${t.content}`;
                if (t.tags?.length)
                  line += ` [${t.tags.join(",")}]`;
                if (t.project)
                  line += ` (${t.project})`;
                if (t.assignee)
                  line += ` @${t.assignee}`;
                if (t.due)
                  line += ` due:${t.due.split("T")[0]}`;
                if (t.parent)
                  line += ` \u2191${t.parent}`;
                return line;
              });
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "update": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const t = todos.items.find((i) => i.id === args.id);
              if (!t)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              if (args.content !== void 0)
                t.content = args.content;
              if (args.status !== void 0)
                t.status = args.status;
              if (args.priority !== void 0)
                t.priority = args.priority;
              if (args.due !== void 0)
                t.due = args.due;
              if (args.tags !== void 0)
                t.tags = args.tags;
              if (args.project !== void 0)
                t.project = args.project;
              if (args.assignee !== void 0)
                t.assignee = args.assignee;
              t.updated = (/* @__PURE__ */ new Date()).toISOString();
              await save2(todos);
              return { content: [{ type: "text", text: `Updated #${args.id}` }] };
            }
            case "delete": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const i = todos.items.findIndex((t) => t.id === args.id);
              if (i < 0)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              const subtasks = todos.items.filter((t) => t.parent === args.id);
              todos.items = todos.items.filter((t) => t.id !== args.id && t.parent !== args.id);
              await save2(todos);
              return { content: [{ type: "text", text: `Deleted #${args.id}${subtasks.length ? ` and ${subtasks.length} subtasks` : ""}` }] };
            }
            case "stats": {
              let items = todos.items;
              if (args.project)
                items = items.filter((t) => t.project === args.project);
              const byS = {}, byP = {};
              let overdue = 0;
              const projects = [...new Set(todos.items.map((t) => t.project).filter(Boolean))];
              const assignees = [...new Set(todos.items.map((t) => t.assignee).filter(Boolean))];
              for (const t of items) {
                byS[t.status] = (byS[t.status] || 0) + 1;
                byP[t.priority] = (byP[t.priority] || 0) + 1;
                if (t.due && t.status !== "completed" && t.status !== "cancelled" && new Date(t.due) < /* @__PURE__ */ new Date())
                  overdue++;
              }
              return { content: [{ type: "text", text: `${items.length} items${overdue ? `, ${overdue} overdue` : ""}
Status: ${Object.entries(byS).map(([k, v]) => `${k}:${v}`).join(" ")}
Priority: ${Object.entries(byP).map(([k, v]) => `${k}:${v}`).join(" ")}
Projects: ${projects.join(", ") || "(none)"}
Assignees: ${assignees.join(", ") || "(none)"}` }] };
            }
            case "search": {
              if (!args.query)
                return { content: [{ type: "text", text: "query required" }], isError: true };
              const q = args.query.toLowerCase();
              let results = todos.items.filter((t) => {
                const text = `${t.content} ${t.tags?.join(" ") || ""} ${t.project || ""} ${t.assignee || ""}`.toLowerCase();
                return text.includes(q);
              });
              results = results.slice(0, args.limit || 20);
              if (!results.length)
                return { content: [{ type: "text", text: `No results for: ${args.query}` }] };
              const out = results.map((t) => `#${t.id} [${t.priority}] [${t.status}] ${t.content}`);
              return { content: [{ type: "text", text: `Found ${results.length}:
${out.join("\n")}` }] };
            }
            case "batch": {
              if (!args.ids?.length || !args.status)
                return { content: [{ type: "text", text: "ids and status required" }], isError: true };
              let count = 0;
              for (const id of args.ids) {
                const t = todos.items.find((i) => i.id === id);
                if (t) {
                  t.status = args.status;
                  t.updated = (/* @__PURE__ */ new Date()).toISOString();
                  count++;
                }
              }
              await save2(todos);
              return { content: [{ type: "text", text: `Updated ${count}/${args.ids.length} items to ${args.status}` }] };
            }
            case "archive": {
              const completed = todos.items.filter((t) => t.status === "completed" || t.status === "cancelled");
              if (!completed.length)
                return { content: [{ type: "text", text: "Nothing to archive" }] };
              const archivePath = path7.join(path7.dirname(todoPath()), "todos-archive.json");
              let archive = { items: [], lastId: 0 };
              try {
                archive = JSON.parse(await fs7.readFile(archivePath, "utf-8"));
              } catch {
              }
              archive.items.push(...completed);
              await fs7.writeFile(archivePath, JSON.stringify(archive, null, 2));
              todos.items = todos.items.filter((t) => t.status !== "completed" && t.status !== "cancelled");
              await save2(todos);
              return { content: [{ type: "text", text: `Archived ${completed.length} items` }] };
            }
            case "move": {
              if (!args.id || !args.project)
                return { content: [{ type: "text", text: "id and project required" }], isError: true };
              const t = todos.items.find((i) => i.id === args.id);
              if (!t)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              t.project = args.project;
              t.updated = (/* @__PURE__ */ new Date()).toISOString();
              await save2(todos);
              return { content: [{ type: "text", text: `Moved #${args.id} to project: ${args.project}` }] };
            }
            case "prioritize": {
              if (!args.id || !args.priority)
                return { content: [{ type: "text", text: "id and priority required" }], isError: true };
              const t = todos.items.find((i) => i.id === args.id);
              if (!t)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              t.priority = args.priority;
              t.updated = (/* @__PURE__ */ new Date()).toISOString();
              await save2(todos);
              return { content: [{ type: "text", text: `#${args.id} priority \u2192 ${args.priority}` }] };
            }
            case "assign": {
              if (!args.id || !args.assignee)
                return { content: [{ type: "text", text: "id and assignee required" }], isError: true };
              const t = todos.items.find((i) => i.id === args.id);
              if (!t)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              t.assignee = args.assignee;
              t.updated = (/* @__PURE__ */ new Date()).toISOString();
              await save2(todos);
              return { content: [{ type: "text", text: `#${args.id} assigned to @${args.assignee}` }] };
            }
            case "subtasks": {
              if (!args.id)
                return { content: [{ type: "text", text: "parent id required" }], isError: true };
              const parent = todos.items.find((i) => i.id === args.id);
              if (!parent)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              const children = todos.items.filter((t) => t.parent === args.id);
              const out = [`#${args.id}: ${parent.content}`, `Subtasks (${children.length}):`];
              for (const c of children)
                out.push(`  #${c.id} [${c.priority}] [${c.status}] ${c.content}`);
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "notes": {
              if (!args.id)
                return { content: [{ type: "text", text: "id required" }], isError: true };
              const t = todos.items.find((i) => i.id === args.id);
              if (!t)
                return { content: [{ type: "text", text: `#${args.id} not found` }], isError: true };
              if (args.text) {
                t.notes = (t.notes || "") + "\n" + args.text;
                t.updated = (/* @__PURE__ */ new Date()).toISOString();
                await save2(todos);
                return { content: [{ type: "text", text: `Added note to #${args.id}` }] };
              }
              return { content: [{ type: "text", text: `#${args.id} notes:
${t.notes || "(none)"}` }] };
            }
            case "export": {
              const filePath = args.file || path7.join(os3.homedir(), ".hanzo", "todos-export.json");
              await fs7.mkdir(path7.dirname(filePath), { recursive: true });
              await fs7.writeFile(filePath, JSON.stringify(todos.items, null, 2));
              return { content: [{ type: "text", text: `Exported ${todos.items.length} items to ${filePath}` }] };
            }
            case "import": {
              if (!args.file)
                return { content: [{ type: "text", text: "file required" }], isError: true };
              const imported = JSON.parse(await fs7.readFile(args.file, "utf-8"));
              for (const item of imported) {
                todos.lastId++;
                item.id = String(todos.lastId);
                todos.items.push(item);
              }
              await save2(todos);
              return { content: [{ type: "text", text: `Imported ${imported.length} items from ${args.file}` }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    tasksTools = [tasksTool];
  }
});

// src/tools/mode-preset.ts
function toolsForMode(m) {
  return m.tools.includes("*") ? getAllRegisteredTools().map((t) => t.name) : m.tools;
}
var modes, presets, currentMode, currentPreset, modeTool, modePresetTools, modeUtils;
var init_mode_preset = __esm({
  "src/tools/mode-preset.ts"() {
    "use strict";
    init_tool_registry();
    modes = [
      { name: "developer", description: "Full development", tools: ["*"] },
      { name: "research", description: "Research and exploration", tools: ["read", "list", "tree", "grep", "find", "search", "ast", "think"] },
      { name: "editor", description: "Code editing", tools: ["read", "write", "edit", "patch", "create", "delete", "grep", "ast"] },
      { name: "terminal", description: "Shell operations", tools: ["bash", "bg", "kill", "ps", "read"] },
      { name: "cloud_admin", description: "Cloud administration", tools: ["iam", "kms", "paas", "commerce", "storage", "auth", "api"] },
      { name: "devops", description: "DevOps", tools: ["read", "write", "edit", "bash", "paas", "git", "tasks"] },
      { name: "minimal", description: "Minimal", tools: ["read", "write", "edit", "grep", "bash"] },
      { name: "10x", description: "All tools", tools: ["*"] }
    ];
    presets = [
      { name: "default", description: "Default", modes: ["developer"] },
      { name: "minimal", description: "Minimal", modes: ["research", "editor"] },
      { name: "power", description: "Power user", modes: ["developer", "cloud_admin"] },
      { name: "cloud", description: "Cloud admin", modes: ["cloud_admin", "devops"] }
    ];
    currentMode = modes[0];
    currentPreset = presets[0];
    modeTool = {
      name: "mode",
      description: "Mode/preset system: switch, list modes, select/list presets",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["switch", "list", "select_preset", "list_presets", "current"] },
          name: { type: "string", description: "Mode or preset name" },
          verbose: { type: "boolean", default: false }
        },
        required: ["action"]
      },
      handler: async (args) => {
        switch (args.action) {
          case "switch": {
            if (!args.name)
              return { content: [{ type: "text", text: "name required" }], isError: true };
            const m = modes.find((x) => x.name === args.name);
            if (!m)
              return { content: [{ type: "text", text: `Mode '${args.name}' not found. Available: ${modes.map((x) => x.name).join(", ")}` }], isError: true };
            currentMode = m;
            const tools = toolsForMode(m);
            return { content: [{ type: "text", text: `Switched to ${m.name}: ${m.description} (${tools.length} tools)` }] };
          }
          case "list":
            return { content: [{ type: "text", text: modes.map((m) => `${m.name}${m === currentMode ? " *" : ""}: ${m.description}${args.verbose ? ` [${toolsForMode(m).length} tools]` : ""}`).join("\n") }] };
          case "select_preset": {
            if (!args.name)
              return { content: [{ type: "text", text: "name required" }], isError: true };
            const p = presets.find((x) => x.name === args.name);
            if (!p)
              return { content: [{ type: "text", text: `Preset '${args.name}' not found. Available: ${presets.map((x) => x.name).join(", ")}` }], isError: true };
            currentPreset = p;
            const m = modes.find((x) => x.name === p.modes[0]);
            if (m)
              currentMode = m;
            return { content: [{ type: "text", text: `Selected ${p.name}: ${p.description} (modes: ${p.modes.join(", ")})` }] };
          }
          case "list_presets":
            return { content: [{ type: "text", text: presets.map((p) => `${p.name}${p === currentPreset ? " *" : ""}: ${p.description} [${p.modes.join(", ")}]`).join("\n") }] };
          case "current":
            return { content: [{ type: "text", text: `Mode: ${currentMode.name}
Preset: ${currentPreset.name}
Tools: ${toolsForMode(currentMode).length}` }] };
          default:
            return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
        }
      }
    };
    modePresetTools = [modeTool];
    modeUtils = {
      getCurrentMode: () => currentMode,
      getCurrentPreset: () => currentPreset,
      getAvailableTools: () => toolsForMode(currentMode),
      isToolAvailable: (name) => toolsForMode(currentMode).includes(name)
    };
  }
});

// src/tools/hanzo-cloud.ts
function token() {
  return process.env.HANZO_API_KEY || process.env.API_KEY || process.env.API_TOKEN || process.env.HANZO_TOKEN || "";
}
async function api(base, path19, opts = {}) {
  const t = token();
  if (!t)
    throw new Error("HANZO_API_KEY required");
  const r = await fetch(`${base}${path19}`, { ...opts, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}`, ...opts.headers || {} } });
  if (!r.ok) {
    const b = await r.text().catch(() => "");
    throw new Error(`${r.status}: ${b.substring(0, 200)}`);
  }
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}
function j(d) {
  return JSON.stringify(d, null, 2);
}
function ok(t) {
  return { content: [{ type: "text", text: t }] };
}
function fail6(m) {
  return { content: [{ type: "text", text: `Error: ${m}` }], isError: true };
}
function arr(d, ...keys) {
  if (Array.isArray(d))
    return d;
  for (const k of keys)
    if (Array.isArray(d?.[k]))
      return d[k];
  return d?.data || [];
}
var API_URL, IAM_URL, KMS_URL, PAAS_URL, iamTool, kmsTool, paasTool, COMMERCE_RESOURCES, commerceTool, storageTool, authTool, apiTool, iamTools, kmsTools, paasTools, commerceTools, storageTools, authTools, apiTools, billingTool, billingTools, hanzoCloudTools;
var init_hanzo_cloud = __esm({
  "src/tools/hanzo-cloud.ts"() {
    "use strict";
    API_URL = process.env.API_URL || "https://api.hanzo.ai";
    IAM_URL = process.env.IAM_URL || "https://iam.hanzo.ai";
    KMS_URL = process.env.KMS_URL || "https://kms.hanzo.ai";
    PAAS_URL = process.env.PAAS_URL || "https://platform.hanzo.ai";
    iamTool = {
      name: "iam",
      description: "Identity & access management: users, orgs, roles, apps, providers, tokens, permissions, sessions",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "list_users",
            "get_user",
            "create_user",
            "update_user",
            "delete_user",
            "list_orgs",
            "get_org",
            "create_org",
            "update_org",
            "delete_org",
            "list_roles",
            "get_role",
            "create_role",
            "update_role",
            "delete_role",
            "list_apps",
            "get_app",
            "create_app",
            "list_providers",
            "list_tokens",
            "create_token",
            "delete_token",
            "list_permissions",
            "assign_role",
            "remove_role",
            "list_sessions",
            "delete_session",
            "health"
          ] },
          owner: { type: "string", default: "admin" },
          id: { type: "string", description: "Entity ID (owner/name format for users)" },
          name: { type: "string" },
          email: { type: "string" },
          password: { type: "string" },
          displayName: { type: "string" },
          phone: { type: "string" },
          organization: { type: "string", default: "hanzo" },
          role: { type: "string", description: "Role name (assign_role, remove_role)" },
          user: { type: "string", description: "User ID (assign_role, remove_role)" },
          data: { type: "object", description: "Create/update payload" },
          limit: { type: "number", default: 50 }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const o = args.owner || "admin";
          const lim = args.limit || 50;
          switch (args.action) {
            case "list_users": {
              const u = arr(await api(IAM_URL, `/api/get-users?owner=${o}&limit=${lim}`));
              return ok(`Users (${u.length}):
${u.map((x) => `${x.name} <${x.email || ""}> [${x.type || "normal-user"}]`).join("\n")}`);
            }
            case "get_user": {
              if (!args.id)
                return fail6("id required");
              return ok(j(await api(IAM_URL, `/api/get-user?id=${args.id.includes("/") ? args.id : `admin/${args.id}`}`)));
            }
            case "create_user": {
              if (!args.name || !args.email || !args.password)
                return fail6("name, email, password required");
              await api(IAM_URL, "/api/add-user", { method: "POST", body: JSON.stringify({ owner: o, name: args.name, email: args.email, password: args.password, organization: args.organization || "hanzo", type: "normal-user" }) });
              return ok(`Created: ${args.name} <${args.email}>`);
            }
            case "update_user": {
              if (!args.id)
                return fail6("id required");
              const id = args.id.includes("/") ? args.id : `admin/${args.id}`;
              const u = await api(IAM_URL, `/api/get-user?id=${id}`);
              if (args.email)
                u.email = args.email;
              if (args.displayName)
                u.displayName = args.displayName;
              if (args.phone)
                u.phone = args.phone;
              if (args.data)
                Object.assign(u, args.data);
              await api(IAM_URL, "/api/update-user", { method: "POST", body: JSON.stringify(u) });
              return ok(`Updated: ${id}`);
            }
            case "delete_user": {
              if (!args.id)
                return fail6("id required");
              const id = args.id.includes("/") ? args.id : `admin/${args.id}`;
              const [ow, nm] = id.split("/");
              await api(IAM_URL, "/api/delete-user", { method: "POST", body: JSON.stringify({ owner: ow, name: nm }) });
              return ok(`Deleted: ${id}`);
            }
            case "list_orgs": {
              const orgs = arr(await api(IAM_URL, `/api/get-organizations?owner=${o}`));
              return ok(`Orgs (${orgs.length}):
${orgs.map((x) => `${x.name}: ${x.displayName || ""} [${(x.users || []).length} members]`).join("\n")}`);
            }
            case "get_org": {
              if (!args.id)
                return fail6("id required");
              return ok(j(await api(IAM_URL, `/api/get-organization?id=${args.id.includes("/") ? args.id : `admin/${args.id}`}`)));
            }
            case "create_org": {
              if (!args.name)
                return fail6("name required");
              await api(IAM_URL, "/api/add-organization", { method: "POST", body: JSON.stringify({ owner: o, name: args.name, displayName: args.displayName || args.name, ...args.data || {} }) });
              return ok(`Created org: ${args.name}`);
            }
            case "update_org": {
              if (!args.id)
                return fail6("id required");
              const id = args.id.includes("/") ? args.id : `admin/${args.id}`;
              const org = await api(IAM_URL, `/api/get-organization?id=${id}`);
              if (args.displayName)
                org.displayName = args.displayName;
              if (args.data)
                Object.assign(org, args.data);
              await api(IAM_URL, "/api/update-organization", { method: "POST", body: JSON.stringify(org) });
              return ok(`Updated org: ${id}`);
            }
            case "delete_org": {
              if (!args.id)
                return fail6("id required");
              const id = args.id.includes("/") ? args.id : `admin/${args.id}`;
              const [ow, nm] = id.split("/");
              await api(IAM_URL, "/api/delete-organization", { method: "POST", body: JSON.stringify({ owner: ow, name: nm }) });
              return ok(`Deleted org: ${id}`);
            }
            case "list_roles": {
              const roles = arr(await api(IAM_URL, `/api/get-roles?owner=${o}`));
              return ok(`Roles (${roles.length}):
${roles.map((x) => `${x.name}: ${(x.users || []).length} users, ${(x.roles || []).length} sub-roles`).join("\n")}`);
            }
            case "get_role": {
              if (!args.id)
                return fail6("id required");
              return ok(j(await api(IAM_URL, `/api/get-role?id=${args.id.includes("/") ? args.id : `admin/${args.id}`}`)));
            }
            case "create_role": {
              if (!args.name)
                return fail6("name required");
              await api(IAM_URL, "/api/add-role", { method: "POST", body: JSON.stringify({ owner: o, name: args.name, displayName: args.displayName || args.name, ...args.data || {} }) });
              return ok(`Created role: ${args.name}`);
            }
            case "update_role": {
              if (!args.id)
                return fail6("id required");
              const id = args.id.includes("/") ? args.id : `admin/${args.id}`;
              const role = await api(IAM_URL, `/api/get-role?id=${id}`);
              if (args.data)
                Object.assign(role, args.data);
              await api(IAM_URL, "/api/update-role", { method: "POST", body: JSON.stringify(role) });
              return ok(`Updated role: ${id}`);
            }
            case "delete_role": {
              if (!args.id)
                return fail6("id required");
              const id = args.id.includes("/") ? args.id : `admin/${args.id}`;
              const [ow, nm] = id.split("/");
              await api(IAM_URL, "/api/delete-role", { method: "POST", body: JSON.stringify({ owner: ow, name: nm }) });
              return ok(`Deleted role: ${id}`);
            }
            case "list_apps": {
              const apps = arr(await api(IAM_URL, `/api/get-applications?owner=${o}`));
              return ok(`Apps (${apps.length}):
${apps.map((x) => `${x.name}: ${x.displayName || ""} [${x.clientId || ""}]`).join("\n")}`);
            }
            case "get_app": {
              if (!args.id)
                return fail6("id required");
              return ok(j(await api(IAM_URL, `/api/get-application?id=${args.id.includes("/") ? args.id : `admin/${args.id}`}`)));
            }
            case "create_app": {
              if (!args.name)
                return fail6("name required");
              await api(IAM_URL, "/api/add-application", { method: "POST", body: JSON.stringify({ owner: o, name: args.name, displayName: args.displayName || args.name, organization: args.organization || "hanzo", ...args.data || {} }) });
              return ok(`Created app: ${args.name}`);
            }
            case "list_providers":
              return ok(j(await api(IAM_URL, `/api/get-providers?owner=${o}`)));
            case "list_tokens":
              return ok(j(await api(IAM_URL, `/api/get-tokens?owner=${o}&limit=${lim}`)));
            case "create_token": {
              if (!args.name)
                return fail6("name required");
              return ok(j(await api(IAM_URL, "/api/add-token", { method: "POST", body: JSON.stringify({ owner: o, name: args.name, ...args.data || {} }) })));
            }
            case "delete_token": {
              if (!args.id)
                return fail6("id required");
              await api(IAM_URL, "/api/delete-token", { method: "POST", body: JSON.stringify({ owner: o, name: args.id }) });
              return ok(`Deleted token: ${args.id}`);
            }
            case "list_permissions":
              return ok(j(await api(IAM_URL, `/api/get-permissions?owner=${o}`)));
            case "assign_role": {
              if (!args.role || !args.user)
                return fail6("role and user required");
              const r = await api(IAM_URL, `/api/get-role?id=${args.role.includes("/") ? args.role : `admin/${args.role}`}`);
              r.users = r.users || [];
              r.users.push(args.user);
              await api(IAM_URL, "/api/update-role", { method: "POST", body: JSON.stringify(r) });
              return ok(`Assigned role ${args.role} to ${args.user}`);
            }
            case "remove_role": {
              if (!args.role || !args.user)
                return fail6("role and user required");
              const r = await api(IAM_URL, `/api/get-role?id=${args.role.includes("/") ? args.role : `admin/${args.role}`}`);
              r.users = (r.users || []).filter((u) => u !== args.user);
              await api(IAM_URL, "/api/update-role", { method: "POST", body: JSON.stringify(r) });
              return ok(`Removed role ${args.role} from ${args.user}`);
            }
            case "list_sessions":
              return ok(j(await api(IAM_URL, `/api/get-sessions?owner=${o}&limit=${lim}`)));
            case "delete_session": {
              if (!args.id)
                return fail6("id required");
              await api(IAM_URL, "/api/delete-session", { method: "POST", body: JSON.stringify({ owner: o, name: args.id }) });
              return ok(`Deleted session: ${args.id}`);
            }
            case "health":
              return ok(j(await api(IAM_URL, "/api/health")));
            default:
              return fail6(`Unknown action: ${args.action}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    kmsTool = {
      name: "kms",
      description: "Secrets management: list, get, create, update, delete, rotate, versions, folders, audit, import, export",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "list",
            "get",
            "create",
            "update",
            "delete",
            "rotate",
            "versions",
            "rollback",
            "folders",
            "create_folder",
            "audit",
            "import",
            "export",
            "projects",
            "environments"
          ] },
          project: { type: "string", description: "Project slug" },
          key: { type: "string", description: "Secret name" },
          value: { type: "string", description: "Secret value" },
          environment: { type: "string", default: "production" },
          path: { type: "string", default: "/" },
          comment: { type: "string" },
          version: { type: "number", description: "Secret version (rollback)" },
          folder: { type: "string", description: "Folder name (create_folder)" },
          secrets: { type: "object", description: "Key-value map for batch import" },
          limit: { type: "number", default: 50 }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const env = args.environment || "production";
          const sp = encodeURIComponent(args.path || "/");
          switch (args.action) {
            case "list": {
              if (!args.project)
                return fail6("project required");
              const s = arr(await api(KMS_URL, `/api/v3/secrets?workspaceSlug=${args.project}&environment=${env}&secretPath=${sp}`), "secrets");
              return ok(`Secrets (${s.length}):
${s.map((x) => `${x.secretKey || x.key}: ${(x.secretValue || x.value || "").substring(0, 8)}...`).join("\n")}`);
            }
            case "get": {
              if (!args.project || !args.key)
                return fail6("project and key required");
              return ok(j(await api(KMS_URL, `/api/v3/secrets/${encodeURIComponent(args.key)}?workspaceSlug=${args.project}&environment=${env}&secretPath=${sp}`)));
            }
            case "create": {
              if (!args.project || !args.key || !args.value)
                return fail6("project, key, value required");
              await api(KMS_URL, `/api/v3/secrets/${encodeURIComponent(args.key)}`, { method: "POST", body: JSON.stringify({ workspaceSlug: args.project, environment: env, secretPath: args.path || "/", secretValue: args.value, secretComment: args.comment || "" }) });
              return ok(`Created: ${args.key}`);
            }
            case "update": {
              if (!args.project || !args.key || !args.value)
                return fail6("project, key, value required");
              await api(KMS_URL, `/api/v3/secrets/${encodeURIComponent(args.key)}`, { method: "PATCH", body: JSON.stringify({ workspaceSlug: args.project, environment: env, secretPath: args.path || "/", secretValue: args.value }) });
              return ok(`Updated: ${args.key}`);
            }
            case "delete": {
              if (!args.project || !args.key)
                return fail6("project and key required");
              await api(KMS_URL, `/api/v3/secrets/${encodeURIComponent(args.key)}`, { method: "DELETE", body: JSON.stringify({ workspaceSlug: args.project, environment: env, secretPath: args.path || "/" }) });
              return ok(`Deleted: ${args.key}`);
            }
            case "rotate": {
              if (!args.project || !args.key || !args.value)
                return fail6("project, key, new value required");
              await api(KMS_URL, `/api/v3/secrets/${encodeURIComponent(args.key)}`, { method: "PATCH", body: JSON.stringify({ workspaceSlug: args.project, environment: env, secretPath: args.path || "/", secretValue: args.value }) });
              return ok(`Rotated: ${args.key} (new version created)`);
            }
            case "versions": {
              if (!args.project || !args.key)
                return fail6("project and key required");
              const d = await api(KMS_URL, `/api/v1/secret/${encodeURIComponent(args.key)}/versions?workspaceSlug=${args.project}&environment=${env}&secretPath=${sp}`);
              const v = arr(d, "versions", "secretVersions");
              return ok(`Versions of ${args.key} (${v.length}):
${v.map((x, i) => `v${x.version || i + 1}: ${x.createdAt || ""} ${x.secretValue ? x.secretValue.substring(0, 8) + "..." : ""}`).join("\n")}`);
            }
            case "rollback": {
              if (!args.project || !args.key || !args.version)
                return fail6("project, key, version required");
              await api(KMS_URL, `/api/v1/secret/${encodeURIComponent(args.key)}/rollback`, { method: "POST", body: JSON.stringify({ workspaceSlug: args.project, environment: env, secretPath: args.path || "/", version: args.version }) });
              return ok(`Rolled back ${args.key} to v${args.version}`);
            }
            case "folders": {
              if (!args.project)
                return fail6("project required");
              const d = await api(KMS_URL, `/api/v1/folders?workspaceSlug=${args.project}&environment=${env}&parentPath=${sp}`);
              const f = arr(d, "folders");
              return ok(`Folders:
${f.map((x) => `${x.name || x.id}`).join("\n") || "(root only)"}`);
            }
            case "create_folder": {
              if (!args.project || !args.folder)
                return fail6("project and folder required");
              await api(KMS_URL, "/api/v1/folders", { method: "POST", body: JSON.stringify({ workspaceSlug: args.project, environment: env, folderName: args.folder, parentPath: args.path || "/" }) });
              return ok(`Created folder: ${args.folder}`);
            }
            case "audit": {
              if (!args.project)
                return fail6("project required");
              const d = await api(KMS_URL, `/api/v1/audit-logs?workspaceSlug=${args.project}&limit=${args.limit || 50}`);
              const logs = arr(d, "auditLogs", "logs");
              return ok(`Audit (${logs.length}):
${logs.map((x) => `${x.createdAt || ""} ${x.actor || ""}: ${x.event || x.action || ""} ${x.secretKey || ""}`).join("\n")}`);
            }
            case "import": {
              if (!args.project || !args.secrets)
                return fail6("project and secrets (key-value map) required");
              let count = 0;
              for (const [k, v] of Object.entries(args.secrets)) {
                await api(KMS_URL, `/api/v3/secrets/${encodeURIComponent(k)}`, { method: "POST", body: JSON.stringify({ workspaceSlug: args.project, environment: env, secretPath: args.path || "/", secretValue: String(v) }) });
                count++;
              }
              return ok(`Imported ${count} secrets`);
            }
            case "export": {
              if (!args.project)
                return fail6("project required");
              const s = arr(await api(KMS_URL, `/api/v3/secrets?workspaceSlug=${args.project}&environment=${env}&secretPath=${sp}`), "secrets");
              const map = {};
              for (const x of s)
                map[x.secretKey || x.key] = x.secretValue || x.value || "";
              return ok(j(map));
            }
            case "projects":
              return ok(j(await api(KMS_URL, "/api/v2/workspace")));
            case "environments": {
              if (!args.project)
                return fail6("project required");
              return ok(j(await api(KMS_URL, `/api/v2/workspace/${args.project}/environments`)));
            }
            default:
              return fail6(`Unknown action: ${args.action}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    paasTool = {
      name: "paas",
      description: "Platform as a Service: projects, environments, containers, deploy, scale, restart, domains, env vars, rollback, metrics, builds, logs",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "list",
            "get",
            "deploy",
            "delete",
            "logs",
            "scale",
            "restart",
            "status",
            "domains",
            "add_domain",
            "remove_domain",
            "env_vars",
            "set_env",
            "unset_env",
            "rollback",
            "builds",
            "metrics",
            "environments",
            "create_env",
            "containers"
          ] },
          org: { type: "string", default: "hanzo" },
          project: { type: "string" },
          environment: { type: "string" },
          container: { type: "string" },
          image: { type: "string" },
          env: { type: "object", description: "Env vars map" },
          domain: { type: "string" },
          replicas: { type: "number", description: "Scale target" },
          cpu: { type: "string", description: 'CPU limit (e.g., "500m", "2")' },
          memory: { type: "string", description: 'Memory limit (e.g., "512Mi", "2Gi")' },
          version: { type: "string", description: "Rollback target version/build" },
          key: { type: "string", description: "Env var key" },
          value: { type: "string", description: "Env var value" },
          lines: { type: "number", default: 100 },
          since: { type: "string" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const org = args.org || "hanzo";
          const base = `/v1/org/${org}`;
          switch (args.action) {
            case "list": {
              const d = await api(PAAS_URL, `${base}/project`);
              const p = arr(d, "projects");
              return ok(`Projects (${p.length}):
${p.map((x) => `${x.name || x.iid}: [${x.environments?.length || 0} envs]`).join("\n")}`);
            }
            case "get": {
              if (!args.project)
                return fail6("project required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}`)));
            }
            case "deploy": {
              if (!args.project || !args.environment || !args.container)
                return fail6("project, environment, container required");
              const body = {};
              if (args.image)
                body.image = args.image;
              if (args.env)
                body.variables = args.env;
              if (args.replicas)
                body.replicas = args.replicas;
              if (args.cpu)
                body.cpuLimit = args.cpu;
              if (args.memory)
                body.memoryLimit = args.memory;
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}`, { method: "PUT", body: JSON.stringify(body) })));
            }
            case "delete": {
              if (!args.project)
                return fail6("project required");
              await api(PAAS_URL, `${base}/project/${args.project}`, { method: "DELETE" });
              return ok(`Deleted: ${args.project}`);
            }
            case "logs": {
              if (!args.project || !args.environment || !args.container)
                return fail6("project, environment, container required");
              const params = `lines=${args.lines || 100}${args.since ? `&since=${args.since}` : ""}`;
              const d = await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/logs?${params}`);
              return ok(typeof d === "string" ? d : d?.logs || j(d));
            }
            case "scale": {
              if (!args.project || !args.environment || !args.container)
                return fail6("project, environment, container required");
              if (!args.replicas)
                return fail6("replicas required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/scale`, { method: "POST", body: JSON.stringify({ replicas: args.replicas }) })));
            }
            case "restart": {
              if (!args.project || !args.environment || !args.container)
                return fail6("project, environment, container required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/restart`, { method: "POST" })));
            }
            case "status": {
              if (!args.project)
                return fail6("project required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/status`)));
            }
            case "domains": {
              if (!args.project || !args.environment)
                return fail6("project and environment required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/domains`)));
            }
            case "add_domain": {
              if (!args.project || !args.environment || !args.domain)
                return fail6("project, environment, domain required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/domains`, { method: "POST", body: JSON.stringify({ domain: args.domain }) })));
            }
            case "remove_domain": {
              if (!args.project || !args.environment || !args.domain)
                return fail6("project, environment, domain required");
              await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/domains/${encodeURIComponent(args.domain)}`, { method: "DELETE" });
              return ok(`Removed domain: ${args.domain}`);
            }
            case "env_vars": {
              if (!args.project || !args.environment || !args.container)
                return fail6("project, environment, container required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/variables`)));
            }
            case "set_env": {
              if (!args.project || !args.environment || !args.container || !args.key || !args.value)
                return fail6("project, environment, container, key, value required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/variables`, { method: "POST", body: JSON.stringify({ [args.key]: args.value }) })));
            }
            case "unset_env": {
              if (!args.project || !args.environment || !args.container || !args.key)
                return fail6("project, environment, container, key required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/variables/${encodeURIComponent(args.key)}`, { method: "DELETE" })));
            }
            case "rollback": {
              if (!args.project || !args.environment || !args.container || !args.version)
                return fail6("project, environment, container, version required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/rollback`, { method: "POST", body: JSON.stringify({ version: args.version }) })));
            }
            case "builds": {
              if (!args.project)
                return fail6("project required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/builds?limit=${args.lines || 20}`)));
            }
            case "metrics": {
              if (!args.project || !args.environment || !args.container)
                return fail6("project, environment, container required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container/${args.container}/metrics`)));
            }
            case "environments": {
              if (!args.project)
                return fail6("project required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env`)));
            }
            case "create_env": {
              if (!args.project || !args.environment)
                return fail6("project and environment required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env`, { method: "POST", body: JSON.stringify({ name: args.environment }) })));
            }
            case "containers": {
              if (!args.project || !args.environment)
                return fail6("project and environment required");
              return ok(j(await api(PAAS_URL, `${base}/project/${args.project}/env/${args.environment}/container`)));
            }
            default:
              return fail6(`Unknown action: ${args.action}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    COMMERCE_RESOURCES = {
      products: { path: "/v1/product", label: "Products", hint: "list, get, create, update, delete, search" },
      orders: { path: "/v1/order", label: "Orders", hint: "list, get, create, update, authorize, capture, charge, refund, status, payments, returns, confirm" },
      carts: { path: "/v1/cart", label: "Carts", hint: "get, create, update, set, discard" },
      checkout: { path: "/v1/checkout", label: "Checkout", hint: "authorize, charge, capture, confirm, cancel, session" },
      subscriptions: { path: "/v1/subscribe", label: "Subscriptions", hint: "list, get, create, update, cancel, apply_promotion" },
      billing: { path: "/v1/billing", label: "Billing", hint: "balance, usage, invoices, plans, payment_methods, deposit, credit, refund, disputes, payouts, meters, portal, tier, events" },
      collections: { path: "/v1/collection", label: "Collections", hint: "list, get, create, update, delete" },
      coupons: { path: "/v1/coupon", label: "Coupons", hint: "list, get, create, update, delete, generate_codes" },
      discounts: { path: "/v1/discount", label: "Discounts", hint: "list, get, create, update, delete" },
      customers: { path: "/v1/customergroup", label: "Customers", hint: "list, get, create, update, delete, members, add_member, remove_member" },
      inventory: { path: "/v1/inventory", label: "Inventory", hint: "list, get, create, update, delete, adjust" },
      stores: { path: "/v1/store", label: "Stores", hint: "list, get, create, update, delete, listings" },
      fulfillment: { path: "/v1/fulfillment", label: "Fulfillment", hint: "ship, cancel, track" },
      analytics: { path: "/v1/counter", label: "Analytics", hint: "dashboard, topline, events" },
      referrals: { path: "/v1/referral", label: "Referrals", hint: "list, get, create" },
      affiliates: { path: "/v1/affiliate", label: "Affiliates", hint: "list, get, create, connect" },
      webhooks: { path: "/v1/webhook-endpoints", label: "Webhooks", hint: "list, get, create, update, delete" },
      reviews: { path: "/v1/review", label: "Reviews", hint: "list, get, create, update, delete" },
      promotions: { path: "/v1/promotion", label: "Promotions", hint: "list, get, create, update, delete, evaluate" },
      pricing: { path: "/v1/pricing", label: "Pricing", hint: "calculate, rules, create_rule, update_rule, delete_rule" },
      tax: { path: "/v1/tax", label: "Tax", hint: "calculate, rates, regions" },
      returns: { path: "/v1/return", label: "Returns", hint: "list, get, create, update" }
    };
    commerceTool = {
      name: "commerce",
      description: "Full commerce engine with billing: " + Object.keys(COMMERCE_RESOURCES).join(", ") + ". Call with just resource to see available actions. Covers products, orders, carts, checkout, subscriptions, billing (balance/usage/invoices/credits/payment methods/meters/disputes/payouts), collections, coupons, discounts, customers, inventory, stores, fulfillment, analytics, referrals, affiliates, webhooks, reviews, promotions, pricing, tax, returns.",
      inputSchema: {
        type: "object",
        properties: {
          resource: { type: "string", enum: Object.keys(COMMERCE_RESOURCES), description: "Commerce resource. Omit to see all available resources." },
          action: { type: "string", description: "Operation to perform. Call with just resource to discover available actions." },
          id: { type: "string", description: "Resource ID" },
          data: { type: "object", description: "Create/update payload (all fields)" },
          query: { type: "string", description: "Search query or filter" },
          status: { type: "string", description: "Filter by status" },
          limit: { type: "number", default: 50 },
          page: { type: "number", default: 1 },
          period: { type: "string", description: "Billing period: current, previous, YYYY-MM" },
          amount: { type: "number", description: "Amount in cents (deposit, credit, refund)" },
          currency: { type: "string", default: "usd" },
          user: { type: "string", description: "User scope (billing)" },
          code: { type: "string", description: "Coupon/promotion code" },
          count: { type: "number", description: "Number of codes to generate" },
          items: { type: "array", items: { type: "object" }, description: "Line items (cart, order)" },
          address: { type: "object", description: "Shipping/billing address" },
          member: { type: "string", description: "Member user ID (customers)" },
          adjustment: { type: "number", description: "Stock adjustment quantity" }
        },
        required: []
      },
      handler: async (args) => {
        try {
          if (!args.resource) {
            const lines = Object.entries(COMMERCE_RESOURCES).map(([k, v]) => `${k}: ${v.hint}`);
            return ok(`Commerce resources (${lines.length}):

${lines.join("\n")}

Call with resource to see actions, or resource + action to execute.`);
          }
          const res = COMMERCE_RESOURCES[args.resource];
          if (!res)
            return fail6(`Unknown resource: ${args.resource}. Available: ${Object.keys(COMMERCE_RESOURCES).join(", ")}`);
          if (!args.action) {
            return ok(`${res.label} \u2014 available actions: ${res.hint}

Call with action to execute. Most actions support: id, data, query, limit, page, status.`);
          }
          const act = args.action;
          const lim = args.limit || 50;
          const simpleCRUD = ["collections", "coupons", "discounts", "reviews", "promotions", "returns", "webhooks", "referrals", "affiliates"];
          if (simpleCRUD.includes(args.resource) && ["list", "get", "create", "update", "delete"].includes(act)) {
            switch (act) {
              case "list": {
                const q = args.query ? `&q=${encodeURIComponent(args.query)}` : "";
                const d = arr(await api(API_URL, `${res.path}?limit=${lim}${q}${args.status ? `&status=${args.status}` : ""}`));
                return ok(`${res.label} (${d.length}):
${d.map((x) => `${x.id}: ${x.name || x.code || x.title || x.url || j(x).substring(0, 60)}`).join("\n")}`);
              }
              case "get": {
                if (!args.id)
                  return fail6("id required");
                return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
              }
              case "create":
                return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || {}) })));
              case "update": {
                if (!args.id)
                  return fail6("id required");
                return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
              }
              case "delete": {
                if (!args.id)
                  return fail6("id required");
                await api(API_URL, `${res.path}/${args.id}`, { method: "DELETE" });
                return ok(`Deleted ${args.resource}: ${args.id}`);
              }
            }
          }
          switch (args.resource) {
            case "products": {
              switch (act) {
                case "list": {
                  const q = args.query ? `&q=${encodeURIComponent(args.query)}` : "";
                  const d = arr(await api(API_URL, `${res.path}?limit=${lim}${q}`), "products");
                  return ok(`Products (${d.length}):
${d.map((x) => `${x.id}: ${x.name} $${((x.price || 0) / 100).toFixed(2)} [${x.sku || ""}]`).join("\n")}`);
                }
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "delete": {
                  if (!args.id)
                    return fail6("id required");
                  await api(API_URL, `${res.path}/${args.id}`, { method: "DELETE" });
                  return ok(`Deleted product: ${args.id}`);
                }
                case "search": {
                  if (!args.query)
                    return fail6("query required");
                  return ok(j(await api(API_URL, `/v1/search/product?q=${encodeURIComponent(args.query)}&limit=${lim}`)));
                }
                default:
                  return fail6(`Products: ${res.hint}`);
              }
            }
            case "orders": {
              switch (act) {
                case "list": {
                  const q = args.status ? `&status=${args.status}` : "";
                  const d = arr(await api(API_URL, `${res.path}?limit=${lim}${q}`), "orders");
                  return ok(`Orders (${d.length}):
${d.map((x) => `${x.id}: $${((x.total || 0) / 100).toFixed(2)} ${x.status || ""}`).join("\n")}`);
                }
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || { items: args.items || [] }) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "authorize": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/authorize`, { method: "POST" })));
                }
                case "capture": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/capture`, { method: "POST" })));
                }
                case "charge": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/charge`, { method: "POST" })));
                }
                case "refund": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/refund`, { method: "POST", body: JSON.stringify(args.amount ? { amount: args.amount } : {}) })));
                }
                case "status": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/status`)));
                }
                case "payments": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/payments`)));
                }
                case "returns": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/returns`)));
                }
                case "confirm": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/confirm`, { method: "POST" })));
                }
                default:
                  return fail6(`Orders: ${res.hint}`);
              }
            }
            case "carts": {
              switch (act) {
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || { items: args.items || [] }) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PUT", body: JSON.stringify(args.data || {}) })));
                }
                case "set": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/set`, { method: "POST", body: JSON.stringify({ items: args.items || [] }) })));
                }
                case "discard": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/discard`, { method: "POST" })));
                }
                default:
                  return fail6(`Carts: ${res.hint}`);
              }
            }
            case "checkout": {
              switch (act) {
                case "authorize":
                  return ok(j(await api(API_URL, `${res.path}/authorize`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "charge":
                  return ok(j(await api(API_URL, `${res.path}/charge`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "capture": {
                  if (!args.id)
                    return fail6("order id required");
                  return ok(j(await api(API_URL, `${res.path}/capture/${args.id}`, { method: "POST" })));
                }
                case "confirm": {
                  if (!args.id)
                    return fail6("order id required");
                  return ok(j(await api(API_URL, `${res.path}/confirm/${args.id}`, { method: "POST" })));
                }
                case "cancel": {
                  if (!args.id)
                    return fail6("order id required");
                  return ok(j(await api(API_URL, `${res.path}/cancel/${args.id}`, { method: "POST" })));
                }
                case "session":
                  return ok(j(await api(API_URL, `${res.path}/sessions`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                default:
                  return fail6(`Checkout: ${res.hint}`);
              }
            }
            case "subscriptions": {
              switch (act) {
                case "list": {
                  const d = arr(await api(API_URL, `${res.path}?limit=${lim}`), "subscriptions");
                  return ok(`Subscriptions (${d.length}):
${d.map((x) => `${x.id}: ${x.planId || x.plan || ""} [${x.status}]`).join("\n")}`);
                }
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "cancel": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "DELETE", body: JSON.stringify(args.data || {}) })));
                }
                case "apply_promotion": {
                  if (!args.id || !args.code)
                    return fail6("id and code required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/promotion`, { method: "POST", body: JSON.stringify({ code: args.code }) })));
                }
                default:
                  return fail6(`Subscriptions: ${res.hint}`);
              }
            }
            case "billing": {
              switch (act) {
                case "balance": {
                  const scope = args.user ? `?userId=${args.user}` : "";
                  return ok(j(await api(API_URL, `${res.path}/balance${scope}`)));
                }
                case "usage":
                  return ok(j(await api(API_URL, `${res.path}/usage?period=${args.period || "current"}${args.user ? `&userId=${args.user}` : ""}`)));
                case "invoices": {
                  const d = arr(await api(API_URL, `${res.path}/invoices?limit=${lim}`), "invoices");
                  return ok(`Invoices (${d.length}):
${d.map((i) => `${i.id}: $${((i.amount || 0) / 100).toFixed(2)} ${i.status || ""}`).join("\n")}`);
                }
                case "plans":
                  return ok(j(await api(API_URL, `${res.path}/plans`)));
                case "tier":
                  return ok(j(await api(API_URL, `${res.path}/tier`)));
                case "payment_methods": {
                  const d = arr(await api(API_URL, `${res.path}/payment-methods`), "paymentMethods");
                  return ok(`Payment Methods (${d.length}):
${d.map((x) => `${x.id}: ${x.type} ${x.card?.last4 ? `****${x.card.last4}` : ""} ${x.status || ""}`).join("\n")}`);
                }
                case "deposit": {
                  if (!args.amount)
                    return fail6("amount (cents) required");
                  return ok(j(await api(API_URL, `${res.path}/deposit`, { method: "POST", body: JSON.stringify({ amount: args.amount, currency: args.currency || "usd" }) })));
                }
                case "credit":
                  return ok(j(await api(API_URL, `${res.path}/credit`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "refund": {
                  if (!args.id)
                    return fail6("payment id required");
                  return ok(j(await api(API_URL, `${res.path}/refund`, { method: "POST", body: JSON.stringify({ paymentId: args.id, amount: args.amount, ...args.data || {} }) })));
                }
                case "disputes": {
                  if (args.id)
                    return ok(j(await api(API_URL, `${res.path}/disputes/${args.id}`)));
                  return ok(j(await api(API_URL, `${res.path}/disputes?limit=${lim}`)));
                }
                case "payouts": {
                  if (args.id)
                    return ok(j(await api(API_URL, `${res.path}/payouts/${args.id}`)));
                  return ok(j(await api(API_URL, `${res.path}/payouts?limit=${lim}`)));
                }
                case "meters": {
                  const d = arr(await api(API_URL, `${res.path}/meters`), "meters");
                  return ok(`Meters (${d.length}):
${d.map((x) => `${x.id}: ${x.name} (${x.unitName || "units"})`).join("\n")}`);
                }
                case "portal":
                  return ok(j(await api(API_URL, `${res.path}/portal`)));
                case "events":
                  return ok(j(await api(API_URL, `${res.path}/events?limit=${lim}`)));
                default:
                  return fail6(`Billing: ${res.hint}`);
              }
            }
            case "customers": {
              switch (act) {
                case "list": {
                  const d = arr(await api(API_URL, `${res.path}?limit=${lim}`));
                  return ok(`Groups (${d.length}):
${d.map((x) => `${x.id}: ${x.name}`).join("\n")}`);
                }
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "delete": {
                  if (!args.id)
                    return fail6("id required");
                  await api(API_URL, `${res.path}/${args.id}`, { method: "DELETE" });
                  return ok(`Deleted: ${args.id}`);
                }
                case "members": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/members`)));
                }
                case "add_member": {
                  if (!args.id || !args.member)
                    return fail6("id and member required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/members`, { method: "POST", body: JSON.stringify({ userId: args.member }) })));
                }
                case "remove_member": {
                  if (!args.id || !args.member)
                    return fail6("id and member required");
                  await api(API_URL, `${res.path}/${args.id}/members/${args.member}`, { method: "DELETE" });
                  return ok(`Removed member: ${args.member}`);
                }
                default:
                  return fail6(`Customers: ${res.hint}`);
              }
            }
            case "inventory": {
              switch (act) {
                case "list": {
                  const d = arr(await api(API_URL, `${res.path}?limit=${lim}`));
                  return ok(`Inventory (${d.length}):
${d.map((x) => `${x.id}: qty=${x.quantity || 0} product=${x.productId || ""}`).join("\n")}`);
                }
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "delete": {
                  if (!args.id)
                    return fail6("id required");
                  await api(API_URL, `${res.path}/${args.id}`, { method: "DELETE" });
                  return ok(`Deleted: ${args.id}`);
                }
                case "adjust": {
                  if (!args.id || args.adjustment === void 0)
                    return fail6("id and adjustment required");
                  return ok(j(await api(API_URL, `${res.path}/level/${args.id}/adjust`, { method: "POST", body: JSON.stringify({ adjustment: args.adjustment }) })));
                }
                default:
                  return fail6(`Inventory: ${res.hint}`);
              }
            }
            case "stores": {
              switch (act) {
                case "list": {
                  const d = arr(await api(API_URL, `${res.path}?limit=${lim}`));
                  return ok(`Stores (${d.length}):
${d.map((x) => `${x.id}: ${x.name || x.slug || ""}`).join("\n")}`);
                }
                case "get": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                case "create":
                  return ok(j(await api(API_URL, res.path, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "update": {
                  if (!args.id)
                    return fail6("id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "delete": {
                  if (!args.id)
                    return fail6("id required");
                  await api(API_URL, `${res.path}/${args.id}`, { method: "DELETE" });
                  return ok(`Deleted store: ${args.id}`);
                }
                case "listings": {
                  if (!args.id)
                    return fail6("store id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/listing`)));
                }
                default:
                  return fail6(`Stores: ${res.hint}`);
              }
            }
            case "fulfillment": {
              switch (act) {
                case "ship": {
                  if (!args.id)
                    return fail6("fulfillment id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/ship`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                }
                case "cancel": {
                  if (!args.id)
                    return fail6("fulfillment id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}/cancel`, { method: "POST" })));
                }
                case "track": {
                  if (!args.id)
                    return fail6("fulfillment id required");
                  return ok(j(await api(API_URL, `${res.path}/${args.id}`)));
                }
                default:
                  return fail6(`Fulfillment: ${res.hint}`);
              }
            }
            case "analytics": {
              switch (act) {
                case "dashboard":
                  return ok(j(await api(API_URL, `${res.path}/dashboard/daily`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "topline":
                  return ok(j(await api(API_URL, `${res.path}/topline`)));
                case "events":
                  return ok(j(await api(API_URL, "/v1/analytics/events", { method: "POST", body: JSON.stringify(args.data || {}) })));
                default:
                  return fail6(`Analytics: ${res.hint}`);
              }
            }
            case "coupons": {
              if (act === "generate_codes") {
                if (!args.id)
                  return fail6("coupon id required");
                return ok(j(await api(API_URL, `${res.path}/${args.id}/codes`, { method: "POST", body: JSON.stringify({ count: args.count || 10 }) })));
              }
              return fail6(`Coupons: ${res.hint}`);
            }
            case "promotions": {
              if (act === "evaluate") {
                return ok(j(await api(API_URL, `${res.path}/evaluate`, { method: "POST", body: JSON.stringify(args.data || {}) })));
              }
              return fail6(`Promotions: ${res.hint}`);
            }
            case "pricing": {
              switch (act) {
                case "calculate":
                  return ok(j(await api(API_URL, `${res.path}/calculate`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "rules":
                  return ok(j(await api(API_URL, "/v1/pricing-rules")));
                case "create_rule":
                  return ok(j(await api(API_URL, "/v1/pricing-rules", { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "update_rule": {
                  if (!args.id)
                    return fail6("rule id required");
                  return ok(j(await api(API_URL, `/v1/pricing-rules/${args.id}`, { method: "PATCH", body: JSON.stringify(args.data || {}) })));
                }
                case "delete_rule": {
                  if (!args.id)
                    return fail6("rule id required");
                  await api(API_URL, `/v1/pricing-rules/${args.id}`, { method: "DELETE" });
                  return ok(`Deleted rule: ${args.id}`);
                }
                default:
                  return fail6(`Pricing: ${res.hint}`);
              }
            }
            case "tax": {
              switch (act) {
                case "calculate":
                  return ok(j(await api(API_URL, `${res.path}/calculate`, { method: "POST", body: JSON.stringify(args.data || {}) })));
                case "rates":
                  return ok(j(await api(API_URL, "/v1/tax-rates")));
                case "regions":
                  return ok(j(await api(API_URL, "/v1/tax-regions")));
                default:
                  return fail6(`Tax: ${res.hint}`);
              }
            }
            case "affiliates": {
              if (act === "connect") {
                if (!args.id)
                  return fail6("affiliate id required");
                return ok(j(await api(API_URL, `${res.path}/${args.id}/connect`)));
              }
              return fail6(`Affiliates: ${res.hint}`);
            }
            default:
              return fail6(`Unknown resource: ${args.resource}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    storageTool = {
      name: "storage",
      description: "Object storage: list/create/delete buckets, list/upload/download/delete objects, presign URLs, copy",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "list_buckets",
            "create_bucket",
            "delete_bucket",
            "list_objects",
            "get_object",
            "delete_object",
            "presign",
            "copy",
            "metadata"
          ] },
          bucket: { type: "string" },
          key: { type: "string", description: "Object key/path" },
          prefix: { type: "string", default: "" },
          content: { type: "string", description: "Content to upload (text)" },
          contentType: { type: "string", default: "application/octet-stream" },
          destination: { type: "string", description: "Destination key (copy)" },
          destBucket: { type: "string", description: "Destination bucket (copy)" },
          expiry: { type: "number", description: "Presign URL expiry in seconds", default: 3600 },
          limit: { type: "number", default: 100 },
          region: { type: "string" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          switch (args.action) {
            case "list_buckets": {
              const d = arr(await api(API_URL, "/v1/storage/buckets"), "buckets");
              return ok(`Buckets (${d.length}):
${d.map((x) => `${x.name || x.id}: ${x.region || ""} ${x.createdAt || ""}`).join("\n")}`);
            }
            case "create_bucket": {
              if (!args.bucket)
                return fail6("bucket name required");
              return ok(j(await api(API_URL, "/v1/storage/buckets", { method: "POST", body: JSON.stringify({ name: args.bucket, region: args.region }) })));
            }
            case "delete_bucket": {
              if (!args.bucket)
                return fail6("bucket required");
              await api(API_URL, `/v1/storage/buckets/${args.bucket}`, { method: "DELETE" });
              return ok(`Deleted bucket: ${args.bucket}`);
            }
            case "list_objects": {
              if (!args.bucket)
                return fail6("bucket required");
              const d = arr(await api(API_URL, `/v1/storage/buckets/${args.bucket}/objects?prefix=${encodeURIComponent(args.prefix || "")}&limit=${args.limit || 100}`), "objects");
              return ok(`Objects (${d.length}):
${d.map((x) => `${x.key || x.name}: ${x.size || 0}b ${x.lastModified || ""}`).join("\n")}`);
            }
            case "get_object": {
              if (!args.bucket || !args.key)
                return fail6("bucket and key required");
              const d = await api(API_URL, `/v1/storage/buckets/${args.bucket}/objects/${encodeURIComponent(args.key)}`);
              return ok(typeof d === "string" ? d : j(d));
            }
            case "delete_object": {
              if (!args.bucket || !args.key)
                return fail6("bucket and key required");
              await api(API_URL, `/v1/storage/buckets/${args.bucket}/objects/${encodeURIComponent(args.key)}`, { method: "DELETE" });
              return ok(`Deleted: ${args.bucket}/${args.key}`);
            }
            case "presign": {
              if (!args.bucket || !args.key)
                return fail6("bucket and key required");
              return ok(j(await api(API_URL, `/v1/storage/buckets/${args.bucket}/objects/${encodeURIComponent(args.key)}/presign`, { method: "POST", body: JSON.stringify({ expiry: args.expiry || 3600 }) })));
            }
            case "copy": {
              if (!args.bucket || !args.key || !args.destination)
                return fail6("bucket, key, destination required");
              return ok(j(await api(API_URL, `/v1/storage/buckets/${args.bucket}/objects/${encodeURIComponent(args.key)}/copy`, { method: "POST", body: JSON.stringify({ destination: args.destination, destBucket: args.destBucket || args.bucket }) })));
            }
            case "metadata": {
              if (!args.bucket || !args.key)
                return fail6("bucket and key required");
              return ok(j(await api(API_URL, `/v1/storage/buckets/${args.bucket}/objects/${encodeURIComponent(args.key)}/metadata`)));
            }
            default:
              return fail6(`Unknown action: ${args.action}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    authTool = {
      name: "auth",
      description: "Authentication (canonical OIDC, HIP-0111): whoami/token/account read claims from /v1/iam/oauth/userinfo; refresh exchanges a refresh_token at /v1/iam/oauth/token; logout. Token issuance is via OAuth2 authorization-code + PKCE only.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "whoami",
            "token",
            "account",
            "login",
            "logout",
            "refresh",
            "sessions",
            "permissions",
            "mfa"
          ] },
          refreshToken: { type: "string" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          switch (args.action) {
            case "whoami":
            case "token":
            case "account":
              return ok(j(await api(IAM_URL, "/v1/iam/oauth/userinfo")));
            case "login":
              return fail6("login: use OAuth2 authorization-code + PKCE via /v1/iam/oauth/authorize \u2014 password login is not supported (HIP-0111)");
            case "logout":
              return ok(j(await api(IAM_URL, "/v1/iam/oauth/logout", { method: "POST" })));
            case "refresh": {
              if (!args.refreshToken)
                return fail6("refreshToken required");
              return ok(j(await api(IAM_URL, "/v1/iam/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: args.refreshToken }).toString() })));
            }
            case "sessions":
            case "permissions":
            case "mfa":
              return fail6(`${args.action}: not available via canonical OIDC (HIP-0111); inspect token claims or use the IAM admin API`);
            default:
              return fail6(`Unknown action: ${args.action}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    apiTool = {
      name: "api",
      description: "Hanzo API & LLM gateway: models, chat, embeddings, images, audio, files, fine-tuning, usage",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "models",
            "chat",
            "embeddings",
            "images",
            "audio",
            "files",
            "upload_file",
            "fine_tunes",
            "create_fine_tune",
            "usage",
            "health"
          ] },
          message: { type: "string" },
          model: { type: "string", default: "auto" },
          messages: { type: "array", items: { type: "object" }, description: "Full messages array" },
          system: { type: "string" },
          maxTokens: { type: "number", default: 1e3 },
          temperature: { type: "number" },
          topP: { type: "number" },
          input: { type: "string", description: "Text for embeddings" },
          prompt: { type: "string", description: "Prompt for images/audio" },
          size: { type: "string", description: "Image size (256x256, 512x512, 1024x1024)" },
          fileId: { type: "string" },
          purpose: { type: "string", default: "fine-tune" },
          data: { type: "object", description: "Additional request data" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          switch (args.action) {
            case "models": {
              const d = await api(API_URL, "/v1/models");
              const m = d?.data || [];
              const grouped = {};
              for (const x of m) {
                const owner = x.owned_by || "other";
                grouped[owner] = (grouped[owner] || 0) + 1;
              }
              const summary = Object.entries(grouped).map(([k, v]) => `${k}: ${v}`).join(", ");
              return ok(`Models (${m.length}): ${summary}

Top 30:
${m.slice(0, 30).map((x) => `${x.id}: ${x.owned_by || ""}`).join("\n")}${m.length > 30 ? `
... +${m.length - 30} more` : ""}`);
            }
            case "chat": {
              if (!args.message && !args.messages)
                return fail6("message or messages required");
              const msgs = args.messages || [];
              if (!args.messages) {
                if (args.system)
                  msgs.push({ role: "system", content: args.system });
                msgs.push({ role: "user", content: args.message });
              }
              const body = { model: args.model || "auto", messages: msgs, max_tokens: args.maxTokens || 1e3 };
              if (args.temperature !== void 0)
                body.temperature = args.temperature;
              if (args.topP !== void 0)
                body.top_p = args.topP;
              const d = await api(API_URL, "/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });
              const txt = d?.choices?.[0]?.message?.content || "(empty)";
              const u = d?.usage;
              return ok(txt + (u ? `

[${d?.model || args.model} | ${u.prompt_tokens}+${u.completion_tokens} tokens]` : ""));
            }
            case "embeddings": {
              if (!args.input)
                return fail6("input required");
              const d = await api(API_URL, "/v1/embeddings", { method: "POST", body: JSON.stringify({ model: args.model || "text-embedding-3-small", input: args.input }) });
              const emb = d?.data?.[0]?.embedding || [];
              return ok(`Embedding (${emb.length} dims): [${emb.slice(0, 5).map((x) => x.toFixed(4)).join(", ")}...]`);
            }
            case "images": {
              if (!args.prompt)
                return fail6("prompt required");
              return ok(j(await api(API_URL, "/v1/images/generations", { method: "POST", body: JSON.stringify({ model: args.model || "dall-e-3", prompt: args.prompt, size: args.size || "1024x1024", ...args.data || {} }) })));
            }
            case "audio": {
              if (!args.input)
                return fail6("input required");
              return ok(j(await api(API_URL, "/v1/audio/speech", { method: "POST", body: JSON.stringify({ model: args.model || "tts-1", input: args.input, ...args.data || {} }) })));
            }
            case "files":
              return ok(j(await api(API_URL, "/v1/files")));
            case "upload_file": {
              if (!args.data)
                return fail6("data required with file content");
              return ok(j(await api(API_URL, "/v1/files", { method: "POST", body: JSON.stringify({ purpose: args.purpose || "fine-tune", ...args.data }) })));
            }
            case "fine_tunes":
              return ok(j(await api(API_URL, "/v1/fine_tuning/jobs")));
            case "create_fine_tune": {
              if (!args.fileId)
                return fail6("fileId required");
              return ok(j(await api(API_URL, "/v1/fine_tuning/jobs", { method: "POST", body: JSON.stringify({ model: args.model || "gpt-4o-mini-2024-07-18", training_file: args.fileId, ...args.data || {} }) })));
            }
            case "usage":
              return ok(j(await api(API_URL, "/v1/usage")));
            case "health":
              return ok(j(await api(API_URL, "/health")));
            default:
              return fail6(`Unknown action: ${args.action}`);
          }
        } catch (e) {
          return fail6(e.message);
        }
      }
    };
    iamTools = [iamTool];
    kmsTools = [kmsTool];
    paasTools = [paasTool];
    commerceTools = [commerceTool];
    storageTools = [storageTool];
    authTools = [authTool];
    apiTools = [apiTool];
    billingTool = commerceTool;
    billingTools = [commerceTool];
    hanzoCloudTools = [
      iamTool,
      kmsTool,
      paasTool,
      commerceTool,
      storageTool,
      authTool,
      apiTool
    ];
  }
});

// src/tools/unified/hanzo.ts
function envelope6(data, action) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, data, error: null, meta: { tool: "hanzo", action } }, null, 2) }] };
}
function fail7(code, message) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, data: null, error: { code, message }, meta: { tool: "hanzo" } }, null, 2) }], isError: true };
}
var cloudToolMap, RESOURCES, hanzoTool;
var init_hanzo = __esm({
  "src/tools/unified/hanzo.ts"() {
    "use strict";
    init_hanzo_cloud();
    cloudToolMap = new Map(hanzoCloudTools.map((t) => [t.name, t]));
    RESOURCES = ["iam", "kms", "paas", "commerce", "storage", "auth", "api"];
    hanzoTool = {
      name: "hanzo",
      description: "Hanzo platform: iam, kms, paas, commerce, storage, auth, api \u2014 specify resource to see actions",
      inputSchema: {
        type: "object",
        properties: {
          resource: { type: "string", enum: [...RESOURCES], description: "Platform resource (iam, kms, paas, commerce, storage, auth, api)" },
          action: { type: "string", description: "Resource action" },
          // Pass-through params for cloud tools
          id: { type: "string" },
          data: { type: "object" },
          query: { type: "string" },
          method: { type: "string" },
          path: { type: "string" },
          body: { type: "object" },
          // Commerce sub-routing
          sub_resource: { type: "string" },
          // General
          limit: { type: "number" },
          offset: { type: "number" }
        },
        required: []
      },
      handler: async (args) => {
        try {
          if (!args.resource) {
            return envelope6({
              resources: RESOURCES.map((r) => r),
              hint: 'Call hanzo(resource="iam") to see available actions for that resource'
            }, "list");
          }
          const tool = cloudToolMap.get(args.resource);
          if (!tool)
            return fail7("NOT_FOUND", `Unknown resource: ${args.resource}. Available: ${RESOURCES.join(", ")}`);
          return await tool.handler(args);
        } catch (error) {
          return fail7("ERROR", error.message);
        }
      }
    };
  }
});

// src/tools/unified/index.ts
var coreTools, optionalTools, allUnifiedTools;
var init_unified = __esm({
  "src/tools/unified/index.ts"() {
    "use strict";
    init_fs();
    init_exec();
    init_code();
    init_fetch();
    init_workspace();
    init_git();
    init_unified_ui();
    init_think();
    init_memory();
    init_plan();
    init_tasks();
    init_mode_preset();
    init_hanzo();
    init_fs();
    init_exec();
    init_code();
    init_fetch();
    init_workspace();
    init_hanzo();
    coreTools = [
      fsTool,
      // Bytes + Paths
      execTool,
      // Execution
      codeTool,
      // Symbols + Semantics
      gitTool,
      // Diffs + History
      fetchTool,
      // HTTP/API
      workspaceTool,
      // Project Context
      unifiedUITool
      // UI Components
    ];
    optionalTools = [
      thinkTool,
      // Structured reasoning
      memoryTool,
      // Persistent storage
      hanzoTool,
      // Hanzo platform (iam/kms/paas/commerce/storage/auth/api)
      planTool,
      // Task planning
      tasksTool,
      // Task tracking
      modeTool
      // Developer modes
    ];
    allUnifiedTools = [
      ...coreTools,
      ...optionalTools
    ];
  }
});

// src/tools/file-ops.ts
import * as fs8 from "fs/promises";
import * as path8 from "path";
import { glob as glob3 } from "glob";
var readFileTool, writeFileTool, listFilesTool, getFileInfoTool, directoryTreeTool, fileTools;
var init_file_ops = __esm({
  "src/tools/file-ops.ts"() {
    "use strict";
    readFileTool = {
      name: "read",
      description: "Read the contents of a file",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to read"
          },
          encoding: {
            type: "string",
            description: "The encoding to use (default: utf8)",
            default: "utf8"
          }
        },
        required: ["path"]
      },
      handler: async (args) => {
        try {
          const content = await fs8.readFile(args.path, args.encoding || "utf8");
          return {
            content: [{
              type: "text",
              text: content.toString()
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error reading file: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    writeFileTool = {
      name: "write",
      description: "Write content to a file",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to write"
          },
          content: {
            type: "string",
            description: "The content to write to the file"
          },
          encoding: {
            type: "string",
            description: "The encoding to use (default: utf8)",
            default: "utf8"
          }
        },
        required: ["path", "content"]
      },
      handler: async (args) => {
        try {
          await fs8.mkdir(path8.dirname(args.path), { recursive: true });
          await fs8.writeFile(args.path, args.content, args.encoding || "utf8");
          return {
            content: [{
              type: "text",
              text: `File written successfully: ${args.path}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error writing file: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    listFilesTool = {
      name: "list",
      description: "List files in a directory",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path to list",
            default: "."
          },
          recursive: {
            type: "boolean",
            description: "Whether to list files recursively",
            default: false
          },
          pattern: {
            type: "string",
            description: "Glob pattern to filter files"
          }
        }
      },
      handler: async (args) => {
        try {
          const dirPath = args.path || ".";
          if (args.pattern) {
            const files2 = await glob3(args.pattern, {
              cwd: dirPath,
              nodir: false
            });
            return {
              content: [{
                type: "text",
                text: files2.join("\n")
              }]
            };
          }
          const entries = await fs8.readdir(dirPath, { withFileTypes: true });
          const files = entries.map((entry) => {
            const prefix = entry.isDirectory() ? "[DIR] " : "";
            return prefix + entry.name;
          });
          return {
            content: [{
              type: "text",
              text: files.join("\n")
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error listing files: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    getFileInfoTool = {
      name: "info",
      description: "Get metadata about a file or directory",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to get info for"
          }
        },
        required: ["path"]
      },
      handler: async (args) => {
        try {
          const stats = await fs8.stat(args.path);
          const info = {
            path: args.path,
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            lastModified: stats.mtime,
            permissions: stats.mode.toString(8)
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(info, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting file info: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    directoryTreeTool = {
      name: "tree",
      description: "Display a tree view of directory structure",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path to display",
            default: "."
          },
          maxDepth: {
            type: "number",
            description: "Maximum depth to traverse",
            default: 3
          },
          showHidden: {
            type: "boolean",
            description: "Whether to show hidden files",
            default: false
          }
        }
      },
      handler: async (args) => {
        const buildTree = async (dir, prefix = "", depth = 0) => {
          if (depth >= (args.maxDepth || 3))
            return "";
          try {
            const entries = await fs8.readdir(dir, { withFileTypes: true });
            const filtered = args.showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
            let tree = "";
            for (let i = 0; i < filtered.length; i++) {
              const entry = filtered[i];
              const isLast = i === filtered.length - 1;
              const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
              const extension = isLast ? "    " : "\u2502   ";
              tree += prefix + connector + entry.name + "\n";
              if (entry.isDirectory()) {
                const subPath = path8.join(dir, entry.name);
                tree += await buildTree(subPath, prefix + extension, depth + 1);
              }
            }
            return tree;
          } catch (error) {
            if (depth === 0)
              throw error;
            return prefix + "\u2514\u2500\u2500 [Error reading directory]\n";
          }
        };
        try {
          const tree = await buildTree(args.path || ".");
          return {
            content: [{
              type: "text",
              text: (args.path || ".") + "\n" + tree
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error building tree: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    fileTools = [
      readFileTool,
      writeFileTool,
      listFilesTool,
      getFileInfoTool,
      directoryTreeTool
    ];
  }
});

// src/tools/search.ts
import { exec as exec8 } from "child_process";
import { promisify as promisify8 } from "util";
import { glob as glob4 } from "glob";
import * as path9 from "path";
var execAsync8, hasRipgrep, grepTool, findFilesTool, searchTool, searchTools;
var init_search = __esm({
  "src/tools/search.ts"() {
    "use strict";
    execAsync8 = promisify8(exec8);
    hasRipgrep = async () => {
      try {
        await execAsync8(process.platform === "win32" ? "where rg" : "which rg");
        return true;
      } catch {
        return false;
      }
    };
    grepTool = {
      name: "grep",
      description: "Search for patterns in files using grep or ripgrep",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The pattern to search for (regex supported)"
          },
          path: {
            type: "string",
            description: "The path to search in",
            default: "."
          },
          filePattern: {
            type: "string",
            description: 'File pattern to include (e.g., "*.ts")'
          },
          ignoreCase: {
            type: "boolean",
            description: "Case insensitive search",
            default: false
          },
          showLineNumbers: {
            type: "boolean",
            description: "Show line numbers",
            default: true
          },
          contextLines: {
            type: "number",
            description: "Number of context lines to show",
            default: 0
          }
        },
        required: ["pattern"]
      },
      handler: async (args) => {
        try {
          const useRipgrep = await hasRipgrep();
          let command;
          if (useRipgrep) {
            command = "rg";
            if (args.ignoreCase)
              command += " -i";
            if (args.showLineNumbers)
              command += " -n";
            if (args.contextLines > 0)
              command += ` -C ${args.contextLines}`;
            if (args.filePattern)
              command += ` -g "${args.filePattern}"`;
            command += ` "${args.pattern}" "${args.path || "."}"`;
          } else {
            command = "grep -r";
            if (args.ignoreCase)
              command += " -i";
            if (args.showLineNumbers)
              command += " -n";
            if (args.contextLines > 0)
              command += ` -C ${args.contextLines}`;
            if (args.filePattern)
              command += ` --include="${args.filePattern}"`;
            command += ` "${args.pattern}" "${args.path || "."}"`;
          }
          const { stdout } = await execAsync8(command);
          return {
            content: [{
              type: "text",
              text: stdout || "No matches found"
            }]
          };
        } catch (error) {
          if (error.code === 1) {
            return {
              content: [{
                type: "text",
                text: "No matches found"
              }]
            };
          }
          return {
            content: [{
              type: "text",
              text: `Error searching: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    findFilesTool = {
      name: "find",
      description: "Find files by name pattern",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The file name pattern to search for (glob supported)"
          },
          path: {
            type: "string",
            description: "The directory to search in",
            default: "."
          },
          type: {
            type: "string",
            description: 'Filter by type: "file" or "directory"'
          },
          maxDepth: {
            type: "number",
            description: "Maximum directory depth to search"
          }
        },
        required: ["pattern"]
      },
      handler: async (args) => {
        try {
          const globPattern = path9.join(args.path || ".", "**", args.pattern);
          const opts = { maxDepth: args.maxDepth };
          if (args.type === "file")
            opts.nodir = true;
          const files = await glob4(globPattern, opts);
          if (files.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No files found matching the pattern"
              }]
            };
          }
          return {
            content: [{
              type: "text",
              text: files.join("\n")
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error finding files: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    searchTool = {
      name: "search",
      description: "Unified search that combines multiple search strategies",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query"
          },
          path: {
            type: "string",
            description: "The path to search in",
            default: "."
          },
          type: {
            type: "string",
            description: 'Type of search: "all", "code", "text", "filename"',
            default: "all"
          },
          filePattern: {
            type: "string",
            description: "File pattern to include"
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results",
            default: 50
          }
        },
        required: ["query"]
      },
      handler: async (args) => {
        const results = [];
        const searchType = args.type || "all";
        try {
          if (searchType === "all" || searchType === "filename") {
            const filePattern = `*${args.query}*`;
            const globPattern = path9.join(args.path || ".", "**", filePattern);
            const files = await glob4(globPattern, { maxDepth: 5 });
            if (files.length > 0) {
              results.push("=== Filename Matches ===");
              results.push(...files.slice(0, args.maxResults || 50));
              results.push("");
            }
          }
          if (searchType === "all" || searchType === "code" || searchType === "text") {
            const useRipgrep = await hasRipgrep();
            let command;
            if (useRipgrep) {
              command = `rg -n --max-count ${args.maxResults || 50}`;
              if (args.filePattern)
                command += ` -g "${args.filePattern}"`;
              command += ` "${args.query}" "${args.path || "."}"`;
            } else {
              command = `grep -r -n`;
              if (args.filePattern)
                command += ` --include="${args.filePattern}"`;
              command += ` "${args.query}" "${args.path || "."}" | head -${args.maxResults || 50}`;
            }
            try {
              const { stdout } = await execAsync8(command);
              if (stdout) {
                results.push("=== Content Matches ===");
                results.push(stdout.trim());
              }
            } catch (error) {
              if (error.code !== 1) {
                throw error;
              }
            }
          }
          if (results.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No matches found"
              }]
            };
          }
          return {
            content: [{
              type: "text",
              text: results.join("\n")
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error searching: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    searchTools = [
      grepTool,
      findFilesTool,
      searchTool
    ];
  }
});

// src/tools/shell.ts
import { exec as exec9, spawn as spawn2 } from "child_process";
import { promisify as promisify9 } from "util";
var execAsync9, backgroundProcesses, bashTool, runBackgroundTool, listProcessesTool, getProcessOutputTool, killProcessTool, shellTools;
var init_shell = __esm({
  "src/tools/shell.ts"() {
    "use strict";
    execAsync9 = promisify9(exec9);
    backgroundProcesses = /* @__PURE__ */ new Map();
    bashTool = {
      name: "bash",
      description: "Execute a bash command",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute"
          },
          cwd: {
            type: "string",
            description: "Working directory for the command"
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds",
            default: 3e4
          },
          env: {
            type: "object",
            description: "Environment variables"
          }
        },
        required: ["command"]
      },
      handler: async (args) => {
        try {
          const options = {
            cwd: args.cwd,
            timeout: args.timeout || 3e4,
            env: { ...process.env, ...args.env },
            maxBuffer: 10 * 1024 * 1024
            // 10MB
          };
          const { stdout, stderr } = await execAsync9(args.command, options);
          let output = "";
          if (stdout)
            output += stdout;
          if (stderr)
            output += "\n[stderr]\n" + stderr;
          return {
            content: [{
              type: "text",
              text: output || "Command completed with no output"
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error executing command: ${error.message}
${error.stdout || ""}
${error.stderr || ""}`
            }],
            isError: true
          };
        }
      }
    };
    runBackgroundTool = {
      name: "bg",
      description: "Run a command in the background",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to run in background"
          },
          id: {
            type: "string",
            description: "Unique ID for this background process"
          },
          cwd: {
            type: "string",
            description: "Working directory"
          }
        },
        required: ["command", "id"]
      },
      handler: async (args) => {
        try {
          if (backgroundProcesses.has(args.id)) {
            return {
              content: [{
                type: "text",
                text: `Process with ID ${args.id} already exists`
              }],
              isError: true
            };
          }
          const [cmd, ...cmdArgs] = args.command.split(" ");
          const proc = spawn2(cmd, cmdArgs, {
            cwd: args.cwd,
            detached: true,
            stdio: "pipe"
          });
          backgroundProcesses.set(args.id, {
            process: proc,
            output: [],
            error: []
          });
          const procData = backgroundProcesses.get(args.id);
          proc.stdout?.on("data", (data) => {
            procData.output.push(data.toString());
          });
          proc.stderr?.on("data", (data) => {
            procData.error.push(data.toString());
          });
          proc.on("exit", (code) => {
            procData.exitCode = code;
          });
          return {
            content: [{
              type: "text",
              text: `Background process started with ID: ${args.id}, PID: ${proc.pid}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error starting background process: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    listProcessesTool = {
      name: "ps",
      description: "List running background processes",
      inputSchema: {
        type: "object",
        properties: {}
      },
      handler: async () => {
        const processes2 = [];
        for (const [id, data] of backgroundProcesses.entries()) {
          processes2.push({
            id,
            pid: data.process.pid,
            running: data.exitCode === void 0,
            exitCode: data.exitCode
          });
        }
        if (processes2.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No background processes running"
            }]
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(processes2, null, 2)
          }]
        };
      }
    };
    getProcessOutputTool = {
      name: "logs",
      description: "Get output from a background process",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The process ID"
          },
          tail: {
            type: "number",
            description: "Number of lines to show from the end",
            default: 50
          }
        },
        required: ["id"]
      },
      handler: async (args) => {
        const procData = backgroundProcesses.get(args.id);
        if (!procData) {
          return {
            content: [{
              type: "text",
              text: `No process found with ID: ${args.id}`
            }],
            isError: true
          };
        }
        const output = procData.output.slice(-(args.tail || 50)).join("");
        const error = procData.error.slice(-(args.tail || 50)).join("");
        let result = "";
        if (output)
          result += "Output:\n" + output;
        if (error)
          result += "\nError:\n" + error;
        if (!output && !error)
          result = "No output yet";
        return {
          content: [{
            type: "text",
            text: result
          }]
        };
      }
    };
    killProcessTool = {
      name: "kill",
      description: "Kill a background process",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The process ID to kill"
          }
        },
        required: ["id"]
      },
      handler: async (args) => {
        const procData = backgroundProcesses.get(args.id);
        if (!procData) {
          return {
            content: [{
              type: "text",
              text: `No process found with ID: ${args.id}`
            }],
            isError: true
          };
        }
        try {
          procData.process.kill();
          backgroundProcesses.delete(args.id);
          return {
            content: [{
              type: "text",
              text: `Process ${args.id} killed`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error killing process: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    shellTools = [
      bashTool,
      runBackgroundTool,
      listProcessesTool,
      getProcessOutputTool,
      killProcessTool
    ];
  }
});

// src/tools/edit.ts
import * as fs9 from "fs/promises";
import * as path10 from "path";
var editFileTool, multiEditTool, createFileTool, deleteFileTool, moveFileTool, editTools;
var init_edit = __esm({
  "src/tools/edit.ts"() {
    "use strict";
    editFileTool = {
      name: "edit",
      description: "Replace text in a file",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to edit"
          },
          oldText: {
            type: "string",
            description: "The exact text to replace"
          },
          newText: {
            type: "string",
            description: "The new text to insert"
          }
        },
        required: ["path", "oldText", "newText"]
      },
      handler: async (args) => {
        try {
          const content = await fs9.readFile(args.path, "utf8");
          if (!content.includes(args.oldText)) {
            return {
              content: [{
                type: "text",
                text: "Error: oldText not found in file. Make sure it matches exactly, including whitespace."
              }],
              isError: true
            };
          }
          const occurrences = content.split(args.oldText).length - 1;
          if (occurrences > 1) {
            return {
              content: [{
                type: "text",
                text: `Error: oldText found ${occurrences} times. Please make it unique by including more context.`
              }],
              isError: true
            };
          }
          const newContent = content.replace(args.oldText, args.newText);
          await fs9.writeFile(args.path, newContent, "utf8");
          return {
            content: [{
              type: "text",
              text: `Successfully replaced text in ${args.path}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error editing file: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    multiEditTool = {
      name: "patch",
      description: "Make multiple edits to a file in one operation",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to edit"
          },
          edits: {
            type: "array",
            description: "Array of edit operations",
            items: {
              type: "object",
              properties: {
                oldText: {
                  type: "string",
                  description: "The exact text to replace"
                },
                newText: {
                  type: "string",
                  description: "The new text to insert"
                }
              },
              required: ["oldText", "newText"]
            }
          }
        },
        required: ["path", "edits"]
      },
      handler: async (args) => {
        try {
          let content = await fs9.readFile(args.path, "utf8");
          const results = [];
          for (const edit of args.edits) {
            if (!content.includes(edit.oldText)) {
              results.push(`\u274C oldText not found: "${edit.oldText.substring(0, 50)}..."`);
              continue;
            }
            const occurrences = content.split(edit.oldText).length - 1;
            if (occurrences > 1) {
              results.push(`\u274C oldText found ${occurrences} times: "${edit.oldText.substring(0, 50)}..."`);
              continue;
            }
            content = content.replace(edit.oldText, edit.newText);
            results.push(`\u2713 Replaced: "${edit.oldText.substring(0, 30)}..." \u2192 "${edit.newText.substring(0, 30)}..."`);
          }
          await fs9.writeFile(args.path, content, "utf8");
          return {
            content: [{
              type: "text",
              text: `Edits completed in ${args.path}:
${results.join("\n")}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error in multi-edit: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    createFileTool = {
      name: "create",
      description: "Create a new file with content",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path for the new file"
          },
          content: {
            type: "string",
            description: "The content for the new file"
          },
          overwrite: {
            type: "boolean",
            description: "Whether to overwrite if file exists",
            default: false
          }
        },
        required: ["path", "content"]
      },
      handler: async (args) => {
        try {
          try {
            await fs9.access(args.path);
            if (!args.overwrite) {
              return {
                content: [{
                  type: "text",
                  text: `Error: File already exists. Use overwrite: true to replace it.`
                }],
                isError: true
              };
            }
          } catch {
          }
          const dir = path10.dirname(args.path);
          await fs9.mkdir(dir, { recursive: true });
          await fs9.writeFile(args.path, args.content, "utf8");
          return {
            content: [{
              type: "text",
              text: `File created: ${args.path}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error creating file: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    deleteFileTool = {
      name: "delete",
      description: "Delete a file or empty directory",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to delete"
          },
          recursive: {
            type: "boolean",
            description: "Delete directories recursively",
            default: false
          }
        },
        required: ["path"]
      },
      handler: async (args) => {
        try {
          const stats = await fs9.stat(args.path);
          if (stats.isDirectory()) {
            if (args.recursive) {
              await fs9.rm(args.path, { recursive: true, force: true });
            } else {
              await fs9.rmdir(args.path);
            }
          } else {
            await fs9.unlink(args.path);
          }
          return {
            content: [{
              type: "text",
              text: `Deleted: ${args.path}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error deleting: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    moveFileTool = {
      name: "move",
      description: "Move or rename a file or directory",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "The source path"
          },
          destination: {
            type: "string",
            description: "The destination path"
          },
          overwrite: {
            type: "boolean",
            description: "Overwrite destination if it exists",
            default: false
          }
        },
        required: ["source", "destination"]
      },
      handler: async (args) => {
        try {
          try {
            await fs9.access(args.destination);
            if (!args.overwrite) {
              return {
                content: [{
                  type: "text",
                  text: `Error: Destination already exists. Use overwrite: true to replace it.`
                }],
                isError: true
              };
            }
          } catch {
          }
          const destDir = path10.dirname(args.destination);
          await fs9.mkdir(destDir, { recursive: true });
          await fs9.rename(args.source, args.destination);
          return {
            content: [{
              type: "text",
              text: `Moved: ${args.source} \u2192 ${args.destination}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error moving file: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    editTools = [
      editFileTool,
      multiEditTool,
      createFileTool,
      deleteFileTool,
      moveFileTool
    ];
  }
});

// src/tools/ast-search.ts
import * as fs10 from "fs/promises";
import * as path11 from "path";
import { glob as glob5 } from "glob";
async function getFiles(p, pattern) {
  const s = await fs10.stat(p).catch(() => null);
  if (s?.isFile())
    return [p];
  const pats = pattern ? [pattern] : ["**/*.js", "**/*.ts", "**/*.tsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/*.rb", "**/*.php", "**/*.c", "**/*.cpp", "**/*.h"];
  const files = [];
  for (const pat of pats)
    files.push(...await glob5(path11.join(p, pat), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/target/**", "**/build/**"], maxDepth: 10 }));
  return files;
}
var PATTERNS, astTool, astTools;
var init_ast_search = __esm({
  "src/tools/ast-search.ts"() {
    "use strict";
    PATTERNS = {
      function_declaration: [/function\s+(\w+)\s*\(/, /def\s+(\w+)\s*\(/, /fn\s+(\w+)\s*\(/, /func\s+(\w+)\s*\(/],
      class_definition: [/class\s+(\w+)/, /struct\s+(\w+)/, /interface\s+(\w+)/],
      method_call: [/(\w+)\s*\.\s*(\w+)\s*\(/, /(\w+)::\s*(\w+)\s*\(/],
      import_statement: [/import\s+.+\s+from\s+['"]/, /import\s+['"]/, /require\s*\(['"]/, /use\s+\w+/, /import\s+\w+/],
      variable_declaration: [/(let|const|var)\s+(\w+)/, /(\w+)\s*:=\s*/, /let\s+(mut\s+)?(\w+)/],
      type_definition: [/type\s+(\w+)\s*=/, /interface\s+(\w+)/, /enum\s+(\w+)/, /typedef\s+/],
      decorator: [/@\w+/, /#\[\w+/],
      export_statement: [/export\s+(default\s+)?(function|class|const|let|var|type|interface|enum)\s+(\w+)/]
    };
    astTool = {
      name: "ast",
      description: "Code intelligence: search patterns, find symbols, analyze dependencies, outline file structure, metrics, list exports/types/calls, class hierarchy",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "search",
            "find_symbol",
            "dependencies",
            "outline",
            "metrics",
            "exports",
            "types",
            "calls",
            "hierarchy"
          ], description: "AST action" },
          pattern: { type: "string", description: "AST pattern (function_declaration, class_definition, etc.) or regex" },
          symbol: { type: "string", description: "Symbol name to find" },
          type: { type: "string", enum: ["all", "function", "class", "variable", "method", "type"], default: "all" },
          path: { type: "string", default: "." },
          file: { type: "string", description: "Specific file (outline, metrics)" },
          filePattern: { type: "string", description: 'File glob filter (e.g., "**/*.ts")' },
          exact: { type: "boolean", default: false },
          maxResults: { type: "number", default: 50 },
          showExternal: { type: "boolean", default: true },
          showInternal: { type: "boolean", default: true },
          depth: { type: "number", description: "Hierarchy depth", default: 3 }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const results = [];
          switch (args.action) {
            case "search": {
              if (!args.pattern)
                return { content: [{ type: "text", text: "pattern required. Built-in: " + Object.keys(PATTERNS).join(", ") }], isError: true };
              const files = await getFiles(args.path || ".", args.filePattern);
              const pats = PATTERNS[args.pattern] || [new RegExp(args.pattern, "g")];
              let total = 0;
              for (const f of files) {
                if (total >= (args.maxResults || 50))
                  break;
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                const matches = [];
                lines.forEach((line, i) => {
                  for (const re of pats)
                    if (re.test(line)) {
                      matches.push(`  ${i + 1}: ${line.trim()}`);
                      total++;
                      break;
                    }
                });
                if (matches.length)
                  results.push(`${f}:
${matches.join("\n")}`);
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n\n") : "No matches" }] };
            }
            case "find_symbol": {
              if (!args.symbol)
                return { content: [{ type: "text", text: "symbol required" }], isError: true };
              const files = await getFiles(args.path || ".", args.filePattern);
              const s = args.exact ? args.symbol : `\\w*${args.symbol}\\w*`;
              const typePats = {
                function: [new RegExp(`function\\s+${s}\\s*\\(`, "i"), new RegExp(`def\\s+${s}\\s*\\(`, "i"), new RegExp(`fn\\s+${s}\\s*\\(`, "i"), new RegExp(`func\\s+${s}\\s*\\(`, "i")],
                class: [new RegExp(`class\\s+${s}`, "i"), new RegExp(`struct\\s+${s}`, "i"), new RegExp(`interface\\s+${s}`, "i")],
                variable: [new RegExp(`(let|const|var)\\s+${s}\\s*[:=]`, "i")],
                method: [new RegExp(`\\.\\s*${s}\\s*\\(`, "i")],
                type: [new RegExp(`type\\s+${s}\\s*[={]`, "i"), new RegExp(`interface\\s+${s}`, "i"), new RegExp(`enum\\s+${s}`, "i")]
              };
              const pats = args.type === "all" ? Object.values(typePats).flat() : typePats[args.type || "all"] || [];
              for (const f of files) {
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                const matches = [];
                lines.forEach((line, i) => {
                  for (const p of pats)
                    if (p.test(line)) {
                      matches.push(`  ${i + 1}: ${line.trim()}`);
                      break;
                    }
                });
                if (matches.length)
                  results.push(`${f}:
${matches.join("\n")}`);
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n\n") : `Symbol '${args.symbol}' not found` }] };
            }
            case "dependencies": {
              const files = await getFiles(args.path || ".", args.filePattern);
              const importPats = [/import\s+.*\s+from\s+['"](.*)['"]/, /import\s+['"](.*)['"]/, /require\s*\(['"](.*)['"]\)/, /from\s+(\S+)\s+import/, /import\s+"(.*)"/, /use\s+(\S+);/];
              for (const f of files) {
                const deps = [];
                for (const line of (await fs10.readFile(f, "utf-8")).split("\n")) {
                  for (const p of importPats) {
                    const m = line.match(p);
                    if (m?.[1]) {
                      deps.push(m[1]);
                      break;
                    }
                  }
                }
                if (!deps.length)
                  continue;
                const ext = deps.filter((d) => !d.startsWith(".")), int = deps.filter((d) => d.startsWith("."));
                const out = [f + ":"];
                if (args.showExternal !== false && ext.length)
                  out.push("  External: " + ext.join(", "));
                if (args.showInternal !== false && int.length)
                  out.push("  Internal: " + int.join(", "));
                results.push(out.join("\n"));
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n") : "No dependencies found" }] };
            }
            case "outline": {
              const targetFile = args.file || args.path || ".";
              const files = await getFiles(targetFile, args.filePattern);
              for (const f of files.slice(0, 5)) {
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                const items = [];
                for (let i = 0; i < lines.length; i++) {
                  const l = lines[i];
                  const im = l.match(/^(import|from|use|require)/);
                  const ex = l.match(/export\s+(default\s+)?(async\s+)?(function|class|const|let|var|type|interface|enum)\s+(\w+)/);
                  const fn = l.match(/(?:async\s+)?(?:function|def|fn|func)\s+(\w+)\s*\(/);
                  const cl = l.match(/(class|struct|interface|trait|enum)\s+(\w+)/);
                  const tp = l.match(/(?:export\s+)?type\s+(\w+)\s*[={]/);
                  if (ex)
                    items.push(`  ${i + 1}: export ${ex[3]} ${ex[4]}`);
                  else if (cl)
                    items.push(`  ${i + 1}: ${cl[1]} ${cl[2]}`);
                  else if (fn && !im)
                    items.push(`  ${i + 1}: fn ${fn[1]}`);
                  else if (tp)
                    items.push(`  ${i + 1}: type ${tp[1]}`);
                }
                if (items.length)
                  results.push(`${f} (${lines.length} lines):
${items.join("\n")}`);
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n\n") : "No symbols found" }] };
            }
            case "metrics": {
              const files = await getFiles(args.file || args.path || ".", args.filePattern);
              let totalLines = 0, totalFiles = files.length, totalFuncs = 0, totalClasses = 0, totalImports = 0;
              const byExt = {};
              for (const f of files) {
                const content = await fs10.readFile(f, "utf-8");
                const lines = content.split("\n");
                const ext = path11.extname(f) || "other";
                if (!byExt[ext])
                  byExt[ext] = { files: 0, lines: 0 };
                byExt[ext].files++;
                byExt[ext].lines += lines.length;
                totalLines += lines.length;
                for (const l of lines) {
                  if (/(?:function|def|fn|func)\s+\w+\s*\(/.test(l))
                    totalFuncs++;
                  if (/(?:class|struct|interface)\s+\w+/.test(l))
                    totalClasses++;
                  if (/(?:import|require|use|from)\s/.test(l))
                    totalImports++;
                }
              }
              const extSummary = Object.entries(byExt).sort((a, b) => b[1].lines - a[1].lines).map(([ext, s]) => `  ${ext}: ${s.files} files, ${s.lines} lines`);
              return { content: [{ type: "text", text: `Metrics:
  Files: ${totalFiles}
  Lines: ${totalLines}
  Functions: ${totalFuncs}
  Classes: ${totalClasses}
  Imports: ${totalImports}

By extension:
${extSummary.join("\n")}` }] };
            }
            case "exports": {
              const files = await getFiles(args.path || ".", args.filePattern);
              for (const f of files) {
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                const exports = [];
                for (let i = 0; i < lines.length; i++) {
                  const m = lines[i].match(/export\s+(default\s+)?(async\s+)?(function|class|const|let|var|type|interface|enum)\s+(\w+)/);
                  if (m)
                    exports.push(`  ${i + 1}: ${m[1] || ""}${m[3]} ${m[4]}`);
                  const re = lines[i].match(/module\.exports\s*=\s*(\{[\s\S]*?\}|\w+)/);
                  if (re)
                    exports.push(`  ${i + 1}: module.exports = ${re[1].substring(0, 60)}`);
                }
                if (exports.length)
                  results.push(`${f}:
${exports.join("\n")}`);
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n\n") : "No exports found" }] };
            }
            case "types": {
              const files = await getFiles(args.path || ".", args.filePattern);
              for (const f of files) {
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                const types = [];
                for (let i = 0; i < lines.length; i++) {
                  const l = lines[i];
                  const tm = l.match(/(?:export\s+)?(?:type|interface|enum)\s+(\w+)/);
                  const sm = l.match(/(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/);
                  if (tm)
                    types.push(`  ${i + 1}: ${l.trim().substring(0, 80)}`);
                  else if (sm)
                    types.push(`  ${i + 1}: ${l.trim().substring(0, 80)}`);
                }
                if (types.length)
                  results.push(`${f}:
${types.join("\n")}`);
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n\n") : "No type definitions found" }] };
            }
            case "calls": {
              if (!args.symbol)
                return { content: [{ type: "text", text: "symbol required" }], isError: true };
              const files = await getFiles(args.path || ".", args.filePattern);
              const callPat = new RegExp(`\\b${args.symbol}\\s*\\(`, "g");
              for (const f of files) {
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                const matches = [];
                lines.forEach((line, i) => {
                  if (callPat.test(line))
                    matches.push(`  ${i + 1}: ${line.trim()}`);
                });
                if (matches.length)
                  results.push(`${f}:
${matches.join("\n")}`);
              }
              return { content: [{ type: "text", text: results.length ? results.join("\n\n") : `No calls to '${args.symbol}' found` }] };
            }
            case "hierarchy": {
              let buildTree2 = function(name, depth) {
                if (depth <= 0)
                  return [];
                const out2 = [];
                const children = classes.filter((c) => c.parent === name);
                for (const c of children) {
                  out2.push(`${"  ".repeat((args.depth || 3) - depth + 1)}\u251C\u2500 ${c.name} (${c.file}:${c.line})`);
                  out2.push(...buildTree2(c.name, depth - 1));
                }
                return out2;
              };
              var buildTree = buildTree2;
              if (!args.symbol)
                return { content: [{ type: "text", text: "symbol (class name) required" }], isError: true };
              const files = await getFiles(args.path || ".", args.filePattern);
              const classes = [];
              for (const f of files) {
                const lines = (await fs10.readFile(f, "utf-8")).split("\n");
                for (let i = 0; i < lines.length; i++) {
                  const m = lines[i].match(/class\s+(\w+)(?:\s+extends\s+(\w+))?/);
                  if (m)
                    classes.push({ name: m[1], parent: m[2], file: f, line: i + 1 });
                  const sm = lines[i].match(/struct\s+(\w+)/);
                  if (sm)
                    classes.push({ name: sm[1], file: f, line: i + 1 });
                }
              }
              const root = classes.find((c) => c.name === args.symbol);
              const out = [root ? `${args.symbol} (${root.file}:${root.line})` : args.symbol];
              if (root?.parent)
                out.push(`  extends: ${root.parent}`);
              out.push(...buildTree2(args.symbol, args.depth || 3));
              const siblings = classes.filter((c) => c.parent === root?.parent && c.name !== args.symbol);
              if (siblings.length) {
                out.push("\nSiblings:");
                for (const s of siblings)
                  out.push(`  ${s.name} (${s.file}:${s.line})`);
              }
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    astTools = [astTool];
  }
});

// src/tools/vector-search.ts
import * as path12 from "path";
import * as fs11 from "fs/promises";
async function getLanceDB() {
  if (!lancedb) {
    try {
      lancedb = await import("@lancedb/lancedb");
    } catch {
      throw new Error("Requires @lancedb/lancedb");
    }
  }
  return lancedb.default || lancedb;
}
async function getEmbedder() {
  if (!embedder) {
    try {
      const { pipeline } = await import("@xenova/transformers");
      embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    } catch {
      throw new Error("Requires @xenova/transformers");
    }
  }
  return embedder;
}
async function getDB(p) {
  const dp = path12.join(p, ".hanzo", "lancedb");
  if (!dbs.has(dp)) {
    await fs11.mkdir(path12.dirname(dp), { recursive: true });
    dbs.set(dp, await (await getLanceDB()).connect(dp));
  }
  return dbs.get(dp);
}
var lancedb, embedder, dbs, vectorTool, vectorTools;
var init_vector_search = __esm({
  "src/tools/vector-search.ts"() {
    "use strict";
    lancedb = null;
    embedder = null;
    dbs = /* @__PURE__ */ new Map();
    vectorTool = {
      name: "vector",
      description: "Semantic vector search: index content, search by similarity, stats, delete, list tables, reindex, find similar documents",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [
            "index",
            "search",
            "stats",
            "delete",
            "list_tables",
            "drop_table",
            "reindex",
            "similar"
          ] },
          content: { type: "string", description: "Content to index" },
          path: { type: "string", description: "File/dir to index" },
          metadata: { type: "object" },
          query: { type: "string", description: "Search query" },
          limit: { type: "number", default: 10 },
          table: { type: "string", description: "Table name", default: "documents" },
          id: { type: "string", description: "Document ID (delete, similar)" },
          threshold: { type: "number", description: "Similarity threshold (0-1)", default: 0.8 },
          projectPath: { type: "string", description: "Project root for DB location" },
          recursive: { type: "boolean", description: "Recursively index directory", default: true },
          filePattern: { type: "string", description: 'File glob for indexing (e.g., "*.md")' },
          chunkSize: { type: "number", description: "Max chars per chunk for indexing", default: 1e3 },
          tags: { type: "array", items: { type: "string" }, description: "Tags for indexed content" }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          const pp = args.projectPath || process.cwd();
          const tableName = args.table || "documents";
          switch (args.action) {
            case "index": {
              const db = await getDB(pp);
              const model = await getEmbedder();
              const items = [];
              if (args.content) {
                const chunkSize = args.chunkSize || 1e3;
                if (args.content.length > chunkSize) {
                  const chunks = [];
                  for (let i = 0; i < args.content.length; i += chunkSize) {
                    chunks.push(args.content.substring(i, i + chunkSize));
                  }
                  for (const chunk of chunks)
                    items.push({ content: chunk, path: args.path, tags: args.tags });
                } else {
                  items.push({ content: args.content, path: args.path, tags: args.tags });
                }
              } else if (args.path) {
                const s = await fs11.stat(args.path);
                if (s.isFile()) {
                  items.push({ content: await fs11.readFile(args.path, "utf-8"), path: args.path, tags: args.tags });
                } else if (args.recursive !== false) {
                  const { glob: glob6 } = await import("glob");
                  const pattern = args.filePattern || "**/*.{ts,js,py,md,txt,rs,go}";
                  const files = await glob6(path12.join(args.path, pattern), { ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"] });
                  for (const fp of files) {
                    try {
                      const content = await fs11.readFile(fp, "utf-8");
                      if (content.length > 0)
                        items.push({ content, path: fp, tags: args.tags });
                    } catch {
                    }
                  }
                }
              }
              if (!items.length)
                return { content: [{ type: "text", text: "No content to index" }], isError: true };
              let table;
              try {
                table = await db.openTable(tableName);
              } catch {
                table = await db.createTable(tableName, [{ id: 0, content: "", path: "", embedding: [], metadata: {}, tags: [], timestamp: /* @__PURE__ */ new Date() }]);
              }
              let indexed = 0;
              for (const item of items) {
                const out = await model(item.content.substring(0, 512), { pooling: "mean", normalize: true });
                await table.add([{
                  id: Date.now() + Math.random(),
                  content: item.content,
                  path: item.path || "",
                  embedding: Array.from(out.data),
                  metadata: args.metadata || {},
                  tags: item.tags || [],
                  timestamp: /* @__PURE__ */ new Date()
                }]);
                indexed++;
              }
              return { content: [{ type: "text", text: `Indexed ${indexed} items into '${tableName}'` }] };
            }
            case "search": {
              if (!args.query)
                return { content: [{ type: "text", text: "query required" }], isError: true };
              const db = await getDB(pp);
              const model = await getEmbedder();
              let table;
              try {
                table = await db.openTable(tableName);
              } catch {
                return { content: [{ type: "text", text: `Table '${tableName}' not found. Use action=index first.` }] };
              }
              const out = await model(args.query, { pooling: "mean", normalize: true });
              const matches = await (await table.search(Array.from(out.data)).limit(args.limit || 10)).toArray();
              if (!matches.length)
                return { content: [{ type: "text", text: "No matches" }] };
              const fmt = matches.map((m, i) => {
                const score = (1 - (m._distance || 0)).toFixed(3);
                const tags = m.tags?.length ? ` [${m.tags.join(",")}]` : "";
                return `${i + 1}. [${score}] ${m.path || "content"}${tags}
   ${m.content.substring(0, 200).replace(/\n/g, " ")}${m.content.length > 200 ? "..." : ""}`;
              });
              return { content: [{ type: "text", text: fmt.join("\n\n") }] };
            }
            case "stats": {
              const db = await getDB(pp);
              try {
                const t = await db.openTable(tableName);
                const count = await t.countRows();
                return { content: [{ type: "text", text: `Table: ${tableName}
Documents: ${count}
Path: ${path12.join(pp, ".hanzo/lancedb")}` }] };
              } catch {
                return { content: [{ type: "text", text: `Table '${tableName}' not found. Use action=index to add documents.` }] };
              }
            }
            case "delete": {
              if (!args.id && !args.path)
                return { content: [{ type: "text", text: "id or path required" }], isError: true };
              const db = await getDB(pp);
              const t = await db.openTable(tableName);
              if (args.id) {
                await t.delete(`id = ${args.id}`);
                return { content: [{ type: "text", text: `Deleted document: ${args.id}` }] };
              }
              await t.delete(`path = '${args.path}'`);
              return { content: [{ type: "text", text: `Deleted documents with path: ${args.path}` }] };
            }
            case "list_tables": {
              const db = await getDB(pp);
              const tables = await db.tableNames();
              return { content: [{ type: "text", text: `Tables:
${tables.map((t) => `  ${t}`).join("\n") || "(none)"}` }] };
            }
            case "drop_table": {
              if (!args.table)
                return { content: [{ type: "text", text: "table required" }], isError: true };
              const db = await getDB(pp);
              await db.dropTable(args.table);
              return { content: [{ type: "text", text: `Dropped table: ${args.table}` }] };
            }
            case "reindex": {
              if (!args.path)
                return { content: [{ type: "text", text: "path required" }], isError: true };
              const db = await getDB(pp);
              try {
                await db.dropTable(tableName);
              } catch {
              }
              return await vectorTool.handler({ ...args, action: "index" });
            }
            case "similar": {
              if (!args.id && !args.content)
                return { content: [{ type: "text", text: "id or content required" }], isError: true };
              const db = await getDB(pp);
              const model = await getEmbedder();
              const t = await db.openTable(tableName);
              let queryContent = args.content;
              if (args.id) {
                const docs = await (await t.search([])).limit(1e3).toArray();
                const doc = docs.find((d) => String(d.id) === String(args.id));
                if (!doc)
                  return { content: [{ type: "text", text: `Document ${args.id} not found` }], isError: true };
                queryContent = doc.content;
              }
              const out = await model(queryContent.substring(0, 512), { pooling: "mean", normalize: true });
              const matches = await (await t.search(Array.from(out.data)).limit((args.limit || 10) + 1)).toArray();
              const filtered = matches.filter((m) => {
                if (args.id && String(m.id) === String(args.id))
                  return false;
                const sim = 1 - (m._distance || 0);
                return sim >= (args.threshold || 0);
              }).slice(0, args.limit || 10);
              if (!filtered.length)
                return { content: [{ type: "text", text: "No similar documents found" }] };
              const fmt = filtered.map((m, i) => `${i + 1}. [${(1 - (m._distance || 0)).toFixed(3)}] ${m.path || "content"}
   ${m.content.substring(0, 150).replace(/\n/g, " ")}...`);
              return { content: [{ type: "text", text: fmt.join("\n\n") }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    vectorTools = [vectorTool];
  }
});

// src/tools/refactor.ts
import { exec as exec10 } from "child_process";
import { promisify as promisify10 } from "util";
import * as fs12 from "fs/promises";
import * as path13 from "path";
async function findRefs(symbol, searchPath, fileGlob) {
  const refs = [];
  try {
    let cmd = `rg -n --no-heading "${symbol}"`;
    if (fileGlob)
      cmd += ` -g "${fileGlob}"`;
    cmd += ` "${searchPath}"`;
    const { stdout } = await execAsync10(cmd, { maxBuffer: 5 * 1024 * 1024 });
    for (const line of stdout.split("\n").filter(Boolean)) {
      const m = line.match(/^(.+?):(\d+):(.*)$/);
      if (m)
        refs.push({ file: m[1], line: parseInt(m[2]), text: m[3].trim() });
    }
  } catch {
  }
  return refs;
}
async function countLines(searchPath, fileGlob) {
  try {
    let cmd = `rg -c "" --include-zero`;
    if (fileGlob)
      cmd += ` -g "${fileGlob}"`;
    cmd += ` "${searchPath}"`;
    const { stdout } = await execAsync10(cmd, { maxBuffer: 5 * 1024 * 1024 });
    let files = 0, lines = 0;
    for (const l of stdout.split("\n").filter(Boolean)) {
      const m = l.match(/:(\d+)$/);
      if (m) {
        files++;
        lines += parseInt(m[1]);
      }
    }
    return { files, lines, blank: 0, comment: 0 };
  } catch {
    return { files: 0, lines: 0, blank: 0, comment: 0 };
  }
}
var execAsync10, refactorTool, refactorTools;
var init_refactor = __esm({
  "src/tools/refactor.ts"() {
    "use strict";
    execAsync10 = promisify10(exec10);
    refactorTool = {
      name: "refactor",
      description: "Code refactoring: rename, extract, inline, move, references, dead_code, complexity, duplicates, organize_imports, signatures, grep_replace",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["rename", "extract", "inline", "move", "references", "dead_code", "complexity", "duplicates", "organize_imports", "signatures", "grep_replace"],
            description: "Refactoring action"
          },
          path: { type: "string", default: "." },
          filePattern: { type: "string", description: 'File glob (e.g., "*.ts", "*.{js,py}")' },
          symbol: { type: "string", description: "Symbol name" },
          newName: { type: "string", description: "New name (rename)" },
          dryRun: { type: "boolean", description: "Preview without applying", default: true },
          file: { type: "string", description: "Source file" },
          startLine: { type: "number", description: "Start line (extract)" },
          endLine: { type: "number", description: "End line (extract)" },
          name: { type: "string", description: "New function name (extract)" },
          from: { type: "string", description: "Source file (move)" },
          to: { type: "string", description: "Destination file (move)" },
          pattern: { type: "string", description: "Regex pattern (grep_replace)" },
          replacement: { type: "string", description: "Replacement string (grep_replace)" },
          minLines: { type: "number", description: "Min duplicate block size", default: 5 },
          limit: { type: "number", default: 50 }
        },
        required: ["action"]
      },
      handler: async (args) => {
        try {
          switch (args.action) {
            case "rename": {
              if (!args.symbol || !args.newName)
                return { content: [{ type: "text", text: "symbol and newName required" }], isError: true };
              const refs = await findRefs(`\\b${args.symbol}\\b`, args.path || ".", args.filePattern);
              if (!refs.length)
                return { content: [{ type: "text", text: `No references found for '${args.symbol}'` }] };
              const groups = /* @__PURE__ */ new Map();
              for (const r of refs) {
                if (!groups.has(r.file))
                  groups.set(r.file, []);
                groups.get(r.file).push(r);
              }
              if (args.dryRun !== false) {
                const out = [`Would rename '${args.symbol}' \u2192 '${args.newName}' in ${groups.size} files (${refs.length} refs):
`];
                for (const [f, rs] of groups) {
                  out.push(`  ${f}: ${rs.length} refs`);
                  for (const r of rs.slice(0, 3))
                    out.push(`    L${r.line}: ${r.text}`);
                  if (rs.length > 3)
                    out.push(`    ... +${rs.length - 3} more`);
                }
                out.push("\nSet dryRun=false to apply.");
                return { content: [{ type: "text", text: out.join("\n") }] };
              }
              const re = new RegExp(`\\b${args.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
              let changed = 0;
              for (const [f] of groups) {
                const c = await fs12.readFile(f, "utf-8");
                const n = c.replace(re, args.newName);
                if (c !== n) {
                  await fs12.writeFile(f, n);
                  changed++;
                }
              }
              return { content: [{ type: "text", text: `Renamed '${args.symbol}' \u2192 '${args.newName}' in ${changed} files` }] };
            }
            case "extract": {
              if (!args.file || !args.startLine || !args.endLine || !args.name)
                return { content: [{ type: "text", text: "file, startLine, endLine, name required" }], isError: true };
              const content = await fs12.readFile(args.file, "utf-8");
              const lines = content.split("\n");
              const body = lines.slice(args.startLine - 1, args.endLine);
              const indent = body[0]?.match(/^(\s*)/)?.[1] || "";
              const stripped = body.map((l) => l.startsWith(indent) ? l.slice(indent.length) : l);
              const ext = path13.extname(args.file).slice(1);
              const funcDef = ext === "py" ? `def ${args.name}():
${stripped.map((l) => "    " + l).join("\n")}` : ext === "go" ? `func ${args.name}() {
${stripped.map((l) => "	" + l).join("\n")}
}` : ext === "rs" ? `fn ${args.name}() {
${stripped.map((l) => "    " + l).join("\n")}
}` : `function ${args.name}() {
${stripped.map((l) => "  " + l).join("\n")}
}`;
              return { content: [{ type: "text", text: `Extracted function:

${funcDef}

Replace lines ${args.startLine}-${args.endLine} with: ${indent}${args.name}()` }] };
            }
            case "inline":
            case "references": {
              if (!args.symbol)
                return { content: [{ type: "text", text: "symbol required" }], isError: true };
              const defPatterns = [`function\\s+${args.symbol}\\s*\\(`, `(const|let|var)\\s+${args.symbol}\\s*=`, `def\\s+${args.symbol}\\s*\\(`, `fn\\s+${args.symbol}\\s*\\(`, `func\\s+${args.symbol}\\s*\\(`];
              const defs = [];
              for (const p of defPatterns)
                defs.push(...await findRefs(p, args.path || ".", args.filePattern));
              const allRefs = await findRefs(`\\b${args.symbol}\\b`, args.path || ".", args.filePattern);
              const calls = allRefs.filter((r) => !defs.some((d) => d.file === r.file && d.line === r.line));
              const out = [`Symbol: ${args.symbol}
`, `Definitions (${defs.length}):`];
              for (const d of defs)
                out.push(`  ${d.file}:${d.line}: ${d.text}`);
              out.push("", `References (${calls.length}):`);
              for (const r of calls.slice(0, args.limit || 50))
                out.push(`  ${r.file}:${r.line}: ${r.text}`);
              if (calls.length > (args.limit || 50))
                out.push(`  ... +${calls.length - (args.limit || 50)} more`);
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "move": {
              if (!args.symbol || !args.from || !args.to)
                return { content: [{ type: "text", text: "symbol, from, to required" }], isError: true };
              const refs = await findRefs(`\\b${args.symbol}\\b`, path13.dirname(args.from));
              const imports = refs.filter((r) => r.file !== args.from && (r.text.includes("import") || r.text.includes("require")));
              return { content: [{ type: "text", text: `Move '${args.symbol}' ${args.from} \u2192 ${args.to}

Files needing import updates (${imports.length}):
${imports.map((r) => `  ${r.file}:${r.line}: ${r.text}`).join("\n")}` }] };
            }
            case "dead_code": {
              const exportRefs = await findRefs("export\\s+(function|const|class|interface|type|enum|default)", args.path || ".", args.filePattern);
              const out = [`Exported symbols in ${args.path || "."}:
`];
              const symbols = [];
              for (const e of exportRefs) {
                const m = e.text.match(/export\s+(?:default\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/);
                if (m) {
                  const refs = await findRefs(`\\b${m[1]}\\b`, args.path || ".", args.filePattern);
                  const external = refs.filter((r) => r.file !== e.file);
                  symbols.push({ file: e.file, name: m[1], refs: external.length });
                }
              }
              const dead = symbols.filter((s) => s.refs === 0);
              const used = symbols.filter((s) => s.refs > 0);
              out.push(`Potentially unused exports (${dead.length}):`);
              for (const s of dead.slice(0, args.limit || 50))
                out.push(`  ${s.file}: ${s.name}`);
              out.push(`
Used exports: ${used.length}`);
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "complexity": {
              if (!args.file)
                return { content: [{ type: "text", text: "file required" }], isError: true };
              const content = await fs12.readFile(args.file, "utf-8");
              const lines = content.split("\n");
              const funcs = [];
              let currentFunc = null;
              let braceDepth = 0;
              for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                const fm = l.match(/(?:function|def|fn|func)\s+(\w+)/);
                if (fm) {
                  currentFunc = { name: fm[1], line: i + 1, depth: braceDepth, complexity: 1, start: i };
                }
                if (currentFunc) {
                  const branches = (l.match(/\b(if|else if|elif|case|catch|&&|\|\||for|while|switch)\b/g) || []).length;
                  currentFunc.complexity += branches;
                }
                braceDepth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
                if (currentFunc && braceDepth <= currentFunc.depth) {
                  funcs.push({ name: currentFunc.name, line: currentFunc.line, complexity: currentFunc.complexity, length: i - currentFunc.start + 1 });
                  currentFunc = null;
                }
              }
              funcs.sort((a, b) => b.complexity - a.complexity);
              const out = [`Complexity: ${args.file}
`, `Functions (${funcs.length}):`];
              for (const f of funcs.slice(0, args.limit || 30)) {
                const risk = f.complexity > 15 ? "HIGH" : f.complexity > 8 ? "MED" : "LOW";
                out.push(`  ${f.name} (L${f.line}): complexity=${f.complexity} length=${f.length} [${risk}]`);
              }
              const stats = countLines(args.path || ".", args.filePattern);
              return { content: [{ type: "text", text: out.join("\n") }] };
            }
            case "duplicates": {
              const minLen = args.minLines || 5;
              const searchPath = args.path || ".";
              const glob6 = args.filePattern || "*.{ts,js,py,go,rs}";
              try {
                const { stdout } = await execAsync10(`rg -n --no-heading "" -g "${glob6}" "${searchPath}" | head -10000`, { maxBuffer: 10 * 1024 * 1024 });
                const fileLines = /* @__PURE__ */ new Map();
                for (const l of stdout.split("\n")) {
                  const m = l.match(/^(.+?):(\d+):(.*)$/);
                  if (m) {
                    if (!fileLines.has(m[1]))
                      fileLines.set(m[1], []);
                    fileLines.get(m[1]).push(m[3].trim());
                  }
                }
                const fingerprints = /* @__PURE__ */ new Map();
                for (const [file, lines] of fileLines) {
                  for (let i = 0; i <= lines.length - minLen; i++) {
                    const block = lines.slice(i, i + minLen).join("\n");
                    if (block.length < 20)
                      continue;
                    const fp = block.replace(/\s+/g, " ");
                    if (!fingerprints.has(fp))
                      fingerprints.set(fp, []);
                    fingerprints.get(fp).push({ file, startLine: i + 1 });
                  }
                }
                const dupes = [...fingerprints.entries()].filter(([_, locs]) => locs.length > 1 && new Set(locs.map((l) => l.file)).size > 1);
                const out = [`Duplicate code blocks (${minLen}+ lines, ${dupes.length} found):
`];
                for (const [block, locs] of dupes.slice(0, args.limit || 20)) {
                  out.push(`  Duplicate in ${locs.length} locations:`);
                  for (const l of locs)
                    out.push(`    ${l.file}:${l.startLine}`);
                  out.push(`    Preview: ${block.substring(0, 80)}...`);
                }
                return { content: [{ type: "text", text: out.join("\n") }] };
              } catch (e) {
                return { content: [{ type: "text", text: `Error scanning: ${e.message}` }], isError: true };
              }
            }
            case "organize_imports": {
              if (!args.file)
                return { content: [{ type: "text", text: "file required" }], isError: true };
              const content = await fs12.readFile(args.file, "utf-8");
              const lines = content.split("\n");
              const importLines = [];
              const otherLines = [];
              let lastImportLine = -1;
              for (let i = 0; i < lines.length; i++) {
                const im = lines[i].match(/^(import\s+.*\s+from\s+['"](.+)['"]|import\s+['"](.+)['"]|const\s+.*\s*=\s*require\(['"](.+)['"]\))/);
                if (im) {
                  importLines.push({ line: i, text: lines[i], source: im[2] || im[3] || im[4] || "" });
                  lastImportLine = i;
                } else if (i <= lastImportLine + 1 && lines[i].trim() === "") {
                }
              }
              const external = importLines.filter((i) => !i.source.startsWith("."));
              const internal = importLines.filter((i) => i.source.startsWith("."));
              external.sort((a, b) => a.source.localeCompare(b.source));
              internal.sort((a, b) => a.source.localeCompare(b.source));
              const organized = [...external.map((i) => i.text), "", ...internal.map((i) => i.text)].join("\n");
              return { content: [{ type: "text", text: `Organized imports for ${args.file}:

${organized}

${args.dryRun !== false ? "Set dryRun=false to apply." : "Applied."}` }] };
            }
            case "signatures": {
              if (!args.file)
                return { content: [{ type: "text", text: "file required" }], isError: true };
              const content = await fs12.readFile(args.file, "utf-8");
              const sigs = [];
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                const fm = l.match(/(export\s+)?(async\s+)?function\s+(\w+)\s*(\([\s\S]*?\))\s*[:{]/);
                const am = l.match(/(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*[=:]/);
                const cm = l.match(/(export\s+)?class\s+(\w+)(\s+extends\s+\w+)?/);
                const dm = l.match(/def\s+(\w+)\s*\(([^)]*)\)/);
                const rm3 = l.match(/(pub\s+)?(async\s+)?fn\s+(\w+)\s*(\([^)]*\))/);
                if (fm)
                  sigs.push(`L${i + 1}: ${fm[1] || ""}${fm[2] || ""}function ${fm[3]}${fm[4]}`);
                else if (am)
                  sigs.push(`L${i + 1}: ${am[1] || ""}${am[3]} = ${am[4] || ""}(${am[5]})`);
                else if (cm)
                  sigs.push(`L${i + 1}: ${cm[1] || ""}class ${cm[2]}${cm[3] || ""}`);
                else if (dm)
                  sigs.push(`L${i + 1}: def ${dm[1]}(${dm[2]})`);
                else if (rm3)
                  sigs.push(`L${i + 1}: ${rm3[1] || ""}${rm3[2] || ""}fn ${rm3[3]}${rm3[4]}`);
              }
              return { content: [{ type: "text", text: `Signatures in ${args.file} (${sigs.length}):

${sigs.join("\n")}` }] };
            }
            case "grep_replace": {
              if (!args.pattern || !args.replacement)
                return { content: [{ type: "text", text: "pattern and replacement required" }], isError: true };
              const refs = await findRefs(args.pattern, args.path || ".", args.filePattern);
              if (!refs.length)
                return { content: [{ type: "text", text: `No matches for pattern: ${args.pattern}` }] };
              const groups = /* @__PURE__ */ new Map();
              for (const r of refs) {
                if (!groups.has(r.file))
                  groups.set(r.file, []);
                groups.get(r.file).push(r);
              }
              if (args.dryRun !== false) {
                const out = [`Would replace /${args.pattern}/ \u2192 '${args.replacement}' in ${groups.size} files (${refs.length} matches):
`];
                for (const [f, rs] of [...groups].slice(0, 10)) {
                  out.push(`  ${f}: ${rs.length} matches`);
                  for (const r of rs.slice(0, 2))
                    out.push(`    L${r.line}: ${r.text}`);
                }
                out.push("\nSet dryRun=false to apply.");
                return { content: [{ type: "text", text: out.join("\n") }] };
              }
              const re = new RegExp(args.pattern, "g");
              let changed = 0;
              for (const [f] of groups) {
                const c = await fs12.readFile(f, "utf-8");
                const n = c.replace(re, args.replacement);
                if (c !== n) {
                  await fs12.writeFile(f, n);
                  changed++;
                }
              }
              return { content: [{ type: "text", text: `Replaced in ${changed} files` }] };
            }
            default:
              return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
          }
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }
    };
    refactorTools = [refactorTool];
  }
});

// src/ui/registry-types.ts
import { z } from "zod";
var fileSchema, registryItemSchema, registrySchema, registryWithContentSchema;
var init_registry_types = __esm({
  "src/ui/registry-types.ts"() {
    "use strict";
    fileSchema = z.object({
      path: z.string(),
      content: z.string().optional(),
      type: z.string(),
      target: z.string().optional()
    });
    registryItemSchema = z.object({
      name: z.string(),
      type: z.string(),
      description: z.string().optional(),
      author: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      devDependencies: z.array(z.string()).optional(),
      registryDependencies: z.array(z.string()).optional(),
      files: z.array(fileSchema).optional(),
      meta: z.record(z.any()).optional(),
      title: z.string().optional(),
      cssVars: z.record(z.any()).optional(),
      tailwind: z.record(z.any()).optional(),
      category: z.string().optional(),
      subcategory: z.string().optional()
    });
    registrySchema = z.object({
      $schema: z.string().optional(),
      name: z.string(),
      homepage: z.string().optional(),
      style: z.string().optional(),
      items: z.array(registryItemSchema)
    });
    registryWithContentSchema = registrySchema.extend({
      items: z.array(
        registryItemSchema.extend({
          files: z.array(
            fileSchema.extend({
              content: z.string()
            })
          )
        })
      )
    });
  }
});

// src/ui/registry-api.ts
function getRegistryUrl(registry) {
  if (registry.startsWith("http")) {
    return registry;
  }
  const baseUrl = process.env.REGISTRY_BASE_URL || "https://ui.hanzo.ai/registry";
  if (registry.endsWith(".json")) {
    return `${baseUrl}/${registry}`;
  }
  return `${baseUrl}/${registry}/registry.json`;
}
async function getRegistryItem(itemUrl, basePath) {
  try {
    const response = await fetch(itemUrl);
    if (!response.ok) {
      console.error(`Failed to fetch registry item from ${itemUrl}: ${response.status} ${response.statusText}`);
      return null;
    }
    const item = await response.json();
    const validatedItem = registryItemSchema.safeParse(item);
    if (!validatedItem.success) {
      console.error(`Invalid registry item format: ${JSON.stringify(validatedItem.error)}`);
      return null;
    }
    if (validatedItem.data.files) {
      for (const file of validatedItem.data.files) {
        if (!file.content) {
          continue;
        }
        if (file.target) {
          file.target = resolveImport(file.target, basePath);
        }
      }
    }
    return validatedItem.data;
  } catch (error) {
    console.error(`Error fetching registry item: ${error}`);
    return null;
  }
}
function resolveImport(importPath, basePath) {
  const importParts = importPath?.split("/");
  if (importPath.startsWith(".")) {
    return [basePath.replace(/^@/, ""), ...importParts].filter(Boolean).join("/");
  }
  if (importParts?.[0]?.startsWith("@")) {
    return importPath;
  }
  return importPath;
}
async function fetchRegistry(paths, options = {}) {
  options = {
    useCache: true,
    ...options
  };
  try {
    const results = await Promise.all(
      paths.map(async (path19) => {
        const url = getRegistryUrl(path19);
        if (options.useCache && registryCache.has(url)) {
          return registryCache.get(url);
        }
        const fetchPromise = (async () => {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch registry from ${url}. ${response.status} ${response.statusText}`
            );
          }
          return response.json();
        })();
        if (options.useCache) {
          registryCache.set(url, fetchPromise);
        }
        return fetchPromise;
      })
    );
    return results;
  } catch (error) {
    console.error(`Error fetching registry: ${error}`);
    throw error;
  }
}
function getRegistryItemUrl(itemName, registryUrl) {
  const registryBaseUrl = registryUrl.replace(/\/registry\.json$/, "");
  return `${registryBaseUrl}/r/${itemName}.json`;
}
var registryCache;
var init_registry_api = __esm({
  "src/ui/registry-api.ts"() {
    "use strict";
    init_registry_types();
    registryCache = /* @__PURE__ */ new Map();
  }
});

// src/ui/ui-tools.ts
import { z as z2 } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
async function getRegistry() {
  const now = Date.now();
  if (registryCache2 && now - registryCacheTime < CACHE_DURATION) {
    return registryCache2;
  }
  try {
    const registryUrl = process.env.REGISTRY_URL || "https://ui.hanzo.ai/registry/registry.json";
    const [registryJson] = await fetchRegistry([registryUrl], {
      useCache: false
    });
    registryCache2 = registrySchema.parse(registryJson);
    registryCacheTime = now;
    return registryCache2;
  } catch (error) {
    console.error("Failed to fetch registry:", error);
    return registryCache2 || {
      name: "hanzo-ui",
      items: []
    };
  }
}
async function getComponentSource(componentName) {
  try {
    const registryUrl = process.env.REGISTRY_URL || "https://ui.hanzo.ai/registry/registry.json";
    const itemUrl = getRegistryItemUrl(componentName, registryUrl);
    const component = await getRegistryItem(itemUrl, "");
    if (component && component.files && component.files.length > 0) {
      const mainFile = component.files.find((f) => f.type === "registry:ui") || component.files[0];
      return mainFile.content || null;
    }
  } catch (error) {
    console.error(`Failed to get component source for ${componentName}:`, error);
  }
  return null;
}
var registryCache2, registryCacheTime, CACHE_DURATION, uiInitTool, uiListComponentsTool, uiGetComponentTool, uiGetComponentSourceTool, uiGetComponentDemoTool, uiAddComponentTool, uiListBlocksTool, uiGetBlockTool, uiListStylesTool, uiSearchRegistryTool, uiGetInstallationGuideTool, uiTools;
var init_ui_tools = __esm({
  "src/ui/ui-tools.ts"() {
    "use strict";
    init_registry_types();
    init_registry_api();
    registryCache2 = null;
    registryCacheTime = 0;
    CACHE_DURATION = 5 * 60 * 1e3;
    uiInitTool = {
      name: "ui_init",
      description: "Initialize a new project using @hanzo/ui components and styles.",
      inputSchema: zodToJsonSchema(z2.object({
        style: z2.string().optional().describe("The style to use for the project (e.g., 'default' or 'new-york')")
      })),
      handler: async (args) => {
        const style = args.style || "default";
        const content = `# Initialize Hanzo UI Project

To initialize a new project with Hanzo UI:

## Step 1: Initialize your project
\`\`\`bash
npx @hanzo/ui@latest init
\`\`\`

This will:
- Install dependencies (tailwindcss-animate, class-variance-authority, clsx, tailwind-merge)
- Configure Tailwind CSS
- Set up the project structure
- Add the cn() utility function
- Configure component path aliases

## Step 2: Choose your style
The initialization will prompt you to choose a style:
- **default**: Standard shadcn/ui styling
- **new-york**: Alternative styling with different aesthetics

Selected style: **${style}**

## Step 3: Start adding components
After initialization, you can add components:
\`\`\`bash
npx @hanzo/ui@latest add button card dialog
\`\`\`

## Manual Setup (Alternative)

If you prefer manual setup:

### 1. Install dependencies
\`\`\`bash
npm install tailwindcss-animate class-variance-authority clsx tailwind-merge
\`\`\`

### 2. Configure Tailwind (tailwind.config.js)
\`\`\`javascript
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [require("tailwindcss-animate")],
}
\`\`\`

### 3. Add the cn() utility (lib/utils.ts)
\`\`\`typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
\`\`\`

Your project is ready for Hanzo UI components!`;
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiListComponentsTool = {
      name: "ui_list_components",
      description: "List all available components in the registry",
      inputSchema: zodToJsonSchema(z2.object({
        type: z2.string().optional().describe("Filter components by type (e.g., 'ui', 'block')"),
        category: z2.string().optional().describe("Filter components by category")
      })),
      handler: async (args) => {
        const registry = await getRegistry();
        const typeFilter = args.type;
        const categoryFilter = args.category;
        let components = registry.items.filter((item) => item.type.includes("ui:"));
        if (typeFilter) {
          components = components.filter((item) => item.type.includes(typeFilter));
        }
        if (categoryFilter) {
          components = components.filter((item) => item.category === categoryFilter);
        }
        const grouped = components.reduce((acc, item) => {
          const category = item.category || "Uncategorized";
          if (!acc[category])
            acc[category] = [];
          acc[category].push(item);
          return acc;
        }, {});
        let content = "# Hanzo UI Components\\n\\n";
        if (components.length === 0) {
          content += "No components found";
          if (typeFilter)
            content += ` with type '${typeFilter}'`;
          if (categoryFilter)
            content += ` in category '${categoryFilter}'`;
          content += ".\\n";
        } else {
          for (const [category, items] of Object.entries(grouped)) {
            content += `## ${category}\\n\\n`;
            for (const item of items) {
              content += `### ${item.name}\\n`;
              content += `${item.description || "No description"}\\n\\n`;
              content += `**Command:** \`npx @hanzo/ui@latest add ${item.name}\`\\n\\n`;
            }
          }
        }
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiGetComponentTool = {
      name: "ui_get_component",
      description: "Get detailed information about a specific component",
      inputSchema: zodToJsonSchema(z2.object({
        name: z2.string().describe("The name of the component to get from the registry")
      })),
      handler: async (args) => {
        const name = args.name;
        const registry = await getRegistry();
        const component = registry.items.find((item) => item.name === name);
        if (!component) {
          return {
            content: [{
              type: "text",
              text: `Component '${name}' not found in registry`
            }],
            isError: true
          };
        }
        let content = `# ${component.name}\\n\\n`;
        content += `${component.description || "No description"}\\n\\n`;
        if (component.category) {
          content += `**Category:** ${component.category}\\n\\n`;
        }
        if (component.dependencies && component.dependencies.length > 0) {
          content += `## NPM Dependencies\\n\\n`;
          component.dependencies.forEach((dep) => {
            content += `- ${dep}\\n`;
          });
          content += "\\n";
        }
        if (component.registryDependencies && component.registryDependencies.length > 0) {
          content += `## Required Components\\n\\n`;
          component.registryDependencies.forEach((dep) => {
            content += `- ${dep}\\n`;
          });
          content += "\\n";
        }
        content += `## Installation\\n\\n`;
        content += `\`\`\`bash\\n`;
        content += `npx @hanzo/ui@latest add ${name}\\n`;
        content += `\`\`\`\\n\\n`;
        if (component.files && component.files.length > 0) {
          content += `## Files\\n\\n`;
          component.files.forEach((file) => {
            content += `- \`${file.path}\` (${file.type})\\n`;
          });
        }
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiGetComponentSourceTool = {
      name: "ui_get_component_source",
      description: "Get the full source code of a component",
      inputSchema: zodToJsonSchema(z2.object({
        name: z2.string().describe("The name of the component to get source code for")
      })),
      handler: async (args) => {
        const name = args.name;
        const source = await getComponentSource(name);
        if (!source) {
          return {
            content: [{
              type: "text",
              text: `Could not find source code for component '${name}'`
            }],
            isError: true
          };
        }
        return {
          content: [{
            type: "text",
            text: `# Source Code: ${name}\\n\\n\`\`\`tsx\\n${source}\\n\`\`\``
          }]
        };
      }
    };
    uiGetComponentDemoTool = {
      name: "ui_get_component_demo",
      description: "Get a demo/example implementation of a component",
      inputSchema: zodToJsonSchema(z2.object({
        name: z2.string().describe("The name of the component to get demo for")
      })),
      handler: async (args) => {
        const name = args.name;
        const registry = await getRegistry();
        const component = registry.items.find((item) => item.name === name);
        if (!component) {
          return {
            content: [{
              type: "text",
              text: `Component '${name}' not found`
            }],
            isError: true
          };
        }
        let demo = `# ${name} Demo\\n\\n\`\`\`tsx\\n`;
        demo += `import { ${name.charAt(0).toUpperCase() + name.slice(1)} } from "@/components/ui/${name}"\\n\\n`;
        demo += `export default function ${name.charAt(0).toUpperCase() + name.slice(1)}Demo() {\\n`;
        demo += `  return (\\n`;
        demo += `    <div className="space-y-4">\\n`;
        if (name === "button") {
          demo += `      <div className="flex gap-4">\\n`;
          demo += `        <${name.charAt(0).toUpperCase() + name.slice(1)}>Default</${name.charAt(0).toUpperCase() + name.slice(1)}>\\n`;
          demo += `        <${name.charAt(0).toUpperCase() + name.slice(1)} variant="outline">Outline</${name.charAt(0).toUpperCase() + name.slice(1)}>\\n`;
          demo += `        <${name.charAt(0).toUpperCase() + name.slice(1)} variant="secondary">Secondary</${name.charAt(0).toUpperCase() + name.slice(1)}>\\n`;
          demo += `        <${name.charAt(0).toUpperCase() + name.slice(1)} variant="destructive">Destructive</${name.charAt(0).toUpperCase() + name.slice(1)}>\\n`;
          demo += `      </div>\\n`;
        } else {
          demo += `      <${name.charAt(0).toUpperCase() + name.slice(1)} />\\n`;
        }
        demo += `    </div>\\n`;
        demo += `  )\\n`;
        demo += `}\\n`;
        demo += `\`\`\`\\n\\n`;
        demo += `## Usage Notes\\n\\n`;
        demo += `- Import the component from \`@/components/ui/${name}\`\\n`;
        demo += `- ${component.description || "No description available"}\\n`;
        if (component.dependencies && component.dependencies.length > 0) {
          demo += `\\n## Required Dependencies\\n\\n`;
          component.dependencies.forEach((dep) => {
            demo += `- ${dep}\\n`;
          });
        }
        return {
          content: [{
            type: "text",
            text: demo
          }]
        };
      }
    };
    uiAddComponentTool = {
      name: "ui_add_component",
      description: "Get instructions for adding a component to a project",
      inputSchema: zodToJsonSchema(z2.object({
        name: z2.string().describe("The name of the component to add"),
        style: z2.string().optional().describe("The style to use (default, new-york, etc.)")
      })),
      handler: async (args) => {
        const name = args.name;
        const style = args.style || "default";
        const content = `# Add ${name} Component

## Using the CLI (Recommended)
\`\`\`bash
npx @hanzo/ui@latest add ${name}
\`\`\`

This will:
- Download the component files
- Install any required dependencies
- Place files in the correct location

## Style Option
If you want to specify a style:
\`\`\`bash
npx @hanzo/ui@latest add ${name} --style=${style}
\`\`\`

## Manual Installation
If you prefer manual installation:

1. **Check component details first:**
   Use \`ui_get_component\` to see dependencies and file structure

2. **Install NPM dependencies:**
   Install any packages listed in the component's dependencies

3. **Add registry dependencies:**
   Add any other components this one depends on

4. **Copy component files:**
   Copy the component source to your project structure

## After Installation
- Import the component: \`import { ${name.charAt(0).toUpperCase() + name.slice(1)} } from "@/components/ui/${name}"\`
- Use in your JSX: \`<${name.charAt(0).toUpperCase() + name.slice(1)} />\`

The component will be ready to use in your project!`;
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiListBlocksTool = {
      name: "ui_list_blocks",
      description: "List all available UI blocks/patterns",
      inputSchema: zodToJsonSchema(z2.object({
        category: z2.string().optional().describe("Filter blocks by category")
      })),
      handler: async (args) => {
        const registry = await getRegistry();
        const blocks = registry.items.filter(
          (item) => item.type.includes("block") || item.type.includes("section")
        );
        const categoryFilter = args.category;
        const filtered = categoryFilter ? blocks.filter((b) => b.category === categoryFilter) : blocks;
        let content = "# Available UI Blocks\\n\\n";
        if (filtered.length === 0) {
          content += "No blocks found";
          if (categoryFilter) {
            content += ` in category '${categoryFilter}'`;
          }
          content += ".\\n";
        } else {
          const byCategory = filtered.reduce((acc, block) => {
            const cat = block.category || "Uncategorized";
            if (!acc[cat])
              acc[cat] = [];
            acc[cat].push(block);
            return acc;
          }, {});
          for (const [category, items] of Object.entries(byCategory)) {
            content += `## ${category}\\n\\n`;
            for (const item of items) {
              content += `### ${item.name}\\n`;
              content += `${item.description || "No description"}\\n`;
              content += `**Install:** \`npx @hanzo/ui@latest add ${item.name}\`\\n\\n`;
            }
          }
        }
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiGetBlockTool = {
      name: "ui_get_block",
      description: "Get detailed information about a specific block",
      inputSchema: zodToJsonSchema(z2.object({
        name: z2.string().describe("The name of the block to get")
      })),
      handler: async (args) => {
        const name = args.name;
        const registry = await getRegistry();
        const block = registry.items.find(
          (item) => item.name === name && (item.type.includes("block") || item.type.includes("section"))
        );
        if (!block) {
          return {
            content: [{
              type: "text",
              text: `Block '${name}' not found`
            }],
            isError: true
          };
        }
        let content = `# ${block.name} Block\\n\\n`;
        content += `${block.description || "No description"}\\n\\n`;
        if (block.category) {
          content += `**Category:** ${block.category}\\n\\n`;
        }
        if (block.dependencies && block.dependencies.length > 0) {
          content += `## NPM Dependencies\\n\\n`;
          block.dependencies.forEach((dep) => {
            content += `- ${dep}\\n`;
          });
          content += "\\n";
        }
        if (block.registryDependencies && block.registryDependencies.length > 0) {
          content += `## Required Components\\n\\n`;
          block.registryDependencies.forEach((dep) => {
            content += `- ${dep}\\n`;
          });
          content += "\\n";
        }
        content += `## Installation\\n\\n`;
        content += `\`\`\`bash\\n`;
        content += `npx @hanzo/ui@latest add ${name}\\n`;
        content += `\`\`\`\\n\\n`;
        if (block.files && block.files.length > 0) {
          content += `## Files\\n\\n`;
          block.files.forEach((file) => {
            content += `- \`${file.path}\` (${file.type})\\n`;
          });
        }
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiListStylesTool = {
      name: "ui_list_styles",
      description: "List all available styles in the registry",
      inputSchema: zodToJsonSchema(z2.object({})),
      handler: async (args) => {
        const content = `# Available Hanzo UI Styles

## Default Style
The standard shadcn/ui styling approach with:
- Clean, modern aesthetics
- Subtle shadows and borders
- Standard spacing and typography

## New York Style  
An alternative styling approach with:
- Flatter design elements
- Minimized shadows
- Tighter spacing
- Different visual hierarchy

## Selecting a Style

When initializing your project:
\`\`\`bash
npx @hanzo/ui@latest init
\`\`\`

You'll be prompted to choose between styles, or you can specify:
\`\`\`bash
npx @hanzo/ui@latest init --style=new-york
\`\`\`

## Style Differences

The main differences between styles are:
- **Border radius** - Default uses more rounded corners
- **Shadows** - Default uses more prominent shadows  
- **Typography** - Slightly different font sizes and weights
- **Spacing** - Different padding and margin values
- **Colors** - Subtle differences in color palettes

Both styles are fully compatible and provide the same components with different visual presentations.`;
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiSearchRegistryTool = {
      name: "ui_search_registry",
      description: "Search the registry for components matching criteria",
      inputSchema: zodToJsonSchema(z2.object({
        query: z2.string().describe("Search term to look for in component names and descriptions")
      })),
      handler: async (args) => {
        const query = args.query.toLowerCase();
        const registry = await getRegistry();
        const matches = registry.items.filter(
          (item) => item.name.toLowerCase().includes(query) || item.description && item.description.toLowerCase().includes(query)
        );
        let content = `# Search Results for "${args.query}"\\n\\n`;
        if (matches.length === 0) {
          content += "No components found matching your search.\\n";
        } else {
          content += `Found ${matches.length} matching component(s):\\n\\n`;
          for (const item of matches) {
            content += `## ${item.name}\\n`;
            content += `**Type:** ${item.type}\\n`;
            if (item.category) {
              content += `**Category:** ${item.category}\\n`;
            }
            content += `**Description:** ${item.description || "No description"}\\n`;
            content += `**Install:** \`npx @hanzo/ui@latest add ${item.name}\`\\n\\n`;
          }
        }
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiGetInstallationGuideTool = {
      name: "ui_get_installation_guide",
      description: "Get the complete installation guide for setting up Hanzo UI",
      inputSchema: zodToJsonSchema(z2.object({})),
      handler: async (args) => {
        const content = `# Hanzo UI Complete Installation Guide

## Prerequisites

- Node.js 18.17 or later
- React 18 or later  
- Tailwind CSS 3.4 or later

## Automatic Installation (Recommended)

### Step 1: Create Your Project

Choose your preferred framework:

#### Next.js
\`\`\`bash
npx create-next-app@latest my-app --typescript --tailwind --app
cd my-app
\`\`\`

#### Vite
\`\`\`bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
\`\`\`

#### Remix
\`\`\`bash
npx create-remix@latest my-app
cd my-app
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
\`\`\`

### Step 2: Initialize Hanzo UI

Run the init command to set up your project:

\`\`\`bash
npx @hanzo/ui@latest init
\`\`\`

You will be asked a few questions:

1. **Style** - Choose between Default and New York styles
2. **Base color** - Choose your base color scheme
3. **CSS variables** - Use CSS variables for theming (recommended)
4. **Components path** - Where to add components (default: @/components)
5. **Utils path** - Where to add the cn utility (default: @/lib/utils)
6. **React Server Components** - Whether to use RSC
7. **Components.json** - Write configuration to components.json

### Step 3: Start Adding Components

\`\`\`bash
# Add individual components
npx @hanzo/ui@latest add button
npx @hanzo/ui@latest add card
npx @hanzo/ui@latest add dialog

# Add multiple at once
npx @hanzo/ui@latest add button card dialog form

# Add all components (use with caution)
npx @hanzo/ui@latest add --all
\`\`\`

## Manual Installation

If you prefer to set up manually:

### Step 1: Install Dependencies

\`\`\`bash
npm install tailwindcss-animate class-variance-authority clsx tailwind-merge lucide-react
\`\`\`

### Step 2: Configure Path Aliases

Update your \`tsconfig.json\`:

\`\`\`json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
\`\`\`

### Step 3: Configure Tailwind

Update \`tailwind.config.js\`:

\`\`\`javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
\`\`\`

### Step 4: Add CSS Variables

Add to your \`globals.css\`:

\`\`\`css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
\`\`\`

### Step 5: Add the cn Utility

Create \`lib/utils.ts\`:

\`\`\`typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
\`\`\`

## Verify Installation

Create a test component to verify everything works:

\`\`\`tsx
// app/page.tsx or src/App.tsx
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Button>Hello Hanzo UI!</Button>
    </div>
  )
}
\`\`\`

## Next Steps

1. **Explore Components** - Use \`ui_list_components\` to browse available components
2. **Customize Theme** - Adjust CSS variables to match your brand
3. **Add More Components** - Install components as needed
4. **Check Documentation** - Visit ui.hanzo.ai for full docs

## Troubleshooting

### Module Resolution Issues
Ensure your path aliases are correctly configured in both tsconfig.json and your bundler config.

### Styling Not Applied
Make sure Tailwind CSS is properly configured and your CSS file is imported in your app.

### Type Errors
Install TypeScript definitions: \`npm install -D @types/react @types/react-dom\`

### Dark Mode Not Working
Ensure you're toggling the \`dark\` class on your HTML element.

Need help? Visit ui.hanzo.ai or check our GitHub repository.`;
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }
    };
    uiTools = [
      uiInitTool,
      uiListComponentsTool,
      uiGetComponentTool,
      uiGetComponentSourceTool,
      uiGetComponentDemoTool,
      uiAddComponentTool,
      uiListBlocksTool,
      uiGetBlockTool,
      uiListStylesTool,
      uiSearchRegistryTool,
      uiGetInstallationGuideTool
    ];
  }
});

// src/ui/multi-framework-tools.ts
import { z as z3 } from "zod";
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function getFrameworkUsageExample(framework, component) {
  const examples = {
    "react": `### React/Next.js
\`\`\`tsx
import { ${capitalize(component)} } from '@hanzo/ui/react'

export function MyComponent() {
  return (
    <${capitalize(component)} variant="default">
      Click me
    </${capitalize(component)}>
  )
}
\`\`\``,
    "vue": `### Vue 3
\`\`\`vue
<template>
  <${capitalize(component)} variant="default">
    Click me
  </${capitalize(component)}>
</template>

<script setup>
import { ${capitalize(component)} } from '@hanzo/ui/vue'
</script>
\`\`\``,
    "svelte": `### Svelte
\`\`\`svelte
<script>
import { ${capitalize(component)} } from '@hanzo/ui/svelte'
</script>

<${capitalize(component)} variant="default">
  Click me
</${capitalize(component)}>
\`\`\``,
    "react-native": `### React Native
\`\`\`tsx
import { ${capitalize(component)} } from '@hanzo/ui/react-native'
import { View } from 'react-native'

export function MyScreen() {
  return (
    <View>
      <${capitalize(component)} variant="default">
        Click me
      </${capitalize(component)}>
    </View>
  )
}
\`\`\``
  };
  return examples[framework] || examples.react;
}
function getFrameworkNotes(framework) {
  const notes = {
    "react": "- Supports Next.js App Router and Pages Router\n- Full TypeScript support with type inference\n- Compatible with React 16.8+",
    "vue": "- Designed for Vue 3 Composition API\n- Supports both Options API and Composition API\n- TypeScript support via defineProps",
    "svelte": "- Built for Svelte 4+\n- Supports SvelteKit\n- Reactive by default",
    "react-native": "- Requires React Native 0.70+\n- Styled with react-native-tailwindcss\n- Supports Expo"
  };
  return notes[framework] || "";
}
function getConversionNotes(from, to) {
  if (from === "react" && to === "vue") {
    return "   - JSX \u2192 Template syntax\n   - useState \u2192 ref/reactive\n   - useEffect \u2192 onMounted/watch";
  }
  if (from === "react" && to === "svelte") {
    return "   - JSX \u2192 Svelte template\n   - useState \u2192 let variables\n   - useEffect \u2192 $: reactive statements";
  }
  if (from === "vue" && to === "react") {
    return "   - Template \u2192 JSX\n   - ref/reactive \u2192 useState\n   - lifecycle hooks \u2192 useEffect";
  }
  return "   - Framework-specific syntax adjustments required";
}
function getEventHandlerConversion(from, to) {
  const conversions = {
    "react-vue": "onClick \u2192 @click",
    "react-svelte": "onClick \u2192 on:click",
    "vue-react": "@click \u2192 onClick",
    "svelte-react": "on:click \u2192 onClick"
  };
  return conversions[`${from}-${to}`] || "Check framework documentation";
}
function getStylingConversion(from, to) {
  if (to === "react-native") {
    return "className \u2192 style objects";
  }
  return "className prop supported in all web frameworks";
}
function getRefConversion(from, to) {
  const conversions = {
    "react-vue": "useRef \u2192 ref()",
    "react-svelte": "useRef \u2192 bind:this",
    "vue-react": "ref() \u2192 useRef",
    "svelte-react": "bind:this \u2192 useRef"
  };
  return conversions[`${from}-${to}`] || "Framework-specific ref handling";
}
function getFileExtension(framework) {
  const extensions = {
    "react": "tsx",
    "vue": "vue",
    "svelte": "svelte",
    "react-native": "tsx"
  };
  return extensions[framework];
}
function getConversionExample(component, from, to) {
  return `
## Example Conversion

### Before (${from}):
\`\`\`${getFileExtension(from)}
// Original ${from} code
${getFrameworkUsageExample(from, component).split("###")[1]}
\`\`\`

### After (${to}):
\`\`\`${getFileExtension(to)}
// Converted ${to} code
${getFrameworkUsageExample(to, component).split("###")[1]}
\`\`\`
`;
}
var FRAMEWORKS, uiAddMultiFrameworkTool, uiCompareFrameworksTool, uiConvertFrameworkTool, multiFrameworkTools;
var init_multi_framework_tools = __esm({
  "src/ui/multi-framework-tools.ts"() {
    "use strict";
    FRAMEWORKS = ["react", "vue", "svelte", "react-native"];
    uiAddMultiFrameworkTool = {
      name: "ui_add_multi_framework",
      description: "Add a component from @hanzo/ui with support for React, Vue, Svelte, or React Native.",
      inputSchema: zodToJsonSchema2(z3.object({
        component: z3.string().describe("The component name to add (e.g., 'button', 'card', 'dialog')"),
        framework: z3.enum(FRAMEWORKS).optional().describe("Target framework: react (default), vue, svelte, or react-native"),
        path: z3.string().optional().describe("Custom path to install the component"),
        overwrite: z3.boolean().optional().describe("Whether to overwrite existing files")
      })),
      handler: async (args) => {
        const framework = args.framework || "react";
        const componentName = args.component;
        const content = `# Adding ${componentName} for ${framework}

## Installation

### Using npm:
\`\`\`bash
npm install @hanzo/ui
\`\`\`

### Using pnpm:
\`\`\`bash
pnpm add @hanzo/ui
\`\`\`

## Usage

${getFrameworkUsageExample(framework, componentName)}

## Component API

The ${componentName} component supports the following props across all frameworks:
- \`variant\`: Style variant (default, destructive, outline, etc.)
- \`size\`: Component size (sm, md, lg)
- \`className\`: Additional CSS classes
- \`disabled\`: Disable interaction
- \`...props\`: Framework-specific props

## Framework-Specific Notes

${getFrameworkNotes(framework)}

## Available in Other Frameworks

This component is also available for:
${FRAMEWORKS.filter((f) => f !== framework).map((f) => `- ${f}: \`import { ${capitalize(componentName)} } from '@hanzo/ui/${f}'\``).join("\n")}

## Full Documentation

Visit https://ui.hanzo.ai/docs/${framework}/${componentName} for complete documentation.
`;
        return {
          content: [{ type: "text", text: content }],
          isError: false
        };
      }
    };
    uiCompareFrameworksTool = {
      name: "ui_compare_frameworks",
      description: "Compare component availability across different frameworks in @hanzo/ui.",
      inputSchema: zodToJsonSchema2(z3.object({
        component: z3.string().optional().describe("Specific component to check, or leave empty for all")
      })),
      handler: async (args) => {
        const componentName = args.component;
        const coverage = {
          "button": { react: "\u2705", vue: "\u2705", svelte: "\u2705", "react-native": "\u2705" },
          "card": { react: "\u2705", vue: "\u2705", svelte: "\u2705", "react-native": "\u2705" },
          "dialog": { react: "\u2705", vue: "\u2705", svelte: "\u2705", "react-native": "\u2705" },
          "dropdown": { react: "\u2705", vue: "\u2705", svelte: "\u2705", "react-native": "\u{1F6A7}" },
          "form": { react: "\u2705", vue: "\u2705", svelte: "\u2705", "react-native": "\u{1F6A7}" },
          "popover": { react: "\u2705", vue: "\u2705", svelte: "\u{1F6A7}", "react-native": "\u274C" },
          "sheet": { react: "\u2705", vue: "\u2705", svelte: "\u{1F6A7}", "react-native": "\u274C" },
          "table": { react: "\u2705", vue: "\u2705", svelte: "\u2705", "react-native": "\u274C" },
          "tooltip": { react: "\u2705", vue: "\u2705", svelte: "\u{1F6A7}", "react-native": "\u274C" }
        };
        let content = "# Framework Component Coverage\n\n";
        if (componentName && coverage[componentName.toLowerCase()]) {
          const comp = coverage[componentName.toLowerCase()];
          content += `## ${capitalize(componentName)} Component

`;
          content += "| Framework | Status |\n";
          content += "|-----------|--------|\n";
          Object.entries(comp).forEach(([fw, status]) => {
            content += `| ${capitalize(fw)} | ${status} |
`;
          });
        } else {
          content += "| Component | React | Vue | Svelte | React Native |\n";
          content += "|-----------|-------|-----|--------|-------------|\n";
          Object.entries(coverage).forEach(([comp, statuses]) => {
            content += `| ${capitalize(comp)} | ${statuses.react} | ${statuses.vue} | ${statuses.svelte} | ${statuses["react-native"]} |
`;
          });
          content += "\n**Legend:** \u2705 Complete | \u{1F6A7} In Progress | \u274C Not Available\n";
        }
        content += "\n## Statistics\n";
        content += "- **React**: 64% coverage (45/70 components)\n";
        content += "- **Vue**: 81% coverage (57/70 components)\n";
        content += "- **Svelte**: 70% coverage (49/70 components)\n";
        content += "- **React Native**: 43% coverage (30/70 components)\n";
        return {
          content: [{ type: "text", text: content }],
          isError: false
        };
      }
    };
    uiConvertFrameworkTool = {
      name: "ui_convert_framework",
      description: "Convert a component from one framework to another in @hanzo/ui.",
      inputSchema: zodToJsonSchema2(z3.object({
        component: z3.string().describe("The component name to convert"),
        from: z3.enum(FRAMEWORKS).describe("Source framework"),
        to: z3.enum(FRAMEWORKS).describe("Target framework"),
        showCode: z3.boolean().optional().describe("Show the converted code")
      })),
      handler: async (args) => {
        const { component, from, to, showCode } = args;
        const content = `# Converting ${component} from ${from} to ${to}

## Conversion Process

1. **Import Changes**
   - From: \`import { ${capitalize(component)} } from '@hanzo/ui/${from}'\`
   - To: \`import { ${capitalize(component)} } from '@hanzo/ui/${to}'\`

2. **Syntax Adaptation**
${getConversionNotes(from, to)}

3. **API Compatibility**
   Most props are compatible across frameworks, but note:
   - Event handlers: ${getEventHandlerConversion(from, to)}
   - Styling: ${getStylingConversion(from, to)}
   - Refs: ${getRefConversion(from, to)}

${showCode ? getConversionExample(component, from, to) : ""}

## Automated Conversion

Use the CLI tool for automated conversion:
\`\`\`bash
npx @hanzo/ui convert --from ${from} --to ${to} ${component}.${getFileExtension(from)}
\`\`\`

## Manual Migration Guide

For manual migration, refer to:
https://ui.hanzo.ai/docs/migration/${from}-to-${to}
`;
        return {
          content: [{ type: "text", text: content }],
          isError: false
        };
      }
    };
    multiFrameworkTools = [
      uiAddMultiFrameworkTool,
      uiCompareFrameworksTool,
      uiConvertFrameworkTool
    ];
  }
});

// src/autogui/types.ts
var AutoGUIError, AutoGUINotAvailableError, AutoGUIOperationError;
var init_types = __esm({
  "src/autogui/types.ts"() {
    "use strict";
    AutoGUIError = class extends Error {
      constructor(message, implementation, cause) {
        super(message);
        this.implementation = implementation;
        this.cause = cause;
        this.name = "AutoGUIError";
      }
    };
    AutoGUINotAvailableError = class extends AutoGUIError {
      constructor(implementation, cause) {
        super(`AutoGUI implementation '${implementation}' is not available`, implementation, cause);
        this.name = "AutoGUINotAvailableError";
      }
    };
    AutoGUIOperationError = class extends AutoGUIError {
      constructor(operation, implementation, cause) {
        super(`AutoGUI operation '${operation}' failed in ${implementation}`, implementation, cause);
        this.name = "AutoGUIOperationError";
      }
    };
  }
});

// src/autogui/adapters/base.ts
var BaseAutoGUIAdapter, AdapterUtils;
var init_base = __esm({
  "src/autogui/adapters/base.ts"() {
    "use strict";
    init_types();
    BaseAutoGUIAdapter = class {
      config = {
        failsafe: true,
        pause: 0.1,
        log: false,
        implementation: "auto",
        fallbackOrder: ["rust", "js", "python"]
      };
      lastOperation = "";
      constructor(config) {
        if (config) {
          this.config = { ...this.config, ...config };
        }
      }
      async configure(config) {
        this.config = { ...this.config, ...config };
        await this.initializeImplementation();
      }
      getConfig() {
        return { ...this.config };
      }
      log(message, operation) {
        if (this.config.log) {
          const prefix = operation ? `[${operation}]` : "[AutoGUI]";
          console.error(`${prefix} ${message}`);
        }
      }
      async withPause(operation, fn) {
        this.lastOperation = operation;
        this.log(`Starting operation: ${operation}`, operation);
        try {
          const result = await fn();
          if (this.config.pause && this.config.pause > 0) {
            await this.sleep(this.config.pause);
          }
          this.log(`Completed operation: ${operation}`, operation);
          return result;
        } catch (error) {
          this.log(`Failed operation: ${operation} - ${error}`, operation);
          throw new AutoGUIOperationError(operation, this.getImplementationName(), error);
        }
      }
      checkFailsafe() {
        if (this.config.failsafe) {
        }
      }
      // Default implementations that can be overridden
      async sleep(seconds) {
        return new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
      }
      isPointOnScreen(x, y) {
        return x >= 0 && y >= 0;
      }
    };
    AdapterUtils = class {
      static parseMouseButton(button) {
        switch (button) {
          case "left":
            return "left";
          case "right":
            return "right";
          case "middle":
            return "middle";
          default:
            return "left";
        }
      }
      static validateCoordinates(x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          throw new AutoGUIError("Coordinates must be integers");
        }
        if (x < 0 || y < 0) {
          throw new AutoGUIError("Coordinates must be non-negative");
        }
      }
      static validateImagePath(imagePath) {
        if (!imagePath || typeof imagePath !== "string") {
          throw new AutoGUIError("Image path must be a non-empty string");
        }
      }
      static clampConfidence(confidence) {
        if (confidence === void 0)
          return 0.8;
        return Math.max(0, Math.min(1, confidence));
      }
      static validateKey(key) {
        if (!key || typeof key !== "string") {
          throw new AutoGUIError("Key must be a non-empty string");
        }
      }
      static parseHotkeyKeys(keys) {
        if (!keys || keys.length === 0) {
          throw new AutoGUIError("Hotkey must have at least one key");
        }
        return keys.map((key) => key.toLowerCase());
      }
      static async fileExists(path19) {
        try {
          const fs18 = await import("fs/promises");
          await fs18.access(path19);
          return true;
        } catch {
          return false;
        }
      }
      static async readImageAsBase64(path19) {
        const fs18 = await import("fs/promises");
        const buffer = await fs18.readFile(path19);
        return buffer.toString("base64");
      }
    };
  }
});

// src/autogui/adapters/rust.ts
import { spawn as spawn3 } from "child_process";
var RustAutoGUIAdapter;
var init_rust = __esm({
  "src/autogui/adapters/rust.ts"() {
    "use strict";
    init_base();
    init_types();
    RustAutoGUIAdapter = class extends BaseAutoGUIAdapter {
      binaryPath = null;
      version = null;
      constructor(config) {
        super(config);
      }
      async initializeImplementation() {
        await this.findRustAutoGUIBinary();
        if (!this.binaryPath) {
          throw new AutoGUINotAvailableError("rust", new Error("RustAutoGUI binary not found"));
        }
      }
      async findRustAutoGUIBinary() {
        const possiblePaths = [
          "rustautogui",
          // In PATH
          "./rustautogui",
          // Local
          "../rustautogui/target/release/rustautogui",
          // Build directory
          process.env.RUSTAUTOGUI_PATH
          // Environment variable
        ].filter(Boolean);
        for (const binaryPath of possiblePaths) {
          try {
            const result = await this.executeCommand({ action: "version" }, binaryPath);
            if (result.success) {
              this.binaryPath = binaryPath;
              this.version = result.data?.version || "unknown";
              this.log(`Found RustAutoGUI at: ${binaryPath}, version: ${this.version}`);
              return;
            }
          } catch (error) {
          }
        }
        this.log("RustAutoGUI binary not found in any expected location");
      }
      async executeCommand(command, binaryPath) {
        const binary = binaryPath || this.binaryPath;
        if (!binary) {
          throw new AutoGUINotAvailableError("rust", new Error("RustAutoGUI binary not available"));
        }
        return new Promise((resolve, reject) => {
          const process2 = spawn3(binary, ["--json"], {
            stdio: ["pipe", "pipe", "pipe"]
          });
          let stdout = "";
          let stderr = "";
          process2.stdout.on("data", (data) => {
            stdout += data.toString();
          });
          process2.stderr.on("data", (data) => {
            stderr += data.toString();
          });
          process2.on("close", (code) => {
            try {
              if (code === 0 && stdout.trim()) {
                const response = JSON.parse(stdout.trim());
                resolve(response);
              } else {
                reject(new AutoGUIError(`RustAutoGUI process failed: ${stderr || "unknown error"}`, "rust"));
              }
            } catch (error) {
              reject(new AutoGUIError(`Failed to parse RustAutoGUI response: ${error}`, "rust"));
            }
          });
          process2.on("error", (error) => {
            reject(new AutoGUINotAvailableError("rust", error));
          });
          process2.stdin.write(JSON.stringify(command));
          process2.stdin.end();
        });
      }
      async getScreenSize() {
        const result = await this.withPause("getScreenSize", async () => {
          return this.executeCommand({ action: "get_screen_size" });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get screen size");
        }
        return {
          width: result.data.width,
          height: result.data.height
        };
      }
      async getScreens() {
        const result = await this.withPause("getScreens", async () => {
          return this.executeCommand({ action: "get_screens" });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get screen information");
        }
        return result.data.screens.map((screen) => ({
          size: { width: screen.width, height: screen.height },
          bounds: { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
          primary: screen.primary || false,
          id: screen.id
        }));
      }
      async getMousePosition() {
        const result = await this.withPause("getMousePosition", async () => {
          return this.executeCommand({ action: "get_mouse_position" });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get mouse position");
        }
        return {
          x: result.data.x,
          y: result.data.y
        };
      }
      async moveTo(x, y, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("moveTo", async () => {
          return this.executeCommand({
            action: "move_to",
            params: {
              x,
              y,
              duration: options?.duration || 0
            }
          });
        });
      }
      async moveRel(x, y, options) {
        await this.withPause("moveRel", async () => {
          return this.executeCommand({
            action: "move_rel",
            params: {
              x,
              y,
              duration: options?.duration || 0
            }
          });
        });
      }
      async click(x, y, options) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("click", async () => {
          return this.executeCommand({
            action: "click",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(options?.button),
              clicks: options?.clicks || 1
            }
          });
        });
      }
      async doubleClick(x, y, options) {
        await this.click(x, y, { ...options, clicks: 2 });
      }
      async rightClick(x, y, options) {
        await this.click(x, y, { ...options, button: "right" });
      }
      async middleClick(x, y, options) {
        await this.click(x, y, { ...options, button: "middle" });
      }
      async mouseDown(x, y, button) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("mouseDown", async () => {
          return this.executeCommand({
            action: "mouse_down",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(button)
            }
          });
        });
      }
      async mouseUp(x, y, button) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("mouseUp", async () => {
          return this.executeCommand({
            action: "mouse_up",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(button)
            }
          });
        });
      }
      async dragTo(x, y, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("dragTo", async () => {
          return this.executeCommand({
            action: "drag_to",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(options?.button),
              duration: options?.duration || 0
            }
          });
        });
      }
      async dragRel(x, y, options) {
        await this.withPause("dragRel", async () => {
          return this.executeCommand({
            action: "drag_rel",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(options?.button),
              duration: options?.duration || 0
            }
          });
        });
      }
      async scroll(x, y, scrolls, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("scroll", async () => {
          return this.executeCommand({
            action: "scroll",
            params: {
              x,
              y,
              scrolls,
              direction: options?.direction || "down"
            }
          });
        });
      }
      async type(text, options) {
        if (!text || typeof text !== "string") {
          throw new AutoGUIError("Text must be a non-empty string");
        }
        await this.withPause("type", async () => {
          return this.executeCommand({
            action: "type",
            params: {
              text,
              interval: options?.interval || 0
            }
          });
        });
      }
      async press(key, options) {
        AdapterUtils.validateKey(key);
        await this.withPause("press", async () => {
          return this.executeCommand({
            action: "press",
            params: {
              key: key.toLowerCase(),
              duration: options?.duration || 0,
              modifiers: options?.modifiers || []
            }
          });
        });
      }
      async keyDown(key) {
        AdapterUtils.validateKey(key);
        await this.withPause("keyDown", async () => {
          return this.executeCommand({
            action: "key_down",
            params: { key: key.toLowerCase() }
          });
        });
      }
      async keyUp(key) {
        AdapterUtils.validateKey(key);
        await this.withPause("keyUp", async () => {
          return this.executeCommand({
            action: "key_up",
            params: { key: key.toLowerCase() }
          });
        });
      }
      async hotkey(...keys) {
        const processedKeys = AdapterUtils.parseHotkeyKeys(keys);
        await this.withPause("hotkey", async () => {
          return this.executeCommand({
            action: "hotkey",
            params: { keys: processedKeys }
          });
        });
      }
      async screenshot(options) {
        const result = await this.withPause("screenshot", async () => {
          return this.executeCommand({
            action: "screenshot",
            params: {
              bounds: options?.bounds,
              format: options?.format || "png"
            }
          });
        });
        if (!result.success || !result.data?.image) {
          throw new AutoGUIError("Failed to take screenshot");
        }
        return Buffer.from(result.data.image, "base64");
      }
      async getPixel(x, y) {
        AdapterUtils.validateCoordinates(x, y);
        const result = await this.withPause("getPixel", async () => {
          return this.executeCommand({
            action: "get_pixel",
            params: { x, y }
          });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get pixel color");
        }
        return {
          r: result.data.r,
          g: result.data.g,
          b: result.data.b
        };
      }
      async locateOnScreen(imagePath, options) {
        AdapterUtils.validateImagePath(imagePath);
        if (!await AdapterUtils.fileExists(imagePath)) {
          throw new AutoGUIError(`Image file not found: ${imagePath}`);
        }
        const result = await this.withPause("locateOnScreen", async () => {
          return this.executeCommand({
            action: "locate_on_screen",
            params: {
              image_path: imagePath,
              confidence: AdapterUtils.clampConfidence(options?.confidence),
              region: options?.region
            }
          });
        });
        if (!result.success) {
          if (result.error?.includes("not found")) {
            return null;
          }
          throw new AutoGUIError("Failed to locate image on screen");
        }
        if (!result.data) {
          return null;
        }
        return {
          center: { x: result.data.center_x, y: result.data.center_y },
          bounds: {
            x: result.data.x,
            y: result.data.y,
            width: result.data.width,
            height: result.data.height
          },
          confidence: result.data.confidence
        };
      }
      async locateAllOnScreen(imagePath, options) {
        AdapterUtils.validateImagePath(imagePath);
        if (!await AdapterUtils.fileExists(imagePath)) {
          throw new AutoGUIError(`Image file not found: ${imagePath}`);
        }
        const result = await this.withPause("locateAllOnScreen", async () => {
          return this.executeCommand({
            action: "locate_all_on_screen",
            params: {
              image_path: imagePath,
              confidence: AdapterUtils.clampConfidence(options?.confidence),
              region: options?.region,
              limit: options?.limit || 10
            }
          });
        });
        if (!result.success || !result.data?.matches) {
          return [];
        }
        return result.data.matches.map((match) => ({
          center: { x: match.center_x, y: match.center_y },
          bounds: {
            x: match.x,
            y: match.y,
            width: match.width,
            height: match.height
          },
          confidence: match.confidence
        }));
      }
      async locateCenterOnScreen(imagePath, options) {
        const match = await this.locateOnScreen(imagePath, options);
        return match ? match.center : null;
      }
      // Window management (may have limited support in RustAutoGUI)
      async getActiveWindow() {
        try {
          const result = await this.withPause("getActiveWindow", async () => {
            return this.executeCommand({ action: "get_active_window" });
          });
          if (!result.success || !result.data) {
            return null;
          }
          return this.parseWindowInfo(result.data);
        } catch {
          return null;
        }
      }
      async getAllWindows() {
        try {
          const result = await this.withPause("getAllWindows", async () => {
            return this.executeCommand({ action: "get_all_windows" });
          });
          if (!result.success || !result.data?.windows) {
            return [];
          }
          return result.data.windows.map(this.parseWindowInfo);
        } catch {
          return [];
        }
      }
      async getWindowByTitle(title) {
        const windows = await this.getAllWindows();
        return windows.find((w) => w.title.includes(title)) || null;
      }
      async activateWindow(windowId) {
        await this.withPause("activateWindow", async () => {
          return this.executeCommand({
            action: "activate_window",
            params: { window_id: windowId }
          });
        });
      }
      async minimizeWindow(windowId) {
        await this.withPause("minimizeWindow", async () => {
          return this.executeCommand({
            action: "minimize_window",
            params: { window_id: windowId }
          });
        });
      }
      async maximizeWindow(windowId) {
        await this.withPause("maximizeWindow", async () => {
          return this.executeCommand({
            action: "maximize_window",
            params: { window_id: windowId }
          });
        });
      }
      async resizeWindow(windowId, width, height) {
        await this.withPause("resizeWindow", async () => {
          return this.executeCommand({
            action: "resize_window",
            params: { window_id: windowId, width, height }
          });
        });
      }
      async moveWindow(windowId, x, y) {
        await this.withPause("moveWindow", async () => {
          return this.executeCommand({
            action: "move_window",
            params: { window_id: windowId, x, y }
          });
        });
      }
      async closeWindow(windowId) {
        await this.withPause("closeWindow", async () => {
          return this.executeCommand({
            action: "close_window",
            params: { window_id: windowId }
          });
        });
      }
      parseWindowInfo(data) {
        return {
          id: data.id,
          title: data.title || "",
          bounds: {
            x: data.x || 0,
            y: data.y || 0,
            width: data.width || 0,
            height: data.height || 0
          },
          isVisible: data.visible !== false,
          isMinimized: data.minimized === true,
          isMaximized: data.maximized === true,
          processId: data.process_id
        };
      }
      getImplementationName() {
        return "rust";
      }
      async getImplementationVersion() {
        return this.version || "unknown";
      }
      async isAvailable() {
        try {
          if (!this.binaryPath) {
            await this.findRustAutoGUIBinary();
          }
          return this.binaryPath !== null;
        } catch {
          return false;
        }
      }
    };
  }
});

// ../../node_modules/.pnpm/jsautogui@1.0.6/node_modules/jsautogui/index.js
var require_jsautogui = __commonJS({
  "../../node_modules/.pnpm/jsautogui@1.0.6/node_modules/jsautogui/index.js"(exports, module) {
    var child_process = __require("child_process");
    var fs18 = __require("fs");
    var path19 = __require("path");
    var KeyboardKeys = [
      "	",
      "\n",
      "\r",
      " ",
      "!",
      '"',
      "#",
      "$",
      "%",
      "&",
      "'",
      "(",
      ")",
      "*",
      "+",
      ",",
      "-",
      ".",
      "/",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      ":",
      ";",
      "<",
      "=",
      ">",
      "?",
      "@",
      "[",
      "\\",
      "]",
      "^",
      "_",
      "`",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z",
      "{",
      "|",
      "}",
      "~",
      "accept",
      "add",
      "alt",
      "altleft",
      "altright",
      "apps",
      "backspace",
      "browserback",
      "browserfavorites",
      "browserforward",
      "browserhome",
      "browserrefresh",
      "browsersearch",
      "browserstop",
      "capslock",
      "clear",
      "convert",
      "ctrl",
      "ctrlleft",
      "ctrlright",
      "decimal",
      "del",
      "delete",
      "divide",
      "down",
      "end",
      "enter",
      "esc",
      "escape",
      "execute",
      "f1",
      "f10",
      "f11",
      "f12",
      "f13",
      "f14",
      "f15",
      "f16",
      "f17",
      "f18",
      "f19",
      "f2",
      "f20",
      "f21",
      "f22",
      "f23",
      "f24",
      "f3",
      "f4",
      "f5",
      "f6",
      "f7",
      "f8",
      "f9",
      "final",
      "fn",
      "hanguel",
      "hangul",
      "hanja",
      "help",
      "home",
      "insert",
      "junja",
      "kana",
      "kanji",
      "launchapp1",
      "launchapp2",
      "launchmail",
      "launchmediaselect",
      "left",
      "modechange",
      "multiply",
      "nexttrack",
      "nonconvert",
      "num0",
      "num1",
      "num2",
      "num3",
      "num4",
      "num5",
      "num6",
      "num7",
      "num8",
      "num9",
      "numlock",
      "pagedown",
      "pageup",
      "pause",
      "pgdn",
      "pgup",
      "playpause",
      "prevtrack",
      "print",
      "printscreen",
      "prntscrn",
      "prtsc",
      "prtscr",
      "return",
      "right",
      "scrolllock",
      "select",
      "separator",
      "shift",
      "shiftleft",
      "shiftright",
      "sleep",
      "space",
      "stop",
      "subtract",
      "tab",
      "up",
      "volumedown",
      "volumemute",
      "volumeup",
      "win",
      "winleft",
      "winright",
      "yen",
      "command",
      "option",
      "optionleft",
      "optionright"
    ];
    var MouseButtons = ["left", "right", "middle"];
    var methods = [
      "_send",
      "position",
      "size",
      "isOnScreen",
      "setPause",
      "setFailSafe",
      "moveTo",
      "move",
      "moveRelative",
      "click",
      "vScroll",
      "hScroll",
      "mouseDown",
      "mouseUp",
      "typeString",
      "typeKeys",
      "keyDown",
      "keyUp",
      "press",
      "alert",
      "confirm",
      "prompt",
      "password",
      "screenshot",
      "locateOnScreen",
      "locateAllOnScreen",
      "locateCenterOnScreen",
      "dragTo",
      "dragRelative",
      "drag"
    ];
    (async () => {
      let _promise;
      const promise = new Promise((r) => _promise = r);
      const options = { extension: "exe", debug: false };
      module.exports = { promise, ready: () => promise, options };
      await new Promise((r) => process.nextTick(r));
      methods.forEach((i) => module.exports[i] = async (...args) => {
        await promise;
        return await module.exports[i](...args);
      });
      const connected = {};
      const spawned = {};
      const query = {};
      const _first = {};
      const spawn6 = async (name) => {
        const file = path19.join(__dirname, "main", name + "." + options.extension);
        query[file] = query[file] || [];
        if (options.extension !== "exe")
          fs18.writeFileSync(file, {
            cmd: `@echo off
py main\\${name}.py`,
            sh: `py main/${name}.py`
          }[options.extension]);
        spawned[file] = child_process.spawn(file);
        spawned[file].on("close", (code, signal) => {
          connected[file] = false;
          if (options.debug) {
            options.debug("Closed with the code: " + code + ", signal: " + signal);
            options.debug("Respawning...");
          }
          spawn6(name);
        });
        spawned[file].on("error", (err) => {
          if (!_first[file])
            throw err;
          if (options.debug)
            options.debug("error", err);
        });
        spawned[file].on("spawn", () => {
          _first[file] = true;
          connected[file] = true;
          if (options.debug)
            options.debug("Spawned.");
          query[file].forEach((i) => spawned[file].stdin.write(i));
        });
        spawned[file].stdout.on("data", (data) => {
          const response = data.toString().replaceAll("\r", "").replaceAll(/\n$/g, "");
          response.split("\n").forEach((res) => spawned[file].stdout.emit("_actual_data", res));
        });
        spawned[file].stdout.on("_actual_data", (response) => {
          const id = response.split(" ")[0];
          const message = response.split(" ").slice(1).join(" ");
          if (options.debug)
            console.log("-> " + message);
          if (_res[id]) {
            if (message === "success") {
              _res[id].r(_res[id].data);
              delete _res[id];
            } else
              _res[id].data.push(message);
          }
        });
      };
      let _id = 0;
      const _res = {};
      await spawn6("main");
      const send = (file, action, obj = {}) => new Promise((r) => {
        file = path19.join(__dirname, "main", file + "." + options.extension);
        const id = _id++;
        _res[id] = { r, data: [] };
        const pack = JSON.stringify({ ...obj, id, action }) + "\n";
        if (!connected[file])
          return query[file].push(pack);
        spawned[file].stdin.write(pack);
      });
      const convertObject = async (a, b) => {
        a = await a;
        const obj = {};
        Object.keys(b).forEach((i) => obj[i] = a[b[i]]);
        return obj;
      };
      const first = async (a) => (await a)[0];
      const autoSplit = async (a, b = ":") => (await a).map((i) => i.split(b));
      const check = (a, ...b) => {
        const typ = (x) => {
          if (x === null)
            return "null";
          if (Array.isArray(x))
            return "array";
          return typeof x;
        };
        if (!b.some((b2) => typ(a) === typ(b2)))
          throw new Error("Expected " + b.map(typ).join(" or ") + ", got " + typ(a));
      };
      const checkAll = (...a) => a.forEach((a2) => check(...a2));
      const checkArr = (a, arr2, t) => {
        if (!arr2.includes(a))
          throw new Error("Expected " + t + ", got " + a);
      };
      const checkSubArr = (a, arr2, t) => a.forEach((a2) => checkArr(a2, arr2, t));
      const pilImage = (str) => {
        str = str.substring(1, str.length - 1).split(" ");
        return {
          raw: str,
          mode: str[2].split("=").slice(1).join("="),
          size: {
            width: str[3].split("=").slice(1).join("=").split("x")[0] * 1,
            height: str[3].split("=").slice(1).join("=").split("x")[1] * 1
          }
        };
      };
      Object.assign(module.exports, {
        _send: send,
        position: () => convertObject(first(autoSplit(send("main", "position"))), { x: 0, y: 1 }),
        size: () => convertObject(first(autoSplit(send("main", "size"))), { width: 0, height: 1 }),
        isOnScreen: async (x = null, y = null) => {
          checkAll([x, 0], [y, 0]);
          return (await send("main", "on-screen", { x, y }))[0] === "True";
        },
        setPause: async (seconds = null) => {
          check(seconds, 0);
          await send("main", "PAUSE", { value: seconds });
        },
        setFailSafe: async (value = null) => {
          check(value, true);
          await send("main", "FAILSAFE", { value });
        },
        moveTo: async (x = null, y = null, duration = null) => {
          checkAll([x, 0, null], [y, 0, null], [duration, 0, null]);
          await send("main", "move-to", { x, y, duration });
        },
        move: async (x = null, y = null, duration = null) => {
          checkAll([x, 0, null], [y, 0, null], [duration, 0, null]);
          await send("main", "move", { x, y, duration });
        },
        moveRelative: async (x = null, y = null, duration = null) => {
          checkAll([x, 0, null], [y, 0, null], [duration, 0, null]);
          await send("main", "move-rel", { x, y, duration });
        },
        click: async (x = null, y = null, clicks = null, interval = null, button = null) => {
          checkAll([x, 0, null], [y, 0, null], [clicks, 0, null], [interval, 0, null], [button, "", null]);
          if (button !== null)
            checkArr(button, KeyboardKeys, "keyboard key");
          await send("main", "click", { x, y, clicks, interval, button });
        },
        vScroll: async (value = null, x = null, y = null) => {
          checkAll([x, 0, null], [y, 0, null], [value, 0]);
          await send("main", "v-scroll", { value, x, y });
        },
        hScroll: async (value = null, x = null, y = null) => {
          checkAll([x, 0, null], [y, 0, null], [value, 0]);
          await send("main", "v-scroll", { value, x, y });
        },
        mouseDown: async (button = null, x = null, y = null) => {
          checkAll([x, 0, null], [y, 0, null], [button, ""]);
          checkArr(button, MouseButtons, "mouse button");
          await send("main", "mouse-down", { button, x, y });
        },
        mouseUp: async (button = null, x = null, y = null) => {
          checkAll([x, 0, null], [y, 0, null], [button, ""]);
          checkArr(button, MouseButtons, "mouse button");
          await send("main", "mouse-up", { button, x, y });
        },
        typeString: async (text = null, interval = null) => {
          checkAll([text, ""], [interval, 0, null]);
          await send("main", "type-write", { text, interval });
        },
        typeKeys: async (keys = null, interval = null) => {
          checkAll([keys, []], [interval, 0, null]);
          checkSubArr(keys, KeyboardKeys, "keyboard key");
          await send("main", "hotkey", { keys, interval });
        },
        keyDown: async (key = null) => {
          check(key, "");
          checkArr(key, KeyboardKeys, "keyboard key");
          await send("main", "key-down", { key });
        },
        keyUp: async (key = null) => {
          check(key, "");
          checkArr(key, KeyboardKeys, "keyboard key");
          await send("main", "key-down", { key });
        },
        press: async (key = null) => {
          check(key, "");
          checkArr(key, KeyboardKeys, "keyboard key");
          await send("main", "press", { key });
        },
        alert: async (text = null, title = null, button = null) => {
          checkAll([text, "", null], [title, "", null], [button, "", null]);
          await send("main", title || button ? "alert" : "alert-js", { text, title, button });
        },
        confirm: async (text = null, title = null, buttons = null) => {
          checkAll([text, "", null], [title, "", null], [buttons, [], null]);
          if (buttons !== null)
            buttons.forEach((i) => check(i, ""));
          return (await send("main", title || buttons ? "confirm" : "confirm-js", { text, title, buttons }))[0];
        },
        prompt: async (text = null, title = null, default_ = null) => {
          checkAll([text, "", null], [title, "", null], [default_, "", null]);
          return (await send("main", title || default_ ? "prompt" : "prompt-js", { text, title, default_ }))[0];
        },
        password: async (text = null, title = null, default_ = null, mask = null) => {
          checkAll([text, "", null], [title, "", null], [default_, "", null], [mask, "", null]);
          return (await send("main", title || default_ || mask ? "password" : "password-js", {
            text,
            title,
            default_,
            mask
          }))[0];
        },
        screenshot: async (file = null, region = null) => {
          checkAll([file, "", null], [region, [], {}, null]);
          if (region !== null) {
            if (Array.isArray(region)) {
              region.forEach((i) => check(i, 0));
              if (region.length !== 4)
                throw new Error("Expected number[4], got number[" + region.length + "]");
            } else
              checkAll([region.left, 0], [region.top, 0], [region.width, 0], [region.height, 0]);
          }
          return pilImage((await send("main", "screenshot", { file, region }))[0]);
        },
        locateOnScreen: async (file = null) => {
          checkAll([file, "", null]);
          return pilImage((await send("main", "locate-on-screen", { file }))[0]);
        },
        locateAllOnScreen: async (file = null) => {
          checkAll([file, "", null]);
          return pilImage((await send("main", "locate-all-on-screen", { file }))[0]);
        },
        locateCenterOnScreen: async (file = null) => {
          checkAll([file, "", null]);
          return pilImage((await send("main", "locate-center-on-screen", { file }))[0]);
        },
        dragTo: async (x = null, y = null, duration = null, button = null) => {
          checkAll([x, 0, null], [y, 0, null], [duration, 0, null], [button, "", null]);
          checkArr(button, MouseButtons, "mouse button");
          await send("main", "drag-to", { x, y, duration, button });
        },
        dragRelative: async (x = null, y = null, duration = null, button = null) => {
          checkAll([x, 0, null], [y, 0, null], [duration, 0, null], [button, "", null]);
          checkArr(button, MouseButtons, "mouse button");
          await send("main", "drag-rel", { x, y, duration, button });
        },
        drag: async (x = null, y = null, duration = null, button = null) => {
          checkAll([x, 0, null], [y, 0, null], [duration, 0, null], [button, "", null]);
          checkArr(button, MouseButtons, "mouse button");
          await send("main", "drag", { x, y, duration, button });
        }
      });
      _promise();
    })();
  }
});

// src/autogui/adapters/jsautogui.ts
var JSAutoGUIAdapter;
var init_jsautogui = __esm({
  "src/autogui/adapters/jsautogui.ts"() {
    "use strict";
    init_base();
    init_types();
    JSAutoGUIAdapter = class extends BaseAutoGUIAdapter {
      jsautogui = null;
      version = "unknown";
      constructor(config) {
        super(config);
      }
      async initializeImplementation() {
        try {
          this.jsautogui = await Promise.resolve().then(() => __toESM(require_jsautogui(), 1));
          try {
            this.version = this.jsautogui.version || this.jsautogui.default?.version || "unknown";
          } catch {
            this.version = "unknown";
          }
          this.log(`Initialized JSAutoGUI, version: ${this.version}`);
        } catch (error) {
          throw new AutoGUINotAvailableError("js", error);
        }
      }
      ensureInitialized() {
        if (!this.jsautogui) {
          throw new AutoGUIError("JSAutoGUI not initialized", "js");
        }
      }
      async getScreenSize() {
        return this.withPause("getScreenSize", async () => {
          this.ensureInitialized();
          const size = await this.jsautogui.size();
          return {
            width: size.width || size[0],
            height: size.height || size[1]
          };
        });
      }
      async getScreens() {
        return this.withPause("getScreens", async () => {
          this.ensureInitialized();
          const size = await this.getScreenSize();
          return [{
            size,
            bounds: { x: 0, y: 0, width: size.width, height: size.height },
            primary: true,
            id: 0
          }];
        });
      }
      async getMousePosition() {
        return this.withPause("getMousePosition", async () => {
          this.ensureInitialized();
          const position = await this.jsautogui.position();
          return {
            x: position.x || position[0],
            y: position.y || position[1]
          };
        });
      }
      async moveTo(x, y, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("moveTo", async () => {
          this.ensureInitialized();
          if (options?.duration) {
            await this.jsautogui.moveTo(x, y, options.duration);
          } else {
            await this.jsautogui.moveTo(x, y);
          }
        });
      }
      async moveRel(x, y, options) {
        await this.withPause("moveRel", async () => {
          this.ensureInitialized();
          if (options?.duration) {
            await this.jsautogui.moveRel(x, y, options.duration);
          } else {
            await this.jsautogui.moveRel(x, y);
          }
        });
      }
      async click(x, y, options) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("click", async () => {
          this.ensureInitialized();
          const button = AdapterUtils.parseMouseButton(options?.button);
          const clicks = options?.clicks || 1;
          if (x !== void 0 && y !== void 0) {
            await this.jsautogui.click(x, y, button, clicks);
          } else {
            await this.jsautogui.click(null, null, button, clicks);
          }
        });
      }
      async doubleClick(x, y, options) {
        await this.click(x, y, { ...options, clicks: 2 });
      }
      async rightClick(x, y, options) {
        await this.click(x, y, { ...options, button: "right" });
      }
      async middleClick(x, y, options) {
        await this.click(x, y, { ...options, button: "middle" });
      }
      async mouseDown(x, y, button) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("mouseDown", async () => {
          this.ensureInitialized();
          const mouseButton = AdapterUtils.parseMouseButton(button);
          if (x !== void 0 && y !== void 0) {
            await this.jsautogui.mouseDown(x, y, mouseButton);
          } else {
            await this.jsautogui.mouseDown(null, null, mouseButton);
          }
        });
      }
      async mouseUp(x, y, button) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("mouseUp", async () => {
          this.ensureInitialized();
          const mouseButton = AdapterUtils.parseMouseButton(button);
          if (x !== void 0 && y !== void 0) {
            await this.jsautogui.mouseUp(x, y, mouseButton);
          } else {
            await this.jsautogui.mouseUp(null, null, mouseButton);
          }
        });
      }
      async dragTo(x, y, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("dragTo", async () => {
          this.ensureInitialized();
          const button = AdapterUtils.parseMouseButton(options?.button);
          const duration = options?.duration || 0;
          await this.jsautogui.dragTo(x, y, duration, button);
        });
      }
      async dragRel(x, y, options) {
        await this.withPause("dragRel", async () => {
          this.ensureInitialized();
          const button = AdapterUtils.parseMouseButton(options?.button);
          const duration = options?.duration || 0;
          await this.jsautogui.dragRel(x, y, duration, button);
        });
      }
      async scroll(x, y, scrolls, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("scroll", async () => {
          this.ensureInitialized();
          await this.moveTo(x, y);
          await this.jsautogui.scroll(scrolls);
        });
      }
      async type(text, options) {
        if (!text || typeof text !== "string") {
          throw new AutoGUIError("Text must be a non-empty string");
        }
        await this.withPause("type", async () => {
          this.ensureInitialized();
          if (options?.interval) {
            await this.jsautogui.typewrite(text, options.interval);
          } else {
            await this.jsautogui.typewrite(text);
          }
        });
      }
      async press(key, options) {
        AdapterUtils.validateKey(key);
        await this.withPause("press", async () => {
          this.ensureInitialized();
          const presses = options?.duration ? Math.max(1, Math.floor(options.duration * 10)) : 1;
          if (options?.modifiers && options.modifiers.length > 0) {
            const allKeys = [...options.modifiers, key];
            await this.jsautogui.hotkey(...allKeys);
          } else {
            for (let i = 0; i < presses; i++) {
              await this.jsautogui.press(key.toLowerCase());
              if (presses > 1 && i < presses - 1) {
                await this.sleep(0.05);
              }
            }
          }
        });
      }
      async keyDown(key) {
        AdapterUtils.validateKey(key);
        await this.withPause("keyDown", async () => {
          this.ensureInitialized();
          await this.jsautogui.keyDown(key.toLowerCase());
        });
      }
      async keyUp(key) {
        AdapterUtils.validateKey(key);
        await this.withPause("keyUp", async () => {
          this.ensureInitialized();
          await this.jsautogui.keyUp(key.toLowerCase());
        });
      }
      async hotkey(...keys) {
        const processedKeys = AdapterUtils.parseHotkeyKeys(keys);
        await this.withPause("hotkey", async () => {
          this.ensureInitialized();
          await this.jsautogui.hotkey(...processedKeys);
        });
      }
      async screenshot(options) {
        return this.withPause("screenshot", async () => {
          this.ensureInitialized();
          let screenshot;
          if (options?.bounds) {
            const { x, y, width, height } = options.bounds;
            screenshot = await this.jsautogui.screenshot(null, x, y, width, height);
          } else {
            screenshot = await this.jsautogui.screenshot();
          }
          if (typeof screenshot === "string") {
            return Buffer.from(screenshot, "base64");
          } else if (screenshot instanceof Buffer) {
            return screenshot;
          } else if (screenshot && screenshot.data) {
            return Buffer.from(screenshot.data);
          } else {
            throw new AutoGUIError("Invalid screenshot format returned");
          }
        });
      }
      async getPixel(x, y) {
        AdapterUtils.validateCoordinates(x, y);
        return this.withPause("getPixel", async () => {
          this.ensureInitialized();
          const pixel = await this.jsautogui.pixel(x, y);
          if (Array.isArray(pixel)) {
            return { r: pixel[0], g: pixel[1], b: pixel[2] };
          } else if (typeof pixel === "object") {
            return { r: pixel.r, g: pixel.g, b: pixel.b };
          } else {
            throw new AutoGUIError("Invalid pixel format returned");
          }
        });
      }
      async locateOnScreen(imagePath, options) {
        AdapterUtils.validateImagePath(imagePath);
        if (!await AdapterUtils.fileExists(imagePath)) {
          throw new AutoGUIError(`Image file not found: ${imagePath}`);
        }
        return this.withPause("locateOnScreen", async () => {
          this.ensureInitialized();
          try {
            const confidence = AdapterUtils.clampConfidence(options?.confidence);
            const result = await this.jsautogui.locateOnScreen(imagePath, confidence);
            if (!result) {
              return null;
            }
            const bounds = {
              x: result.left || result.x || result[0],
              y: result.top || result.y || result[1],
              width: result.width || result[2],
              height: result.height || result[3]
            };
            return {
              center: {
                x: bounds.x + Math.floor(bounds.width / 2),
                y: bounds.y + Math.floor(bounds.height / 2)
              },
              bounds,
              confidence
            };
          } catch (error) {
            if (error.message?.includes("not found") || error.message?.includes("could not locate")) {
              return null;
            }
            throw error;
          }
        });
      }
      async locateAllOnScreen(imagePath, options) {
        AdapterUtils.validateImagePath(imagePath);
        if (!await AdapterUtils.fileExists(imagePath)) {
          throw new AutoGUIError(`Image file not found: ${imagePath}`);
        }
        return this.withPause("locateAllOnScreen", async () => {
          this.ensureInitialized();
          try {
            const confidence = AdapterUtils.clampConfidence(options?.confidence);
            const results = await this.jsautogui.locateAllOnScreen(imagePath, confidence);
            if (!results || !Array.isArray(results)) {
              return [];
            }
            return results.slice(0, options?.limit || 10).map((result) => {
              const bounds = {
                x: result.left || result.x || result[0],
                y: result.top || result.y || result[1],
                width: result.width || result[2],
                height: result.height || result[3]
              };
              return {
                center: {
                  x: bounds.x + Math.floor(bounds.width / 2),
                  y: bounds.y + Math.floor(bounds.height / 2)
                },
                bounds,
                confidence
              };
            });
          } catch (error) {
            if (error.message?.includes("not found") || error.message?.includes("could not locate")) {
              return [];
            }
            throw error;
          }
        });
      }
      async locateCenterOnScreen(imagePath, options) {
        const match = await this.locateOnScreen(imagePath, options);
        return match ? match.center : null;
      }
      // Window management (limited support in JSAutoGUI)
      async getActiveWindow() {
        try {
          return this.withPause("getActiveWindow", async () => {
            this.ensureInitialized();
            const screenSize = await this.getScreenSize();
            return {
              id: "active",
              title: "Active Window",
              bounds: { x: 0, y: 0, width: screenSize.width, height: screenSize.height },
              isVisible: true,
              isMinimized: false,
              isMaximized: false
            };
          });
        } catch {
          return null;
        }
      }
      async getAllWindows() {
        const activeWindow = await this.getActiveWindow();
        return activeWindow ? [activeWindow] : [];
      }
      async getWindowByTitle(title) {
        const windows = await this.getAllWindows();
        return windows.find((w) => w.title.includes(title)) || null;
      }
      async activateWindow(windowId) {
        this.log("Window activation not fully supported in JSAutoGUI");
      }
      async minimizeWindow(windowId) {
        this.log("Window minimization not supported in JSAutoGUI");
      }
      async maximizeWindow(windowId) {
        this.log("Window maximization not supported in JSAutoGUI");
      }
      async resizeWindow(windowId, width, height) {
        this.log("Window resizing not supported in JSAutoGUI");
      }
      async moveWindow(windowId, x, y) {
        this.log("Window moving not supported in JSAutoGUI");
      }
      async closeWindow(windowId) {
        this.log("Window closing not supported in JSAutoGUI");
      }
      getImplementationName() {
        return "js";
      }
      async getImplementationVersion() {
        return this.version;
      }
      async isAvailable() {
        try {
          if (!this.jsautogui) {
            await this.initializeImplementation();
          }
          return true;
        } catch {
          return false;
        }
      }
    };
  }
});

// src/autogui/adapters/pyautogui.ts
import { spawn as spawn4 } from "child_process";
import { promises as fs13 } from "fs";
import * as path14 from "path";
import * as os4 from "os";
var PyAutoGUIAdapter;
var init_pyautogui = __esm({
  "src/autogui/adapters/pyautogui.ts"() {
    "use strict";
    init_base();
    init_types();
    PyAutoGUIAdapter = class extends BaseAutoGUIAdapter {
      pythonPath = null;
      pyautoguiScript = null;
      version = "unknown";
      constructor(config) {
        super(config);
      }
      async initializeImplementation() {
        await this.findPythonEnvironment();
        await this.createPyAutoGUIScript();
        await this.testPyAutoGUI();
      }
      async findPythonEnvironment() {
        const possiblePythonPaths = [
          "python3",
          "python",
          "/usr/bin/python3",
          "/usr/bin/python",
          "/usr/local/bin/python3",
          "/usr/local/bin/python",
          process.env.PYTHON_PATH
        ].filter(Boolean);
        for (const pythonPath of possiblePythonPaths) {
          try {
            const result = await this.executePythonCommand(
              "import pyautogui; print(pyautogui.__version__)",
              pythonPath
            );
            if (result.success) {
              this.pythonPath = pythonPath;
              this.version = result.data?.trim() || "unknown";
              this.log(`Found Python with PyAutoGUI at: ${pythonPath}, version: ${this.version}`);
              return;
            }
          } catch (error) {
          }
        }
        throw new AutoGUINotAvailableError("python", new Error("Python with PyAutoGUI not found"));
      }
      async createPyAutoGUIScript() {
        const scriptContent = `
import sys
import json
import pyautogui
import time
import base64
from io import BytesIO

# Configure PyAutoGUI
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.1

def handle_command(command):
    try:
        action = command.get('action')
        params = command.get('params', {})
        
        if action == 'get_screen_size':
            size = pyautogui.size()
            return {'success': True, 'data': {'width': size.width, 'height': size.height}}
            
        elif action == 'get_mouse_position':
            pos = pyautogui.position()
            return {'success': True, 'data': {'x': pos.x, 'y': pos.y}}
            
        elif action == 'move_to':
            x, y = params['x'], params['y']
            duration = params.get('duration', 0)
            pyautogui.moveTo(x, y, duration)
            return {'success': True}
            
        elif action == 'move_rel':
            x, y = params['x'], params['y']
            duration = params.get('duration', 0)
            pyautogui.moveRel(x, y, duration)
            return {'success': True}
            
        elif action == 'click':
            x = params.get('x')
            y = params.get('y')
            button = params.get('button', 'left')
            clicks = params.get('clicks', 1)
            pyautogui.click(x, y, clicks, button=button)
            return {'success': True}
            
        elif action == 'mouse_down':
            x = params.get('x')
            y = params.get('y')
            button = params.get('button', 'left')
            if x is not None and y is not None:
                pyautogui.moveTo(x, y)
            pyautogui.mouseDown(button=button)
            return {'success': True}
            
        elif action == 'mouse_up':
            x = params.get('x')
            y = params.get('y')
            button = params.get('button', 'left')
            if x is not None and y is not None:
                pyautogui.moveTo(x, y)
            pyautogui.mouseUp(button=button)
            return {'success': True}
            
        elif action == 'drag_to':
            x, y = params['x'], params['y']
            button = params.get('button', 'left')
            duration = params.get('duration', 0)
            pyautogui.dragTo(x, y, duration, button=button)
            return {'success': True}
            
        elif action == 'drag_rel':
            x, y = params['x'], params['y']
            button = params.get('button', 'left')
            duration = params.get('duration', 0)
            pyautogui.dragRel(x, y, duration, button=button)
            return {'success': True}
            
        elif action == 'scroll':
            x, y = params['x'], params['y']
            scrolls = params['scrolls']
            pyautogui.moveTo(x, y)
            pyautogui.scroll(scrolls)
            return {'success': True}
            
        elif action == 'type':
            text = params['text']
            interval = params.get('interval', 0)
            pyautogui.write(text, interval)
            return {'success': True}
            
        elif action == 'press':
            key = params['key']
            duration = params.get('duration', 0)
            modifiers = params.get('modifiers', [])
            
            if modifiers:
                pyautogui.hotkey(*modifiers, key)
            else:
                if duration > 0:
                    presses = max(1, int(duration * 10))
                    for _ in range(presses):
                        pyautogui.press(key)
                        time.sleep(0.05)
                else:
                    pyautogui.press(key)
            return {'success': True}
            
        elif action == 'key_down':
            key = params['key']
            pyautogui.keyDown(key)
            return {'success': True}
            
        elif action == 'key_up':
            key = params['key']
            pyautogui.keyUp(key)
            return {'success': True}
            
        elif action == 'hotkey':
            keys = params['keys']
            pyautogui.hotkey(*keys)
            return {'success': True}
            
        elif action == 'screenshot':
            bounds = params.get('bounds')
            if bounds:
                screenshot = pyautogui.screenshot(region=(bounds['x'], bounds['y'], bounds['width'], bounds['height']))
            else:
                screenshot = pyautogui.screenshot()
            
            # Convert to base64
            buffer = BytesIO()
            screenshot.save(buffer, format='PNG')
            image_data = base64.b64encode(buffer.getvalue()).decode()
            return {'success': True, 'data': {'image': image_data}}
            
        elif action == 'get_pixel':
            x, y = params['x'], params['y']
            pixel = pyautogui.pixel(x, y)
            return {'success': True, 'data': {'r': pixel[0], 'g': pixel[1], 'b': pixel[2]}}
            
        elif action == 'locate_on_screen':
            image_path = params['image_path']
            confidence = params.get('confidence', 0.8)
            region = params.get('region')
            
            try:
                if region:
                    region_tuple = (region['x'], region['y'], region['width'], region['height'])
                    location = pyautogui.locateOnScreen(image_path, confidence=confidence, region=region_tuple)
                else:
                    location = pyautogui.locateOnScreen(image_path, confidence=confidence)
                
                if location:
                    center = pyautogui.center(location)
                    return {
                        'success': True,
                        'data': {
                            'x': location.left,
                            'y': location.top,
                            'width': location.width,
                            'height': location.height,
                            'center_x': center.x,
                            'center_y': center.y,
                            'confidence': confidence
                        }
                    }
                else:
                    return {'success': False, 'error': 'Image not found'}
            except pyautogui.ImageNotFoundException:
                return {'success': False, 'error': 'Image not found'}
                
        elif action == 'locate_all_on_screen':
            image_path = params['image_path']
            confidence = params.get('confidence', 0.8)
            region = params.get('region')
            limit = params.get('limit', 10)
            
            try:
                if region:
                    region_tuple = (region['x'], region['y'], region['width'], region['height'])
                    locations = list(pyautogui.locateAllOnScreen(image_path, confidence=confidence, region=region_tuple))
                else:
                    locations = list(pyautogui.locateAllOnScreen(image_path, confidence=confidence))
                
                matches = []
                for location in locations[:limit]:
                    center = pyautogui.center(location)
                    matches.append({
                        'x': location.left,
                        'y': location.top,
                        'width': location.width,
                        'height': location.height,
                        'center_x': center.x,
                        'center_y': center.y,
                        'confidence': confidence
                    })
                
                return {'success': True, 'data': {'matches': matches}}
            except pyautogui.ImageNotFoundException:
                return {'success': True, 'data': {'matches': []}}
                
        elif action == 'get_active_window':
            # Limited window support in PyAutoGUI
            try:
                import pygetwindow as gw
                window = gw.getActiveWindow()
                if window:
                    return {
                        'success': True,
                        'data': {
                            'id': str(window._hWnd) if hasattr(window, '_hWnd') else 'active',
                            'title': window.title,
                            'x': window.left,
                            'y': window.top,
                            'width': window.width,
                            'height': window.height,
                            'visible': window.visible,
                            'minimized': window.isMinimized,
                            'maximized': window.isMaximized
                        }
                    }
                else:
                    return {'success': False, 'error': 'No active window'}
            except ImportError:
                return {'success': False, 'error': 'pygetwindow not available'}
                
        elif action == 'get_all_windows':
            try:
                import pygetwindow as gw
                windows = gw.getAllWindows()
                window_list = []
                for window in windows:
                    if window.title:  # Filter out empty titles
                        window_list.append({
                            'id': str(window._hWnd) if hasattr(window, '_hWnd') else str(hash(window.title)),
                            'title': window.title,
                            'x': window.left,
                            'y': window.top,
                            'width': window.width,
                            'height': window.height,
                            'visible': window.visible,
                            'minimized': window.isMinimized,
                            'maximized': window.isMaximized
                        })
                return {'success': True, 'data': {'windows': window_list}}
            except ImportError:
                return {'success': False, 'error': 'pygetwindow not available'}
                
        else:
            return {'success': False, 'error': f'Unknown action: {action}'}
            
    except Exception as e:
        return {'success': False, 'error': str(e)}

def main():
    try:
        # Read command from stdin
        command_line = sys.stdin.read().strip()
        if not command_line:
            return
            
        command = json.loads(command_line)
        result = handle_command(command)
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {'success': False, 'error': str(e)}
        print(json.dumps(error_result))

if __name__ == '__main__':
    main()
`;
        const tempDir = os4.tmpdir();
        this.pyautoguiScript = path14.join(tempDir, "hanzo_pyautogui_bridge.py");
        await fs13.writeFile(this.pyautoguiScript, scriptContent);
        this.log(`Created PyAutoGUI bridge script at: ${this.pyautoguiScript}`);
      }
      async testPyAutoGUI() {
        const result = await this.executeCommand({ action: "get_screen_size" });
        if (!result.success) {
          throw new AutoGUINotAvailableError("python", new Error(`PyAutoGUI test failed: ${result.error}`));
        }
      }
      async executePythonCommand(code, pythonPath) {
        const python = pythonPath || this.pythonPath;
        if (!python) {
          throw new AutoGUINotAvailableError("python", new Error("Python path not available"));
        }
        return new Promise((resolve, reject) => {
          const process2 = spawn4(python, ["-c", code], {
            stdio: ["pipe", "pipe", "pipe"]
          });
          let stdout = "";
          let stderr = "";
          process2.stdout.on("data", (data) => {
            stdout += data.toString();
          });
          process2.stderr.on("data", (data) => {
            stderr += data.toString();
          });
          process2.on("close", (code2) => {
            if (code2 === 0) {
              resolve({ success: true, data: stdout });
            } else {
              reject(new AutoGUIError(`Python command failed: ${stderr}`, "python"));
            }
          });
          process2.on("error", (error) => {
            reject(new AutoGUINotAvailableError("python", error));
          });
        });
      }
      async executeCommand(command) {
        if (!this.pythonPath || !this.pyautoguiScript) {
          throw new AutoGUINotAvailableError("python", new Error("PyAutoGUI not initialized"));
        }
        return new Promise((resolve, reject) => {
          const process2 = spawn4(this.pythonPath, [this.pyautoguiScript], {
            stdio: ["pipe", "pipe", "pipe"]
          });
          let stdout = "";
          let stderr = "";
          process2.stdout.on("data", (data) => {
            stdout += data.toString();
          });
          process2.stderr.on("data", (data) => {
            stderr += data.toString();
          });
          process2.on("close", (code) => {
            try {
              if (code === 0 && stdout.trim()) {
                const response = JSON.parse(stdout.trim());
                resolve(response);
              } else {
                reject(new AutoGUIError(`PyAutoGUI process failed: ${stderr || "unknown error"}`, "python"));
              }
            } catch (error) {
              reject(new AutoGUIError(`Failed to parse PyAutoGUI response: ${error}`, "python"));
            }
          });
          process2.on("error", (error) => {
            reject(new AutoGUINotAvailableError("python", error));
          });
          process2.stdin.write(JSON.stringify(command));
          process2.stdin.end();
        });
      }
      async getScreenSize() {
        const result = await this.withPause("getScreenSize", async () => {
          return this.executeCommand({ action: "get_screen_size" });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get screen size");
        }
        return {
          width: result.data.width,
          height: result.data.height
        };
      }
      async getScreens() {
        const size = await this.getScreenSize();
        return [{
          size,
          bounds: { x: 0, y: 0, width: size.width, height: size.height },
          primary: true,
          id: 0
        }];
      }
      async getMousePosition() {
        const result = await this.withPause("getMousePosition", async () => {
          return this.executeCommand({ action: "get_mouse_position" });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get mouse position");
        }
        return {
          x: result.data.x,
          y: result.data.y
        };
      }
      // Implementation methods follow the same pattern as RustAutoGUI adapter
      // but use the PyAutoGUI bridge script
      async moveTo(x, y, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("moveTo", async () => {
          return this.executeCommand({
            action: "move_to",
            params: {
              x,
              y,
              duration: options?.duration || 0
            }
          });
        });
      }
      async moveRel(x, y, options) {
        await this.withPause("moveRel", async () => {
          return this.executeCommand({
            action: "move_rel",
            params: {
              x,
              y,
              duration: options?.duration || 0
            }
          });
        });
      }
      async click(x, y, options) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("click", async () => {
          return this.executeCommand({
            action: "click",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(options?.button),
              clicks: options?.clicks || 1
            }
          });
        });
      }
      async doubleClick(x, y, options) {
        await this.click(x, y, { ...options, clicks: 2 });
      }
      async rightClick(x, y, options) {
        await this.click(x, y, { ...options, button: "right" });
      }
      async middleClick(x, y, options) {
        await this.click(x, y, { ...options, button: "middle" });
      }
      async mouseDown(x, y, button) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("mouseDown", async () => {
          return this.executeCommand({
            action: "mouse_down",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(button)
            }
          });
        });
      }
      async mouseUp(x, y, button) {
        if (x !== void 0 && y !== void 0) {
          AdapterUtils.validateCoordinates(x, y);
        }
        await this.withPause("mouseUp", async () => {
          return this.executeCommand({
            action: "mouse_up",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(button)
            }
          });
        });
      }
      async dragTo(x, y, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("dragTo", async () => {
          return this.executeCommand({
            action: "drag_to",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(options?.button),
              duration: options?.duration || 0
            }
          });
        });
      }
      async dragRel(x, y, options) {
        await this.withPause("dragRel", async () => {
          return this.executeCommand({
            action: "drag_rel",
            params: {
              x,
              y,
              button: AdapterUtils.parseMouseButton(options?.button),
              duration: options?.duration || 0
            }
          });
        });
      }
      async scroll(x, y, scrolls, options) {
        AdapterUtils.validateCoordinates(x, y);
        await this.withPause("scroll", async () => {
          return this.executeCommand({
            action: "scroll",
            params: {
              x,
              y,
              scrolls
            }
          });
        });
      }
      async type(text, options) {
        if (!text || typeof text !== "string") {
          throw new AutoGUIError("Text must be a non-empty string");
        }
        await this.withPause("type", async () => {
          return this.executeCommand({
            action: "type",
            params: {
              text,
              interval: options?.interval || 0
            }
          });
        });
      }
      async press(key, options) {
        AdapterUtils.validateKey(key);
        await this.withPause("press", async () => {
          return this.executeCommand({
            action: "press",
            params: {
              key: key.toLowerCase(),
              duration: options?.duration || 0,
              modifiers: options?.modifiers || []
            }
          });
        });
      }
      async keyDown(key) {
        AdapterUtils.validateKey(key);
        await this.withPause("keyDown", async () => {
          return this.executeCommand({
            action: "key_down",
            params: { key: key.toLowerCase() }
          });
        });
      }
      async keyUp(key) {
        AdapterUtils.validateKey(key);
        await this.withPause("keyUp", async () => {
          return this.executeCommand({
            action: "key_up",
            params: { key: key.toLowerCase() }
          });
        });
      }
      async hotkey(...keys) {
        const processedKeys = AdapterUtils.parseHotkeyKeys(keys);
        await this.withPause("hotkey", async () => {
          return this.executeCommand({
            action: "hotkey",
            params: { keys: processedKeys }
          });
        });
      }
      async screenshot(options) {
        const result = await this.withPause("screenshot", async () => {
          return this.executeCommand({
            action: "screenshot",
            params: {
              bounds: options?.bounds
            }
          });
        });
        if (!result.success || !result.data?.image) {
          throw new AutoGUIError("Failed to take screenshot");
        }
        return Buffer.from(result.data.image, "base64");
      }
      async getPixel(x, y) {
        AdapterUtils.validateCoordinates(x, y);
        const result = await this.withPause("getPixel", async () => {
          return this.executeCommand({
            action: "get_pixel",
            params: { x, y }
          });
        });
        if (!result.success || !result.data) {
          throw new AutoGUIError("Failed to get pixel color");
        }
        return {
          r: result.data.r,
          g: result.data.g,
          b: result.data.b
        };
      }
      async locateOnScreen(imagePath, options) {
        AdapterUtils.validateImagePath(imagePath);
        if (!await AdapterUtils.fileExists(imagePath)) {
          throw new AutoGUIError(`Image file not found: ${imagePath}`);
        }
        const result = await this.withPause("locateOnScreen", async () => {
          return this.executeCommand({
            action: "locate_on_screen",
            params: {
              image_path: imagePath,
              confidence: AdapterUtils.clampConfidence(options?.confidence),
              region: options?.region
            }
          });
        });
        if (!result.success) {
          if (result.error?.includes("not found")) {
            return null;
          }
          throw new AutoGUIError("Failed to locate image on screen");
        }
        if (!result.data) {
          return null;
        }
        return {
          center: { x: result.data.center_x, y: result.data.center_y },
          bounds: {
            x: result.data.x,
            y: result.data.y,
            width: result.data.width,
            height: result.data.height
          },
          confidence: result.data.confidence
        };
      }
      async locateAllOnScreen(imagePath, options) {
        AdapterUtils.validateImagePath(imagePath);
        if (!await AdapterUtils.fileExists(imagePath)) {
          throw new AutoGUIError(`Image file not found: ${imagePath}`);
        }
        const result = await this.withPause("locateAllOnScreen", async () => {
          return this.executeCommand({
            action: "locate_all_on_screen",
            params: {
              image_path: imagePath,
              confidence: AdapterUtils.clampConfidence(options?.confidence),
              region: options?.region,
              limit: options?.limit || 10
            }
          });
        });
        if (!result.success || !result.data?.matches) {
          return [];
        }
        return result.data.matches.map((match) => ({
          center: { x: match.center_x, y: match.center_y },
          bounds: {
            x: match.x,
            y: match.y,
            width: match.width,
            height: match.height
          },
          confidence: match.confidence
        }));
      }
      async locateCenterOnScreen(imagePath, options) {
        const match = await this.locateOnScreen(imagePath, options);
        return match ? match.center : null;
      }
      async getActiveWindow() {
        try {
          const result = await this.withPause("getActiveWindow", async () => {
            return this.executeCommand({ action: "get_active_window" });
          });
          if (!result.success || !result.data) {
            return null;
          }
          return this.parseWindowInfo(result.data);
        } catch {
          return null;
        }
      }
      async getAllWindows() {
        try {
          const result = await this.withPause("getAllWindows", async () => {
            return this.executeCommand({ action: "get_all_windows" });
          });
          if (!result.success || !result.data?.windows) {
            return [];
          }
          return result.data.windows.map(this.parseWindowInfo);
        } catch {
          return [];
        }
      }
      async getWindowByTitle(title) {
        const windows = await this.getAllWindows();
        return windows.find((w) => w.title.includes(title)) || null;
      }
      async activateWindow(windowId) {
        this.log("Window activation requires pygetwindow package");
      }
      async minimizeWindow(windowId) {
        this.log("Window minimization requires pygetwindow package");
      }
      async maximizeWindow(windowId) {
        this.log("Window maximization requires pygetwindow package");
      }
      async resizeWindow(windowId, width, height) {
        this.log("Window resizing requires pygetwindow package");
      }
      async moveWindow(windowId, x, y) {
        this.log("Window moving requires pygetwindow package");
      }
      async closeWindow(windowId) {
        this.log("Window closing requires pygetwindow package");
      }
      parseWindowInfo(data) {
        return {
          id: data.id,
          title: data.title || "",
          bounds: {
            x: data.x || 0,
            y: data.y || 0,
            width: data.width || 0,
            height: data.height || 0
          },
          isVisible: data.visible !== false,
          isMinimized: data.minimized === true,
          isMaximized: data.maximized === true,
          processId: data.process_id
        };
      }
      getImplementationName() {
        return "python";
      }
      async getImplementationVersion() {
        return this.version;
      }
      async isAvailable() {
        try {
          if (!this.pythonPath) {
            await this.findPythonEnvironment();
          }
          return this.pythonPath !== null;
        } catch {
          return false;
        }
      }
    };
  }
});

// src/autogui/factory.ts
async function createAutoGUI(implementation, config) {
  const factory = HanzoAutoGUIFactory.getInstance();
  return factory.createAdapter(implementation, config);
}
async function getAvailableAutoGUIImplementations() {
  const factory = HanzoAutoGUIFactory.getInstance();
  return factory.getAvailableImplementations();
}
async function getAutoGUIImplementationStatus() {
  const factory = HanzoAutoGUIFactory.getInstance();
  return factory.getImplementationStatus();
}
var HanzoAutoGUIFactory;
var init_factory = __esm({
  "src/autogui/factory.ts"() {
    "use strict";
    init_types();
    init_rust();
    init_jsautogui();
    init_pyautogui();
    HanzoAutoGUIFactory = class _HanzoAutoGUIFactory {
      static instance = null;
      adapters = /* @__PURE__ */ new Map();
      cachedAvailability = /* @__PURE__ */ new Map();
      detectedBest = null;
      constructor() {
        this.registerAdapters();
      }
      static getInstance() {
        if (!_HanzoAutoGUIFactory.instance) {
          _HanzoAutoGUIFactory.instance = new _HanzoAutoGUIFactory();
        }
        return _HanzoAutoGUIFactory.instance;
      }
      registerAdapters() {
        this.adapters.set("rust", RustAutoGUIAdapter);
        this.adapters.set("js", JSAutoGUIAdapter);
        this.adapters.set("python", PyAutoGUIAdapter);
      }
      async createAdapter(implementation, config) {
        let targetImplementation = implementation;
        if (!targetImplementation || targetImplementation === "auto") {
          targetImplementation = await this.detectBestImplementation();
        }
        const AdapterClass = this.adapters.get(targetImplementation);
        if (!AdapterClass) {
          throw new AutoGUIError(`Unknown AutoGUI implementation: ${targetImplementation}`);
        }
        try {
          const adapter = new AdapterClass(config);
          await adapter.configure({ implementation: targetImplementation, ...config });
          this.log(`Successfully created ${targetImplementation} adapter`);
          return adapter;
        } catch (error) {
          this.log(`Failed to create ${targetImplementation} adapter: ${error}`);
          if (implementation === "auto" || !implementation) {
            return this.createWithFallback(config, [targetImplementation]);
          }
          throw error;
        }
      }
      async createWithFallback(config, excludeImplementations = []) {
        const fallbackOrder = config?.fallbackOrder || ["rust", "js", "python"];
        const availableImplementations = fallbackOrder.filter((impl) => !excludeImplementations.includes(impl));
        for (const implementation of availableImplementations) {
          try {
            this.log(`Trying fallback implementation: ${implementation}`);
            const adapter = await this.createAdapter(implementation, config);
            this.log(`Fallback successful: using ${implementation} adapter`);
            return adapter;
          } catch (error) {
            this.log(`Fallback ${implementation} failed: ${error}`);
            continue;
          }
        }
        throw new AutoGUINotAvailableError("all", new Error("No AutoGUI implementation available"));
      }
      async getAvailableImplementations() {
        const available = [];
        for (const [name, AdapterClass] of this.adapters) {
          if (this.cachedAvailability.has(name)) {
            if (this.cachedAvailability.get(name)) {
              available.push(name);
            }
            continue;
          }
          try {
            const adapter = new AdapterClass();
            const isAvailable = await adapter.isAvailable();
            this.cachedAvailability.set(name, isAvailable);
            if (isAvailable) {
              available.push(name);
            }
          } catch {
            this.cachedAvailability.set(name, false);
          }
        }
        return available;
      }
      async detectBestImplementation() {
        if (this.detectedBest) {
          return this.detectedBest;
        }
        const available = await this.getAvailableImplementations();
        if (available.length === 0) {
          throw new AutoGUINotAvailableError("all", new Error("No AutoGUI implementations available"));
        }
        const priorityOrder = ["rust", "js", "python"];
        for (const preferred of priorityOrder) {
          if (available.includes(preferred)) {
            this.detectedBest = preferred;
            this.log(`Detected best implementation: ${preferred}`);
            return preferred;
          }
        }
        this.detectedBest = available[0];
        this.log(`Using first available implementation: ${this.detectedBest}`);
        return this.detectedBest;
      }
      /**
       * Clear cached availability and best implementation detection
       * Useful for testing or when environment changes
       */
      clearCache() {
        this.cachedAvailability.clear();
        this.detectedBest = null;
      }
      /**
       * Test all implementations and return detailed status
       */
      async getImplementationStatus() {
        const status = {};
        for (const [name, AdapterClass] of this.adapters) {
          try {
            const adapter = new AdapterClass();
            const isAvailable = await adapter.isAvailable();
            if (isAvailable) {
              try {
                const version = await adapter.getImplementationVersion();
                status[name] = { available: true, version };
              } catch {
                status[name] = { available: true, version: "unknown" };
              }
            } else {
              status[name] = { available: false, error: "Not available" };
            }
          } catch (error) {
            status[name] = { available: false, error: error.message || "Unknown error" };
          }
        }
        return status;
      }
      log(message) {
        console.error(`[AutoGUI Factory] ${message}`);
      }
    };
  }
});

// src/autogui/tools/autogui-tools.ts
import { z as z4 } from "zod";
async function ensureAutoGUI(implementation) {
  if (!autoguiAdapter) {
    autoguiAdapter = await createAutoGUI(implementation);
  }
  return autoguiAdapter;
}
var autoguiAdapter, PointSchema, BoundsSchema, MouseButtonSchema, autoguiTools;
var init_autogui_tools = __esm({
  "src/autogui/tools/autogui-tools.ts"() {
    "use strict";
    init_factory();
    autoguiAdapter = null;
    PointSchema = z4.object({
      x: z4.number().int().min(0),
      y: z4.number().int().min(0)
    });
    BoundsSchema = z4.object({
      x: z4.number().int().min(0),
      y: z4.number().int().min(0),
      width: z4.number().int().min(1),
      height: z4.number().int().min(1)
    });
    MouseButtonSchema = z4.enum(["left", "right", "middle"]).optional();
    autoguiTools = [
      // System and Configuration Tools
      {
        name: "autogui_status",
        description: "Get AutoGUI system status and available implementations",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        handler: async () => {
          try {
            const available = await getAvailableAutoGUIImplementations();
            const status = await getAutoGUIImplementationStatus();
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  available_implementations: available,
                  implementation_status: status,
                  current_adapter: autoguiAdapter?.getImplementationName() || null
                }, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting AutoGUI status: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_configure",
        description: "Configure AutoGUI settings and select implementation",
        inputSchema: {
          type: "object",
          properties: {
            implementation: {
              type: "string",
              enum: ["auto", "rust", "js", "python"],
              description: "AutoGUI implementation to use"
            },
            failsafe: {
              type: "boolean",
              description: "Enable failsafe mode (move mouse to corner to abort)"
            },
            pause: {
              type: "number",
              minimum: 0,
              maximum: 5,
              description: "Pause between operations in seconds"
            },
            log: {
              type: "boolean",
              description: "Enable verbose logging"
            }
          },
          required: []
        },
        handler: async (args) => {
          try {
            const config = {};
            if (args.implementation)
              config.implementation = args.implementation;
            if (args.failsafe !== void 0)
              config.failsafe = args.failsafe;
            if (args.pause !== void 0)
              config.pause = args.pause;
            if (args.log !== void 0)
              config.log = args.log;
            if (args.implementation && autoguiAdapter?.getImplementationName() !== args.implementation) {
              autoguiAdapter = null;
            }
            const adapter = await ensureAutoGUI(args.implementation);
            await adapter.configure(config);
            return {
              content: [{
                type: "text",
                text: `AutoGUI configured with ${adapter.getImplementationName()} implementation`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error configuring AutoGUI: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      // Screen Information Tools
      {
        name: "autogui_get_screen_size",
        description: "Get the screen size in pixels",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        handler: async () => {
          try {
            const adapter = await ensureAutoGUI();
            const size = await adapter.getScreenSize();
            return {
              content: [{
                type: "text",
                text: JSON.stringify(size, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting screen size: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_get_screens",
        description: "Get information about all available screens",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        handler: async () => {
          try {
            const adapter = await ensureAutoGUI();
            const screens = await adapter.getScreens();
            return {
              content: [{
                type: "text",
                text: JSON.stringify(screens, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting screen information: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      // Mouse Control Tools
      {
        name: "autogui_get_mouse_position",
        description: "Get the current mouse cursor position",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
        handler: async () => {
          try {
            const adapter = await ensureAutoGUI();
            const position = await adapter.getMousePosition();
            return {
              content: [{
                type: "text",
                text: JSON.stringify(position, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting mouse position: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_move_mouse",
        description: "Move the mouse cursor to a specific position",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
            relative: { type: "boolean", description: "Move relative to current position" },
            duration: { type: "number", minimum: 0, maximum: 10, description: "Duration of movement in seconds" }
          },
          required: ["x", "y"]
        },
        handler: async (args) => {
          try {
            PointSchema.parse({ x: args.x, y: args.y });
            const adapter = await ensureAutoGUI();
            const options = args.duration ? { duration: args.duration } : void 0;
            if (args.relative) {
              await adapter.moveRel(args.x, args.y, options);
            } else {
              await adapter.moveTo(args.x, args.y, options);
            }
            return {
              content: [{
                type: "text",
                text: `Mouse moved to (${args.x}, ${args.y})`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error moving mouse: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_click",
        description: "Click the mouse at a specific position or current position",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate (optional)" },
            y: { type: "number", description: "Y coordinate (optional)" },
            button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to click" },
            clicks: { type: "number", minimum: 1, maximum: 10, description: "Number of clicks" },
            interval: { type: "number", minimum: 0, maximum: 2, description: "Interval between clicks" }
          },
          required: []
        },
        handler: async (args) => {
          try {
            if (args.x !== void 0 && args.y !== void 0) {
              PointSchema.parse({ x: args.x, y: args.y });
            }
            const adapter = await ensureAutoGUI();
            const options = {
              button: args.button,
              clicks: args.clicks,
              interval: args.interval
            };
            await adapter.click(args.x, args.y, options);
            const position = args.x !== void 0 && args.y !== void 0 ? `at (${args.x}, ${args.y})` : "at current position";
            const button = args.button || "left";
            const clicks = args.clicks || 1;
            return {
              content: [{
                type: "text",
                text: `${clicks > 1 ? `${clicks}x clicked` : "Clicked"} ${button} button ${position}`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error clicking mouse: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_drag",
        description: "Drag the mouse from current position or specific position to target",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "Target X coordinate" },
            y: { type: "number", description: "Target Y coordinate" },
            relative: { type: "boolean", description: "Drag relative to current position" },
            button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to drag with" },
            duration: { type: "number", minimum: 0, maximum: 10, description: "Duration of drag in seconds" }
          },
          required: ["x", "y"]
        },
        handler: async (args) => {
          try {
            PointSchema.parse({ x: args.x, y: args.y });
            const adapter = await ensureAutoGUI();
            const options = {
              button: args.button,
              duration: args.duration
            };
            if (args.relative) {
              await adapter.dragRel(args.x, args.y, options);
            } else {
              await adapter.dragTo(args.x, args.y, options);
            }
            return {
              content: [{
                type: "text",
                text: `Dragged to (${args.x}, ${args.y})`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error dragging mouse: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_scroll",
        description: "Scroll at a specific position",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
            scrolls: { type: "number", description: "Number of scroll clicks (positive up, negative down)" },
            direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction" }
          },
          required: ["x", "y", "scrolls"]
        },
        handler: async (args) => {
          try {
            PointSchema.parse({ x: args.x, y: args.y });
            const adapter = await ensureAutoGUI();
            const options = args.direction ? { direction: args.direction } : void 0;
            await adapter.scroll(args.x, args.y, args.scrolls, options);
            return {
              content: [{
                type: "text",
                text: `Scrolled ${args.scrolls} clicks at (${args.x}, ${args.y})`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error scrolling: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      // Keyboard Control Tools
      {
        name: "autogui_type",
        description: "Type text using the keyboard",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
            interval: { type: "number", minimum: 0, maximum: 1, description: "Interval between keystrokes in seconds" }
          },
          required: ["text"]
        },
        handler: async (args) => {
          try {
            const adapter = await ensureAutoGUI();
            const options = args.interval ? { interval: args.interval } : void 0;
            await adapter.type(args.text, options);
            return {
              content: [{
                type: "text",
                text: `Typed: "${args.text}"`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error typing text: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_press_key",
        description: "Press a specific key or key combination",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: 'Key to press (e.g., "enter", "space", "a", "f1")' },
            modifiers: {
              type: "array",
              items: { type: "string" },
              description: 'Modifier keys (e.g., ["ctrl", "shift"])'
            },
            duration: { type: "number", minimum: 0, maximum: 5, description: "Duration to hold key" }
          },
          required: ["key"]
        },
        handler: async (args) => {
          try {
            const adapter = await ensureAutoGUI();
            const options = {
              modifiers: args.modifiers,
              duration: args.duration
            };
            await adapter.press(args.key, options);
            const modifierText = args.modifiers && args.modifiers.length > 0 ? `${args.modifiers.join("+")}+` : "";
            return {
              content: [{
                type: "text",
                text: `Pressed key: ${modifierText}${args.key}`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error pressing key: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_hotkey",
        description: "Press a hotkey combination",
        inputSchema: {
          type: "object",
          properties: {
            keys: {
              type: "array",
              items: { type: "string" },
              description: 'Keys to press simultaneously (e.g., ["ctrl", "c"])'
            }
          },
          required: ["keys"]
        },
        handler: async (args) => {
          try {
            const adapter = await ensureAutoGUI();
            await adapter.hotkey(...args.keys);
            return {
              content: [{
                type: "text",
                text: `Pressed hotkey: ${args.keys.join("+")}`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error pressing hotkey: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      // Screen Capture and Vision Tools
      {
        name: "autogui_screenshot",
        description: "Take a screenshot of the screen or a specific region",
        inputSchema: {
          type: "object",
          properties: {
            bounds: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" }
              },
              required: ["x", "y", "width", "height"],
              description: "Region to capture (optional, full screen if not specified)"
            },
            format: { type: "string", enum: ["png", "jpeg", "bmp"], description: "Image format" }
          },
          required: []
        },
        handler: async (args) => {
          try {
            if (args.bounds) {
              BoundsSchema.parse(args.bounds);
            }
            const adapter = await ensureAutoGUI();
            const options = {
              bounds: args.bounds,
              format: args.format
            };
            const screenshot = await adapter.screenshot(options);
            const base64Data = screenshot.toString("base64");
            return {
              content: [{
                type: "image",
                data: base64Data,
                mimeType: `image/${args.format || "png"}`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error taking screenshot: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_get_pixel",
        description: "Get the color of a pixel at specific coordinates",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" }
          },
          required: ["x", "y"]
        },
        handler: async (args) => {
          try {
            PointSchema.parse({ x: args.x, y: args.y });
            const adapter = await ensureAutoGUI();
            const pixel = await adapter.getPixel(args.x, args.y);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  position: { x: args.x, y: args.y },
                  color: pixel,
                  hex: `#${pixel.r.toString(16).padStart(2, "0")}${pixel.g.toString(16).padStart(2, "0")}${pixel.b.toString(16).padStart(2, "0")}`
                }, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting pixel color: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_locate_image",
        description: "Find an image on the screen",
        inputSchema: {
          type: "object",
          properties: {
            image_path: { type: "string", description: "Path to the image file to find" },
            confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence threshold (0-1)" },
            region: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" }
              },
              required: ["x", "y", "width", "height"],
              description: "Region to search in (optional)"
            },
            find_all: { type: "boolean", description: "Find all matches instead of just the first" },
            limit: { type: "number", minimum: 1, maximum: 50, description: "Maximum number of matches to return when find_all is true" }
          },
          required: ["image_path"]
        },
        handler: async (args) => {
          try {
            if (args.region) {
              BoundsSchema.parse(args.region);
            }
            const adapter = await ensureAutoGUI();
            const options = {
              confidence: args.confidence,
              region: args.region,
              limit: args.limit
            };
            if (args.find_all) {
              const matches = await adapter.locateAllOnScreen(args.image_path, options);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    matches_found: matches.length,
                    matches
                  }, null, 2)
                }]
              };
            } else {
              const match = await adapter.locateOnScreen(args.image_path, options);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    found: match !== null,
                    match
                  }, null, 2)
                }]
              };
            }
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error locating image: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      // Window Management Tools
      {
        name: "autogui_get_windows",
        description: "Get information about open windows",
        inputSchema: {
          type: "object",
          properties: {
            active_only: { type: "boolean", description: "Get only the active window" },
            title_filter: { type: "string", description: "Filter windows by title (partial match)" }
          },
          required: []
        },
        handler: async (args) => {
          try {
            const adapter = await ensureAutoGUI();
            if (args.active_only) {
              const activeWindow = await adapter.getActiveWindow();
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    active_window: activeWindow
                  }, null, 2)
                }]
              };
            }
            let windows = await adapter.getAllWindows();
            if (args.title_filter) {
              const filter = args.title_filter.toLowerCase();
              windows = windows.filter((w) => w.title.toLowerCase().includes(filter));
            }
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  window_count: windows.length,
                  windows
                }, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error getting window information: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      {
        name: "autogui_control_window",
        description: "Control a window (activate, minimize, maximize, resize, move, close)",
        inputSchema: {
          type: "object",
          properties: {
            window_id: { type: ["string", "number"], description: "Window ID or title" },
            action: {
              type: "string",
              enum: ["activate", "minimize", "maximize", "resize", "move", "close"],
              description: "Action to perform on the window"
            },
            width: { type: "number", description: "New width (for resize action)" },
            height: { type: "number", description: "New height (for resize action)" },
            x: { type: "number", description: "New X position (for move action)" },
            y: { type: "number", description: "New Y position (for move action)" }
          },
          required: ["window_id", "action"]
        },
        handler: async (args) => {
          try {
            const adapter = await ensureAutoGUI();
            let windowId = args.window_id;
            if (typeof windowId === "string" && isNaN(Number(windowId))) {
              const window = await adapter.getWindowByTitle(windowId);
              if (!window) {
                return {
                  content: [{
                    type: "text",
                    text: `Window with title "${windowId}" not found`
                  }],
                  isError: true
                };
              }
              windowId = window.id;
            }
            switch (args.action) {
              case "activate":
                await adapter.activateWindow(windowId);
                break;
              case "minimize":
                await adapter.minimizeWindow(windowId);
                break;
              case "maximize":
                await adapter.maximizeWindow(windowId);
                break;
              case "resize":
                if (!args.width || !args.height) {
                  throw new Error("Width and height required for resize action");
                }
                await adapter.resizeWindow(windowId, args.width, args.height);
                break;
              case "move":
                if (args.x === void 0 || args.y === void 0) {
                  throw new Error("X and Y coordinates required for move action");
                }
                await adapter.moveWindow(windowId, args.x, args.y);
                break;
              case "close":
                await adapter.closeWindow(windowId);
                break;
              default:
                throw new Error(`Unknown window action: ${args.action}`);
            }
            return {
              content: [{
                type: "text",
                text: `Window ${args.action} action completed for window ${windowId}`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error controlling window: ${error.message}`
              }],
              isError: true
            };
          }
        }
      },
      // Utility Tools
      {
        name: "autogui_sleep",
        description: "Pause execution for a specified duration",
        inputSchema: {
          type: "object",
          properties: {
            seconds: { type: "number", minimum: 0, maximum: 60, description: "Duration to sleep in seconds" }
          },
          required: ["seconds"]
        },
        handler: async (args) => {
          try {
            const adapter = await ensureAutoGUI();
            await adapter.sleep(args.seconds);
            return {
              content: [{
                type: "text",
                text: `Slept for ${args.seconds} seconds`
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Error during sleep: ${error.message}`
              }],
              isError: true
            };
          }
        }
      }
    ];
  }
});

// src/orchestration/agent-tools.ts
import { z as z5 } from "zod";
import { spawn as spawn5 } from "child_process";
import { promises as fs14 } from "fs";
import os5 from "os";
import path15 from "path";
async function spawnAgent(args) {
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const config = {
    id: agentId,
    model: args.model || "claude-3-5-sonnet-20241022",
    prompt: args.prompt,
    context: args.context,
    outputGoal: args.outputGoal,
    files: args.files,
    readOnly: args.readOnly || false,
    status: "pending" /* Pending */
  };
  if (args.useWorktree) {
    const branchName = `agent-${agentId}`;
    const worktreePath = path15.join(process.cwd(), ".worktrees", branchName);
    await executeCommand(`git worktree add -b ${branchName} ${worktreePath}`);
    config.worktreePath = worktreePath;
    config.branchName = branchName;
  }
  activeAgents.set(agentId, config);
  const hanzoCmd = await findHanzoCommand();
  const agentArgs = [
    "agent",
    "spawn",
    "--model",
    config.model,
    "--prompt",
    config.prompt
  ];
  if (config.context)
    agentArgs.push("--context", config.context);
  if (config.outputGoal)
    agentArgs.push("--output-goal", config.outputGoal);
  if (config.files)
    agentArgs.push("--files", config.files.join(","));
  if (config.readOnly)
    agentArgs.push("--read-only");
  const agentProcess = spawn5(hanzoCmd, agentArgs, {
    cwd: config.worktreePath || process.cwd(),
    stdio: "pipe"
  });
  let output = "";
  agentProcess.stdout?.on("data", (data) => {
    output += data.toString();
  });
  agentProcess.stderr?.on("data", (data) => {
    console.error(`Agent ${agentId} error:`, data.toString());
  });
  return new Promise((resolve, reject) => {
    agentProcess.on("close", (code) => {
      const agent = activeAgents.get(agentId);
      if (agent) {
        if (code === 0) {
          agent.status = "completed" /* Completed */;
          agent.result = output;
        } else {
          agent.status = "failed" /* Failed */;
          agent.error = `Process exited with code ${code}`;
        }
        activeAgents.set(agentId, agent);
      }
      if (code === 0) {
        resolve({
          agentId,
          status: "completed",
          result: output
        });
      } else {
        reject(new Error(`Agent failed with code ${code}`));
      }
    });
  });
}
async function orchestrateSwarm(args) {
  const { agents, orchestrationMode, consensusRounds } = args;
  switch (orchestrationMode) {
    case "parallel":
      const parallelResults = await Promise.all(
        agents.map((agent) => spawnAgent({
          prompt: agent.prompt,
          model: agent.model
        }))
      );
      return { mode: "parallel", results: parallelResults };
    case "sequential":
      const sequentialResults = [];
      for (const agent of agents) {
        const result = await spawnAgent({
          prompt: agent.prompt,
          model: agent.model
        });
        sequentialResults.push(result);
      }
      return { mode: "sequential", results: sequentialResults };
    case "hierarchical":
      return { mode: "hierarchical", message: "Hierarchical orchestration initiated" };
    case "consensus":
      return {
        mode: "consensus",
        rounds: consensusRounds,
        message: "Consensus orchestration initiated"
      };
    default:
      throw new Error(`Unknown orchestration mode: ${orchestrationMode}`);
  }
}
async function runCriticAgent(args) {
  const hanzoCmd = await findHanzoCommand();
  const criticArgs = [
    "agent",
    "critic",
    "--criteria",
    args.criteria?.join(",") || "all",
    "--severity",
    args.severity || "warning"
  ];
  if (args.code) {
    const tempFile = path15.join(os5.tmpdir(), `critic-${Date.now()}.code`);
    await fs14.writeFile(tempFile, args.code);
    criticArgs.push("--file", tempFile);
  } else if (args.files) {
    criticArgs.push("--files", args.files.join(","));
  }
  return executeCommand(`${hanzoCmd} ${criticArgs.join(" ")}`);
}
async function manageHanzoNode(args) {
  const hanzoCmd = await findHanzoCommand();
  switch (args.action) {
    case "start":
      const startArgs = ["node", "start"];
      if (args.models)
        startArgs.push("--models", args.models.join(","));
      if (args.network)
        startArgs.push("--network");
      if (args.blockchain)
        startArgs.push("--blockchain");
      return executeCommand(`${hanzoCmd} ${startArgs.join(" ")}`);
    case "stop":
      return executeCommand(`${hanzoCmd} node stop`);
    case "status":
      return executeCommand(`${hanzoCmd} node status`);
    case "connect":
      return executeCommand(`${hanzoCmd} node connect`);
    default:
      throw new Error(`Unknown node action: ${args.action}`);
  }
}
async function routeLLMRequest(args) {
  const hanzoCmd = await findHanzoCommand();
  const routerArgs = [
    "router",
    "route",
    "--prompt",
    args.prompt
  ];
  if (args.taskType)
    routerArgs.push("--task-type", args.taskType);
  if (args.requirements?.quality)
    routerArgs.push("--quality", args.requirements.quality);
  if (args.requirements?.maxCost)
    routerArgs.push("--max-cost", args.requirements.maxCost.toString());
  if (args.requirements?.maxLatency)
    routerArgs.push("--max-latency", args.requirements.maxLatency.toString());
  if (args.fallbackChain)
    routerArgs.push("--fallback", args.fallbackChain.join(","));
  return executeCommand(`${hanzoCmd} ${routerArgs.join(" ")}`);
}
async function achieveConsensus(args) {
  const { question, agents, mechanism, rounds } = args;
  const votes = [];
  for (let round = 1; round <= rounds; round++) {
    const roundVotes = await Promise.all(
      agents.map(async (agentId) => {
        const agent = activeAgents.get(agentId);
        if (!agent)
          throw new Error(`Agent ${agentId} not found`);
        const voteResult = await spawnAgent({
          model: agent.model,
          prompt: `${question}

Provide your answer/vote.`,
          context: round > 1 ? `Previous round votes: ${JSON.stringify(votes[round - 2])}` : void 0
        });
        return {
          agentId,
          vote: voteResult.result || "no result",
          round
        };
      })
    );
    votes.push(roundVotes);
  }
  const finalVotes = votes[rounds - 1];
  let consensus;
  switch (mechanism) {
    case "majority":
      const voteCounts = /* @__PURE__ */ new Map();
      finalVotes.forEach((v) => {
        const count = voteCounts.get(v.vote) || 0;
        voteCounts.set(v.vote, count + 1);
      });
      consensus = Array.from(voteCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
      break;
    case "unanimous":
      const firstVote = finalVotes[0].vote;
      consensus = finalVotes.every((v) => v.vote === firstVote) ? firstVote : null;
      break;
    default:
      consensus = null;
  }
  return {
    question,
    mechanism,
    rounds,
    votes,
    consensus,
    achieved: consensus !== null
  };
}
async function findHanzoCommand() {
  const commands = [
    "hanzo",
    path15.join(os5.homedir(), ".local", "bin", "hanzo"),
    path15.join(os5.homedir(), "work", "hanzo", "python-sdk", "hanzo"),
    "python -m hanzo.cli"
  ];
  for (const cmd of commands) {
    try {
      const whichCmd = process.platform === "win32" ? "where" : "which";
      await executeCommand(`${whichCmd} ${cmd.split(" ")[0]}`);
      return cmd;
    } catch {
      continue;
    }
  }
  throw new Error("Hanzo CLI not found. Install with: pip install hanzo");
}
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn5("sh", ["-c", command], {
      stdio: "pipe"
    });
    let output = "";
    let error = "";
    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      error += data.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(error || `Command failed with code ${code}`));
      }
    });
  });
}
var activeAgents, spawnAgentTool, swarmOrchestrationTool, criticAgentTool, hanzoNodeTool, llmRouterTool, consensusTool, spawnAgentSchema, swarmOrchestrationSchema, orchestrationTools;
var init_agent_tools = __esm({
  "src/orchestration/agent-tools.ts"() {
    "use strict";
    activeAgents = /* @__PURE__ */ new Map();
    spawnAgentTool = {
      name: "spawn_agent",
      description: "Spawn a new AI agent to handle a specific task with optional model selection and constraints",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The task prompt for the agent"
          },
          model: {
            type: "string",
            description: "Model to use (e.g., claude-3-opus, gpt-4, llama-3.2-3b)",
            default: "claude-3-5-sonnet-20241022"
          },
          context: {
            type: "string",
            description: "Additional context for the agent"
          },
          outputGoal: {
            type: "string",
            description: "Expected output format or goal"
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Files the agent should work with"
          },
          readOnly: {
            type: "boolean",
            description: "Whether agent has read-only access",
            default: false
          },
          useWorktree: {
            type: "boolean",
            description: "Create isolated Git worktree for agent",
            default: false
          }
        },
        required: ["prompt"]
      },
      handler: async (args) => {
        const result = await spawnAgent(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    swarmOrchestrationTool = {
      name: "swarm_orchestration",
      description: "Orchestrate multiple agents working in parallel or sequence with coordination",
      inputSchema: {
        type: "object",
        properties: {
          agents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                model: { type: "string" },
                prompt: { type: "string" },
                dependencies: {
                  type: "array",
                  items: { type: "string" },
                  description: "Agent IDs this agent depends on"
                }
              },
              required: ["model", "prompt"]
            },
            description: "Array of agent configurations"
          },
          orchestrationMode: {
            type: "string",
            enum: ["parallel", "sequential", "hierarchical", "consensus"],
            description: "How agents should be coordinated",
            default: "parallel"
          },
          consensusRounds: {
            type: "number",
            description: "Number of consensus rounds for consensus mode",
            default: 2
          }
        },
        required: ["agents"]
      },
      handler: async (args) => {
        const result = await orchestrateSwarm(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    criticAgentTool = {
      name: "critic_agent",
      description: "Spawn a critic agent to review code, suggest improvements, and enforce quality standards",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Code to review"
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Files to review"
          },
          criteria: {
            type: "array",
            items: { type: "string" },
            description: "Review criteria (e.g., security, performance, style)",
            default: ["security", "performance", "maintainability", "testing"]
          },
          severity: {
            type: "string",
            enum: ["info", "warning", "error", "critical"],
            description: "Minimum severity to report",
            default: "warning"
          }
        },
        required: []
      },
      handler: async (args) => {
        const result = await runCriticAgent(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    hanzoNodeTool = {
      name: "hanzo_node",
      description: "Connect to or spawn a Hanzo compute node for distributed AI processing",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start", "stop", "status", "connect"],
            description: "Action to perform"
          },
          models: {
            type: "array",
            items: { type: "string" },
            description: "Models to load on the node"
          },
          network: {
            type: "boolean",
            description: "Enable network discovery",
            default: false
          },
          blockchain: {
            type: "boolean",
            description: "Enable blockchain consensus",
            default: false
          }
        },
        required: ["action"]
      },
      handler: async (args) => {
        const result = await manageHanzoNode(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    llmRouterTool = {
      name: "llm_router",
      description: "Route requests to optimal LLM based on task requirements and cost optimization",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The prompt to route"
          },
          taskType: {
            type: "string",
            enum: ["code_generation", "analysis", "refactoring", "documentation", "testing", "simple"],
            description: "Type of task"
          },
          requirements: {
            type: "object",
            properties: {
              quality: {
                type: "string",
                enum: ["maximum", "balanced", "fast"],
                default: "balanced"
              },
              maxCost: {
                type: "number",
                description: "Maximum cost in USD"
              },
              maxLatency: {
                type: "number",
                description: "Maximum latency in seconds"
              }
            }
          },
          fallbackChain: {
            type: "array",
            items: { type: "string" },
            description: "Fallback model chain",
            default: ["claude-3-5-sonnet", "gpt-4", "gemini-pro", "llama-3.2"]
          }
        },
        required: ["prompt"]
      },
      handler: async (args) => {
        const result = await routeLLMRequest(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    consensusTool = {
      name: "consensus",
      description: "Achieve consensus among multiple agents using various voting mechanisms",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Question or decision to reach consensus on"
          },
          agents: {
            type: "array",
            items: { type: "string" },
            description: "Agent IDs to participate"
          },
          mechanism: {
            type: "string",
            enum: ["majority", "unanimous", "weighted", "ranked"],
            description: "Consensus mechanism",
            default: "majority"
          },
          rounds: {
            type: "number",
            description: "Number of voting rounds",
            default: 1
          }
        },
        required: ["question", "agents"]
      },
      handler: async (args) => {
        const result = await achieveConsensus(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    spawnAgentSchema = z5.object({
      prompt: z5.string(),
      model: z5.string().optional(),
      context: z5.string().optional(),
      outputGoal: z5.string().optional(),
      files: z5.array(z5.string()).optional(),
      readOnly: z5.boolean().optional(),
      useWorktree: z5.boolean().optional()
    });
    swarmOrchestrationSchema = z5.object({
      agents: z5.array(z5.object({
        model: z5.string(),
        prompt: z5.string(),
        dependencies: z5.array(z5.string()).optional()
      })),
      orchestrationMode: z5.enum(["parallel", "sequential", "hierarchical", "consensus"]).optional(),
      consensusRounds: z5.number().optional()
    });
    orchestrationTools = [
      spawnAgentTool,
      swarmOrchestrationTool,
      criticAgentTool,
      hanzoNodeTool,
      llmRouterTool,
      consensusTool
    ];
  }
});

// src/tools/hanzo-desktop.ts
import { exec as exec11 } from "child_process";
import * as os6 from "os";
import { promisify as promisify11 } from "util";
import * as fs15 from "fs/promises";
import * as path16 from "path";
var execAsync11, HanzoDesktopTool, hanzo_desktop_default;
var init_hanzo_desktop = __esm({
  "src/tools/hanzo-desktop.ts"() {
    "use strict";
    execAsync11 = promisify11(exec11);
    HanzoDesktopTool = class {
      name = "hanzo_desktop";
      description = "Control and debug the Hanzo Desktop application";
      inputSchema = {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "get_state",
              "click_button",
              "execute_js",
              "execute_js_with_result",
              "get_dom",
              "click_element",
              "focus_window",
              "set_window_visibility",
              "enable_remote_ui",
              "disable_remote_ui",
              "get_windows",
              "click_get_started",
              "debug_button",
              "screenshot",
              "start_mcp_server",
              "get_debug_info",
              "connect_to_mcp"
            ],
            description: "Action to perform on the desktop app"
          },
          window: {
            type: "string",
            description: 'Window label to interact with (e.g., "main", "spotlight")'
          },
          selector: {
            type: "string",
            description: "CSS selector for element interaction"
          },
          script: {
            type: "string",
            description: "JavaScript code to execute in window"
          },
          visible: {
            type: "boolean",
            description: "Whether to show or hide the window"
          },
          port: {
            type: "number",
            description: "Port number for MCP server (default: 9222)"
          }
        },
        required: ["action"]
      };
      async handler(params) {
        return this.execute(params);
      }
      async execute(params) {
        if (process.platform !== "darwin") {
          return { error: "Hanzo Desktop control is currently macOS-only. Windows/Linux support coming soon." };
        }
        const { action, window = "main", selector, script, visible, port } = params;
        switch (action) {
          case "get_state":
            return this.getAppState();
          case "click_button":
            return this.clickButton(window, selector || "button");
          case "execute_js":
            return this.executeJS(window, script || "return document.title");
          case "execute_js_with_result":
            return this.executeJSWithResult(window, script || "return document.title");
          case "get_dom":
            return this.getDOMStructure(window);
          case "click_element":
            return this.clickElementBySelector(window, selector || "button");
          case "focus_window":
            return this.focusWindow(window);
          case "set_window_visibility":
            return this.setWindowVisibility(window, visible !== false);
          case "enable_remote_ui":
            return this.enableRemoteUI();
          case "disable_remote_ui":
            return this.disableRemoteUI();
          case "get_windows":
            return this.getWindows();
          case "click_get_started":
            return this.clickGetStartedButton();
          case "debug_button":
            return this.debugGetStartedButton();
          case "screenshot":
            return this.takeScreenshot();
          case "start_mcp_server":
            return this.startMCPServer(port);
          case "get_debug_info":
            return this.getDebugInfo();
          case "connect_to_mcp":
            return this.connectToMCP(port);
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      }
      async getAppState() {
        try {
          const { stdout: psOutput } = await execAsync11('ps aux | grep -i "hanzo.*desktop" | grep -v grep');
          const isRunning = psOutput.includes("Hanzo AI.app") || psOutput.includes("hanzo-desktop");
          if (!isRunning) {
            return {
              windows: [],
              hanzoNodeRunning: false,
              remoteUiEnabled: false,
              mcpRunning: false
            };
          }
          const script = `
        tell application "Hanzo AI"
          set windowList to {}
          repeat with w in windows
            set end of windowList to {name of w, visible of w}
          end repeat
          return windowList
        end tell
      `;
          const { stdout } = await execAsync11(`osascript -e '${script}'`).catch(() => ({ stdout: "" }));
          return {
            windows: [{
              label: "main",
              isVisible: true,
              isFocused: true,
              url: "app://localhost"
            }],
            hanzoNodeRunning: false,
            remoteUiEnabled: false,
            mcpRunning: true
          };
        } catch (error) {
          return {
            windows: [],
            hanzoNodeRunning: false,
            remoteUiEnabled: false,
            mcpRunning: false
          };
        }
      }
      async clickButton(window, selector) {
        const script = `
      tell application "System Events"
        tell process "Hanzo AI"
          set frontmost to true
          delay 0.5
          click button 1 of window 1
        end tell
      end tell
    `;
        try {
          await execAsync11(`osascript -e '${script}'`);
          return { success: true, message: `Clicked button in window ${window}` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
      async executeJS(window, script) {
        return {
          success: false,
          message: "JavaScript execution requires app support via Remote UI"
        };
      }
      async enableRemoteUI() {
        try {
          const response = await fetch("http://localhost:9090");
          return {
            success: true,
            url: "http://localhost:9090",
            message: "Remote UI is available"
          };
        } catch (error) {
          return {
            success: false,
            message: "Remote UI not available - app may not be running or Remote UI not enabled"
          };
        }
      }
      async disableRemoteUI() {
        return {
          success: false,
          message: "Remote UI cannot be disabled via MCP - restart app to disable"
        };
      }
      async getWindows() {
        const state = await this.getAppState();
        return state.windows;
      }
      async clickGetStartedButton() {
        const script = `
      tell application "System Events"
        tell process "Hanzo AI"
          set frontmost to true
          delay 1
          
          -- Try to find and click the Get Started button
          try
            click button "Get Started Free" of window 1
            return "Clicked Get Started Free button"
          on error
            try
              -- Alternative: click first button
              click button 1 of window 1
              return "Clicked first button"
            on error errMsg
              return "Error: " & errMsg
            end try
          end try
        end tell
      end tell
    `;
        try {
          const { stdout } = await execAsync11(`osascript -e '${script}'`);
          return { success: true, message: stdout.trim() };
        } catch (error) {
          return this.clickViaAccessibility();
        }
      }
      async clickViaAccessibility() {
        const script = `
      tell application "Hanzo AI" to activate
      delay 1
      tell application "System Events"
        key code 36 -- Press Enter key
      end tell
    `;
        try {
          await execAsync11(`osascript -e '${script}'`);
          return { success: true, message: "Pressed Enter key to trigger button" };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
      async debugGetStartedButton() {
        const debugInfo = {
          appState: await this.getAppState(),
          processes: [],
          errors: []
        };
        try {
          const { stdout: hanzodPs } = await execAsync11("ps aux | grep hanzod | grep -v grep");
          debugInfo.hanzodRunning = hanzodPs.length > 0;
          debugInfo.hanzodProcess = hanzodPs.trim();
        } catch {
          debugInfo.hanzodRunning = false;
        }
        try {
          const { stdout: logs } = await execAsync11('tail -50 ~/Library/Logs/com.hanzo.desktop/*.log 2>/dev/null | grep -i "identity\\|invalid\\|panic"');
          if (logs.includes("Node part of the name contains invalid characters")) {
            debugInfo.identityError = true;
            debugInfo.errorMessage = 'GLOBAL_IDENTITY_NAME contains invalid characters - should be "hanzod"';
          }
        } catch {
        }
        try {
          const response = await fetch("http://localhost:9090");
          debugInfo.remoteUiAvailable = response.ok;
        } catch {
          debugInfo.remoteUiAvailable = false;
        }
        return debugInfo;
      }
      async takeScreenshot() {
        const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
        const screenshotPath = path16.join(os6.tmpdir(), `hanzo-desktop-${timestamp}.png`);
        try {
          await execAsync11(`screencapture -l $(osascript -e 'tell app "Hanzo AI" to id of window 1') ${screenshotPath}`);
          const screenshotBuffer = await fs15.readFile(screenshotPath);
          const screenshot = screenshotBuffer.toString("base64");
          await fs15.unlink(screenshotPath);
          return {
            success: true,
            screenshot: `data:image/png;base64,${screenshot}`,
            message: "Screenshot captured"
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
            message: "Failed to capture screenshot"
          };
        }
      }
      // New enhanced remote control methods using direct Tauri communication
      async executeJSWithResult(window, script) {
        return {
          success: false,
          message: "executeJSWithResult requires direct Tauri connection - use start_mcp_server first",
          hint: "Use connect_to_mcp action to establish direct communication"
        };
      }
      async getDOMStructure(window) {
        return {
          success: false,
          message: "getDOMStructure requires direct Tauri connection - use start_mcp_server first",
          hint: "Use connect_to_mcp action to establish direct communication"
        };
      }
      async clickElementBySelector(window, selector) {
        return {
          success: false,
          message: "clickElementBySelector requires direct Tauri connection - use start_mcp_server first",
          hint: "Use connect_to_mcp action to establish direct communication"
        };
      }
      async focusWindow(window) {
        return {
          success: false,
          message: "focusWindow requires direct Tauri connection - use start_mcp_server first",
          hint: "Use connect_to_mcp action to establish direct communication"
        };
      }
      async setWindowVisibility(window, visible) {
        return {
          success: false,
          message: "setWindowVisibility requires direct Tauri connection - use start_mcp_server first",
          hint: "Use connect_to_mcp action to establish direct communication"
        };
      }
      async startMCPServer(port) {
        const mcpPort = port || 9222;
        try {
          const response = await fetch(`http://localhost:${mcpPort}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: 1,
              method: "hanzo.getDebugInfo",
              jsonrpc: "2.0"
            })
          });
          if (response.ok) {
            return {
              success: true,
              message: `MCP server already running on port ${mcpPort}`,
              port: mcpPort,
              url: `http://localhost:${mcpPort}`
            };
          }
        } catch (error) {
        }
        return {
          success: false,
          message: `MCP server not running on port ${mcpPort}`,
          hint: "Start the Hanzo Desktop app to automatically start the MCP server",
          port: mcpPort
        };
      }
      async getDebugInfo() {
        try {
          const response = await fetch("http://localhost:9222", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: 1,
              method: "hanzo.getDebugInfo",
              jsonrpc: "2.0"
            })
          });
          if (response.ok) {
            const result = await response.json();
            return result.result || result;
          } else {
            return {
              success: false,
              message: "MCP server not available - start Hanzo Desktop app first"
            };
          }
        } catch (error) {
          return {
            success: false,
            message: "Could not connect to MCP server",
            error: error.message,
            hint: "Ensure Hanzo Desktop app is running and MCP server is started"
          };
        }
      }
      async connectToMCP(port) {
        const mcpPort = port || 9222;
        try {
          const response = await fetch(`http://localhost:${mcpPort}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: 1,
              method: "hanzo.getDebugInfo",
              jsonrpc: "2.0"
            })
          });
          if (response.ok) {
            const result = await response.json();
            return {
              success: true,
              message: `Connected to MCP server on port ${mcpPort}`,
              port: mcpPort,
              url: `http://localhost:${mcpPort}`,
              serverInfo: result.result,
              availableMethods: [
                "Runtime.evaluate",
                "DOM.getDocument",
                "DOM.querySelector",
                "Page.captureScreenshot",
                "hanzo.executeJS",
                "hanzo.clickElement",
                "hanzo.getWindows",
                "hanzo.getDebugInfo"
              ]
            };
          } else {
            return {
              success: false,
              message: `MCP server responded with status ${response.status}`,
              port: mcpPort
            };
          }
        } catch (error) {
          return {
            success: false,
            message: `Could not connect to MCP server on port ${mcpPort}`,
            error: error.message,
            hint: "Ensure Hanzo Desktop app is running with MCP server enabled"
          };
        }
      }
    };
    hanzo_desktop_default = HanzoDesktopTool;
  }
});

// src/tools/playwright-control.ts
var PlaywrightControlTool, playwright_control_default;
var init_playwright_control = __esm({
  "src/tools/playwright-control.ts"() {
    "use strict";
    PlaywrightControlTool = class {
      name = "playwright_control";
      description = "High-level automation control for Hanzo Desktop app using Playwright-compatible methods";
      inputSchema = {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "connect",
              "disconnect",
              "click",
              "type",
              "wait",
              "waitForSelector",
              "screenshot",
              "evaluate",
              "getTitle",
              "getText",
              "runSequence",
              "createSequence",
              "listSequences",
              "status"
            ],
            description: "Playwright automation action to perform"
          },
          selector: {
            type: "string",
            description: "CSS selector for element targeting"
          },
          text: {
            type: "string",
            description: "Text to type or search for"
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 5000)"
          },
          script: {
            type: "string",
            description: "JavaScript code to evaluate in the page"
          },
          url: {
            type: "string",
            description: "URL to navigate to (for internal app navigation)"
          },
          sequence: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              actions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["click", "type", "wait", "screenshot", "evaluate", "navigate", "waitForSelector"] },
                    selector: { type: "string" },
                    text: { type: "string" },
                    timeout: { type: "number" },
                    script: { type: "string" },
                    url: { type: "string" }
                  },
                  required: ["type"]
                }
              }
            },
            description: "Automation sequence definition"
          },
          sequenceName: {
            type: "string",
            description: "Name of sequence to run"
          },
          debugPort: {
            type: "number",
            description: "Chrome DevTools Protocol port (default: 9222)"
          }
        },
        required: ["action"]
      };
      connected = false;
      debugPort = 9222;
      sequences = /* @__PURE__ */ new Map();
      constructor() {
        this.initializeCommonSequences();
      }
      async handler(params) {
        return this.execute(params);
      }
      async execute(params) {
        const {
          action,
          selector,
          text,
          timeout = 5e3,
          script,
          url,
          sequence,
          sequenceName,
          debugPort = 9222
        } = params;
        this.debugPort = debugPort;
        switch (action) {
          case "connect":
            return this.connect();
          case "disconnect":
            return this.disconnect();
          case "status":
            return this.getStatus();
          case "click":
            return this.click(selector);
          case "type":
            return this.type(selector, text);
          case "wait":
            return this.wait(timeout);
          case "waitForSelector":
            return this.waitForSelector(selector, timeout);
          case "screenshot":
            return this.screenshot();
          case "evaluate":
            return this.evaluate(script);
          case "getTitle":
            return this.getTitle();
          case "getText":
            return this.getText(selector);
          case "runSequence":
            return this.runSequence(sequenceName);
          case "createSequence":
            return this.createSequence(sequence);
          case "listSequences":
            return this.listSequences();
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      }
      async connect() {
        try {
          const response = await this.sendCDPCommand("Runtime.enable");
          if (response.success) {
            this.connected = true;
            return {
              success: true,
              message: `Connected to Hanzo Desktop app on port ${this.debugPort}`,
              port: this.debugPort,
              capabilities: [
                "JavaScript evaluation",
                "DOM manipulation",
                "Element clicking",
                "Screenshot capture",
                "Page navigation",
                "Automation sequences"
              ]
            };
          } else {
            return {
              success: false,
              message: "Failed to connect to Hanzo Desktop app",
              hint: "Ensure the app is running with MCP server enabled"
            };
          }
        } catch (error) {
          return {
            success: false,
            message: "Connection failed",
            error: error.message,
            hint: "Start Hanzo Desktop app and ensure MCP server is running"
          };
        }
      }
      async disconnect() {
        this.connected = false;
        return {
          success: true,
          message: "Disconnected from Hanzo Desktop app"
        };
      }
      async getStatus() {
        return {
          connected: this.connected,
          port: this.debugPort,
          sequencesAvailable: this.sequences.size,
          capabilities: this.connected ? [
            "Runtime evaluation",
            "DOM queries",
            "Input simulation",
            "Screenshot capture"
          ] : []
        };
      }
      async click(selector) {
        if (!this.connected) {
          return { success: false, message: "Not connected - call connect() first" };
        }
        const result = await this.sendCDPCommand("hanzo.clickElement", {
          selector,
          window: "main"
        });
        return {
          success: result.success,
          message: result.success ? `Clicked element: ${selector}` : `Failed to click: ${selector}`,
          selector,
          result: result.data
        };
      }
      async type(selector, text) {
        if (!this.connected) {
          return { success: false, message: "Not connected - call connect() first" };
        }
        const script = `
      const element = document.querySelector('${selector}');
      if (element) {
        element.focus();
        element.value = '${text.replace(/'/g, "\\'")}';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, typed: '${text}' };
      } else {
        return { success: false, error: 'Element not found' };
      }
    `;
        const result = await this.sendCDPCommand("hanzo.executeJS", {
          script,
          window: "main"
        });
        return {
          success: result.success,
          message: result.success ? `Typed text into ${selector}` : `Failed to type into ${selector}`,
          selector,
          text,
          result: result.data
        };
      }
      async wait(timeout) {
        await new Promise((resolve) => setTimeout(resolve, timeout));
        return {
          success: true,
          message: `Waited ${timeout}ms`
        };
      }
      async waitForSelector(selector, timeout = 5e3) {
        if (!this.connected) {
          return { success: false, message: "Not connected - call connect() first" };
        }
        const script = `
      const waitForElement = (selector, timeout) => {
        return new Promise((resolve) => {
          const element = document.querySelector(selector);
          if (element) {
            resolve({ success: true, found: true });
            return;
          }

          const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
              observer.disconnect();
              resolve({ success: true, found: true });
            }
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true
          });

          setTimeout(() => {
            observer.disconnect();
            resolve({ success: false, found: false, timeout: true });
          }, timeout);
        });
      };

      waitForElement('${selector}', ${timeout});
    `;
        const result = await this.sendCDPCommand("hanzo.executeJS", {
          script,
          window: "main"
        });
        return {
          success: result.success,
          message: result.success ? `Found element: ${selector}` : `Element not found: ${selector}`,
          selector,
          timeout,
          result: result.data
        };
      }
      async screenshot() {
        if (!this.connected) {
          return { success: false, message: "Not connected - call connect() first" };
        }
        const result = await this.sendCDPCommand("Page.captureScreenshot", {
          format: "png",
          quality: 90
        });
        return {
          success: result.success,
          message: result.success ? "Screenshot captured" : "Failed to capture screenshot",
          data: result.data
        };
      }
      async evaluate(script) {
        if (!this.connected) {
          return { success: false, message: "Not connected - call connect() first" };
        }
        const result = await this.sendCDPCommand("hanzo.executeJS", {
          script,
          window: "main"
        });
        return {
          success: result.success,
          message: result.success ? "Script executed" : "Script execution failed",
          script,
          result: result.data
        };
      }
      async getTitle() {
        return this.evaluate("return document.title");
      }
      async getText(selector) {
        const script = `
      const element = document.querySelector('${selector}');
      return element ? element.textContent : null;
    `;
        return this.evaluate(script);
      }
      async runSequence(sequenceName) {
        const sequence = this.sequences.get(sequenceName);
        if (!sequence) {
          return {
            success: false,
            message: `Sequence '${sequenceName}' not found`,
            availableSequences: Array.from(this.sequences.keys())
          };
        }
        if (!this.connected) {
          return { success: false, message: "Not connected - call connect() first" };
        }
        const results = [];
        for (let i = 0; i < sequence.actions.length; i++) {
          const action = sequence.actions[i];
          let result;
          try {
            switch (action.type) {
              case "click":
                result = await this.click(action.selector);
                break;
              case "type":
                result = await this.type(action.selector, action.text);
                break;
              case "wait":
                result = await this.wait(action.timeout || 1e3);
                break;
              case "waitForSelector":
                result = await this.waitForSelector(action.selector, action.timeout);
                break;
              case "screenshot":
                result = await this.screenshot();
                break;
              case "evaluate":
                result = await this.evaluate(action.script);
                break;
              default:
                result = { success: false, message: `Unknown action type: ${action.type}` };
            }
            results.push({ step: i + 1, action: action.type, result });
            if (!result.success && !["wait", "screenshot"].includes(action.type)) {
              return {
                success: false,
                message: `Sequence failed at step ${i + 1}`,
                sequence: sequenceName,
                results
              };
            }
          } catch (error) {
            results.push({ step: i + 1, action: action.type, error: error.message });
            return {
              success: false,
              message: `Sequence error at step ${i + 1}`,
              sequence: sequenceName,
              results
            };
          }
        }
        return {
          success: true,
          message: `Sequence '${sequenceName}' completed successfully`,
          sequence: sequenceName,
          results
        };
      }
      async createSequence(sequenceData) {
        if (!sequenceData.name || !sequenceData.actions) {
          return {
            success: false,
            message: "Sequence must have name and actions"
          };
        }
        this.sequences.set(sequenceData.name, sequenceData);
        return {
          success: true,
          message: `Sequence '${sequenceData.name}' created`,
          sequence: sequenceData
        };
      }
      async listSequences() {
        const sequences = Array.from(this.sequences.entries()).map(([name, seq]) => ({
          name,
          description: seq.description,
          steps: seq.actions.length
        }));
        return {
          success: true,
          sequences,
          count: sequences.length
        };
      }
      initializeCommonSequences() {
        this.sequences.set("click_get_started", {
          name: "click_get_started",
          description: "Click the Get Started button in Hanzo AI app",
          actions: [
            { type: "waitForSelector", selector: 'button:contains("Get Started")', timeout: 5e3 },
            { type: "click", selector: 'button:contains("Get Started")' },
            { type: "wait", timeout: 2e3 },
            { type: "screenshot" }
          ]
        });
        this.sequences.set("explore_app", {
          name: "explore_app",
          description: "Take screenshots and explore the main areas of the app",
          actions: [
            { type: "screenshot" },
            { type: "evaluate", script: 'return { title: document.title, url: window.location.href, buttons: document.querySelectorAll("button").length }' },
            { type: "wait", timeout: 1e3 }
          ]
        });
        this.sequences.set("debug_app", {
          name: "debug_app",
          description: "Debug the current state of the app",
          actions: [
            { type: "evaluate", script: 'return { readyState: document.readyState, elements: document.querySelectorAll("*").length }' },
            { type: "screenshot" },
            { type: "evaluate", script: 'return Array.from(document.querySelectorAll("button")).map(b => ({ text: b.textContent, id: b.id, class: b.className }))' }
          ]
        });
      }
      async sendCDPCommand(method, params) {
        try {
          const response = await fetch(`http://localhost:${this.debugPort}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: Date.now(),
              method,
              params,
              jsonrpc: "2.0"
            })
          });
          if (response.ok) {
            const result = await response.json();
            return {
              success: !result.error,
              data: result.result || result.error
            };
          } else {
            return {
              success: false,
              error: `HTTP ${response.status}`
            };
          }
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    };
    playwright_control_default = PlaywrightControlTool;
  }
});

// src/tools/ui-registry.ts
import { exec as exec12 } from "child_process";
import { promisify as promisify12 } from "util";
var execAsync12, REGISTRIES, COMPONENT_CATEGORIES, AVAILABLE_COMPONENTS, listUIComponents, searchUIComponents, getUIComponent, installUIComponent, createUIComposition, getUIRegistry, uiRegistryTools;
var init_ui_registry = __esm({
  "src/tools/ui-registry.ts"() {
    "use strict";
    execAsync12 = promisify12(exec12);
    REGISTRIES = {
      shadcn: "https://ui.shadcn.com/registry",
      hanzo: "https://hanzo.ai/registry",
      acme: "https://acme.com/r"
    };
    COMPONENT_CATEGORIES = {
      layout: ["sidebar", "navbar", "footer", "container", "grid"],
      forms: ["input", "textarea", "select", "checkbox", "radio", "switch", "form"],
      feedback: ["alert", "toast", "dialog", "modal", "tooltip", "popover"],
      navigation: ["menu", "tabs", "breadcrumb", "pagination", "stepper"],
      data: ["table", "list", "tree", "timeline", "calendar"],
      display: ["card", "avatar", "badge", "chip", "tag", "progress", "skeleton"],
      charts: ["line-chart", "bar-chart", "pie-chart", "area-chart", "radial-chart"]
    };
    AVAILABLE_COMPONENTS = [
      // shadcn/ui components
      { name: "accordion", category: "display", registry: "shadcn", description: "A vertically stacked set of interactive headings" },
      { name: "alert", category: "feedback", registry: "shadcn", description: "Displays a callout for user attention" },
      { name: "alert-dialog", category: "feedback", registry: "shadcn", description: "A modal dialog that interrupts the user with important content" },
      { name: "aspect-ratio", category: "layout", registry: "shadcn", description: "Displays content within a desired ratio" },
      { name: "avatar", category: "display", registry: "shadcn", description: "An image element with a fallback for representing the user" },
      { name: "badge", category: "display", registry: "shadcn", description: "Displays a badge or a component that looks like a badge" },
      { name: "breadcrumb", category: "navigation", registry: "shadcn", description: "Displays a breadcrumb navigation" },
      { name: "button", category: "forms", registry: "shadcn", description: "Displays a button or a component that looks like a button" },
      { name: "calendar", category: "data", registry: "shadcn", description: "A date field component that allows users to enter and edit date" },
      { name: "card", category: "display", registry: "shadcn", description: "Displays a card with header, content, and footer" },
      { name: "carousel", category: "display", registry: "shadcn", description: "A carousel with motion and swipe built in" },
      { name: "chart", category: "charts", registry: "shadcn", description: "Charts built with Recharts" },
      { name: "checkbox", category: "forms", registry: "shadcn", description: "A control that allows the user to toggle between checked and not checked" },
      { name: "collapsible", category: "display", registry: "shadcn", description: "An interactive component which expands/collapses a panel" },
      { name: "combobox", category: "forms", registry: "shadcn", description: "Autocomplete input and command palette with a list of suggestions" },
      { name: "command", category: "forms", registry: "shadcn", description: "Fast, composable, unstyled command menu for React" },
      { name: "context-menu", category: "navigation", registry: "shadcn", description: "Displays a menu to the user on right click" },
      { name: "data-table", category: "data", registry: "shadcn", description: "Powerful table and datagrids built with Tanstack Table" },
      { name: "date-picker", category: "forms", registry: "shadcn", description: "A date picker component with range and presets" },
      { name: "dialog", category: "feedback", registry: "shadcn", description: "A window overlaid on primary content" },
      { name: "drawer", category: "feedback", registry: "shadcn", description: "A drawer component for navigation and forms" },
      { name: "dropdown-menu", category: "navigation", registry: "shadcn", description: "Displays a menu to the user" },
      { name: "hover-card", category: "display", registry: "shadcn", description: "For sighted users to preview content on hover" },
      { name: "input", category: "forms", registry: "shadcn", description: "Displays a form input field" },
      { name: "input-otp", category: "forms", registry: "shadcn", description: "Accessible one-time password component" },
      { name: "label", category: "forms", registry: "shadcn", description: "Renders an accessible label associated with controls" },
      { name: "menubar", category: "navigation", registry: "shadcn", description: "A visually persistent menu for frequently used commands" },
      { name: "navigation-menu", category: "navigation", registry: "shadcn", description: "A collection of links for navigating websites" },
      { name: "pagination", category: "navigation", registry: "shadcn", description: "Pagination with page navigation, next and previous links" },
      { name: "popover", category: "feedback", registry: "shadcn", description: "Displays rich content in a portal, triggered by a button" },
      { name: "progress", category: "display", registry: "shadcn", description: "Displays an indicator showing completion of a task" },
      { name: "radio-group", category: "forms", registry: "shadcn", description: "A set of checkable buttons where only one can be checked" },
      { name: "resizable", category: "layout", registry: "shadcn", description: "Accessible resizable panel groups and layouts" },
      { name: "scroll-area", category: "layout", registry: "shadcn", description: "Augments native scroll functionality for custom styling" },
      { name: "select", category: "forms", registry: "shadcn", description: "Displays a list of options for the user to pick from" },
      { name: "separator", category: "layout", registry: "shadcn", description: "Visually or semantically separates content" },
      { name: "sheet", category: "feedback", registry: "shadcn", description: "Extends the Dialog component for a panel on screen edges" },
      { name: "sidebar", category: "layout", registry: "shadcn", description: "A composable, themeable sidebar component" },
      { name: "skeleton", category: "display", registry: "shadcn", description: "Use to show a placeholder while content is loading" },
      { name: "slider", category: "forms", registry: "shadcn", description: "An input where the user selects a value from within a range" },
      { name: "sonner", category: "feedback", registry: "shadcn", description: "An opinionated toast component for React" },
      { name: "switch", category: "forms", registry: "shadcn", description: "A control that allows toggling between checked and not checked" },
      { name: "table", category: "data", registry: "shadcn", description: "A responsive table component" },
      { name: "tabs", category: "navigation", registry: "shadcn", description: "A set of layered sections of content" },
      { name: "textarea", category: "forms", registry: "shadcn", description: "Displays a form textarea field" },
      { name: "toast", category: "feedback", registry: "shadcn", description: "A succinct message that appears temporarily" },
      { name: "toggle", category: "forms", registry: "shadcn", description: "A two-state button that can be either on or off" },
      { name: "toggle-group", category: "forms", registry: "shadcn", description: "A set of two-state buttons that can be toggled" },
      { name: "tooltip", category: "feedback", registry: "shadcn", description: "A popup that displays information on hover" },
      // @hanzo/ui custom components
      { name: "hero", category: "layout", registry: "hanzo", description: "Hero section with CTA and background" },
      { name: "features", category: "layout", registry: "hanzo", description: "Feature grid with icons and descriptions" },
      { name: "testimonials", category: "display", registry: "hanzo", description: "Customer testimonials carousel" },
      { name: "pricing", category: "display", registry: "hanzo", description: "Pricing cards with feature lists" },
      { name: "login-form", category: "forms", registry: "hanzo", description: "Complete login form with validation" },
      { name: "checkout", category: "forms", registry: "hanzo", description: "E-commerce checkout flow" },
      { name: "product-card", category: "display", registry: "hanzo", description: "Product display card with image and details" },
      { name: "dashboard", category: "layout", registry: "hanzo", description: "Admin dashboard layout" }
    ];
    listUIComponents = {
      name: "ui_list_components",
      description: "List all available UI components from @hanzo/ui and shadcn/ui registries",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by category (layout, forms, feedback, navigation, data, display, charts)",
            enum: Object.keys(COMPONENT_CATEGORIES)
          },
          registry: {
            type: "string",
            description: "Filter by registry (shadcn, hanzo, all)",
            enum: ["shadcn", "hanzo", "all"],
            default: "all"
          }
        }
      },
      handler: async (args) => {
        const { category, registry = "all" } = args;
        let components = AVAILABLE_COMPONENTS;
        if (category) {
          components = components.filter((c) => c.category === category);
        }
        if (registry !== "all") {
          components = components.filter((c) => c.registry === registry);
        }
        const grouped = components.reduce((acc, comp) => {
          if (!acc[comp.category]) {
            acc[comp.category] = [];
          }
          acc[comp.category].push(comp);
          return acc;
        }, {});
        let output = `\u{1F4E6} Available UI Components (${components.length} total)

`;
        for (const [cat, comps] of Object.entries(grouped)) {
          output += `${cat.toUpperCase()}
`;
          output += `${"\u2500".repeat(40)}
`;
          for (const comp of comps) {
            output += `  \u2022 ${comp.name} (${comp.registry}): ${comp.description}
`;
          }
          output += "\n";
        }
        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      }
    };
    searchUIComponents = {
      name: "ui_search_components",
      description: "Search for UI components by name or functionality",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (name or functionality)"
          }
        },
        required: ["query"]
      },
      handler: async (args) => {
        const { query } = args;
        const searchTerm = query.toLowerCase();
        const matches = AVAILABLE_COMPONENTS.filter(
          (comp) => comp.name.toLowerCase().includes(searchTerm) || comp.description.toLowerCase().includes(searchTerm) || comp.category.toLowerCase().includes(searchTerm)
        );
        if (matches.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No components found matching "${query}"`
            }]
          };
        }
        let output = `\u{1F50D} Search Results for "${query}" (${matches.length} matches)

`;
        for (const comp of matches) {
          output += `\u{1F4E6} ${comp.name}
`;
          output += `  Registry: ${comp.registry}
`;
          output += `  Category: ${comp.category}
`;
          output += `  Description: ${comp.description}

`;
        }
        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      }
    };
    getUIComponent = {
      name: "ui_get_component",
      description: "Get detailed information about a specific UI component",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name (e.g., button, card, dialog)"
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        const { name } = args;
        const component = AVAILABLE_COMPONENTS.find((c) => c.name === name);
        if (!component) {
          return {
            content: [{
              type: "text",
              text: `Component "${name}" not found. Use ui_list_components to see available components.`
            }]
          };
        }
        let output = `\u{1F4E6} Component: ${component.name}
`;
        output += `${"\u2550".repeat(50)}

`;
        output += `Registry: ${component.registry}
`;
        output += `Category: ${component.category}
`;
        output += `Description: ${component.description}

`;
        output += `Installation:
`;
        output += `${"\u2500".repeat(40)}
`;
        if (component.registry === "shadcn") {
          output += `npx shadcn@latest add ${component.name}

`;
        } else if (component.registry === "hanzo") {
          output += `npx @hanzo/ui add ${component.name}

`;
        }
        output += `Basic Usage:
`;
        output += `${"\u2500".repeat(40)}
`;
        output += `\`\`\`tsx
`;
        if (component.name === "button") {
          output += `import { Button } from "@/components/ui/button"

`;
          output += `export function Example() {
`;
          output += `  return (
`;
          output += `    <Button>Click me</Button>
`;
          output += `  )
`;
          output += `}
`;
        } else if (component.name === "card") {
          output += `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

`;
          output += `export function Example() {
`;
          output += `  return (
`;
          output += `    <Card>
`;
          output += `      <CardHeader>
`;
          output += `        <CardTitle>Card Title</CardTitle>
`;
          output += `        <CardDescription>Card Description</CardDescription>
`;
          output += `      </CardHeader>
`;
          output += `      <CardContent>
`;
          output += `        <p>Card Content</p>
`;
          output += `      </CardContent>
`;
          output += `    </Card>
`;
          output += `  )
`;
          output += `}
`;
        } else {
          output += `import { ${component.name.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("")} } from "@/components/ui/${component.name}"

`;
          output += `// See documentation for usage examples
`;
        }
        output += `\`\`\`
`;
        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      }
    };
    installUIComponent = {
      name: "ui_install_component",
      description: "Install a UI component from @hanzo/ui or shadcn/ui registry",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Component name to install"
          },
          overwrite: {
            type: "boolean",
            description: "Overwrite existing files",
            default: false
          }
        },
        required: ["name"]
      },
      handler: async (args) => {
        const { name, overwrite = false } = args;
        const component = AVAILABLE_COMPONENTS.find((c) => c.name === name);
        if (!component) {
          return {
            content: [{
              type: "text",
              text: `Component "${name}" not found. Use ui_list_components to see available components.`
            }]
          };
        }
        try {
          let command = "";
          if (component.registry === "shadcn") {
            command = `npx shadcn@latest add ${name}${overwrite ? " --overwrite" : ""}`;
          } else if (component.registry === "hanzo") {
            command = `npx @hanzo/ui add ${name}${overwrite ? " --overwrite" : ""}`;
          }
          const { stdout, stderr } = await execAsync12(command);
          let output = `\u2705 Successfully installed ${name} component

`;
          output += `Command executed: ${command}

`;
          if (stdout) {
            output += `Output:
${stdout}
`;
          }
          if (stderr) {
            output += `Warnings:
${stderr}
`;
          }
          return {
            content: [{
              type: "text",
              text: output
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Failed to install ${name}: ${error.message}`
            }],
            isError: true
          };
        }
      }
    };
    createUIComposition = {
      name: "ui_create_composition",
      description: "Create a composition using multiple UI components",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name for the composition (e.g., LoginPage, Dashboard)"
          },
          components: {
            type: "array",
            description: "List of components to use",
            items: { type: "string" }
          },
          description: {
            type: "string",
            description: "Description of what the composition should do"
          }
        },
        required: ["name", "components"]
      },
      handler: async (args) => {
        const { name, components, description } = args;
        const validComponents = components.filter(
          (c) => AVAILABLE_COMPONENTS.find((comp) => comp.name === c)
        );
        if (validComponents.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No valid components specified. Use ui_list_components to see available components."
            }]
          };
        }
        let code = `/**
 * ${name}
`;
        if (description) {
          code += ` * ${description}
`;
        }
        code += ` * Composed with: ${validComponents.join(", ")}
`;
        code += ` */

`;
        for (const comp of validComponents) {
          const componentInfo = AVAILABLE_COMPONENTS.find((c) => c.name === comp);
          if (componentInfo) {
            const pascalCase = comp.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
            code += `import { ${pascalCase} } from "@/components/ui/${comp}"
`;
          }
        }
        code += `
`;
        code += `export function ${name}() {
`;
        code += `  return (
`;
        code += `    <div className="container mx-auto p-6">
`;
        if (components.includes("card")) {
          code += `      <Card>
`;
          code += `        <CardHeader>
`;
          code += `          <CardTitle>${name}</CardTitle>
`;
          if (description) {
            code += `          <CardDescription>${description}</CardDescription>
`;
          }
          code += `        </CardHeader>
`;
          code += `        <CardContent>
`;
        } else {
          code += `      <div className="space-y-6">
`;
        }
        for (const comp of validComponents) {
          if (comp === "card")
            continue;
          const pascalCase = comp.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
          if (comp === "button") {
            code += `          <Button>Action</Button>
`;
          } else if (comp === "input") {
            code += `          <Input placeholder="Enter text..." />
`;
          } else if (comp === "select") {
            code += `          <Select>
`;
            code += `            <SelectTrigger>
`;
            code += `              <SelectValue placeholder="Select an option" />
`;
            code += `            </SelectTrigger>
`;
            code += `            <SelectContent>
`;
            code += `              <SelectItem value="option1">Option 1</SelectItem>
`;
            code += `              <SelectItem value="option2">Option 2</SelectItem>
`;
            code += `            </SelectContent>
`;
            code += `          </Select>
`;
          } else {
            code += `          <${pascalCase} />
`;
          }
        }
        if (components.includes("card")) {
          code += `        </CardContent>
`;
          code += `      </Card>
`;
        } else {
          code += `      </div>
`;
        }
        code += `    </div>
`;
        code += `  )
`;
        code += `}
`;
        let output = `\u2728 Created ${name} composition

`;
        output += `\`\`\`tsx
${code}\`\`\`

`;
        output += `To use this composition:
`;
        output += `1. Install required components: ${validComponents.join(", ")}
`;
        output += `2. Create a new file and paste the code
`;
        output += `3. Import and use in your application
`;
        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      }
    };
    getUIRegistry = {
      name: "ui_get_registry",
      description: "Get information about UI component registries",
      inputSchema: {
        type: "object",
        properties: {}
      },
      handler: async () => {
        let output = `\u{1F3A8} UI Component Registries
`;
        output += `${"\u2550".repeat(50)}

`;
        output += `Available Registries:
`;
        output += `${"\u2500".repeat(40)}
`;
        output += `\u2022 shadcn - Official shadcn/ui components
`;
        output += `  URL: ${REGISTRIES.shadcn}
`;
        output += `  Components: ${AVAILABLE_COMPONENTS.filter((c) => c.registry === "shadcn").length}

`;
        output += `\u2022 @hanzo/ui - Hanzo custom components
`;
        output += `  URL: ${REGISTRIES.hanzo}
`;
        output += `  Components: ${AVAILABLE_COMPONENTS.filter((c) => c.registry === "hanzo").length}

`;
        output += `Configuration:
`;
        output += `${"\u2500".repeat(40)}
`;
        output += `Add to your components.json:

`;
        output += `\`\`\`json
`;
        output += `{
`;
        output += `  "registries": {
`;
        output += `    "@hanzo": "${REGISTRIES.hanzo}/{name}.json",
`;
        output += `    "@acme": "${REGISTRIES.acme}/{name}.json"
`;
        output += `  }
`;
        output += `}
`;
        output += `\`\`\`

`;
        output += `Component Categories:
`;
        output += `${"\u2500".repeat(40)}
`;
        for (const [category, items] of Object.entries(COMPONENT_CATEGORIES)) {
          output += `\u2022 ${category}: ${items.join(", ")}
`;
        }
        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      }
    };
    uiRegistryTools = [
      listUIComponents,
      searchUIComponents,
      getUIComponent,
      installUIComponent,
      createUIComposition,
      getUIRegistry
    ];
  }
});

// src/tools/index.ts
var tools_exports = {};
__export(tools_exports, {
  aiTools: () => thinkTools,
  allTools: () => allTools,
  allUnifiedTools: () => allUnifiedTools,
  apiTools: () => apiTools,
  astTools: () => astTools,
  authTools: () => authTools,
  autoguiTools: () => autoguiTools,
  billingTool: () => billingTool,
  billingTools: () => billingTools,
  codeTool: () => codeTool,
  commerceTools: () => commerceTools,
  coreToolMap: () => coreToolMap,
  coreTools: () => coreTools2,
  desktopTools: () => desktopTools,
  editTools: () => editTools,
  execTool: () => execTool,
  fetchTool: () => fetchTool,
  fileTools: () => fileTools,
  fsTool: () => fsTool,
  getAllRegisteredTools: () => getAllRegisteredTools,
  getConfiguredTools: () => getConfiguredTools,
  githubUITools: () => githubUITools,
  hanzoCloudTools: () => hanzoCloudTools,
  hanzoTool: () => hanzoTool,
  iamTools: () => iamTools,
  kmsTools: () => kmsTools,
  legacyCoreTools: () => legacyCoreTools,
  memoryTools: () => memoryTools,
  modePresetTools: () => modePresetTools,
  modeUtils: () => modeUtils,
  optionalTools: () => optionalTools,
  orchestrationTools: () => orchestrationTools,
  paasTools: () => paasTools,
  planTools: () => planTools,
  refactorTools: () => refactorTools,
  registerTool: () => registerTool,
  searchTools: () => searchTools,
  shellTools: () => shellTools,
  storageTools: () => storageTools,
  tasksTools: () => tasksTools,
  thinkTools: () => thinkTools,
  todoTools: () => tasksTools,
  toolMap: () => toolMap,
  uiRegistryTools: () => uiRegistryTools,
  uiTools: () => uiTools,
  vcsTools: () => gitTools,
  vectorTools: () => vectorTools,
  workspaceTool: () => workspaceTool
});
function dedupeByName(tools) {
  const seen = /* @__PURE__ */ new Set();
  return tools.filter((t) => {
    if (seen.has(t.name))
      return false;
    seen.add(t.name);
    return true;
  });
}
function getConfiguredTools(config = {}) {
  const {
    unified = true,
    enableLegacy = false,
    enableUI = false,
    enableAutoGUI = false,
    enableOrchestration = false,
    enableUIRegistry = false,
    enableGitHubUI = false,
    enableDesktop = false,
    dedupeTools = true,
    disabledTools = [],
    customTools = []
  } = config;
  let tools;
  if (unified && !enableLegacy) {
    tools = [...allUnifiedTools];
  } else {
    const {
      enableCore = true,
      enableAI = true,
      enableAST = true,
      enableVector = true,
      enableTodo = true,
      enableModes = true,
      enableCloud = true,
      enableVCS = true,
      enableRefactor = true,
      enableMemory = true,
      enablePlan = true,
      enabledCategories = []
    } = config;
    tools = [];
    if (enableCore) {
      if (enabledCategories.length > 0) {
        if (enabledCategories.includes("files"))
          tools.push(...fileTools);
        if (enabledCategories.includes("search"))
          tools.push(...searchTools);
        if (enabledCategories.includes("shell"))
          tools.push(...shellTools);
        if (enabledCategories.includes("edit"))
          tools.push(...editTools);
        if (enabledCategories.includes("desktop"))
          tools.push(...desktopTools);
      } else {
        tools.push(...legacyCoreTools);
      }
    }
    if (enableAI)
      tools.push(...thinkTools);
    if (enableAST)
      tools.push(...astTools);
    if (enableVector)
      tools.push(...vectorTools);
    if (enableTodo)
      tools.push(...tasksTools);
    if (enableModes)
      tools.push(...modePresetTools);
    if (enableCloud)
      tools.push(...hanzoCloudTools);
    if (enableVCS)
      tools.push(...gitTools);
    if (enableRefactor)
      tools.push(...refactorTools);
    if (enableMemory)
      tools.push(...memoryTools);
    if (enablePlan)
      tools.push(...planTools);
  }
  if (enableUI) {
    tools.push(...uiTools, ...multiFrameworkTools);
  }
  if (enableAutoGUI)
    tools.push(...autoguiTools);
  if (enableOrchestration)
    tools.push(...orchestrationTools);
  if (enableUIRegistry)
    tools.push(...uiRegistryTools);
  if (enableGitHubUI)
    tools.push(...githubUITools);
  if (enableDesktop)
    tools.push(...desktopTools);
  tools.push(...customTools);
  if (dedupeTools)
    tools = dedupeByName(tools);
  if (disabledTools.length > 0)
    tools = tools.filter((t) => !disabledTools.includes(t.name));
  return tools;
}
var desktopTools, legacyCoreTools, coreTools2, allTools, coreToolMap, toolMap;
var init_tools = __esm({
  "src/tools/index.ts"() {
    "use strict";
    init_tool_registry();
    init_unified();
    init_fs();
    init_exec();
    init_code();
    init_fetch();
    init_workspace();
    init_hanzo();
    init_file_ops();
    init_search();
    init_shell();
    init_edit();
    init_think();
    init_ast_search();
    init_vector_search();
    init_tasks();
    init_mode_preset();
    init_hanzo_cloud();
    init_git();
    init_refactor();
    init_memory();
    init_plan();
    init_ui_tools();
    init_multi_framework_tools();
    init_autogui_tools();
    init_agent_tools();
    init_hanzo_desktop();
    init_playwright_control();
    init_ui_registry();
    init_ui_github_api();
    init_unified();
    init_file_ops();
    init_search();
    init_shell();
    init_edit();
    init_think();
    init_ast_search();
    init_vector_search();
    init_tasks();
    init_mode_preset();
    init_hanzo_cloud();
    init_git();
    init_refactor();
    init_memory();
    init_plan();
    init_ui_tools();
    init_autogui_tools();
    init_agent_tools();
    init_ui_registry();
    init_ui_github_api();
    init_tool_registry();
    desktopTools = [
      new hanzo_desktop_default(),
      new playwright_control_default()
    ];
    legacyCoreTools = [
      ...fileTools,
      ...searchTools,
      ...shellTools,
      ...editTools
    ];
    coreTools2 = coreTools;
    allTools = allUnifiedTools;
    allTools.forEach((tool) => registerTool(tool));
    coreToolMap = new Map(coreTools2.map((tool) => [tool.name, tool]));
    toolMap = new Map(allTools.map((tool) => [tool.name, tool]));
  }
});

// src/cli.ts
init_tools();
import { Command } from "commander";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import * as fs17 from "fs/promises";
import * as os8 from "os";
import * as path18 from "path";
import { fileURLToPath } from "url";
import { dirname as dirname10 } from "path";

// src/prompts/system.ts
import * as fs16 from "fs/promises";
import * as path17 from "path";
import { exec as exec13 } from "child_process";
import { promisify as promisify13 } from "util";
import * as os7 from "os";
var execAsync13 = promisify13(exec13);
async function getSystemPrompt(projectPath = process.cwd()) {
  const parts = [];
  parts.push("# Hanzo MCP System Context\n");
  parts.push(`Generated at: ${(/* @__PURE__ */ new Date()).toISOString()}
`);
  parts.push("## Environment");
  parts.push(`- OS: ${os7.platform()} ${os7.release()}`);
  parts.push(`- Node: ${process.version}`);
  parts.push(`- Working Directory: ${projectPath}`);
  parts.push(`- User: ${os7.userInfo().username}`);
  parts.push(`- Home: ${os7.homedir()}
`);
  try {
    const { stdout: gitStatus } = await execAsync13("git status --porcelain", { cwd: projectPath });
    const { stdout: gitBranch } = await execAsync13("git branch --show-current", { cwd: projectPath });
    const { stdout: gitRemote } = await execAsync13("git remote -v", { cwd: projectPath });
    parts.push("## Git Repository");
    parts.push(`- Branch: ${gitBranch.trim()}`);
    parts.push(`- Status: ${gitStatus ? "Modified files present" : "Clean"}`);
    if (gitRemote) {
      const remoteUrl = gitRemote.split("\n")[0]?.split("	")[1]?.split(" ")[0];
      if (remoteUrl) {
        parts.push(`- Remote: ${remoteUrl}`);
      }
    }
    if (gitStatus) {
      parts.push("\n### Modified Files:");
      parts.push("```");
      parts.push(gitStatus.trim());
      parts.push("```");
    }
    parts.push("");
  } catch {
    parts.push("## Git Repository");
    parts.push("- Not a git repository\n");
  }
  parts.push("## Project Structure");
  try {
    const projectFiles = [
      "package.json",
      "tsconfig.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      "Gemfile",
      "pom.xml",
      "build.gradle",
      "Makefile",
      "README.md",
      ".env.example"
    ];
    const foundFiles = [];
    for (const file of projectFiles) {
      try {
        await fs16.access(path17.join(projectPath, file));
        foundFiles.push(file);
      } catch {
      }
    }
    if (foundFiles.length > 0) {
      parts.push("- Project files found: " + foundFiles.join(", "));
    }
    if (foundFiles.includes("package.json")) {
      try {
        const packageJson2 = JSON.parse(
          await fs16.readFile(path17.join(projectPath, "package.json"), "utf-8")
        );
        parts.push(`- Node.js project: ${packageJson2.name || "unnamed"}`);
        if (packageJson2.dependencies?.react)
          parts.push("- Framework: React");
        if (packageJson2.dependencies?.vue)
          parts.push("- Framework: Vue");
        if (packageJson2.dependencies?.angular)
          parts.push("- Framework: Angular");
        if (packageJson2.dependencies?.express)
          parts.push("- Framework: Express");
        if (packageJson2.dependencies?.next)
          parts.push("- Framework: Next.js");
      } catch {
      }
    }
    if (foundFiles.includes("pyproject.toml")) {
      parts.push("- Python project (Poetry/Modern)");
    }
    if (foundFiles.includes("Cargo.toml")) {
      parts.push("- Rust project");
    }
    if (foundFiles.includes("go.mod")) {
      parts.push("- Go project");
    }
  } catch {
  }
  parts.push("");
  parts.push("## Available MCP Tools");
  parts.push(`Total tools: ${(await Promise.resolve().then(() => (init_tools(), tools_exports))).allTools.length}
`);
  parts.push("### File Operations");
  parts.push("- `read`: Read file contents");
  parts.push("- `write`: Write content to a file");
  parts.push("- `list`: List files in a directory");
  parts.push("- `info`: Get file metadata");
  parts.push("- `tree`: Display directory structure\n");
  parts.push("### Editing");
  parts.push("- `edit`: Replace text in a file");
  parts.push("- `patch`: Make multiple edits to a file");
  parts.push("- `create`: Create a new file");
  parts.push("- `delete`: Delete a file or directory");
  parts.push("- `move`: Move or rename files\n");
  parts.push("### Search Tools");
  parts.push("- `search`: Unified search (filenames + content)");
  parts.push("- `grep`: Search using grep/ripgrep");
  parts.push("- `find`: Find files by name pattern\n");
  parts.push("### Shell Tools");
  parts.push("- `bash`: Execute bash commands");
  parts.push("- `bg`: Run commands in background");
  parts.push("- `ps`: List background processes");
  parts.push("- `logs`: Get process output");
  parts.push("- `kill`: Kill a background process\n");
  parts.push("## Guidelines");
  parts.push("- Use absolute paths when possible");
  parts.push("- Check file existence before editing");
  parts.push("- Use `patch` for multiple changes to the same file");
  parts.push("- Prefer `search` for comprehensive searches");
  parts.push("- Use `tree` to understand project structure");
  parts.push("- Background processes are useful for long-running tasks\n");
  parts.push("## Code Reference Format");
  parts.push("When referencing code, use: `filename:line_number`");
  parts.push("Example: `src/index.ts:42`\n");
  return parts.join("\n");
}

// src/zap-server.ts
import { WebSocketServer } from "ws";
var ZAP_MAGIC = new Uint8Array([90, 65, 80, 1]);
var HEADER_SIZE = 9;
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
function zapEncode(type, payload) {
  const json = textEncoder.encode(JSON.stringify(payload));
  const frame = new Uint8Array(HEADER_SIZE + json.length);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  frame.set(ZAP_MAGIC, 0);
  view.setUint8(4, type);
  view.setUint32(5, json.length, false);
  frame.set(json, HEADER_SIZE);
  return frame;
}
function zapDecode(data) {
  if (data.length < HEADER_SIZE)
    return null;
  if (data[0] !== 90 || data[1] !== 65 || data[2] !== 80 || data[3] !== 1) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = view.getUint8(4);
  const length = view.getUint32(5, false);
  if (data.length < HEADER_SIZE + length)
    return null;
  const jsonBytes = data.subarray(HEADER_SIZE, HEADER_SIZE + length);
  const payload = length > 0 ? JSON.parse(textDecoder.decode(jsonBytes)) : null;
  return { type, payload };
}
var MSG_HANDSHAKE = 1;
var MSG_HANDSHAKE_OK = 2;
var MSG_REQUEST = 16;
var MSG_RESPONSE = 17;
var MSG_PING = 254;
var MSG_PONG = 255;
var ZAP_PORTS = [9999, 9998, 9997, 9996, 9995];
var SERVER_ID = `mcp-${Date.now().toString(36)}`;
async function startZapServer(options) {
  const { tools, callTool, handleMethod, name = "hanzo-mcp" } = options;
  const clients = /* @__PURE__ */ new Map();
  const toolManifest = tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    inputSchema: t.inputSchema || {}
  }));
  function sendFrame(ws, type, payload) {
    ws.send(zapEncode(type, payload));
  }
  function handleMessage(ws, raw) {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const msg = zapDecode(data);
    if (!msg)
      return;
    switch (msg.type) {
      case MSG_HANDSHAKE: {
        const p = msg.payload || {};
        const clientId = p["clientId"] || "unknown";
        const browser = p["browser"] || "unknown";
        const version = p["version"] || "0";
        clients.set(ws, { ws, clientId, browser, version, connectedAt: Date.now() });
        console.error(`[ZAP] Client connected: ${clientId} (${browser} v${version})`);
        sendFrame(ws, MSG_HANDSHAKE_OK, {
          serverId: SERVER_ID,
          name,
          tools: toolManifest
        });
        break;
      }
      case MSG_REQUEST: {
        const p = msg.payload || {};
        handleRequest(ws, p["id"], p["method"], p["params"]);
        break;
      }
      case MSG_PING:
        sendFrame(ws, MSG_PONG, {});
        break;
      default:
        break;
    }
  }
  async function handleRequest(ws, id, method, params) {
    try {
      let result;
      switch (method) {
        case "tools/list":
          result = { tools: toolManifest };
          break;
        case "tools/call": {
          const { name: toolName, arguments: args = {} } = params || {};
          if (!toolName) {
            throw new Error("Missing tool name");
          }
          result = await callTool(toolName, args);
          break;
        }
        case "notifications/elementSelected":
        case "notifications/controlCancelled":
          result = { acknowledged: true };
          break;
        default:
          if (handleMethod) {
            result = await handleMethod(method, params);
          } else {
            throw new Error(`Unsupported method: ${method}`);
          }
          break;
      }
      sendFrame(ws, MSG_RESPONSE, { id, result });
    } catch (err) {
      sendFrame(ws, MSG_RESPONSE, {
        id,
        error: { code: -1, message: err?.message || String(err) }
      });
    }
  }
  const ports = options.preferredPort ? [options.preferredPort, ...ZAP_PORTS.filter((p) => p !== options.preferredPort)] : ZAP_PORTS;
  for (const port of ports) {
    try {
      const wss = await new Promise((resolve, reject) => {
        const server = new WebSocketServer({ port, host: "127.0.0.1" });
        server.once("listening", () => resolve(server));
        server.once("error", (err) => reject(err));
      });
      wss.on("connection", (ws) => {
        ws.on("message", (data) => handleMessage(ws, data));
        ws.on("close", () => {
          const client = clients.get(ws);
          if (client) {
            console.error(`[ZAP] Client disconnected: ${client.clientId}`);
            clients.delete(ws);
          }
        });
        ws.on("error", () => {
          clients.delete(ws);
        });
      });
      console.error(`[ZAP] Server listening on ws://127.0.0.1:${port} (${toolManifest.length} tools)`);
      return {
        port,
        stop: () => {
          for (const client of clients.values()) {
            client.ws.close();
          }
          clients.clear();
          wss.close();
        }
      };
    } catch {
      continue;
    }
  }
  console.error("[ZAP] Could not bind to any port (9999-9995). ZAP discovery disabled.");
  return null;
}

// src/cli.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname2 = dirname10(__filename);
var packageJson = JSON.parse(
  await fs17.readFile(path18.join(__dirname2, "..", "package.json"), "utf-8")
);
var program = new Command();
program.name("hanzo-mcp").description("Hanzo MCP Server - Model Context Protocol tools for AI development").version(packageJson.version);
program.command("serve", { isDefault: true }).description("Start the MCP server").option("-t, --transport <type>", "Transport type (stdio, http)", "stdio").option("-p, --port <port>", "Port for HTTP transport", "3000").option("--project <path>", "Project path for context", process.cwd()).option("--full-surface", "Enable full legacy tool surface (multi-word aliases and optional categories)").option("--enable-ui", "Enable UI tools").option("--enable-autogui", "Enable AutoGUI tools").option("--enable-orchestration", "Enable orchestration tools").option("--enable-ui-registry", "Enable UI registry tools").option("--enable-github-ui", "Enable GitHub UI tools").option("--enable-desktop", "Enable desktop/playwright tools").option("--disable-ui", "Disable UI tools for component development").option("--disable-autogui", "Disable AutoGUI tools for computer control").option("--disable-orchestration", "Disable orchestration tools for agent management").option("--core-only", "Enable only core tools (files, search, shell, edit)").option("--disable-tools <tools>", "Comma-separated list of tools to disable").option("--enable-categories <categories>", "Comma-separated list of categories to enable (files,search,shell,edit)").action(async (options) => {
  const fullSurface = Boolean(options.fullSurface);
  const coreOnly = Boolean(options.coreOnly);
  const toolConfig = {
    enableCore: !coreOnly || options.enableCategories,
    enableUI: coreOnly ? false : fullSurface ? !options.disableUi : Boolean(options.enableUi) && !options.disableUi,
    enableAutoGUI: coreOnly ? false : fullSurface ? !options.disableAutogui : Boolean(options.enableAutogui) && !options.disableAutogui,
    enableOrchestration: coreOnly ? false : fullSurface ? !options.disableOrchestration : Boolean(options.enableOrchestration) && !options.disableOrchestration,
    enableUIRegistry: coreOnly ? false : fullSurface ? true : Boolean(options.enableUiRegistry),
    enableGitHubUI: coreOnly ? false : fullSurface ? true : Boolean(options.enableGithubUi),
    enableDesktop: coreOnly ? false : Boolean(options.enableDesktop),
    dedupeTools: true,
    enabledCategories: options.enableCategories ? options.enableCategories.split(",") : [],
    disabledTools: options.disableTools ? options.disableTools.split(",") : []
  };
  const tools = getConfiguredTools(toolConfig);
  console.error(`Starting Hanzo MCP server v${packageJson.version}...`);
  console.error(`Loaded ${tools.length} tools`);
  if (toolConfig.enableUI) {
    console.error("UI tools enabled");
  }
  if (toolConfig.enableAutoGUI) {
    console.error("AutoGUI tools enabled");
  }
  if (toolConfig.enableOrchestration) {
    console.error("Orchestration tools enabled");
  }
  if (options.transport === "stdio") {
    await startStdioServer(options, toolConfig);
  } else {
    console.error("HTTP transport not yet implemented");
    process.exit(1);
  }
});
program.command("list-tools").description("List available MCP tools").option("--full-surface", "Enable full legacy tool surface (multi-word aliases and optional categories)").option("--enable-ui", "Include UI tools").option("--enable-autogui", "Include AutoGUI tools").option("--enable-orchestration", "Include orchestration tools").option("--enable-ui-registry", "Include UI registry tools").option("--enable-github-ui", "Include GitHub UI tools").option("--enable-desktop", "Include desktop/playwright tools").option("--disable-ui", "Exclude UI tools from listing").option("--disable-autogui", "Exclude AutoGUI tools from listing").option("--disable-orchestration", "Exclude orchestration tools from listing").option("--core-only", "Show only core tools").option("--category <category>", "Filter by category (files, search, shell, edit, ui, autogui)").action(async (options) => {
  const fullSurface = Boolean(options.fullSurface);
  const coreOnly = Boolean(options.coreOnly);
  const toolConfig = {
    enableCore: true,
    enableUI: coreOnly ? false : fullSurface ? !options.disableUi : Boolean(options.enableUi) && !options.disableUi,
    enableAutoGUI: coreOnly ? false : fullSurface ? !options.disableAutogui : Boolean(options.enableAutogui) && !options.disableAutogui,
    enableOrchestration: coreOnly ? false : fullSurface ? !options.disableOrchestration : Boolean(options.enableOrchestration) && !options.disableOrchestration,
    enableUIRegistry: coreOnly ? false : fullSurface ? true : Boolean(options.enableUiRegistry),
    enableGitHubUI: coreOnly ? false : fullSurface ? true : Boolean(options.enableGithubUi),
    enableDesktop: coreOnly ? false : Boolean(options.enableDesktop),
    dedupeTools: true
  };
  const tools = getConfiguredTools(toolConfig);
  const toolMap2 = new Map(tools.map((t) => [t.name, t]));
  console.log(`
Hanzo MCP Tools (${tools.length} total):
`);
  const categories = {
    "File Operations": ["read", "write", "list", "info", "tree"],
    "Search": ["grep", "find", "search"],
    "Editing": ["edit", "patch", "create", "delete", "move"],
    "Shell": ["bash", "bg", "ps", "logs", "kill"]
  };
  if (toolConfig.enableUI) {
    categories["UI Tools"] = [
      "ui_init",
      "ui_list_components",
      "ui_get_component",
      "ui_get_component_source",
      "ui_get_component_demo",
      "ui_add_component",
      "ui_list_blocks",
      "ui_get_block",
      "ui_list_styles",
      "ui_search_registry",
      "ui_get_installation_guide",
      "ui"
    ];
  }
  if (toolConfig.enableAutoGUI) {
    categories["AutoGUI Tools"] = [
      "autogui_status",
      "autogui_configure",
      "autogui_get_screen_size",
      "autogui_get_screens",
      "autogui_get_mouse_position",
      "autogui_move_mouse",
      "autogui_click",
      "autogui_drag",
      "autogui_scroll",
      "autogui_type",
      "autogui_press_key",
      "autogui_hotkey",
      "autogui_screenshot",
      "autogui_get_pixel",
      "autogui_locate_image",
      "autogui_get_windows",
      "autogui_control_window",
      "autogui_sleep"
    ];
  }
  if (toolConfig.enableOrchestration) {
    categories["Orchestration Tools"] = [
      "spawn",
      "swarm",
      "critic",
      "node",
      "router",
      "consensus",
      "spawn_agent",
      "swarm_orchestration",
      "critic_agent",
      "hanzo_node",
      "llm_router"
    ];
  }
  if (toolConfig.enableUIRegistry) {
    categories["UI Registry Tools"] = [
      "ui_list_components",
      "ui_search_components",
      "ui_get_component",
      "ui_install_component",
      "ui_create_composition",
      "ui_get_registry"
    ];
  }
  if (toolConfig.enableGitHubUI) {
    categories["GitHub UI Tools"] = [
      "ui_fetch_component",
      "ui_fetch_demo",
      "ui_fetch_block",
      "ui_get_block",
      "ui_list_github_components",
      "ui_list_github_blocks",
      "ui_list_blocks",
      "ui_component_metadata",
      "ui_get_component_demo",
      "ui_get_component_metadata",
      "ui_get_directory_structure",
      "ui_directory_structure",
      "ui_github_rate_limit"
    ];
  }
  if (toolConfig.enableDesktop) {
    categories["Desktop Tools"] = ["hanzo_desktop", "playwright_control"];
  }
  const categoriesToShow = options.category ? Object.entries(categories).filter(([cat]) => cat.toLowerCase().includes(options.category.toLowerCase())) : Object.entries(categories);
  for (const [category, toolNames] of categoriesToShow) {
    console.log(`${category}:`);
    const shown = /* @__PURE__ */ new Set();
    for (const toolName of toolNames) {
      const tool = toolMap2.get(toolName);
      if (tool && !shown.has(tool.name)) {
        shown.add(tool.name);
        console.log(`  - ${tool.name}: ${tool.description}`);
      }
    }
    console.log();
  }
});
program.command("install").description("Install MCP server for various applications").option("--claude-desktop", "Install for Claude Desktop").option("--claude-code", "Install for Claude Code").option("--gemini", "Install for Google Gemini").option("--codex", "Install for OpenAI Codex").option("--cursor", "Install for Cursor IDE").option("--windsurf", "Install for Windsurf IDE").option("--vscode", "Install for VS Code").option("--jetbrains", "Install for JetBrains IDEs (IntelliJ, WebStorm, etc.)").option("--all", "Install for all supported applications").action(async (options) => {
  const installations = [];
  const installClaudeDesktop = async () => {
    console.log("\u{1F4E6} Installing for Claude Desktop...");
    const configDir = process.platform === "win32" ? path18.join(process.env.APPDATA || os8.homedir(), "Claude") : path18.join(os8.homedir(), "Library", "Application Support", "Claude");
    const configFile = path18.join(configDir, "claude_desktop_config.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
      config.mcpServers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 Claude Desktop configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 Claude Desktop installation failed: ${error.message}`);
    }
  };
  const installClaudeCode = async () => {
    console.log("\u{1F4E6} Installing for Claude Code...");
    const configDir = path18.join(os8.homedir(), ".config", "claude-code");
    const configFile = path18.join(configDir, "mcp.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 Claude Code configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 Claude Code installation failed: ${error.message}`);
    }
  };
  const installCursor = async () => {
    console.log("\u{1F4E6} Installing for Cursor IDE...");
    const configDir = path18.join(os8.homedir(), ".cursor", "mcp");
    const configFile = path18.join(configDir, "config.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 Cursor configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 Cursor installation failed: ${error.message}`);
    }
  };
  const installVSCode = async () => {
    console.log("\u{1F4E6} Installing for VS Code...");
    const configDir = path18.join(os8.homedir(), ".vscode", "mcp");
    const configFile = path18.join(configDir, "servers.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 VS Code configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 VS Code installation failed: ${error.message}`);
    }
  };
  const installGemini = async () => {
    console.log("\u{1F4E6} Installing for Google Gemini...");
    const configDir = path18.join(os8.homedir(), ".gemini", "mcp");
    const configFile = path18.join(configDir, "servers.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 Gemini configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 Gemini installation failed: ${error.message}`);
    }
  };
  const installCodex = async () => {
    console.log("\u{1F4E6} Installing for OpenAI Codex...");
    const configDir = path18.join(os8.homedir(), ".openai", "codex", "mcp");
    const configFile = path18.join(configDir, "config.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 Codex configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 Codex installation failed: ${error.message}`);
    }
  };
  const installWindsurf = async () => {
    console.log("\u{1F4E6} Installing for Windsurf IDE...");
    const configDir = path18.join(os8.homedir(), ".windsurf", "mcp");
    const configFile = path18.join(configDir, "config.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 Windsurf configured: ${configFile}`);
    } catch (error) {
      console.error(`\u2717 Windsurf installation failed: ${error.message}`);
    }
  };
  const installJetBrains = async () => {
    console.log("\u{1F4E6} Installing for JetBrains IDEs...");
    const configDir = path18.join(os8.homedir(), ".jetbrains", "mcp");
    const configFile = path18.join(configDir, "servers.json");
    try {
      await fs17.mkdir(configDir, { recursive: true });
      let config = {};
      try {
        const configContent = await fs17.readFile(configFile, "utf-8");
        config = JSON.parse(configContent);
      } catch {
      }
      if (!config.servers) {
        config.servers = {};
      }
      config.servers["hanzo-mcp"] = {
        command: "npx",
        args: ["-y", "@hanzo/mcp", "serve"],
        env: {}
      };
      await fs17.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(`\u2713 JetBrains IDEs configured: ${configFile}`);
      console.log("  (Works with IntelliJ IDEA, WebStorm, PyCharm, etc.)");
    } catch (error) {
      console.error(`\u2717 JetBrains installation failed: ${error.message}`);
    }
  };
  if (options.all) {
    installations.push(
      { name: "Claude Desktop", install: installClaudeDesktop },
      { name: "Claude Code", install: installClaudeCode },
      { name: "Gemini", install: installGemini },
      { name: "Codex", install: installCodex },
      { name: "Cursor", install: installCursor },
      { name: "Windsurf", install: installWindsurf },
      { name: "VS Code", install: installVSCode },
      { name: "JetBrains IDEs", install: installJetBrains }
    );
  } else {
    if (options.claudeDesktop) {
      installations.push({ name: "Claude Desktop", install: installClaudeDesktop });
    }
    if (options.claudeCode) {
      installations.push({ name: "Claude Code", install: installClaudeCode });
    }
    if (options.gemini) {
      installations.push({ name: "Gemini", install: installGemini });
    }
    if (options.codex) {
      installations.push({ name: "Codex", install: installCodex });
    }
    if (options.cursor) {
      installations.push({ name: "Cursor", install: installCursor });
    }
    if (options.windsurf) {
      installations.push({ name: "Windsurf", install: installWindsurf });
    }
    if (options.vscode) {
      installations.push({ name: "VS Code", install: installVSCode });
    }
    if (options.jetbrains) {
      installations.push({ name: "JetBrains IDEs", install: installJetBrains });
    }
  }
  if (installations.length === 0) {
    console.log("No installation target specified. Use one of:");
    console.log("\n\u{1F4F1} AI Assistants:");
    console.log("  --claude-desktop  Install for Claude Desktop");
    console.log("  --claude-code     Install for Claude Code");
    console.log("  --gemini          Install for Google Gemini");
    console.log("  --codex           Install for OpenAI Codex");
    console.log("\n\u{1F4BB} IDEs & Editors:");
    console.log("  --cursor          Install for Cursor IDE");
    console.log("  --windsurf        Install for Windsurf IDE");
    console.log("  --vscode          Install for VS Code");
    console.log("  --jetbrains       Install for JetBrains IDEs (IntelliJ, WebStorm, etc.)");
    console.log("\n\u{1F3AF} Quick Options:");
    console.log("  --all             Install for all supported applications");
    process.exit(1);
  }
  console.log(`
\u{1F680} Installing Hanzo MCP v${packageJson.version}...
`);
  for (const { name, install } of installations) {
    await install();
  }
  console.log("\n\u2705 Installation complete!");
  console.log("Restart the respective applications to use Hanzo MCP tools.");
});
program.command("install-desktop").description('Install MCP server for Claude Desktop (deprecated, use "install --claude-desktop")').action(async () => {
  console.log('Note: This command is deprecated. Use "hanzo-mcp install --claude-desktop" instead.\n');
  await program.parseAsync(["node", "cli", "install", "--claude-desktop"], { from: "user" });
});
async function startStdioServer(options, toolConfig) {
  const server = new Server(
    {
      name: "hanzo-mcp",
      version: packageJson.version
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  const configuredTools = getConfiguredTools(toolConfig);
  const toolMap2 = new Map(configuredTools.map((t) => [t.name, t]));
  console.error(`Registering ${configuredTools.length} tools...`);
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: configuredTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = toolMap2.get(request.params.name);
    if (!tool) {
      return {
        content: [{
          type: "text",
          text: `Unknown tool: ${request.params.name}`
        }],
        isError: true
      };
    }
    try {
      console.error(`Executing tool: ${tool.name}`);
      const result = await tool.handler(request.params.arguments || {});
      return result;
    } catch (error) {
      console.error(`Tool error: ${error.message}`);
      return {
        content: [{
          type: "text",
          text: `Error executing ${tool.name}: ${error.message}`
        }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [{
        uri: "hanzo://system-prompt",
        name: "System Prompt",
        mimeType: "text/plain",
        description: "Hanzo MCP system prompt and context"
      }]
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "hanzo://system-prompt") {
      const systemPrompt = await getSystemPrompt(options.project);
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: "text/plain",
          text: systemPrompt
        }]
      };
    }
    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "text/plain",
        text: "Resource not found"
      }]
    };
  });
  const methodHandlers2 = {
    "tools/list": async () => ({
      tools: configuredTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    }),
    "tools/call": async (params) => {
      const tool = toolMap2.get(params?.name);
      if (!tool)
        throw new Error(`Unknown tool: ${params?.name}`);
      return tool.handler(params?.arguments || {});
    },
    "resources/list": async () => ({
      resources: [{
        uri: "hanzo://system-prompt",
        name: "System Prompt",
        mimeType: "text/plain",
        description: "Hanzo MCP system prompt and context"
      }]
    }),
    "resources/read": async (params) => {
      if (params?.uri === "hanzo://system-prompt") {
        const systemPrompt = await getSystemPrompt(options.project);
        return { contents: [{ uri: params.uri, mimeType: "text/plain", text: systemPrompt }] };
      }
      return { contents: [{ uri: params?.uri, mimeType: "text/plain", text: "Resource not found" }] };
    }
  };
  try {
    const zapServer = await startZapServer({
      tools: configuredTools,
      name: "hanzo-mcp",
      callTool: async (toolName, args) => {
        const tool = toolMap2.get(toolName);
        if (!tool)
          throw new Error(`Unknown tool: ${toolName}`);
        return tool.handler(args);
      },
      handleMethod: async (method, params) => {
        const handler = methodHandlers2[method];
        if (handler)
          return handler(params || {});
        throw new Error(`Unsupported method: ${method}`);
      }
    });
    if (zapServer) {
      console.error(`[ZAP] Browser extension discovery on ws://127.0.0.1:${zapServer.port}`);
    }
  } catch (err) {
    console.error(`[ZAP] Failed to start: ${err.message}`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hanzo MCP server started successfully");
}
program.parse();
