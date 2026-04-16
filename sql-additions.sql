-- ============================================================
--  FinderSeek — Schema additions for backend integration
--  Run this in Supabase SQL Editor before deploying.
-- ============================================================

-- ── HUNTS table additions ─────────────────────────────────
alter table public.hunts
  add column if not exists hiding_spot   text,
  add column if not exists clue_persona  text,
  add column if not exists clue_count    integer;

-- ── PROFILES table additions (for stats + Stripe Connect) ──
alter table public.profiles
  add column if not exists total_won             bigint default 0,
  add column if not exists quests_joined         integer default 0,
  add column if not exists quests_created        integer default 0,
  add column if not exists total_prize_money     bigint default 0,
  add column if not exists stripe_connect_id     text,
  add column if not exists stripe_customer_id    text,
  add column if not exists stripe_subscription_id text,
  add column if not exists pro_since             timestamptz;

-- ── Row-level security policies for inserts ───────────────

-- Allow authenticated users to insert their own hunts
drop policy if exists "hunts_insert_own" on public.hunts;
create policy "hunts_insert_own"
  on public.hunts for insert
  to authenticated
  with check (auth.uid() = pirate_id or auth.uid() = created_by);

-- Allow authenticated users to insert clues for hunts they own
drop policy if exists "clues_insert_own" on public.clues;
create policy "clues_insert_own"
  on public.clues for insert
  to authenticated
  with check (
    exists (
      select 1 from public.hunts h
      where h.id = hunt_id
        and (h.pirate_id = auth.uid() or h.created_by = auth.uid())
    )
  );

-- Allow users to insert their own find_reports
drop policy if exists "find_reports_insert_own" on public.find_reports;
create policy "find_reports_insert_own"
  on public.find_reports for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Allow users to read their own find_reports
drop policy if exists "find_reports_select_own" on public.find_reports;
create policy "find_reports_select_own"
  on public.find_reports for select
  to authenticated
  using (auth.uid() = user_id);

-- ── Helper function: increment finds + total_won when winning ──
create or replace function public.record_quest_win(
  p_user_id uuid,
  p_prize_value_cents bigint
)
returns void language sql security definer as $$
  update public.profiles
  set
    finds_count = coalesce(finds_count, 0) + 1,
    total_won   = coalesce(total_won, 0) + p_prize_value_cents,
    updated_at  = now()
  where id = p_user_id;
$$;

-- ── Indexes for performance ───────────────────────────────
create index if not exists hunts_status_starts_idx
  on public.hunts (status, starts_at desc);

create index if not exists clues_hunt_reveal_idx
  on public.clues (hunt_id, reveal_at);

create index if not exists find_reports_user_idx
  on public.find_reports (user_id, created_at desc);

create index if not exists hunts_created_by_idx
  on public.hunts (created_by, created_at desc);

