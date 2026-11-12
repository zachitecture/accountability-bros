-- Accountability Bros: database setup
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It is safe to run again later (it only adds what is missing and refreshes the rules).
--
-- How it is locked down:
--   * Every table has row level security switched on with NO policies, and all
--     direct access is revoked. Nobody can read or write a table directly.
--   * The app only talks to the functions below. Each one checks who is calling
--     and what they are allowed to do.
--   * Times always come from the server (app_now), never from a member's phone.

-- ---------------------------------------------------------------- tables ---

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  group_name text not null default 'Accountability Bros',
  min_goals int not null default 3,
  min_physical_minutes int not null default 25,
  forfeit_per_member numeric(10,2) not null default 5,
  forfeit_due_days int not null default 10,
  join_code text not null default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
);
insert into public.settings (id) values (1) on conflict (id) do nothing;
-- Lets someone who joins after the Monday lock still set goals for that first week.
alter table public.settings add column if not exists first_week_grace boolean not null default true;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  title text not null default '',
  timezone text not null default 'Australia/Melbourne',
  eligible boolean not null default true,
  is_admin boolean not null default false,
  can_manage_kitty boolean not null default false,
  active boolean not null default true,
  sort_order int,
  joined_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  activity text not null,
  category text not null check (category in ('physical', 'lifestyle', 'recovery')),
  target int not null check (target between 1 and 14),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists goals_user_week on public.goals (user_id, week_start);

create table if not exists public.week_notes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  reason text not null,
  primary key (user_id, week_start)
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete restrict,
  week_start date not null,
  local_day date not null,
  duration_min int not null,
  photo_path text not null unique,
  flag_short boolean not null default false,
  flag_same_day boolean not null default false,
  logged_at timestamptz not null default now()
);
create index if not exists logs_user_week on public.logs (user_id, week_start);
create index if not exists logs_goal on public.logs (goal_id);

create table if not exists public.ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('forfeit', 'fee', 'other')),
  week_start date,
  amount numeric(10,2) not null check (amount > 0),
  note text not null default '',
  status text not null default 'owed' check (status in ('owed', 'paid')),
  due_date date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  paid_at timestamptz,
  paid_marked_by uuid references public.profiles (id) on delete set null
);
create unique index if not exists ledger_one_forfeit_per_week
  on public.ledger (user_id, week_start) where kind = 'forfeit';

-- A week the Kitty managers have excused (leave, illness and so on).
create table if not exists public.week_rulings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  note text not null default '',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.week_notes enable row level security;
alter table public.logs enable row level security;
alter table public.ledger enable row level security;
alter table public.week_rulings enable row level security;

revoke all on table public.settings, public.profiles, public.goals, public.week_notes,
  public.logs, public.ledger, public.week_rulings from anon, authenticated;

-- --------------------------------------------------------------- helpers ---

-- The one clock the whole app uses.
create or replace function public.app_now() returns timestamptz
language sql stable as $$ select now() $$;

create or replace function public.safe_tz(p text) returns text
language plpgsql stable as $$
begin
  if p is null or btrim(p) = '' then return 'Australia/Melbourne'; end if;
  perform now() at time zone p;
  return p;
exception when others then
  return 'Australia/Melbourne';
end $$;

-- The Monday that starts the week containing "now" in the given time zone.
create or replace function public.week_of(p_tz text) returns date
language sql stable set search_path = public as $$
  select date_trunc('week', public.app_now() at time zone p_tz)::date
$$;

-- Goals for a week lock when Monday ends (Tuesday 12:00am) in the member's time zone.
create or replace function public.lock_at(p_week date, p_tz text) returns timestamptz
language sql stable as $$
  select ((p_week + 1)::timestamp at time zone p_tz)
$$;

create or replace function public.me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'You have not joined the group yet.'; end if;
  if not p.active then raise exception 'Your membership is paused. Talk to the Executive.'; end if;
  return p;
end $$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.week_complete(p_user uuid, p_week date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.goals g where g.user_id = p_user and g.week_start = p_week)
     and not exists (
       select 1 from public.goals g
       where g.user_id = p_user and g.week_start = p_week
         and (select count(*) from public.logs l where l.goal_id = g.id) < g.target)
