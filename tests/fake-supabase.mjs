// A small local stand-in for Supabase, used only by the tests.
// It speaks just enough of the auth, REST (rpc) and storage APIs for the real
// app code to run against the real schema.sql in a local Postgres.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createDb, lit } from './harness.mjs';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return body;
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  let best = null;
  let at = body.indexOf(boundary);
  while (at !== -1) {
    const next = body.indexOf(boundary, at + boundary.length);
    if (next === -1) break;
    const part = body.subarray(at + boundary.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = part.subarray(0, split).toString();
      const content = part.subarray(split + 4);
      if (/filename=/i.test(headers) || /content-type:\s*image\//i.test(headers)) best = content;
    }
    at = next;
  }
  return best || body;
}

export async function startFakeSupabase(port = 54321) {
  const h = await createDb();
  const files = new Map();
  const tokens = new Map(); // access or refresh token -> user id

  function sessionFor(user) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp })}.test`;
    const refresh = randomUUID();
    tokens.set(access, user.id);
    tokens.set(refresh, user.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userJson(user) };
  }
  function userJson(user) {
    return { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  }
  async function userById(id) {
    const r = await h.db.query(`select id, email from auth.users where id = ${lit(id)}`);
    return r.rows[0] || null;
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    const send = (status, body, headers = {}) => {
      const isBuf = Buffer.isBuffer(body);
      res.writeHead(status, { ...cors, 'Content-Type': isBuf ? 'image/jpeg' : 'application/json', ...headers });
      res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204);

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = decodeURIComponent(url.pathname);
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const uid = tokens.get(bearer) || null;
    const json = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };

    try {
      // ---- auth
      if (path === '/auth/v1/signup' && req.method === 'POST') {
        const { email, password } = json();
        const exists = await h.db.query(`select 1 from auth.users where email = ${lit(email)}`);
        if (exists.rows.length) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const id = await h.newUser(email, password);
        return send(200, sessionFor({ id, email }));
      }
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const body = json();
        if (url.searchParams.get('grant_type') === 'password') {
          const r = await h.db.query(`select id, email from auth.users where email = ${lit(body.email)} and password = ${lit(body.password)}`);
          if (!r.rows.length) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return send(200, sessionFor(r.rows[0]));
        }
        const who = tokens.get(body.refresh_token);
        const user = who ? await userById(who) : null;
        if (!user) return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return send(200, sessionFor(user));
      }
      if (path === '/auth/v1/user' && req.method === 'GET') {
        const user = uid ? await userById(uid) : null;
        return user ? send(200, userJson(user)) : send(401, { code: 401, msg: 'Invalid token' });
      }
      if (path === '/auth/v1/logout') return send(204);
      if (path === '/auth/v1/recover') return send(200, {});

      // ---- database functions
      if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
        const fn = path.slice('/rest/v1/rpc/'.length);
        try {
          return send(200, await h.call(uid, fn, json(), uid ? 'authenticated' : 'anon'));
        } catch (e) {
          return send(400, { code: 'P0001', message: e.message, details: null, hint: null });
        }
      }

      // ---- photo storage (the insert and select run through the real storage rules)
      if (path.startsWith('/storage/v1/object/proof/')) {
        const name = path.slice('/storage/v1/object/proof/'.length);
        if (req.method === 'POST') {
          try {
            await h.asUser(uid, `insert into storage.objects (bucket_id, name) values ('proof', ${lit(name)})`, uid ? 'authenticated' : 'anon');
          } catch (e) {
            return send(403, { statusCode: '403', error: 'Unauthorized', message: e.message });
          }
          files.set(name, parseMultipart(raw, req.headers['content-type']));
          return send(200, { Key: `proof/${name}`, Id: randomUUID() });
        }
        if (req.method === 'GET') {
          const rows = await h.asUser(uid, `select 1 from storage.objects where bucket_id = 'proof' and name = ${lit(name)}`, uid ? 'authenticated' : 'anon');
          if (!rows.length || !files.has(name)) return send(404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          return send(200, files.get(name));
        }
      }
      return send(404, { message: `No fake route for ${req.method} ${path}` });
    } catch (e) {
      return send(500, { message: e.message });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { ...h, files, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}
