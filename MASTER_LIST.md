# FinderSeek — Master Reference

> Internal reference for how FinderSeek works and how to run it.
> **Not for public eyes** — keep this out of the deployed site (see §15).
> Last updated: **July 17, 2026**. Keep this current as the app changes.

---

## 1. What FinderSeek is

A location-based treasure-hunt app. **Quest Masters** hide a physical envelope containing a **6-digit PIN**, fund a cash prize, and the app generates AI clues that lead **Seekers** to the hiding spot. The first person to find the envelope enters the PIN to claim the prize. It's framed as a skill-based contest: seekers don't pay to play; only creators fund prizes.

- Live site / brand: **finderseek.com**
- Support contact: **mike@finderseek.com**

---

## 2. Architecture & stack

- **iOS app = Capacitor wrapper that loads the LIVE site remotely.** The native app is essentially a WKWebView browsing the real, verified `finderseek.com`. This is the single most important fact about the architecture — it means most changes are just web deploys (see §3), and browser features like Apple Pay behave as they do in Safari.
- **Front end:** static HTML pages in the repo root (no framework). Each page is self-contained HTML + inline CSS + inline JS.
- **Back end:** Vercel serverless functions in `api/` (Node, ES-module `export default handler` style).
- **Database / auth / storage:** **Supabase** (Postgres + Auth + Storage).
- **Payments:** **PayPal** (escrow model) + **Apple Pay on the Web** + card.
- **AI clues:** **Anthropic API** (`/api/generate-clues`).
- **Clue voice/audio:** **OpenAI TTS** (`/api/tts`), stored in Supabase Storage.
- **Email:** **Resend** (via `/api/notify`).
- **Maps:** **Google Maps** (Places autocomplete, static maps, geocoding).
- **Hosting:** **Vercel (Pro).** Current app build: **v1.1 build 3** (live on the App Store).

---

## 3. Dev & deploy workflow

- Changes are shipped as **complete files**. Drop each file into the right place, then deploy:
  - **Pages** (`index.html`, `newquest.html`, `quest.html`, `admin.html`, …) → **repo root**
  - **Server code** → **`api/`**
  - Deploy: **`npx vercel --prod`**
- **Web files deploy instantly to the app** (because the app loads the live site) — no App Store review, no rebuild.
- **Only** changes to `ios/` or `capacitor.config.json` require an **Xcode rebuild + a new App Store submission.** Everything we do on the web side avoids that entirely.
- Repo lives at `~/Documents/GitHub/finderseek`.

---

## 4. Pages (repo root)

- **`index.html`** — Home / browse. Lists quests in Active / Scheduled / Completed sections, a live map, stats strip. Has pull-to-refresh (pull down → dark-gray "well" + spinner → re-runs `loadQuests()`). Browse cards use the "spine + panel" design: a status-colored left spine (green = active, amber = scheduled, grey = completed) with a status dot, the quest ID as a monospace chip, and a solid panel behind the text for legibility.
- **`newquest.html`** — Quest creation (5-step flow, see §7).
- **`quest.html`** — Seeker view of a single quest (clues, map, PIN entry to claim).
- **`profile.html`** — User profile / their quests.
- **`admin.html`** — Admin command center (see §10).
- **`how-it-works.html`**, **`terms.html`** — Static info pages.
- **`auth-callback.html`** — OAuth redirect landing (Apple/Google sign-in return).

---

## 5. Server endpoints (`api/`)

The ones currently in use (there may be more — treat this as the working set):