$$;

-- Weeks in a row with every goal met. The current week counts once it is complete.
-- Excused weeks neither add to the streak nor break it.
create or replace function public.streak(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; w date; n int := 0; i int := 0;
begin
  select timezone into v_tz from public.profiles where id = p_user;
  if v_tz is null then return 0; end if;
  w := public.week_of(v_tz);
  if public.week_complete(p_user, w) then n := 1; end if;
  loop
    w := w - 7; i := i + 1;
    exit when i > 520;
    if exists (select 1 from public.week_rulings r where r.user_id = p_user and r.week_start = w) then
      continue;
    end if;
    exit when not public.week_complete(p_user, w);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Until when a member may change their goals for a week, or null if they may not.
--   * next week: until its own Monday lock
--   * this week: until the Monday lock; or, if they joined after that lock and the
--     first-week setting is on, for 24 hours after joining
create or replace function public.edit_until(p_user uuid, p_week date) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles; v_cur date; v_lock timestamptz; v_grace timestamptz;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or p_week is null then return null; end if;
  v_cur := public.week_of(p.timezone);
  v_lock := public.lock_at(p_week, p.timezone);
  if p_week = v_cur + 7 then return v_lock; end if;
  if p_week <> v_cur then return null; end if;
  if public.app_now() < v_lock then return v_lock; end if;
  if (select first_week_grace from public.settings where id = 1) and p.joined_at >= v_lock then
    v_grace := p.joined_at + interval '24 hours';
    if public.app_now() < v_grace then return v_grace; end if;
  end if;
  return null;
end $$;

-- ------------------------------------------------------- joining & state ---

create or replace function public.get_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles; s public.settings;
  v_week date; v_lock timestamptz; v_until timestamptz; v_now timestamptz := public.app_now();
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  select * into p from public.profiles where id = v_uid;
  if p.id is null then
    return jsonb_build_object('member', false, 'first', not exists (select 1 from public.profiles));
  end if;
  if not p.active then
    return jsonb_build_object('member', false, 'paused', true);
  end if;
  select * into s from public.settings where id = 1;
  v_week := public.week_of(p.timezone);
  v_lock := public.lock_at(v_week, p.timezone);
  v_until := public.edit_until(p.id, v_week);
  return jsonb_build_object(
    'member', true,
    'me', jsonb_build_object('id', p.id, 'nickname', p.nickname, 'title', p.title, 'timezone', p.timezone,
      'eligible', p.eligible, 'is_admin', p.is_admin, 'can_manage_kitty', p.can_manage_kitty),
    'settings', jsonb_build_object('group_name', s.group_name, 'min_goals', s.min_goals,
      'min_physical_minutes', s.min_physical_minutes, 'forfeit_per_member', s.forfeit_per_member,
      'forfeit_due_days', s.forfeit_due_days),
    'now', v_now, 'week_start', v_week, 'lock_at', v_lock,
    -- "locked" means this member can no longer change this week's goals.
    'locked', v_until is null, 'edit_until', v_until, 'grace', v_until is not null and v_now >= v_lock);
end $$;

-- The very first person to join needs no code and becomes the admin.
-- Everyone after that needs the join code.
create or replace function public.join_group(p_code text, p_nickname text, p_timezone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_first boolean; v_code text;
  v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then return public.get_state(); end if;
  if length(v_nick) < 1 or length(v_nick) > 20 then
    raise exception 'Pick a name between 1 and 20 characters.';
  end if;
  select join_code into v_code from public.settings where id = 1 for update;
  v_first := not exists (select 1 from public.profiles);
  if not v_first and upper(btrim(coalesce(p_code, ''))) <> upper(v_code) then
    raise exception 'That join code is not right.';
  end if;
  if exists (select 1 from public.profiles where lower(nickname) = lower(v_nick)) then
    raise exception 'Someone already has that name.';
  end if;
  insert into public.profiles (id, nickname, timezone, is_admin, can_manage_kitty, joined_at)
  values (v_uid, v_nick, public.safe_tz(p_timezone), v_first, v_first, public.app_now());
  return public.get_state();
end $$;

create or replace function public.update_my_profile(p_nickname text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if length(v_nick) < 1 or length(v_nick) > 20 then
    raise exception 'Pick a name between 1 and 20 characters.';
  end if;
  if exists (select 1 from public.profiles where lower(nickname) = lower(v_nick) and id <> m.id) then
    raise exception 'Someone already has that name.';
  end if;
  update public.profiles set nickname = v_nick where id = m.id;
  return public.get_state();
end $$;

-- ----------------------------------------------------------------- goals ---

create or replace function public.get_week(p_week date default null, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  t public.profiles;
  v_week date; v_cur date; v_lock timestamptz; v_goals jsonb; v_hist jsonb; v_reason text;
begin
  if p_user is null or p_user = m.id then
    t := m;
  else
    select * into t from public.profiles where id = p_user;
    if t.id is null then raise exception 'Member not found.'; end if;
  end if;
  v_cur := public.week_of(t.timezone);
  v_week := coalesce(p_week, v_cur);
  v_lock := public.lock_at(v_week, t.timezone);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'activity', g.activity, 'category', g.category, 'target', g.target,
           'done', (select count(*) from public.logs l where l.goal_id = g.id))
           order by g.position, g.created_at), '[]'::jsonb)
    into v_goals
    from public.goals g where g.user_id = t.id and g.week_start = v_week;

  select reason into v_reason from public.week_notes where user_id = t.id and week_start = v_week;

  select coalesce(jsonb_agg(jsonb_build_object(
           'week_start', w.d,
           'declared', (select coalesce(sum(g.target), 0) from public.goals g where g.user_id = t.id and g.week_start = w.d),
           'done', (select count(*) from public.logs l where l.user_id = t.id and l.week_start = w.d))
           order by w.d), '[]'::jsonb)
    into v_hist
    from (select (v_week - 7 * i) as d from generate_series(1, 4) as i) w;

  return jsonb_build_object(
    'user_id', t.id, 'nickname', t.nickname, 'title', t.title, 'timezone', t.timezone,
    'week_start', v_week, 'current_week', v_cur, 'lock_at', v_lock,
    'editable', public.edit_until(t.id, v_week) is not null, 'edit_until', public.edit_until(t.id, v_week),
    'goals', v_goals, 'reason', v_reason, 'history', v_hist);
end $$;

-- Replace a member's goals for a week. Members can do this for the current week
-- until the Monday lock (or for 24 hours after joining mid-week), and for next week at any time. The Executive (admins)
-- can change another member's goals after the lock, for agreed substitutions.
create or replace function public.save_goals(p_week date, p_goals jsonb, p_reason text default null, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  t public.profiles; s public.settings;
  v_cur date; v_item jsonb; v_id uuid; v_activity text; v_category text; v_target int; v_done int;
  v_total int := 0; v_pos int := 0; v_keep uuid[] := '{}';
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_override boolean := false; r record;
begin
  if p_user is not null and p_user <> m.id then
    if not m.is_admin then raise exception 'Only the Executive can change another member''s goals.'; end if;
    select * into t from public.profiles where id = p_user;
    if t.id is null then raise exception 'Member not found.'; end if;
    v_override := true;
  else
    t := m;
  end if;
  select * into s from public.settings where id = 1;

  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'Weeks start on a Monday.'; end if;
  v_cur := public.week_of(t.timezone);
  if not v_override then
    if p_week <> v_cur and p_week <> v_cur + 7 then
      raise exception 'You can only set goals for this week or next week.';
    end if;
    if public.edit_until(t.id, p_week) is null then
      raise exception 'This week''s goals locked on Monday at 11:59 pm.';
    end if;
  end if;

  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then raise exception 'Goals are missing.'; end if;
  if jsonb_array_length(p_goals) > 12 then raise exception 'That is too many separate goals (12 at most).'; end if;

  for v_item in select * from jsonb_array_elements(p_goals) loop
    v_activity := btrim(coalesce(v_item->>'activity', ''));
    v_category := coalesce(v_item->>'category', 'physical');
    v_target := coalesce((v_item->>'target')::int, 0);
    v_id := nullif(v_item->>'id', '')::uuid;
    if length(v_activity) < 1 or length(v_activity) > 40 then
      raise exception 'Give each goal a name (up to 40 characters).';
    end if;
    if v_category not in ('physical', 'lifestyle', 'recovery') then raise exception 'Unknown goal type.'; end if;
    if v_target < 1 or v_target > 14 then raise exception 'Each goal needs a count between 1 and 14.'; end if;
    v_total := v_total + v_target;
    if v_id is not null then
      update public.goals set activity = v_activity, category = v_category, target = v_target, position = v_pos
        where id = v_id and user_id = t.id and week_start = p_week;
      if not found then raise exception 'One of those goals no longer exists. Reload and try again.'; end if;
      select count(*) into v_done from public.logs where goal_id = v_id;
      if v_done > v_target then
        raise exception '"%" already has % logged, so it cannot go below that.', v_activity, v_done;
      end if;
    else
      insert into public.goals (user_id, week_start, activity, category, target, position, created_at)
        values (t.id, p_week, v_activity, v_category, v_target, v_pos, public.app_now())
        returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
    v_pos := v_pos + 1;
  end loop;

  if v_total < s.min_goals and v_reason is null and not v_override then
    raise exception 'That is under the minimum of %. Add a reason for the lighter week.', s.min_goals;
  end if;

  for r in
    select g.id, g.activity, (select count(*) from public.logs l where l.goal_id = g.id) as done
    from public.goals g
    where g.user_id = t.id and g.week_start = p_week and not (g.id = any (v_keep))
  loop
    if r.done > 0 then
      raise exception '"%" already has activity logged, so it cannot be removed.', r.activity;
    end if;
    delete from public.goals where id = r.id;
  end loop;

  if v_reason is null then
    delete from public.week_notes where user_id = t.id and week_start = p_week;
  else
    insert into public.week_notes (user_id, week_start, reason) values (t.id, p_week, v_reason)
      on conflict (user_id, week_start) do update set reason = excluded.reason;
  end if;

  return public.get_week(p_week, t.id);
end $$;

-- --------------------------------------------------------------- logging ---

-- Record one completed activity. The time is the server's, the week is worked
-- out from that time, and the entry cannot be edited afterwards.
create or replace function public.log_activity(p_goal_id uuid, p_duration int, p_photo_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  s public.settings; g public.goals; v_log public.logs;
  v_cur date; v_done int; v_day date; v_short boolean; v_same boolean;
  v_week_done int; v_week_total int;
begin
  select * into s from public.settings where id = 1;
  select * into g from public.goals where id = p_goal_id and user_id = m.id for update;
  if g.id is null then raise exception 'That goal was not found.'; end if;
  v_cur := public.week_of(m.timezone);
  if g.week_start <> v_cur then raise exception 'That goal is not from this week.'; end if;
  select count(*) into v_done from public.logs where goal_id = g.id;
  if v_done >= g.target then
    raise exception 'You have already done all % of "%" this week.', g.target, g.activity;
  end if;
  if p_duration is null or p_duration < 1 or p_duration > 1440 then
    raise exception 'Enter how many minutes it took.';
  end if;
  if p_photo_path is null or p_photo_path not like (m.id::text || '/%') then
    raise exception 'A proof photo is required.';
  end if;
  if exists (select 1 from public.logs where photo_path = p_photo_path) then
    raise exception 'That photo has already been used.';
  end if;

  v_day := (public.app_now() at time zone m.timezone)::date;
  v_short := g.category = 'physical' and p_duration <= s.min_physical_minutes;
  v_same := exists (select 1 from public.logs where goal_id = g.id and local_day = v_day);

  insert into public.logs (user_id, goal_id, week_start, local_day, duration_min, photo_path, flag_short, flag_same_day, logged_at)
    values (m.id, g.id, v_cur, v_day, p_duration, p_photo_path, v_short, v_same, public.app_now())
    returning * into v_log;

  select coalesce(sum(target), 0) into v_week_total from public.goals where user_id = m.id and week_start = v_cur;
  select count(*) into v_week_done from public.logs where user_id = m.id and week_start = v_cur;

  return jsonb_build_object(
    'id', v_log.id, 'logged_at', v_log.logged_at, 'duration_min', v_log.duration_min,
    'flag_short', v_short, 'flag_same_day', v_same,
    'activity', g.activity, 'category', g.category, 'nickname', m.nickname, 'timezone', m.timezone,
    'done', v_week_done, 'total', v_week_total, 'goal_done', v_done + 1, 'goal_target', g.target,
    'group_name', s.group_name, 'min_physical_minutes', s.min_physical_minutes);
end $$;

-- A member can undo their own entry for 15 minutes (wrong goal, wrong photo).
-- After that only the Executive can remove it, and never their own.
create or replace function public.undo_log(p_log_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  l public.logs;
begin
  select * into l from public.logs where id = p_log_id;
  if l.id is null then raise exception 'That entry was not found.'; end if;
  if l.user_id = m.id then
    if public.app_now() > l.logged_at + interval '15 minutes' then
      raise exception 'Entries can only be undone within 15 minutes. Ask the Executive.';
    end if;
  elsif not m.is_admin then
    raise exception 'Only the Executive can remove another member''s entry.';
  end if;
  delete from public.logs where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

-- ----------------------------------------------------------------- group ---

create or replace function public.get_group() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  v jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.so nulls last, x.ja), '[]'::jsonb) into v
  from (
    select p.sort_order as so, p.joined_at as ja,
      jsonb_build_object(
        'id', p.id, 'nickname', p.nickname, 'title', p.title, 'eligible', p.eligible, 'is_me', p.id = m.id,
        'week_start', w.wk,
        'total', (select coalesce(sum(g.target), 0) from public.goals g where g.user_id = p.id and g.week_start = w.wk),
        'done', (select count(*) from public.logs l where l.user_id = p.id and l.week_start = w.wk),
        'flags', (select count(*) from public.logs l where l.user_id = p.id and l.week_start = w.wk and (l.flag_short or l.flag_same_day)),
        'reason', (select n.reason from public.week_notes n where n.user_id = p.id and n.week_start = w.wk),
        'streak', public.streak(p.id)) as j
    from public.profiles p
    cross join lateral (select public.week_of(p.timezone) as wk) w
    where p.active
  ) x;
  return jsonb_build_object('week_start', public.week_of(m.timezone), 'members', v);
end $$;

create or replace function public.get_member(p_user uuid, p_week date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  v_base jsonb; v_week date; v_logs jsonb; v_user uuid;
begin
  v_base := public.get_week(p_week, p_user);
  v_week := (v_base->>'week_start')::date;
  v_user := (v_base->>'user_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'activity', g.activity, 'category', g.category, 'duration_min', l.duration_min,
           'logged_at', l.logged_at, 'photo_path', l.photo_path,
           'flag_short', l.flag_short, 'flag_same_day', l.flag_same_day,
           'can_undo', (l.user_id = m.id and public.app_now() <= l.logged_at + interval '15 minutes')
                       or (m.is_admin and l.user_id <> m.id))
           order by l.logged_at), '[]'::jsonb)
    into v_logs
    from public.logs l join public.goals g on g.id = l.goal_id
    where l.user_id = v_user and l.week_start = v_week;
  return v_base || jsonb_build_object(
    'logs', v_logs,
    'streak', public.streak(v_user),
    'is_me', v_user = m.id,
    'excused', exists (select 1 from public.week_rulings r where r.user_id = v_user and r.week_start = v_week));
end $$;

-- ----------------------------------------------------------------- kitty ---

create or replace function public.get_kitty() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  s public.settings;
  v_elig int; v_in numeric; v_owed numeric;
  v_entries jsonb; v_misses jsonb := '[]'::jsonb; v_members jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  select count(*) into v_elig from public.profiles where active and eligible;
  select coalesce(sum(amount) filter (where status = 'paid'), 0),
         coalesce(sum(amount) filter (where status = 'owed'), 0)
    into v_in, v_owed from public.ledger;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'user_id', e.user_id, 'nickname', p.nickname, 'kind', e.kind, 'week_start', e.week_start,
           'amount', e.amount, 'note', e.note, 'status', e.status, 'due_date', e.due_date,
           'paid_at', e.paid_at, 'created_at', e.created_at, 'is_mine', e.user_id = m.id)
           order by (e.status = 'owed') desc, e.created_at desc), '[]'::jsonb)
    into v_entries
    from public.ledger e join public.profiles p on p.id = e.user_id;

  if m.can_manage_kitty then
    -- Finished weeks (up to four back) where an eligible member fell short and
    -- nothing has been decided yet.
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', q.id, 'nickname', q.nickname, 'week_start', q.wk, 'total', q.total, 'done', q.done, 'is_mine', q.id = m.id)
             order by q.wk desc, q.nickname), '[]'::jsonb)
      into v_misses
      from (
        select p.id, p.nickname, w.wk,
          (select coalesce(sum(g.target), 0) from public.goals g where g.user_id = p.id and g.week_start = w.wk) as total,
          (select count(*) from public.logs l where l.user_id = p.id and l.week_start = w.wk) as done
        from public.profiles p
        cross join generate_series(1, 4) as i
        cross join lateral (select public.week_of(p.timezone) - 7 * i as wk) w
        where p.active and p.eligible
          and p.joined_at < public.lock_at(w.wk, p.timezone)
          and not public.week_complete(p.id, w.wk)
          and not exists (select 1 from public.ledger e where e.user_id = p.id and e.kind = 'forfeit' and e.week_start = w.wk)
          and not exists (select 1 from public.week_rulings r where r.user_id = p.id and r.week_start = w.wk)
      ) q;
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nickname', p.nickname) order by p.nickname), '[]'::jsonb)
      into v_members from public.profiles p where p.active;
  end if;

  return jsonb_build_object(
    'in_kitty', v_in, 'owed', v_owed, 'eligible_count', v_elig,
    'forfeit_per_member', s.forfeit_per_member, 'forfeit_amount', s.forfeit_per_member * v_elig,
    'forfeit_due_days', s.forfeit_due_days,
    'can_manage', m.can_manage_kitty, 'entries', v_entries, 'misses', v_misses, 'members', v_members);
