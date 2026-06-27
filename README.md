# Guesscue

Guesscue is a category-based, browser-first word guessing game inspired by taboo-style party games. It is built with React + Vite and designed for GitHub Pages static hosting.

## Features

- React + Vite app
- GitHub Pages friendly static build
- Light and dark theme
- Turkish card packs
- English WIP placeholders
- JSON-based category data under `public/data/{language}/{category}.json`
- 8 Turkish categories; Movie/Series, Games, Geography, and History/Mythology have 200 reviewed cards each
- Remote mode: everyone plays from their own device
- Shared device mode: 2-8 teams on one device
- Preset, custom, or infinite rounds
- Round-based pass rights, default 3 per round
- Correct +1, Taboo -1, Pass 0
- Optional seed/game code support
- Optional Supabase live room mode
- Realtime score publishing when Supabase is configured
- Supabase live lobby, turn order, presence heartbeat, and disconnect-safe active player list
- Category cards show live card counts on the setup screen

## Categories

- Movie / Series
- Games
- General
- Geography
- Professions
- Animals
- Gen Z Slang
- History and Mythology

## Install

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## GitHub Pages

If your repository is published at `https://USERNAME.github.io/guesscue/`, create `.env.local` locally:

```env
VITE_BASE_PATH=/guesscue/
```

Then build:

```bash
npm run build
```

You can deploy the `dist` folder through GitHub Pages or use your own deployment flow.

## Supabase live rooms

Supabase is optional. The app works without Supabase.

Create `.env.local` locally. Do not commit it.

```env
VITE_BASE_PATH=/guesscue/
VITE_SUPABASE_ENABLED=true
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_or_publishable_key
```

The browser app must use the Supabase anon/publishable key, not the `service_role` key. The anon key is intended for client-side apps and respects Row Level Security. The `service_role` key bypasses RLS and must never be committed or bundled into frontend code.

### Supabase setup checklist

1. Create a Supabase project.
2. Go to Authentication > Providers and enable Anonymous Sign-ins.
3. Open SQL Editor and run `supabase.schema.sql` from this repo.
4. Open `.env.local` locally and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Restart the Vite dev server.

`supabase.schema.sql` creates:

- `rooms`
- `room_players`
- `room_events`
- `room_used_cards`

It also enables RLS policies and Realtime publication for score updates.

## Important public repo safety

The following files are ignored by Git:

- `.env`
- `.env.*`
- `node_modules/`
- `dist/`

Only `.env.example` is committed.

Never commit:

- Supabase `service_role` keys
- database connection strings with passwords
- service account JSON files
- Gemini/OpenAI API keys
- any paid API secrets

## Card schema

```json
{
  "id": "tr-movie-series-0001",
  "answer": "Breaking Bad",
  "forbidden": ["Walter White", "Jesse", "Heisenberg", "kimya", "meth"],
  "category": "movie-series",
  "type": "series",
  "difficulty": 1,
  "language": "tr"
}
```

`difficulty` is currently stored for future filtering but not shown as a setup option.

## Data editing

Edit card packs directly in:

```text
public/data/tr/*.json
```

Keep every card ID unique within its category.

## Live room lobby and turn order

When Supabase live rooms are enabled, the setup button opens a lobby instead of immediately starting the game. The host creates the room, shares the room code, waits for players to join, and then starts the game from the lobby.

Live room flow:

1. Host chooses settings and creates the room.
2. Other players join with the room code.
3. Joined players inherit the host settings.
4. Host starts the game from the lobby.
5. Every round, each player gets one narrator turn in lobby join order.
6. Non-narrators see a waiting / guessing screen until the narrator finishes the turn.
7. The round number only advances after every room player has taken their narrator turn.

If you created the Supabase tables with an older Guesscue version, run the current `supabase.schema.sql` again in SQL Editor. It adds the `rooms.state` and `room_players.last_seen` columns and updates policies for live turn synchronization/presence.

Presence behavior:

- Active clients update `last_seen` every 10 seconds.
- Leaving the lobby/game marks the player as disconnected.
- Abruptly closed tabs are removed from the active turn list after roughly 35 seconds.
- In live rooms, only the host or the current narrator can advance to the next narrator turn.

## Latest live-room/card notes

- Live rooms now share `room_used_cards` across all players. The currently visible card is also marked as used when a turn ends, so the next narrator/turn starts from a fresh available card.
- If you already created the Supabase schema before this update, re-run `supabase.schema.sql` in Supabase SQL Editor so `room_used_cards` is included in realtime publications.
- Category counts are loaded dynamically from the JSON files. The full distribution audit is available in `card_distribution_summary.json`.
