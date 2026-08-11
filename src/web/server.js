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
    ? () => options.whatsappClient.sock ? 'READY' : 'INITIALIZING'
    : () => 'INITIALIZING');

  const getQrCode = options.getQrCode || (options.whatsappClient
    ? () => options.whatsappClient.getQrCode()
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

  app.get('/qr', (req, res) => {
    const status = resolveStatus(getStatus);
    const qrCode = resolveQrCode(getQrCode);

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');

    if (!qrCode && status === 'READY') {
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
              <p>Il bot è attivo (chiavi da Firestore) e pronto a gestire la lista della spesa.</p>
              <p><small>Uptime: ${Math.floor(process.uptime())}s</small></p>
            </div>
          </body>
        </html>
      `);
    }

    if (qrCode) {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="5">
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
              <img src="${qrCode}" alt="WhatsApp QR Code" width="300" height="300" />
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
          <meta http-equiv="refresh" content="3">
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
            <h1>⏳ Avvio in corso...</h1>
            <div class="spinner"></div>
            <p>Generazione del QR Code in corso, oppure caricamento delle chiavi da Firestore...</p>
          </div>
        </body>
      </html>
    `);
  });

  // --- Self-ping Keep-Alive ---
  // Render free tier spegne il server dopo 15 min di inattività HTTP.
  // Questo timer fa un ping interno ogni 10 minuti per tenerlo sveglio.
  app.startKeepAlive = (port) => {
    const INTERVAL_MS = 10 * 60 * 1000; // 10 minuti
    const url = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/health`
      : `http://localhost:${port}/health`;

    setInterval(async () => {
      try {
        const res = await fetch(url);
        const data = await res.json();
        console.log(`🏓 [Keep-Alive] Ping OK — uptime: ${Math.floor(data.uptime)}s, WA: ${data.whatsappStatus}`);
      } catch (err) {
        console.error('🏓 [Keep-Alive] Ping fallito:', err.message);
      }
    }, INTERVAL_MS);

    console.log(`🏓 [Keep-Alive] Auto-ping attivato ogni 10 minuti → ${url}`);
  };

  return app;
}
