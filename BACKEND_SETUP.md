# FinderSeek — Supabase Backend Setup Guide

## What this gives you

| Feature | How it works |
|---|---|
| **Hunt & clues persist** | Admin publishes once via the app; stored in Postgres |
| **Daily 8 AM reveals** | `reveal_at` timestamp on each clue; client filters `reveal_at <= now()` |
| **User accounts** | Supabase Auth (email, Google, Apple, SMS) |
| **Pro status** | `is_pro` + `pro_expires` columns on `profiles` |
| **RLS security** | Free clues visible to all; pro clues only for pro members |
| **Real-time updates** | Clue changes push instantly via Supabase Realtime |

---

## Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name it `finderseeek`, pick a region close to your city, set a password
3. Wait ~2 minutes for provisioning

---

## Step 2 — Run the schema

1. In your project dashboard → **SQL Editor** → **New Query**
2. Paste the full contents of `schema.sql` and click **Run**
3. You should see: tables `profiles`, `hunts`, `clues`, `find_reports`; views `leaderboard`, `active_hunt`

---

## Step 3 — Enable Auth providers

Go to **Authentication → Providers**:

### Email
- Already enabled by default
- Optionally: enable "Confirm email" (recommended for production)

### Google
1. Enable Google provider
2. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
3. Create OAuth 2.0 Client ID (Web application)
4. Add Authorized redirect URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
5. Paste Client ID + Secret into Supabase

### Apple
1. Enable Apple provider
2. Requires an Apple Developer account ($99/yr)
3. Create a Services ID at [developer.apple.com](https://developer.apple.com)
4. Configure Sign In with Apple, add your Supabase callback URL
5. Paste Service ID + Key ID + Private Key into Supabase

### Phone (SMS)
1. Enable Phone provider
2. Connect a Twilio account (or use Supabase's built-in SMS for testing)
3. Add your Twilio Account SID, Auth Token, and phone number

---

## Step 4 — Create Storage bucket

1. **Storage** → **New Bucket**
2. Name: `finderseeek-assets`
3. Public: **Yes** (for clue photos and find-report photos)
4. Add this RLS policy to allow authenticated users to upload:

```sql
-- Allow authenticated users to upload to find-reports folder
create policy "reports_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'finderseeek-assets'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = 'find-reports'
  );

-- Allow service role to upload clue photos
create policy "clues_upload_service"
  on storage.objects for insert
  using (auth.role() = 'service_role');

-- Public read for all assets
create policy "assets_public_read"
  on storage.objects for select
  using (bucket_id = 'finderseeek-assets');
```

---

## Step 5 — Add environment variables

In your project root, create `.env` (or `.env.local` for Vite):

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Find these in: **Settings → API → Project URL** and **anon public** key.

⚠️ **Never commit the service_role key to git.** It's only for server-side admin functions.

---

## Step 6 — Install the Supabase client

```bash
npm install @supabase/supabase-js
```

---

## Step 7 — Wire the data layer into the app

Copy `finderseeek-db.js` into your `src/` folder. Then update `treasure-hunt.jsx`:

```jsx
// At the top of treasure-hunt.jsx, add:
import {
  supabase,
  fetchActiveHunt,
  subscribeHuntClues,
  fetchLeaderboard,
  onAuthChange,
  getProfile,
  signUpEmail, signInEmail,
  signInGoogle, signInApple,
  signInPhone, verifyPhoneOtp,
  signOut,
  updateProfile,
  submitFindReport,
  isProfilePro,
} from './finderseeek-db';

// Replace the DEFAULT_HUNT hardcoded state with:
const [hunt, setHunt] = useState(null);   // null until loaded
const [loading, setLoading] = useState(true);

useEffect(() => {
  // Load hunt on mount
  fetchActiveHunt().then(data => {
    if (data) setHunt(data.hunt);   // ← shapes match existing UI
    setLoading(false);
  });

  // Listen for auth changes (login/logout)
  const unsub = onAuthChange(async (event, session) => {
    if (session?.user) {
      const profile = await getProfile(session.user.id);
      setUser(profile);
      setIsPro(isProfilePro(profile));
    } else {
      setUser(null);
      setIsPro(false);
    }
  });

  return unsub;
}, []);

// Subscribe to real-time clue updates when hunt loads
useEffect(() => {
  if (!hunt?.id) return;
  const unsub = subscribeHuntClues(hunt.id, ({ hunt: h }) => setHunt(h));
  return unsub;
}, [hunt?.id]);
```

---

## Step 8 — Replace auth handlers

In the auth screens, replace the `setTimeout` simulations with real calls:

```jsx
// AuthEmail — replace submit():
const submit = async () => {
  try {
    if (isLogin) {
      await signInEmail(email, password);
    } else {
      await signUpEmail(email, password, email.split('@')[0]);
    }
    // onAuthChange listener above will handle updating user state
  } catch (err) {
    setErrors({ general: err.message });
  }
};

// AuthPhone — replace sendCode():
const sendCode = async () => {
  await signInPhone(phone);
  setStep('code');
};

// AuthPhone — replace verifyCode():
const verifyCode = async () => {
  await verifyPhoneOtp(phone, code);
};

// AuthSocial — replace useEffect:
useEffect(() => {
  if (provider === 'google') signInGoogle();
  if (provider === 'apple')  signInApple();
}, []);

// AccountMenu — replace onLogout:
const handleLogout = async () => {
  await signOut();
  onLogout();
};
```

---

## Step 9 — Publish your first hunt

You have two options:

### Option A — From the Admin Panel in the app
The Admin Panel already calls `onPublish`. Wire it to `adminPublishHunt` via a Supabase Edge Function (keeps service_role key off the client).

### Option B — Direct SQL (fastest for testing)
Edit the seed block at the bottom of `schema.sql`, replace `<hunt_id>` with a real UUID, uncomment, and run it in the SQL Editor.

---

## Step 10 — Set up the increment_finds function

The `adminEndHunt` helper calls a Postgres function. Add this in SQL Editor:

```sql
create or replace function public.increment_finds(user_id uuid)
returns void language sql security definer as $$
  update public.profiles
  set finds_count = finds_count + 1,
      updated_at  = now()
  where id = user_id;
$$;
```

---

## How clue reveals work (no cron needed)

The `reveal_at` column stores the exact UTC timestamp for each clue's unlock.

The app already has this logic:
```js
const isRevealed = (clue, now) => now >= new Date(clue.reveal_at);
```

RLS on the `clues` table also enforces this server-side — even if someone calls the API directly, pro clues are only returned after `reveal_at` and only for pro members.

**No cron job needed.** Reveals are purely time-based checks.

---

## Database schema overview

```
auth.users (Supabase managed)
    │
    └── profiles          id, username, city, is_pro, pro_expires, finds_count
            │
hunts       └── (winner_id FK)
    │         id, week_label, prize_desc, starts_at, ends_at, status
    │
    └── clues             id, hunt_id, clue_number, tier, reveal_at, clue_text, photo_url
    │
    └── find_reports      id, hunt_id, user_id, photo_url, status

Views:
    active_hunt           → joins hunts + clues for the current active hunt
    leaderboard           → profiles ranked by finds_count
```

---

## Local development

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Pull remote schema to local
supabase db pull

# Run locally (optional)
supabase start   # spins up local Postgres + Auth on localhost
```
