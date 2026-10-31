import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createApp } from '../src/app.js';
import { serveFrontend } from '../src/frontend.js';

const secret = 'isolated-production-configuration-test-secret42';
describe('Compiled frontend security boundary', () => {
  test('missing build fails explicitly', () => {
    expect(() => serveFrontend(express(), join(tmpdir(), 'hilltop-no-such-build'))).toThrow(
      'Frontend build missing',
    );
  });
  test('serves only public build assets and preserves API errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hilltop-static-test-'));
    try {
      const build = join(directory, 'dist');
      await mkdir(join(build, 'assets'), { recursive: true });
      await writeFile(join(build, 'index.html'), '<!doctype html><title>Hilltop support</title>');
      await writeFile(join(build, 'assets', 'app.js'), 'console.log("Hilltop");');
      await writeFile(join(build, '.env'), 'PRIVATE_TEST_FIXTURE');
      await writeFile(join(directory, 'private.txt'), 'PRIVATE_TEST_FIXTURE');
      const outer = createApp({
        secret,
        production: true,
        origin: 'https://hilltop.example',
        frontend: build,
      });
      expect((await request(outer).get('/')).text).toContain('Hilltop support');
      expect((await request(outer).get('/')).headers['content-security-policy']).toContain(
        "script-src 'self'",
      );
      expect((await request(outer).get('/assets/app.js')).type).toMatch(/javascript/);
      for (const path of ['/.env', '/%2eenv', '/private.txt', '/src/server.js', '/package.json']) {
        const response = await request(outer).get(path);
        expect(response.status).toBe(404);
        expect(response.text).not.toContain('PRIVATE_TEST_FIXTURE');
      }
      const unknown = await request(outer).get('/api/not-an-endpoint');
      expect(unknown.status).toBe(404);
      expect(unknown.type).toBe('application/json');
      expect((await request(outer).post('/')).status).toBe(404);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Additional security regression', () => {
  test('spoofing forwarded addresses cannot bypass a direct-server limiter', async () => {
    const app = createApp({ secret, maxRequests: 1, trustProxy: 0 });
    expect((await request(app).get('/missing').set('X-Forwarded-For', '1.2.3.4')).status).toBe(404);
    const response = await request(app).get('/missing').set('X-Forwarded-For', '5.6.7.8');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
  });
  test('account limit is shared across login/signup and prefixed/unprefixed aliases', async () => {
    const app = createApp({ secret });
    const paths = ['/api/users', '/auth/login', '/users', '/api/auth/login'];
    for (let index = 0; index < 15; index++)
      expect(
        (
          await request(app)
            .post(paths[index % paths.length])
            .send({})
        ).status,
      ).toBe(400);
    expect((await request(app).post('/api/users').send({})).status).toBe(429);
  });
  test('production responses restrict scripts, frames and content sniffing', async () => {
    const app = createApp({ secret, production: true, origin: 'https://hilltop.example' });
    const response = await request(app).get('/unknown');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
