import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

// The default fork/thread pools fail to initialize the suite context in this
// Node/Vitest combination; vmThreads keeps the existing tests isolated.
export default mergeConfig(viteConfig, defineConfig({ test: { pool: 'vmThreads' } }));
