-- ============================================================
--  FinderSeek — Schema additions for newquest.html flow
--  Run this in Supabase SQL Editor before deploying.
-- ============================================================

-- Add columns the new quest creation form uses
alter table public.hunts
  add column if not exists hiding_spot   text,
  add column if not exists clue_persona  text,
  add column if not exists clue_count    integer;

-- Allow authenticated users to insert their own hunts
-- (idempotent — drops policy first if it exists)
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

-- Index for fast lookups of active hunts
create index if not exists hunts_status_starts_idx
  on public.hunts (status, starts_at desc);

-- Index for fast lookups of clues for a hunt
create index if not exists clues_hunt_reveal_idx
  on public.clues (hunt_id, reveal_at);
