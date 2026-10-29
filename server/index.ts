import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import routes from './routes.js';
import { db } from './db.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8787);
// Local-first by default; set HOST=0.0.0.0 explicitly if LAN access is needed.
const host = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use('/api', routes);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// CLIENT_DIR lets container images or custom launchers place the static build
// outside the default repo layout without changing the code.
const clientDir = process.env.CLIENT_DIR
  ? path.resolve(process.env.CLIENT_DIR)
  : path.join(root, 'dist', 'client');
if (fs.existsSync(clientDir)) {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Keep internal exception and database details in the server log only.
  console.error('[api]', error);
  if (res.headersSent) return;
  res.status(500).json({
    error: '服务内部错误，请稍后重试；如果持续失败，请检查服务日志与 data/ 目录权限。',
  });
});

const server = app.listen(port, host, () => {
  console.log(`[opsite] API listening on http://${host}:${port}`);
  startScheduler();
});

function shutdown() {
  stopScheduler();
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore close errors during shutdown
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