- **`admin-login.js`** — Verifies the admin password against `ADMIN_PASSWORD`, returns a signed token `admin.<expiresAt>.<HMAC>` (HMAC-SHA256 over the payload with `ADMIN_TOKEN_SECRET`, valid 24h).
- **`admin-codes.js`** — Returns `{ id: finder_code }` for all hunts. Reads the locked-down `finder_code` column with the **service-role key**, gated behind the same admin token. This is what makes the admin CODE column work.
- **`notify.js`** — Sends transactional emails (Resend). Verifies an admin token via the `x-admin-token` header for admin-triggered events.
- **`payout-request.js`** — Handles winner payouts. Tries the PayPal Payouts API first; falls back to a manual ops email. Authorizes a payout only with one of three DB-checked proofs (env secret / winner JWT / correct PIN), locks the first valid payout, and writes an audit row for every decision.
- **`create-checkout.js`** — Creates a PayPal order for a quest's prize + fee.
- **`paypal-capture.js`** — Captures an approved PayPal order, activates the quest, assigns its human `quest_id`.
- **`paypal-client-id.js`** — Returns the PayPal client ID to the front end.
- **`generate-clues.js`** — Generates the clue set + location riddle from the hiding-spot data (Anthropic).
- **`tts.js`** — Generates clue audio (OpenAI), writes the audio URL back to the row with the service key.

---

## 6. Data model (Supabase)

Field lists below are the ones the app reads/writes; there may be additional columns. **Do not** expose `finder_code` or `hiding_spot` to the client (see §12).

**`hunts`** — the core quest table:
`id`, `quest_id` (human ID, e.g. `TXA-0013`), `status` (`draft` / `active` / `scheduled` / `ended` / `cancelled`), `prize_desc`, `prize_value` (cents), `starts_at`, `ends_at`, `quest_tz`, `city`, `state_code`, `neighborhood`, `lat`, `lng`, `photo_url`, `finder_code` (**the 6-digit PIN — LOCKED DOWN**), `hiding_spot` (**LOCKED DOWN**), `clue_persona`, `clue_count`, `location_riddle`, `location_riddle_audio_url`, `winner_id`, `found_at`, `pirate_id`, `created_by`, `payment_type` (`finderseek` / `escrow` / `honor`), `escrow_status` (`pending` / `funded` / `paid` / `refunded`), `escrow_amount`, `payment_handle`, `winner_payout_method`, `winner_payout_handle`, `payout_method`, `payout_note`, `payout_status` (`processing` / `sent`), `payout_destination`, `payout_at`, `paid_at`, `is_pinned`, `is_promoted`.

**`clues`**:
`id`, `hunt_id`, `clue_number`, `tier` (`free` / `pro`), `reveal_at`, `clue_text`, `clue_question`, `clue_answer`, `is_photo`, `photo_url`, `is_finder`, `audio_url`.

**`profiles`**:
`id`, `username`, `email`, `city`, `is_pro`, `pro_expires`, `is_banned`, `admin_note`, `created_at`.

**`settings`** — a key/value store. Known keys: `listing_start_hour`, `listing_end_hour` (the daily window during which quests may be created), `max_hunts_per_city`, and `note_*` entries (admin notes).

**`payout_audit`** — one row per payout decision: `id`, `created_at`, `hunt_id`, `quest_id`, `winner_id`, `proof_type`, `outcome` (`sent` / `processing` / `rejected` / `duplicate` / `no_winner` / `error`), `destination`, `amount`, `method`, `batch_id`, `error_msg`, `ip`. There's also a convenience view **`payout_log`** (CT timezone, trimmed columns, newest first) for easy reading.

Access control: Supabase uses **column-level grants**. `finder_code` and `hiding_spot` are **revoked from the `anon` and `authenticated` roles**, so they can never be read by the app or website — only by server endpoints using the service-role key.

---

## 7. User flows

### Creating a quest (Quest Master) — `newquest.html`, 5 steps
1. **Hide it:** generate a 6-digit PIN + take a photo of the hiding spot (both required).
2. **Prize & clues:** pick a prize ($10–$100) and clue count (4 / 5 / 6).
3. **Style:** pick a clue persona (pirate, poetic, insults, sarcastic, hillbilly, 5-yr-old, grandma, surfer, detective) with a voice preview.
4. **Hiding-spot details:** set the exact location on a full-screen map, describe the exact spot + a starting point, and enter a hint / action / Q&A per clue. AI then generates the clues and shows a preview.
5. **Schedule:** choose a window (Mon–Tue, Wed–Fri, Weekend, or a custom date range) → **sign-in gate (Apple / Google)** → **payment**.

