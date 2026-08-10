import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer, startWebServer, stopWebServer } from '../../../src/web/server.js';

describe('Unit Test: Express Web Server (src/web/server.js)', () => {
  let serverInstance = null;

  afterEach(async () => {
    if (serverInstance) {
      await stopWebServer(serverInstance);
      serverInstance = null;
    }
  });

  it('GET /health returns HTTP 200 OK JSON status', async () => {
    let currentStatus = 'INITIALIZING';
    const { server } = await startWebServer(0, {
      getStatus: () => currentStatus
    });
    serverInstance = server;

    const address = server.address();
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/health`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes('application/json'));

    const data = await response.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.whatsappStatus, 'INITIALIZING');
    assert.equal(typeof data.uptime, 'number');
    assert.ok(data.timestamp);
  });

  it('GET /qr renders initializing spinner card when QR is not yet generated', async () => {
    const { server } = await startWebServer(0, {
      getStatus: () => 'INITIALIZING',
      getQrCode: () => null
    });
    serverInstance = server;

    const address = server.address();
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/qr`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes('text/html'));

    const html = await response.text();
    assert.ok(html.includes('Inizializzazione WhatsApp Client'));
    assert.ok(html.includes('http-equiv="refresh" content="5"'));
  });

  it('GET /qr renders QR code image and auto-refresh tag when QR code is ready', async () => {
    const { server } = await startWebServer(0, {
      getStatus: () => 'QR_READY',
      getQrCode: () => 'mock_qr_payload_xyz'
    });
    serverInstance = server;

    const address = server.address();
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/qr`);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.ok(html.includes('WhatsApp Web QR Code'));
    assert.ok(html.includes('create-qr-code/?size=300x300&amp;data=mock_qr_payload_xyz') || html.includes('data=mock_qr_payload_xyz'));
    assert.ok(html.includes('http-equiv="refresh" content="10"'));
  });

  it('GET /qr renders connected state card when client status is READY', async () => {
    const { server } = await startWebServer(0, {
      getStatus: () => 'READY',
      getQrCode: () => null
    });
    serverInstance = server;

    const address = server.address();
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/qr`);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.ok(html.includes('WhatsApp Client Connected'));
    assert.ok(html.includes('READY'));
  });

  it('GET / redirects to /qr', async () => {
    const { server } = await startWebServer(0, {
      getStatus: () => 'READY'
    });
    serverInstance = server;

    const address = server.address();
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/qr');
  });
});
