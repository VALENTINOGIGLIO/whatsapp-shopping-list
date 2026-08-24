import express from 'express';

function resolveStatus(getStatus) {
  if (typeof getStatus === 'function') {
    return getStatus();
  } else if (typeof getStatus === 'string') {
    return getStatus;
  }
  return 'UNKNOWN';
}

function resolveQrCode(getQrCode) {
  if (typeof getQrCode === 'function') {
    return getQrCode();
  } else if (typeof getQrCode === 'string') {
    return getQrCode;
  }
  return null;
}

export function createWebServer(options = {}) {
  const app = express();
  app.use(express.json());

  const getStatus = options.getStatus || (options.whatsappClient
    ? () => {
        if (typeof options.whatsappClient.getStatus === 'function') {
          return options.whatsappClient.getStatus();
        }
        if (typeof options.whatsappClient.isReady === 'function') {
          return options.whatsappClient.isReady() ? 'READY' : 'INITIALIZING';
        }
        return 'INITIALIZING';
      }
    : () => 'INITIALIZING');

  const getQrCode = options.getQrCode || (options.whatsappClient
    ? () => {
        if (typeof options.whatsappClient.getQrCode === 'function') {
          return options.whatsappClient.getQrCode();
        }
        return null;
      }
    : () => null);

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
      timestamp: new Date().toISOString()
    });
  };

  app.get('/health', handleHealth);
  app.get('/healthz', handleHealth);

  // Force logout + reconnect per generare un nuovo QR code
  app.get('/reconnect', async (req, res) => {
    const client = options.whatsappClient;
    if (!client) {
      return res.status(500).json({ error: 'WhatsApp client not available' });
    }
    try {
      console.log('🔄 [Reconnect] Forzando logout e riconnessione...');

      // 1. Cancella TUTTE le credenziali auth da Firestore se presenti
      try {
        if (client.shoppingListService && client.shoppingListService.db && typeof client.shoppingListService.db._getDb === 'function') {
          const db = await client.shoppingListService.db._getDb();
          if (db && typeof db.collection === 'function') {
            const authColl = db.collection('whatsapp_auth');
            const snapshot = await authColl.get();
            if (snapshot && !snapshot.empty) {
              const batchSize = 500;
              const docs = snapshot.docs;
              for (let i = 0; i < docs.length; i += batchSize) {
                const batch = db.batch();
                docs.slice(i, i + batchSize).forEach(doc => batch.delete(doc.ref || doc));
                await batch.commit();
              }
              console.log(`🔄 [Reconnect] Cancellate ${docs.length} credenziali auth da Firestore`);
            }
          }
        }
      } catch (e) {
        console.error('🔄 [Reconnect] Errore cancellando auth:', e.message);
      }

      // 2. Manda la risposta PRIMA di killare il processo
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="15;url=/qr">
            <title>Riconnessione...</title>
            <style>
              body { font-family: system-ui, sans-serif; background: #fff3e0; text-align: center; padding: 50px 20px; }
              .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 450px; }
              h1 { color: #e65100; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>🔄 Riconnessione in corso...</h1>
              <p>Le credenziali sono state cancellate.</p>
              <p>Il server si sta riavviando... Verrai reindirizzato alla pagina QR tra <strong>15 secondi</strong>.</p>
              <p>Se non appare il QR, ricarica la pagina dopo 30 secondi.</p>
              <p><a href="/qr">Vai alla pagina QR</a></p>
            </div>
          </body>
        </html>
      `);

      setTimeout(() => {
        console.log('🔄 [Reconnect] Killing process — Render lo riavvierà...');
        process.exit(0);
      }, 2000);

    } catch (err) {
      console.error('❌ [Reconnect] Errore:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/qr', (req, res) => {
    const status = resolveStatus(getStatus);
    const qrCode = resolveQrCode(getQrCode);

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');

    if (status === 'READY' || status === 'CONNECTED') {
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
              <p>Il bot è attivo e pronto a gestire la lista della spesa.</p>
              <p><small>Uptime: ${Math.floor(process.uptime())}s</small></p>
            </div>
          </body>
        </html>
      `);
    }

    if (qrCode) {
      const imgSrc = qrCode.startsWith('data:image')
        ? qrCode
        : `https://api.qrserver.com/v1/create-qr-code/?size=300x300&amp;data=${encodeURIComponent(qrCode)}`;

      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="10">
            <title>WhatsApp Bot - Scansiona QR Code</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; text-align: center; padding: 40px 20px; margin: 0; }
              .card { background: white; border-radius: 12px; padding: 32px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 450px; width: 100%; }
              img { border: 1px solid #e0e0e0; border-radius: 8px; margin: 20px 0; max-width: 100%; height: auto; }
              ol { text-align: left; background: #f8f9fa; padding: 16px 24px; border-radius: 8px; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>📱 WhatsApp Web QR Code</h1>
              <p>Inquadra il codice per collegare il bot. Le chiavi verranno salvate su Firestore per i futuri avvii!</p>
              <img src="${imgSrc}" alt="WhatsApp QR Code" width="300" height="300" />
              <div style="display:none" data-qr="${qrCode}">${qrCode}</div>
              <ol>
                <li>Apri <strong>WhatsApp</strong> sul tuo telefono</li>
                <li>Vai in <strong>Impostazioni / Menu</strong> > <strong>Dispositivi collegati</strong></li>
                <li>Premi <strong>Collega un dispositivo</strong> e inquadra questo schermo</li>
              </ol>
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
          <meta http-equiv="refresh" content="5">
          <title>WhatsApp Bot - Inizializzazione</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; text-align: center; padding: 50px 20px; margin: 0; }
            .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
            .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #1976d2; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>⏳ Inizializzazione WhatsApp Client...</h1>
            <div class="spinner"></div>
            <p>Generazione del QR Code in corso, oppure caricamento delle chiavi da Firestore...</p>
          </div>
        </body>
      </html>
    `);
  });

  // --- Self-ping Keep-Alive ---
  // Render free tier spegne il server dopo 15 min di inattività HTTP.
  // Ping ESTERNO ogni 5 minuti per tenere il servizio SEMPRE sveglio.
  app.startKeepAlive = (port) => {
    const INTERVAL_MS = 5 * 60 * 1000; // 5 minuti
    const baseUrl = process.env.RENDER_EXTERNAL_URL
      ? process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '')
      : 'https://whatsapp-shopping-list.onrender.com';
    const EXTERNAL_URL = `${baseUrl}/health`;
    const LOCAL_URL = `http://localhost:${port}/health`;

    const doPing = async () => {
      try {
        const res = await fetch(EXTERNAL_URL);
        const data = await res.json();
        console.log(`🏓 [Keep-Alive] Ping ESTERNO OK — uptime: ${Math.floor(data.uptime)}s, WA: ${data.whatsappStatus}`);
      } catch (err) {
        console.error('🏓 [Keep-Alive] Ping esterno fallito, provo locale:', err.message);
        try {
          await fetch(LOCAL_URL);
          console.log('🏓 [Keep-Alive] Ping locale OK (fallback)');
        } catch (e) {
          console.error('🏓 [Keep-Alive] Anche ping locale fallito:', e.message);
        }
      }
    };

    setTimeout(doPing, 30 * 1000);
    setInterval(doPing, INTERVAL_MS);

    console.log(`🏓 [Keep-Alive] Auto-ping attivato ogni 5 minuti → ${EXTERNAL_URL}`);
  };

  return app;
}

export async function startWebServer(port = 0, options = {}) {
  const app = createWebServer(options);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: actualPort, app });
    });
    server.on('error', reject);
  });
}

export async function stopWebServer(server) {
  if (!server) return;
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