Key design points:
- **Sign-in is gated at the schedule step**, not at the start. Users build the whole quest first, then sign in only when it's time to pay. (Early login caused abandonment; late login used to lose work — both are now solved.)
- The **draft hunt row is created server-side before payment** (`status: 'draft'`, `escrow_status: 'pending'`), so nothing is lost if the user drops off.
- **Draft persistence:** the in-progress form is saved to `localStorage` (`fs_newquest_form`) and stamped with `fs_draft_owner` (the user id, or `'anon'`). The draft is only wiped when it belongs to a **different signed-in user** — a returning user, or a guest who signs in to fund their own quest, keeps their PIN/photo/prize/clues.

### Playing a quest (Seeker) — `quest.html`
Seekers open a quest, read the AI clues, answer the per-clue questions to unlock progress, and use the map/photo to find the envelope.

### Winning & getting paid
The finder enters the 6-digit PIN → they become the `winner_id` and submit their preferred payout method + handle. Payout then happens via §9.

---

## 8. Payments (funding a quest)

- **Escrow model:** the creator pays **prize + 10% fee** via PayPal.
- The payment sheet (`newquest.html`) offers **PayPal**, **Apple Pay**, and **card**.
- **Apple Pay works both in the native app and in Safari** — because the app loads the verified `finderseek.com`, Apple Pay on the Web behaves exactly as it does in Safari. (See the "do not break" list — this depends on the domain-association file.)
- Flow: `create-checkout` (make PayPal order) → user approves → `paypal-capture` (capture + activate quest + assign `quest_id`) → PIN card shown to the creator → clue **TTS generated after payment** (non-blocking).
- **Fallback polling:** iOS PayPal/Venmo callbacks sometimes don't fire, so the modal also polls the hunt's `escrow_status` for `funded` for ~2 minutes and completes the flow if it flips.

---

## 9. Payouts (paying the winner)

- **Currently manual.** PayPal denied the Payouts API, so `payout-request.js` tries the API, and when it can't, sends an **ops email** telling you to send the prize by hand. (Reapply for PayPal Payouts later to automate — the code already tries the API first, so automation "just works" once approved.)
- **Security:** a payout is authorized only with one of three DB-checked proofs — the env secret (admin), the winner's JWT, or the correct PIN. The body's `winnerId` is not trusted; the recipient is resolved from the hunt's `winner_id`. The first valid payout locks the hunt (duplicate attempts get a 409).
- **Audit:** every decision writes a row to `payout_audit` (see the `payout_log` view to read it easily).
- **In practice:** you pay winners from the **Payouts tab** in the admin panel (see §10).

---

## 10. Admin panel — how to run the app (`admin.html`)

**Login:** open `admin.html`, enter the admin password. It's verified server-side (`/api/admin-login`) and you get a 24-hour token. No password is stored in the page.

**Tabs:**
- **Draft** — quests awaiting review. Actions per quest: **Approve**, **Schedule**, **Reject**, **Preview**.
- **Active** — live quests. **Delete**, **View**.
- **Scheduled** — quests set to go live later.
- **Ended** — completed/expired quests.
- **Cancelled** — rejected quests.
- **Payouts** — quests that are funded and awaiting payout (`payout_status: processing`). Each shows a **Pay Winner** button → a modal with the winner's preferred payout method + handle. Send the prize, then confirm.
- **Profiles** — all users. You can add an admin note per user.
- **Settings** — `listing_start_hour` / `listing_end_hour` (the daily window when quests can be created), `max_hunts_per_city`, plus free-form admin notes.

**The CODE column** on each quest card shows the 6-digit PIN. It's fetched via `/api/admin-codes` (service-key endpoint) because the PIN is locked down from the normal client key. If it ever shows `——`, see §12 / §13.

**Auto-refresh:** the panel re-syncs every 30s while you're logged in.

---

## 11. Environment variables (Vercel)

Set in Vercel → Settings → Environment Variables. Names marked *(verify)* are the likely name but confirm against your actual config.

