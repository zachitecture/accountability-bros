import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export function friendly(error) {
  const msg = (error && error.message) || 'Something went wrong.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (/invalid login credentials/i.test(msg)) return 'That email and password do not match.';
  if (/user already registered/i.test(msg)) return 'That email already has an account. Sign in instead.';
  if (/not authorized|rate limit/i.test(msg)) return 'Emails from the app are not switched on yet. Ask an admin to reset your password.';
  return msg;
}

// Every read and write goes through a database function that checks who is asking.
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendly(error));
  return data;
}

export async function uploadProof(userId, blob) {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('proof').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`The photo did not upload. ${friendly(error)}`);
  return path;
}

const urlCache = new Map();
export async function proofUrl(path) {
  if (urlCache.has(path)) return urlCache.get(path);
  const { data, error } = await supabase.storage.from('proof').download(path);
  if (error) throw new Error(friendly(error));
  const url = URL.createObjectURL(data);
  urlCache.set(path, url);
  return url;
}
