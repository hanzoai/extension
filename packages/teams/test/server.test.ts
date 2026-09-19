import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'restify';
import { createServer, MESSAGES_PATH } from '../src/server';
import { loadConfig } from '../src/config';

// The server as `pnpm start` builds it, listening on a free port. This is the
// only suite that loads botbuilder and restify together, which is where the
// bot failed before it ever took a message.
const config = loadConfig({
  MICROSOFT_APP_ID: '00000000-0000-0000-0000-000000000000',
  MICROSOFT_APP_PASSWORD: 'test-secret',
  HANZO_API_KEY: 'sk-test',
});

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(): Promise<string> {
  server = createServer(config);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return server.url;
}

describe('the messaging server', () => {
  it('starts and answers its health check', async () => {
    const res = await fetch(`${await listen()}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('refuses an activity that carries no Bot Framework token', async () => {
    const res = await fetch(`${await listen()}${MESSAGES_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'message', text: 'hi' }),
    });
    expect(res.status).toBe(401);
  });
});
