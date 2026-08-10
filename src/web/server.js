import express from 'express';

/**
 * Resolves status string from getStatus parameter (function returning string or object).
 * @param {Function|Object} getStatus 
 * @returns {string}
 */
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

/**
 * Resolves QR code string from getQrCode parameter.
 * @param {Function|string} getQrCode 
 * @returns {string|null}
 */
function resolveQrCode(getQrCode) {
  if (typeof getQrCode === 'function') {
    return getQrCode();
  } else if (typeof getQrCode === 'string') {
    return getQrCode;
  }
  return null;
}

/**
 * Resolves pairing code string from getPairingCode parameter.
 * @param {Function|string} getPairingCode 
 * @returns {string|null}
 */
function resolvePairingCode(getPairingCode) {
  if (typeof getPairingCode === 'function') {
    return getPairingCode();
  } else if (typeof getPairingCode === 'string') {
    return getPairingCode;
  }
  return null;
}

/**
 * Creates Express server application instance.
 * @param {Object} [options] 
 * @param {Function|Object} [options.getStatus] 
 * @param {Function|string} [options.getQrCode] 
 * @param {Object} [options.whatsappClient] 
 * @returns {import('express').Express}
 */
export function createWebServer(options = {}) {
  const app = express();
  app.use(express.json());

  const getStatus = options.getStatus || (options.whatsappClient
    ? () => options.whatsappClient.getStatus()
    : () => 'INITIALIZING');

  const getQrCode = options.getQrCode || (options.whatsappClient
    ? () => options.whatsappClient.getQrCode()
    : () => null);

  const getPairingCode = options.getPairingCode || (options.whatsappClient && typeof options.whatsappClient.getPairingCode === 'function'
    ? () => options.whatsappClient.getPairingCode()
    : () => null);

  // Root redirect
  app.get('/', (req, res) => {
    res.redirect('/qr');
  });

  // Keep-alive health check endpoint
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

  // Pairing code API endpoint
  app.post('/api/pair', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        return res.status(400).json({ error: 'Valid phoneNumber is required' });
      }
      
      if (!options.whatsappClient || typeof options.whatsappClient.requestPairingCode !== 'function') {
        return res.status(501).json({ error: 'Pairing code not supported by the client' });
      }

      // Format phone number: remove +, spaces, dashes
      const cleanNumber = phoneNumber.replace(/[\+\s\-]/g, '');
      const code = await options.whatsappClient.requestPairingCode(cleanNumber);
      
      return res.status(200).json({ code });
    } catch (err) {
      console.error('Error requesting pairing code:', err);
      return res.status(500).json({ error: err.message || 'Failed to request pairing code' });
    }
  });

  // Browser QR code scanning endpoint
  app.get('/qr', (req, res) => {
    const status = resolveStatus(getStatus);
    const qrCode = resolveQrCode(getQrCode);

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');

    if (status === 'READY' || status === 'AUTHENTICATED' || status === 'CONNECTED') {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="30">
            <title>WhatsApp Bot - Connected</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #e8f5e9; text-align: center; padding: 50px 20px; margin: 0; }
              .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 450px; width: 100%; }
              h1 { color: #2e7d32; margin-top: 0; }
              .status { font-weight: bold; color: #1b5e20; background: #c8e6c9; padding: 6px 12px; border-radius: 16px; display: inline-block; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>✅ WhatsApp Client Connected</h1>
              <p><span class="status">Stato: ${status}</span></p>
              <p>Il bot è attivo e pronto a gestire i comandi della lista della spesa.</p>
              <p><small>Uptime: ${Math.floor(process.uptime())}s</small></p>
            </div>
          </body>
        </html>
      `);
    }

    const pairingCode = resolvePairingCode(getPairingCode);

    if (pairingCode) {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <!-- No auto-refresh so user has time to type the code -->
            <title>WhatsApp Bot - Pairing Code</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; text-align: center; padding: 40px 20px; margin: 0; }
              .card { background: white; border-radius: 12px; padding: 32px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 450px; width: 100%; }
              .code-box { background: #e3f2fd; border: 2px dashed #2196f3; padding: 20px; font-size: 32px; letter-spacing: 4px; font-weight: bold; color: #1565c0; border-radius: 8px; margin: 20px 0; }
              ol { text-align: left; background: #f8f9fa; padding: 16px 24px; border-radius: 8px; line-height: 1.6; margin-bottom: 24px; }
              button { background: #2e7d32; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; cursor: pointer; }
              button:hover { background: #1b5e20; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>🔢 WhatsApp Pairing Code</h1>
              <p>Inserisci questo codice nell'app di WhatsApp:</p>
              <div class="code-box">${pairingCode}</div>
              <ol>
                <li>Apri <strong>WhatsApp</strong> sul tuo telefono</li>
                <li>Vai in <strong>Impostazioni / Menu</strong> > <strong>Dispositivi collegati</strong></li>
                <li>Premi <strong>Collega un dispositivo</strong></li>
                <li>Tocca <strong>Collega con il numero di telefono</strong> in basso</li>
              </ol>
              <button onclick="window.location.reload()">Ho fatto, verifica connessione</button>
            </div>
          </body>
        </html>
      `);
    }

    if (qrCode) {
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Bot - Collega Dispositivo</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; text-align: center; padding: 40px 20px; margin: 0; }
              .card { background: white; border-radius: 12px; padding: 32px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 450px; width: 100%; margin-bottom: 20px; }
              img { border: 1px solid #e0e0e0; border-radius: 8px; margin: 20px 0; max-width: 100%; height: auto; }
              ol { text-align: left; background: #f8f9fa; padding: 16px 24px; border-radius: 8px; line-height: 1.6; }
              .divider { margin: 30px 0; border-bottom: 1px solid #e0e0e0; position: relative; }
              .divider span { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: white; padding: 0 10px; color: #757575; font-size: 14px; }
              input { padding: 12px; font-size: 16px; border: 1px solid #ccc; border-radius: 8px; width: calc(100% - 26px); margin-bottom: 16px; }
              button { background: #2196f3; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; cursor: pointer; width: 100%; }
              button:hover { background: #1976d2; }
              #error-msg { color: #d32f2f; margin-top: 10px; display: none; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>📱 Opzione 1: Scansiona QR Code</h1>
              <img src="${qrImageUrl}" alt="WhatsApp QR Code" width="300" height="300" />
              <p><small>La pagina si aggiorna automaticamente ogni 10s. Stato: <strong>${status}</strong></small></p>
              
              <div class="divider"><span>OPPURE</span></div>
              
              <h1>🔢 Opzione 2: Codice Telefono</h1>
              <p>Inserisci il tuo numero di telefono (es. 393401234567, col prefisso ma senza il +) per generare un codice a 8 cifre.</p>
              <input type="text" id="phone" placeholder="Es: 393401234567" />
              <button id="btn-pair">Genera Codice</button>
              <p id="error-msg"></p>
            </div>
            
            <script>
              let autoRefresh = setTimeout(() => window.location.reload(), 10000);
              
              document.getElementById('btn-pair').addEventListener('click', async () => {
                const phone = document.getElementById('phone').value;
                if (!phone) return alert('Inserisci un numero di telefono');
                
                // Stop auto-refresh while generating
                clearTimeout(autoRefresh);
                document.getElementById('btn-pair').innerText = 'Generazione in corso...';
                document.getElementById('btn-pair').disabled = true;
                
                try {
                  const res = await fetch('/api/pair', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                  });
                  const data = await res.json();
                  
                  if (res.ok && data.code) {
                    window.location.reload(); // Reload to show the pairing code UI
                  } else {
                    document.getElementById('error-msg').innerText = data.error || 'Errore nella generazione del codice';
                    document.getElementById('error-msg').style.display = 'block';
                    document.getElementById('btn-pair').innerText = 'Genera Codice';
                    document.getElementById('btn-pair').disabled = false;
                  }
                } catch (err) {
                  document.getElementById('error-msg').innerText = 'Errore di rete';
                  document.getElementById('error-msg').style.display = 'block';
                  document.getElementById('btn-pair').innerText = 'Genera Codice';
                  document.getElementById('btn-pair').disabled = false;
                }
              });
            </script>
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
          <meta http-equiv="refresh" content="5">
          <title>WhatsApp Bot - Inizializzazione</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #fff3e0; text-align: center; padding: 50px 20px; margin: 0; }
            .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 450px; width: 100%; }
            h1 { color: #e65100; margin-top: 0; }
            .spinner { border: 4px solid #ffe0b2; border-top: 4px solid #e65100; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>⏳ Inizializzazione WhatsApp Client</h1>
            <div class="spinner"></div>
            <p>Stato: <strong>${status}</strong></p>
            <p>Generazione QR code in corso... La pagina si aggiornerà tra pochi secondi.</p>
          </div>
        </body>
      </html>
    `);
  });

  return app;
}

export const createApp = createWebServer;
export const createExpressApp = createWebServer;

/**
 * Starts HTTP web server listening on specified port.
 * @param {number|Object} [portOrOptions] 
 * @param {Object} [maybeOptions] 
 * @returns {Promise<{ server: import('http').Server, app: import('express').Express }>}
 */
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
      console.log(`🌐 [Web Server] Listening on http://localhost:${port} (/health, /qr)`);
      resolve({ server, app });
    });
    server.on('error', reject);
  });
}

/**
 * Closes HTTP web server gracefully.
 * @param {import('http').Server|Object} serverOrInstance 
 * @returns {Promise<void>}
 */
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
