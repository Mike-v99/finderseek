// ============================================================
//  finderseeek-db.js
//  Drop-in Supabase data layer for the FinderSeek React app.
//
//  SETUP:
//    npm install @supabase/supabase-js
//
//  Add to your environment (e.g. .env or Vite config):
//    VITE_SUPABASE_URL=https://xxxx.supabase.co
//    VITE_SUPABASE_ANON_KEY=eyJhbGci...
// ============================================================

import { createClient } from '@supabase/supabase-js';

// ── Client ──────────────────────────────────────────────────
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: true,
  },
});

// ── Helpers ─────────────────────────────────────────────────
function raise(label, error) {
  console.error(`[FinderSeek/${label}]`, error);
  throw error;
}

// ============================================================
//  AUTH
// ============================================================

/** Sign up with email + password, setting username in metadata */
export async function signUpEmail(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) raise('signUpEmail', error);
  return data;
}

/** Log in with email + password */
export async function signInEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) raise('signInEmail', error);
  return data;
}

/** Sign in with Google OAuth */
export async function signInGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) raise('signInGoogle', error);
  return data;
}

/** Sign in with Apple OAuth */
export async function signInApple() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) raise('signInApple', error);
  return data;
}

/** Send SMS OTP (requires Supabase Phone Auth to be enabled) */
export async function signInPhone(phone) {
  const { data, error } = await supabase.auth.signInWithOtp({ phone });
  if (error) raise('signInPhone', error);
  return data;
}

/** Verify SMS OTP */
export async function verifyPhoneOtp(phone, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });
  if (error) raise('verifyPhoneOtp', error);
  return data;
}

/** Log out */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) raise('signOut', error);
}

/** Get current session (null if not logged in) */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/** Subscribe to auth state changes */
export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe(); // returns cleanup fn
}


// ============================================================
//  PROFILES
// ============================================================

/** Fetch profile for a user id */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) raise('getProfile', error);
  return data;
}

/** Update own profile (username, city) */
export async function updateProfile(userId, updates) {
  const allowed = ['username', 'city'];
  const safe = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await supabase
    .from('profiles')
    .update(safe)
    .eq('id', userId)
    .select()
    .single();
  if (error) raise('updateProfile', error);
  return data;
}

/** Check if current user is Pro (and subscription hasn't expired) */
export function isProfilePro(profile) {
  if (!profile?.is_pro) return false;
  if (!profile.pro_expires) return true;               // no expiry = lifetime/active
  return new Date(profile.pro_expires) > new Date();
}


// ============================================================
//  HUNTS + CLUES
// ============================================================

/**
 * Fetch the active hunt with all its clues.
 * RLS ensures free clues are always returned but pro clues
 * are only returned if the caller is a Pro member.
 * Client-side: filter by reveal_at <= now() to show/hide clues.
 */
export async function fetchActiveHunt() {
  const { data, error } = await supabase
    .from('active_hunt')           // view defined in schema.sql
    .select('*');
  if (error) raise('fetchActiveHunt', error);
  if (!data || data.length === 0) return null;

  // Reshape flat rows → { hunt, clues[] }
  const first = data[0];
  const hunt = {
    id:         first.hunt_id,
    weekOf:     first.week_label,
    prize:      first.prize_desc,
    prizeValue: first.prize_value,
    startsAt:   new Date(first.starts_at),
    endsAt:     new Date(first.ends_at),
    status:     first.status,
    city:       first.city,
    winnerId:   first.winner_id,
    foundAt:    first.found_at ? new Date(first.found_at) : null,
  };
  const clues = data.map(row => ({
    id:        row.clue_id,
    huntId:    row.hunt_id,
    id:        row.clue_number,          // keep numeric id for UI compat
    day:       row.day_label,
    date:      row.date_label,
    tier:      row.tier,
    revealAt:  new Date(row.reveal_at),
    text:      row.clue_text ?? '',
    isPhoto:   row.is_photo,
    photoUrl:  row.photo_url ?? null,
  }));

  return { hunt, clues };
}

