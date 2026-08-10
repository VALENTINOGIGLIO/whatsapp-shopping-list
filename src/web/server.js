import express from 'express';

function resolveStatus(getStatus) {
  if (typeof getStatus === 'function') {
    const result = getStatus();
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && result.status) return result.status;
    return 'UNKNOWN';
  } else if (getStatus && typeof getStatus === 'object' && getStatus.status) {
    return getStatus.status;
  }
  return 'INITIALIZING';
}

export function createWebServer(options = {}) {
  const app = express();
  app.use(express.json());

  const getStatus = options.getStatus || (options.whatsappClient
    ? () => options.whatsappClient.getStatus()
    : () => 'INITIALIZING');

  app.get('/', (req, res) => {
    res.redirect('/qr');
  });

  const handleHealth = (req, res) => {
    const status = resolveStatus(getStatus);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json({
      status: 'ok',
      whatsappStatus: status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: 'whatsapp-shopping-list'
    });
  };

  app.get('/health', handleHealth);
  app.get('/healthz', handleHealth);

  // Meta API Webhook Verification
  app.get('/webhook', (req, res) => {
    const verify_token = process.env.WEBHOOK_VERIFY_TOKEN || 'shopping-list-secret';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verify_token) {
        console.log('✅ [Meta API] Webhook verified');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

  // Meta API Webhook Receiving Messages
  app.post('/webhook', async (req, res) => {
    // Return 200 OK immediately as per Meta API requirements
    res.sendStatus(200);
    
    if (options.whatsappClient && typeof options.whatsappClient.handleIncomingWebhook === 'function') {
      try {
        await options.whatsappClient.handleIncomingWebhook(req.body);
      } catch (err) {
        console.error('❌ [Meta API] Error handling webhook:', err);
      }
    }
  });

  // Setup UI
  app.get('/qr', (req, res) => {
    const status = resolveStatus(getStatus);

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');

    if (status === 'READY') {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Bot - Connected</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #e8f5e9; text-align: center; padding: 50px 20px; margin: 0; }
              .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 600px; width: 100%; }
              h1 { color: #2e7d32; margin-top: 0; }
              .status { font-weight: bold; color: #1b5e20; background: #c8e6c9; padding: 6px 12px; border-radius: 16px; display: inline-block; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>✅ Meta Cloud API Attiva</h1>
              <p><span class="status">Stato: ${status}</span></p>
              <p>Il bot è attivo e in ascolto sui webhook.</p>
              <p>Puoi scrivere al Numero di Test fornito da Meta per usare la lista della spesa.</p>
            </div>
          </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="it">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>WhatsApp Bot - Setup Richiesto</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #fff3e0; padding: 40px 20px; margin: 0; line-height: 1.6; }
            .card { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
            h1 { color: #e65100; margin-top: 0; text-align: center; }
            ol { margin-bottom: 24px; padding-left: 20px; }
            li { margin-bottom: 12px; }
            code { background: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-weight: bold; color: #d32f2f; word-break: break-all; }
            .env-vars { background: #333; color: #4CAF50; padding: 15px; border-radius: 8px; font-family: monospace; white-space: pre-wrap; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>⚙️ Configurazione Meta API Richiesta</h1>
            <p style="text-align: center;">Stato Attuale: <strong>${status}</strong></p>
            <p>Per attivare il bot su Render usando il metodo stabile (Meta Cloud API), devi aggiungere le seguenti variabili d'ambiente nella dashboard di Render (scheda "Environment"):</p>
            
            <div class="env-vars">
WHATSAPP_TOKEN = (il tuo Token di Accesso Temporaneo)
WHATSAPP_PHONE_NUMBER_ID = (l'ID del numero di telefono di test)
WEBHOOK_VERIFY_TOKEN = shopping-list-secret
            </div>

            <h3>Come configurare i Webhook su Meta:</h3>
            <ol>
              <li>Vai su developers.facebook.com e apri la tua App.</li>
              <li>Vai su <strong>WhatsApp > Configurazione</strong>.</li>
              <li>Sotto "Webhook", clicca su "Modifica".</li>
              <li>URL di callback: <code>https://${req.get('host')}/webhook</code></li>
              <li>Token di verifica: <code>shopping-list-secret</code></li>
              <li>Clicca "Verifica e salva".</li>
              <li>Infine, clicca su "Gestisci campi Webhook" e iscriviti a <strong>messages</strong>.</li>
            </ol>
            
            <p style="text-align: center; margin-top: 30px;">
              <button onclick="window.location.reload()" style="background: #e65100; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; cursor: pointer;">Ricarica Pagina</button>
            </p>
          </div>
        </body>
      </html>
    `);
  });

  return app;
}

export const createApp = createWebServer;
export const createExpressApp = createWebServer;

export function startWebServer(portOrOptions = {}, maybeOptions = {}) {
  let port;
  let options;

  if (typeof portOrOptions === 'number' || typeof portOrOptions === 'string') {
    port = Number(portOrOptions);
    options = maybeOptions;
  } else {
    options = portOrOptions || {};
    port = options.port || process.env.PORT || 3000;
  }

  const app = createWebServer(options);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`🌐 [Web Server] Listening on http://localhost:${port} (/health, /qr, /webhook)`);
      resolve({ server, app });
    });
    server.on('error', reject);
  });
}

export function stopWebServer(serverOrInstance) {
  return new Promise((resolve, reject) => {
    if (!serverOrInstance) return resolve();
    const server = serverOrInstance.server ? serverOrInstance.server : serverOrInstance;
    if (typeof server.close !== 'function') return resolve();

    server.close((err) => {
      if (err) return reject(err);
      console.log('🌐 [Web Server] Closed HTTP web server connection.');
      resolve();
    });
  });
}
