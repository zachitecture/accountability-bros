// Where the app finds its database. Both values are safe to publish: the key is
// Supabase's "publishable" key, and the database only answers to signed-in members.
// They are read from .env.production when the site is built.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || '';