/**
 * Subscribe to real-time clue reveals for the active hunt.
 * Fires callback({ hunt, clues }) when any clue row changes.
 * Usage:
 *   const unsub = subscribeHuntClues(huntId, data => setHunt(data));
 *   // later: unsub();
 */
export function subscribeHuntClues(huntId, onChange) {
  const channel = supabase
    .channel(`hunt-clues-${huntId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'clues', filter: `hunt_id=eq.${huntId}` },
      async () => {
        const data = await fetchActiveHunt();
        if (data) onChange(data);
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}


// ============================================================
//  FIND REPORTS (claim a find)
// ============================================================

/**
 * Submit a find report. Uploads optional proof photo to Supabase Storage.
 * Returns the created report row.
 */
export async function submitFindReport(huntId, userId, { photoFile, note } = {}) {
  let photoUrl = null;

  // Upload proof photo if provided
  if (photoFile) {
    const ext  = photoFile.name.split('.').pop();
    const path = `find-reports/${huntId}/${userId}-${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('finderseeek-assets')
      .upload(path, photoFile, { upsert: false });
    if (uploadErr) raise('submitFindReport/upload', uploadErr);
    const { data: urlData } = supabase.storage
      .from('finderseeek-assets')
      .getPublicUrl(path);
    photoUrl = urlData.publicUrl;
  }

  const { data, error } = await supabase
    .from('find_reports')
    .insert({ hunt_id: huntId, user_id: userId, photo_url: photoUrl, note })
    .select()
    .single();
  if (error) raise('submitFindReport', error);
  return data;
}


// ============================================================
//  LEADERBOARD
// ============================================================

/** Fetch top N hunters from the leaderboard view */
export async function fetchLeaderboard(limit = 20) {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('rank', { ascending: true })
    .limit(limit);
  if (error) raise('fetchLeaderboard', error);
  return data ?? [];
}


// ============================================================
//  ADMIN HELPERS  (call these with the service-role key only,
//  never expose service_role key in the frontend)
// ============================================================

/**
 * Publish a new hunt + clues.
 * Call from a secure server function / Edge Function, NOT from the browser.
 *
 * huntsRow:  { week_label, prize_desc, prize_value, starts_at, ends_at, city }
 * cluesRows: [{ clue_number, tier, day_label, date_label, reveal_at, clue_text, is_photo, photo_url }]
 */
export async function adminPublishHunt(serviceRoleClient, huntsRow, cluesRows) {
  // Insert hunt
  const { data: hunt, error: huntErr } = await serviceRoleClient
    .from('hunts')
    .insert({ ...huntsRow, status: 'active' })
    .select()
    .single();
  if (huntErr) raise('adminPublishHunt/hunt', huntErr);

  // Insert clues
  const clueInserts = cluesRows.map(c => ({ ...c, hunt_id: hunt.id }));
  const { error: clueErr } = await serviceRoleClient
    .from('clues')
    .insert(clueInserts);
  if (clueErr) raise('adminPublishHunt/clues', clueErr);

  return hunt;
}

/**
 * Mark a hunt as ended and record the winner.
 * Call from a secure server function / Edge Function.
 */
export async function adminEndHunt(serviceRoleClient, huntId, winnerId) {
  const now = new Date().toISOString();

  // Update hunt
  const { error: huntErr } = await serviceRoleClient
    .from('hunts')
    .update({ status: 'ended', winner_id: winnerId, found_at: now })
    .eq('id', huntId);
  if (huntErr) raise('adminEndHunt/hunt', huntErr);

  // Increment winner's find count
  const { error: profErr } = await serviceRoleClient.rpc('increment_finds', {
    user_id: winnerId,
  });
  if (profErr) raise('adminEndHunt/profile', profErr);
}
