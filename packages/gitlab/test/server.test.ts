import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { handleRequest, WEBHOOK_PATH } from '../src/server.js';
import { GitlabClient } from '../src/gitlab-api.js';
import { loadConfig } from '../src/config.js';
import type { Service, RunModel } from '../src/app.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const config = loadConfig({
  GITLAB_TOKEN: 't',
  GITLAB_WEBHOOK_SECRET: 'whsec',
  HANZO_MODEL: 'zen5',
} as NodeJS.ProcessEnv);

/** Build a Service whose client never actually fetches and whose run is a stub. */
function service(run: RunModel = async () => 'out'): { service: Service; dispatched: string[] } {
  const dispatched: string[] = [];
  const client = new GitlabClient({
    baseURL: 'https://gitlab.com',
    token: 't',
    fetch: async (url) => {
      dispatched.push(url);
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  return { service: { config, client, run }, dispatched };
}

/** A fake IncomingMessage that streams `body` then ends. */
function fakeReq(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const emitter = new EventEmitter();
  const req = emitter as unknown as IncomingMessage;
  req.method = opts.method;
  req.url = opts.url;
  req.headers = opts.headers;
  (req as unknown as { destroy: () => void }).destroy = () => {};
  // Emit the body on the next tick so the handler can attach listeners first.
  queueMicrotask(() => {
    if (opts.body) emitter.emit('data', Buffer.from(opts.body, 'utf8'));
    emitter.emit('end');
  });
  return req;
}

/** A fake ServerResponse capturing status + JSON body. */
function fakeRes(): ServerResponse & { statusCode: number; payload: string } {
  const res = {
    statusCode: 0,
    payload: '',
    headersSent: false,
    writeHead(status: number) {
      this.statusCode = status;
      this.headersSent = true;
      return this;
    },
    end(body?: string) {
      if (body) this.payload = body;
      return this;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; payload: string };
}

const validHeaders = {
  'x-gitlab-token': 'whsec',
  'x-gitlab-event': 'Issue Hook',
};

describe('handleRequest', () => {
  it('answers /health with the model', async () => {
    const { service: svc } = service();
    const res = fakeRes();
    await handleRequest(svc, fakeReq({ method: 'GET', url: '/health', headers: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ status: 'ok', model: 'zen5' });
  });

  it('404s an unknown path', async () => {
    const { service: svc } = service();
    const res = fakeRes();
    await handleRequest(svc, fakeReq({ method: 'GET', url: '/nope', headers: {} }), res);
    expect(res.statusCode).toBe(404);
  });

  it('rejects a missing/invalid X-Gitlab-Token with 401 and does not dispatch', async () => {
    const { service: svc, dispatched } = service();
    const res = fakeRes();
    await handleRequest(
      svc,
      fakeReq({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: { 'x-gitlab-token': 'wrong', 'x-gitlab-event': 'Issue Hook' },
        body: '{}',
      }),
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it('400s an invalid JSON body after a valid token', async () => {
    const { service: svc } = service();
    const res = fakeRes();
    await handleRequest(
      svc,
      fakeReq({ method: 'POST', url: WEBHOOK_PATH, headers: validHeaders, body: 'not json' }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('ACKs 202 and dispatches a valid, verified issue-open event', async () => {
    let ran = false;
    const { service: svc } = service(async () => {
      ran = true;
      return 'Summary: x\nSeverity: low\nLabels: none\nResponse:\nHi';
    });
    const res = fakeRes();
    const body = JSON.stringify({
      object_kind: 'issue',
      project: { id: 1, path_with_namespace: 'g/p' },
      object_attributes: { action: 'open', iid: 5, title: 'T', description: 'B' },
    });
    await handleRequest(
      svc,
      fakeReq({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: { 'x-gitlab-token': 'whsec', 'x-gitlab-event': 'Issue Hook' },
        body,
      }),
      res,
    );
    expect(res.statusCode).toBe(202);
    // dispatch runs inline within handleRequest before it resolves.
    expect(ran).toBe(true);
  });
});