- **`ADMIN_PASSWORD`** — the admin panel password.
- **`ADMIN_TOKEN_SECRET`** — secret used to sign/verify admin tokens (used by `admin-login.js` and `admin-codes.js`).
- **`NOTIFY_SECRET`** — server-to-server secret for notify/payout auth. *(Rotated July 2026.)*
- **Supabase service-role key** — used by `admin-codes.js`, `payout-request.js`, `tts.js`, etc. `admin-codes.js` looks for `SUPABASE_SERVICE_ROLE_KEY`, then `SUPABASE_SERVICE_KEY`, then `SERVICE_ROLE_KEY`. **Confirm which name your project actually uses** — if the admin CODE column shows `——`, this is the first thing to check.
- **`ANTHROPIC_API_KEY`** — clue generation.
- **OpenAI API key** *(verify: `OPENAI_API_KEY`)* — TTS.
- **PayPal client ID + secret** *(verify names)* — payments; the client ID is also served to the front end via `paypal-client-id.js`.
- **Resend API key** *(verify: `RESEND_API_KEY`)* — email.
- Supabase project URL (`https://qeiuycuasjkopxfkmggp.supabase.co`) and the **anon** key are embedded in the client HTML (that's fine — the anon key is public by design and is restricted by column grants + RLS).

---

## 12. Security notes

- **`finder_code` (the prize PIN) and `hiding_spot` are revoked from the `anon`/`authenticated` Postgres roles.** They can only be read server-side with the service-role key. Never re-grant these to client roles or select them from client code — doing so leaks the PIN that claims the prize. The admin panel reads them only through the token-gated `/api/admin-codes` endpoint.
- **Admin auth** is an HMAC token (`admin.<expiresAt>.<HMAC over ADMIN_TOKEN_SECRET>`), 24h expiry, verified server-side on every privileged endpoint. Keep new admin/service endpoints behind the same check and make them **fail closed** (401 on any doubt).
- **Payout authorization** requires a real proof (secret / winner JWT / PIN) and is idempotent (first valid payout wins). See §9.
- The service-role key must **never** appear in client code — only in `api/` functions.

---

## 13. Critical "do not break" list

- **Never delete, rename, move, or edit** `/.well-known/apple-developer-merchantid-domain-association`. It verifies the domain for Apple Pay. Removing or altering it **silently breaks Apple Pay in both the app and Safari.** (A `READ-ME-DO-NOT-DELETE-APPLE-PAY.txt` sits next to it as a warning. The association file itself must contain **only** Apple's exact token — you can't put notes inside it.)
- **Don't re-grant `finder_code` / `hiding_spot`** to client roles (see §12).
- **Don't select `finder_code` from client code** — it will 400 the whole query (permission denied) and blank the page. Read it only via the service-key endpoint.
- Web deploys are instant and don't need App Store review — but that also means a bad web deploy hits the live app immediately. There's no review buffer.

---

## 14. Backlog / not yet done

- **Native "Sign in with Apple" sheet** — the current Apple sign-in is a web OAuth flow inside the webview. It works in the shipped (already-approved) binary, but Apple **requires** the native `AuthenticationServices` sheet before you submit **a new native binary** (they previously rejected the web version). Do this — plus migrating Google sign-in off `@codetrix-studio` to a maintained plugin — only when you're actually preparing a new binary.
- **Reapply for the PayPal Payouts API** to automate winner payouts (currently manual).
- **Trivial cleanup:** an inaccurate Apple Pay comment in `newquest.html` (around line 3707) says `ApplePaySession` is undefined in the app webview — it isn't; Apple Pay works in-app. It's just a stale comment, harmless. Also mark any "Route A / SFSafariViewController hand-off" doc as **superseded** (in-app Apple Pay already works directly, so that plan is moot).

---

## 15. Protecting this file (important)

Because your HTML pages are served from the repo, a Markdown file in the root can be served too — i.e. this file could end up public at `finderseek.com/MASTER_LIST.md`, exposing admin and security details. To prevent that, keep it in the repo but **out of the deploy**:

- Add it (and the continuation prompt, and anything sensitive in `docs/`) to **`.vercelignore`** so Vercel never uploads/serves it. A ready-made `.vercelignore` is included alongside this file — if you already have one, just add these lines to it instead of replacing it.
- After your next deploy, sanity-check by visiting `https://finderseek.com/MASTER_LIST.md` — it should return **404**. (While you're at it, check `https://finderseek.com/docs/payout_audit.sql` too.)
