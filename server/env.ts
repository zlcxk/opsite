import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node's built-in .env loader; no dotenv dependency. Missing .env is fine.
// Resolve from this file so it works regardless of the launch directory.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
