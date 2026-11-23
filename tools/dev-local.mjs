// Runs the app on your own computer against a local stand-in for Supabase, so you can
// try changes without touching the live database. Everything resets when you stop it.
//   npm run dev:local     then open http://localhost:5173
// The first account you create becomes the admin (no join code needed).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSupabase } from '../tests/fake-supabase.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fake = await startFakeSupabase(54321);
console.log(`Local database ready at ${fake.url} (runs the real supabase/schema.sql)`);
const vite = spawn('npx', ['vite', '--port', '5173'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: fake.url, VITE_SUPABASE_KEY: 'local-test-key' },
});
const stop = () => { vite.kill(); fake.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', () => fake.close().then(() => process.exit(0)));
