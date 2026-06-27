-- Guesscue Supabase schema for optional live score rooms.
-- Run this in Supabase SQL Editor once per project.
-- Then enable Anonymous Sign-ins in Authentication > Providers > Anonymous Sign-ins.

create table if not exists public.rooms (
  room_code text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  state jsonb not null default '{"phase":"lobby","round":1,"turnIndex":0,"turnId":0,"started":false}'::jsonb,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.room_players (
  room_code text not null references public.rooms(room_code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Oyuncu',
  score integer not null default 0,
  current_round integer not null default 1,
  connected boolean not null default true,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table if not exists public.room_events (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(room_code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('correct', 'taboo', 'pass')),
  card_id text,
  delta integer not null default 0,
  score integer not null default 0,
  round integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.room_used_cards (
  room_code text not null references public.rooms(room_code) on delete cascade,
  card_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_code, card_id)
);


-- Migration for projects created with an older Guesscue schema.
alter table public.rooms
  add column if not exists state jsonb not null default '{"phase":"lobby","round":1,"turnIndex":0,"turnId":0,"started":false}'::jsonb;

alter table public.room_players
  add column if not exists last_seen timestamptz not null default now();

update public.room_players
set last_seen = coalesce(updated_at, joined_at, now())
where last_seen is null;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_events enable row level security;
alter table public.room_used_cards enable row level security;

-- Rooms: authenticated anonymous users can create rooms and read room metadata.
drop policy if exists "rooms_select_authenticated" on public.rooms;
create policy "rooms_select_authenticated"
  on public.rooms for select
  to authenticated
  using (true);

drop policy if exists "rooms_insert_own" on public.rooms;
create policy "rooms_insert_own"
  on public.rooms for insert
  to authenticated
  with check ((select auth.uid()) = created_by);

drop policy if exists "rooms_update_creator" on public.rooms;
drop policy if exists "rooms_update_participant" on public.rooms;
create policy "rooms_update_participant"
  on public.rooms for update
  to authenticated
  using (
    exists (
      select 1 from public.room_players rp
      where rp.room_code = rooms.room_code
        and rp.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.room_players rp
      where rp.room_code = rooms.room_code
        and rp.user_id = (select auth.uid())
    )
  );

-- Players: users can read players in visible rooms, and write only their own player row.
drop policy if exists "players_select_authenticated" on public.room_players;
create policy "players_select_authenticated"
  on public.room_players for select
  to authenticated
  using (true);

drop policy if exists "players_insert_self" on public.room_players;
create policy "players_insert_self"
  on public.room_players for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "players_update_self" on public.room_players;
create policy "players_update_self"
  on public.room_players for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "players_delete_self" on public.room_players;
create policy "players_delete_self"
  on public.room_players for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Events: users can read room events and insert only their own events.
drop policy if exists "events_select_authenticated" on public.room_events;
create policy "events_select_authenticated"
  on public.room_events for select
  to authenticated
  using (true);

drop policy if exists "events_insert_self" on public.room_events;
create policy "events_insert_self"
  on public.room_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Used cards: users can read used cards and insert only cards they used.
drop policy if exists "used_cards_select_authenticated" on public.room_used_cards;
create policy "used_cards_select_authenticated"
  on public.room_used_cards for select
  to authenticated
  using (true);

drop policy if exists "used_cards_insert_self" on public.room_used_cards;
create policy "used_cards_insert_self"
  on public.room_used_cards for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Enable Postgres Changes Realtime for score updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    execute 'alter publication supabase_realtime add table public.rooms';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_players'
  ) then
    execute 'alter publication supabase_realtime add table public.room_players';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_events'
  ) then
    execute 'alter publication supabase_realtime add table public.room_events';
  end if;
end $$;