end $$;

create or replace function public.issue_forfeit(p_user uuid, p_week date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  t public.profiles; s public.settings; v_elig int;
begin
  if not m.can_manage_kitty then raise exception 'Only the Kitty managers can do that.'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null then raise exception 'Member not found.'; end if;
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'Weeks start on a Monday.'; end if;
  if p_week >= public.week_of(t.timezone) then raise exception 'That week has not finished yet.'; end if;
  if exists (select 1 from public.ledger where user_id = p_user and kind = 'forfeit' and week_start = p_week) then
    raise exception 'A forfeit for that week already exists.';
  end if;
  select * into s from public.settings where id = 1;
  select count(*) into v_elig from public.profiles where active and eligible;
  insert into public.ledger (user_id, kind, week_start, amount, status, due_date, created_by, created_at)
  values (p_user, 'forfeit', p_week, s.forfeit_per_member * greatest(v_elig, 1), 'owed',
          (public.app_now() at time zone m.timezone)::date + s.forfeit_due_days, m.id, public.app_now());
  return public.get_kitty();
end $$;

create or replace function public.excuse_week(p_user uuid, p_week date, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
begin
  if not m.can_manage_kitty then raise exception 'Only the Kitty managers can do that.'; end if;
  if p_user = m.id then raise exception 'Another Kitty manager has to excuse your own week.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found.'; end if;
  insert into public.week_rulings (user_id, week_start, note, decided_by, decided_at)
  values (p_user, p_week, btrim(coalesce(p_note, '')), m.id, public.app_now())
  on conflict (user_id, week_start) do update set note = excluded.note, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  return public.get_kitty();
end $$;

create or replace function public.add_entry(p_user uuid, p_kind text, p_amount numeric, p_note text default '', p_week date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  s public.settings;
begin
  if not m.can_manage_kitty then raise exception 'Only the Kitty managers can do that.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found.'; end if;
  if p_kind not in ('forfeit', 'fee', 'other') then raise exception 'Unknown entry type.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then raise exception 'Enter an amount above zero.'; end if;
  if p_kind = 'forfeit' and p_week is null then raise exception 'Pick the week the forfeit is for.'; end if;
  if p_kind = 'forfeit' and exists (select 1 from public.ledger where user_id = p_user and kind = 'forfeit' and week_start = p_week) then
    raise exception 'A forfeit for that week already exists.';
  end if;
  select * into s from public.settings where id = 1;
  insert into public.ledger (user_id, kind, week_start, amount, note, status, due_date, created_by, created_at)
  values (p_user, p_kind, p_week, round(p_amount, 2), left(btrim(coalesce(p_note, '')), 140), 'owed',
          (public.app_now() at time zone m.timezone)::date + s.forfeit_due_days, m.id, public.app_now());
  return public.get_kitty();
end $$;

-- No manager can mark their own entry as paid, or delete it.
create or replace function public.set_paid(p_id uuid, p_paid boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  e public.ledger;
begin
  if not m.can_manage_kitty then raise exception 'Only the Kitty managers can do that.'; end if;
  select * into e from public.ledger where id = p_id;
  if e.id is null then raise exception 'That entry was not found.'; end if;
  if e.user_id = m.id then raise exception 'Another Kitty manager has to mark your own entry.'; end if;
  if p_paid then
    update public.ledger set status = 'paid', paid_at = public.app_now(), paid_marked_by = m.id where id = p_id;
  else
    update public.ledger set status = 'owed', paid_at = null, paid_marked_by = null where id = p_id;
  end if;
  return public.get_kitty();
end $$;

create or replace function public.delete_entry(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  e public.ledger;
begin
  if not m.can_manage_kitty then raise exception 'Only the Kitty managers can do that.'; end if;
  select * into e from public.ledger where id = p_id;
  if e.id is null then raise exception 'That entry was not found.'; end if;
  if e.user_id = m.id then raise exception 'Another Kitty manager has to remove your own entry.'; end if;
  delete from public.ledger where id = p_id;
  return public.get_kitty();
end $$;

-- ----------------------------------------------------------------- admin ---

create or replace function public.list_members() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  v jsonb;
begin
  if not m.is_admin then raise exception 'Only the Executive can do that.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'nickname', p.nickname, 'title', p.title, 'timezone', p.timezone, 'eligible', p.eligible,
           'is_admin', p.is_admin, 'can_manage_kitty', p.can_manage_kitty, 'active', p.active,
           'sort_order', p.sort_order, 'joined_at', p.joined_at, 'email', u.email, 'is_me', p.id = m.id)
           order by p.sort_order nulls last, p.joined_at), '[]'::jsonb)
    into v
    from public.profiles p left join auth.users u on u.id = p.id;
  return v;
end $$;

create or replace function public.update_member(p_user uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  t public.profiles;
  v_nick text; v_admin boolean; v_active boolean;
begin
  if not m.is_admin then raise exception 'Only the Executive can do that.'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null then raise exception 'Member not found.'; end if;

  v_nick := coalesce(nullif(btrim(coalesce(p_patch->>'nickname', '')), ''), t.nickname);
  if length(v_nick) > 20 then raise exception 'Names can be up to 20 characters.'; end if;
  if exists (select 1 from public.profiles where lower(nickname) = lower(v_nick) and id <> t.id) then
    raise exception 'Someone already has that name.';
  end if;
  v_admin := coalesce((p_patch->>'is_admin')::boolean, t.is_admin);
  v_active := coalesce((p_patch->>'active')::boolean, t.active);
  if t.id = m.id and (not v_admin or not v_active) then
    raise exception 'You cannot remove your own admin access. Ask the other admin.';
  end if;

  update public.profiles set
    nickname = v_nick,
    title = case when p_patch ? 'title' then left(btrim(coalesce(p_patch->>'title', '')), 30) else title end,
    timezone = case when p_patch ? 'timezone' then public.safe_tz(p_patch->>'timezone') else timezone end,
    eligible = coalesce((p_patch->>'eligible')::boolean, eligible),
    is_admin = v_admin,
    can_manage_kitty = coalesce((p_patch->>'can_manage_kitty')::boolean, can_manage_kitty),
    active = v_active,
    sort_order = case when p_patch ? 'sort_order' then nullif(p_patch->>'sort_order', '')::int else sort_order end
  where id = t.id;
  return public.list_members();
end $$;

create or replace function public.get_admin_settings() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  s public.settings;
begin
  if not m.is_admin then raise exception 'Only the Executive can do that.'; end if;
  select * into s from public.settings where id = 1;
  return to_jsonb(s);
end $$;

create or replace function public.update_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.profiles := public.me();
  s public.settings;
  v_code text;
begin
  if not m.is_admin then raise exception 'Only the Executive can do that.'; end if;
  select * into s from public.settings where id = 1 for update;
  if p_patch ? 'group_name' then
    s.group_name := left(btrim(coalesce(p_patch->>'group_name', '')), 40);
    if s.group_name = '' then raise exception 'The group needs a name.'; end if;
  end if;
  if p_patch ? 'min_goals' then s.min_goals := (p_patch->>'min_goals')::int; end if;
  if p_patch ? 'min_physical_minutes' then s.min_physical_minutes := (p_patch->>'min_physical_minutes')::int; end if;
  if p_patch ? 'forfeit_per_member' then s.forfeit_per_member := (p_patch->>'forfeit_per_member')::numeric; end if;
  if p_patch ? 'forfeit_due_days' then s.forfeit_due_days := (p_patch->>'forfeit_due_days')::int; end if;
  if p_patch ? 'first_week_grace' then s.first_week_grace := coalesce((p_patch->>'first_week_grace')::boolean, s.first_week_grace); end if;
  if p_patch ? 'join_code' then
    v_code := upper(btrim(coalesce(p_patch->>'join_code', '')));
    if length(v_code) < 6 or length(v_code) > 24 then raise exception 'The join code needs 6 to 24 characters.'; end if;
    s.join_code := v_code;
  end if;
  if s.min_goals < 0 or s.min_goals > 30 then raise exception 'Minimum goals must be between 0 and 30.'; end if;
  if s.min_physical_minutes < 0 or s.min_physical_minutes > 240 then raise exception 'Minimum minutes must be between 0 and 240.'; end if;
  if s.forfeit_per_member < 0 or s.forfeit_per_member > 1000 then raise exception 'The forfeit per member must be between 0 and 1000.'; end if;
  if s.forfeit_due_days < 0 or s.forfeit_due_days > 90 then raise exception 'Days to pay must be between 0 and 90.'; end if;
  update public.settings set group_name = s.group_name, min_goals = s.min_goals,
    min_physical_minutes = s.min_physical_minutes, forfeit_per_member = s.forfeit_per_member,
    forfeit_due_days = s.forfeit_due_days, join_code = s.join_code, first_week_grace = s.first_week_grace
  where id = 1;
  return to_jsonb(s);
end $$;

-- ----------------------------------------------------------- permissions ---

-- Only signed-in people can call the app's functions; the helper functions
-- cannot be called from outside at all (is_member is the exception, because
-- the photo storage rules use it).
do $$
declare
  r record;
  api text[] := array['get_state', 'join_group', 'update_my_profile', 'get_week', 'save_goals', 'log_activity',
    'undo_log', 'get_group', 'get_member', 'get_kitty', 'issue_forfeit', 'excuse_week', 'add_entry', 'set_paid',
    'delete_entry', 'list_members', 'update_member', 'get_admin_settings', 'update_settings', 'is_member'];
  internal text[] := array['app_now', 'safe_tz', 'week_of', 'lock_at', 'me', 'week_complete', 'streak', 'edit_until'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname = any (api) or p.proname = any (internal))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = any (api) then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------ photo store ---

insert into storage.buckets (id, name, public) values ('proof', 'proof', false)
on conflict (id) do nothing;

drop policy if exists "bros upload own proof" on storage.objects;
create policy "bros upload own proof" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'proof' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "bros view proof" on storage.objects;
create policy "bros view proof" on storage.objects
  for select to authenticated
  using (bucket_id = 'proof' and public.is_member());

-- Tell the API layer to pick up the new functions straight away.
notify pgrst, 'reload schema';
