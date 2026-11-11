/**
 * Minimal zero-dependency RFC 6455 WebSocket client over Node built-ins (`node:http` / `node:https`).
 * Enables `@hanzo/browser` to speak Chrome DevTools Protocol (CDP) directly with zero `ws` or
 * `playwright` package dependency.
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class RawWebSocket extends EventEmitter {
  private socket: Duplex | null = null;
  private rxBuf: Buffer = Buffer.alloc(0);
  private fragOpcode = 0;
  private fragChunks: Buffer[] = [];
  public readyState: 'CONNECTING' | 'OPEN' | 'CLOSED' = 'CONNECTING';

  private constructor() {
    super();
  }

  static connect(wsUrl: string, timeoutMs = 10_000): Promise<RawWebSocket> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(wsUrl);
      const isSecure = parsed.protocol === 'wss:';
      const mod = isSecure ? https : http;
      const key = crypto.randomBytes(16).toString('base64');
      const expectedAccept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

      const ws = new RawWebSocket();
      const timer = setTimeout(() => {
        req.destroy(new Error(`WebSocket connect timeout (${timeoutMs}ms): ${wsUrl}`));
      }, timeoutMs);

      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (isSecure ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
      });

      req.once('error', (err) => {
        clearTimeout(timer);
        ws.readyState = 'CLOSED';
        reject(err);
      });

      req.once('upgrade', (res, socket, head) => {
        clearTimeout(timer);
        const accept = res.headers['sec-websocket-accept'];
        if (accept !== expectedAccept) {
          socket.destroy();
          ws.readyState = 'CLOSED';
          reject(new Error(`Invalid Sec-WebSocket-Accept header from ${wsUrl}`));
          return;
        }
        ws.attach(socket, head);
        resolve(ws);
      });

      req.end();
    });
  }

  private attach(socket: Duplex, head: Buffer): void {
    this.socket = socket;
    this.readyState = 'OPEN';
    if ('setNoDelay' in socket && typeof (socket as any).setNoDelay === 'function') {
      (socket as any).setNoDelay(true);
    }
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.once('close', () => {
      this.readyState = 'CLOSED';
      this.emit('close');
    });
    socket.on('error', (err) => this.emit('error', err));
    if (head && head.length > 0) this.onData(head);
  }

  send(data: string | Buffer): void {
    if (!this.socket || this.readyState !== 'OPEN') {
      throw new Error('WebSocket is not open');
    }
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const opcode = typeof data === 'string' ? 0x01 : 0x02;
    this.writeFrame(opcode, payload);
  }

  close(): void {
    if (!this.socket || this.readyState === 'CLOSED') return;
    try {
      this.writeFrame(0x08, Buffer.alloc(0));
    } catch {}
    this.readyState = 'CLOSED';
    this.socket.destroy();
    this.socket = null;
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (!this.socket) return;
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let headerLen = 2 + 4;
    if (len >= 126 && len < 65536) headerLen += 2;
    else if (len >= 65536) headerLen += 8;

    const frame = Buffer.allocUnsafe(headerLen + len);
    frame[0] = 0x80 | (opcode & 0x0f);
    let offset = 2;
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len < 65536) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
      offset = 4;
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
      offset = 10;
    }
    mask.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i++) {
      frame[offset + i] = payload[i] ^ mask[i & 3];
    }
    this.socket.write(frame);
  }

  private onData(chunk: Buffer): void {
    this.rxBuf = this.rxBuf.length === 0 ? chunk : Buffer.concat([this.rxBuf, chunk]);

    while (this.rxBuf.length >= 2) {
      const b0 = this.rxBuf[0];
      const b1 = this.rxBuf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.rxBuf.length < 4) return;
        payloadLen = this.rxBuf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.rxBuf.length < 10) return;
        payloadLen = Number(this.rxBuf.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (this.rxBuf.length < offset + maskLen + payloadLen) return;

      let payload = this.rxBuf.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const mask = this.rxBuf.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ mask[i & 3];
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }

      this.rxBuf = this.rxBuf.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x08) {
        // Close
        this.close();
        return;
      }
      if (opcode === 0x09) {
        // Ping -> Pong
        try { this.writeFrame(0x0a, payload); } catch {}
        continue;
      }
      if (opcode === 0x0a) {
        // Pong
        continue;
      }

      if (opcode === 0x00) {
        this.fragChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragChunks);
          const kind = this.fragOpcode;
          this.fragChunks = [];
          this.fragOpcode = 0;
          this.emit('message', kind === 0x01 ? full.toString('utf8') : full);
        }
      } else if (!fin) {
        this.fragOpcode = opcode;
        this.fragChunks = [payload];
      } else {
        this.emit('message', opcode === 0x01 ? payload.toString('utf8') : payload);
      }
    }
  }
}
