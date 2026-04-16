# FinderSeek — Security Hardening Setup

## What changed

The admin panel and API endpoints have been hardened against credential exposure:

### Before
- `ADMIN_PASS = 'finderseek2026'` was hardcoded in `admin.html` source — visible to anyone viewing the page HTML
- `NOTIFY_SECRET = 'fs-notify-2026'` was hardcoded in multiple frontend files — visible in source
- Password check was done entirely client-side (trivial to bypass)

### After
- Admin password is checked server-side via `/api/admin-login`
- Login returns a signed token (HMAC-SHA256) valid for 24 hours
- Token is stored in `localStorage` and sent on every admin request via `x-admin-token` header
- `/api/notify` now accepts the admin token as an alternative to the notify secret
- Expired tokens auto-force re-login

## Required environment variables

Add these to your Vercel env vars (Project Settings → Environment Variables):

### `ADMIN_PASSWORD`
The actual admin password. **Change this from the old "finderseek2026" value** — since the old one has been in your repo, assume it's compromised.

Pick something strong, e.g.:
```
Kx9$mPq2!vNc#wLrZ8&jHtY4
```

### `ADMIN_TOKEN_SECRET`
A random 32+ character string used to sign admin tokens. This must NEVER be shared or committed.

Generate one with:
```bash
# In any terminal:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
or use an online secret generator for 64 hex chars.

## After deploying

1. **Visit `/admin.html`** → enter your new password → you should get a dashboard.
2. If you get "Server not configured" → env vars aren't set yet, add them and redeploy.
3. If you get "Invalid password" → double-check `ADMIN_PASSWORD` matches exactly (no trailing whitespace).

## Lingering concerns

- **`NOTIFY_SECRET` is still in the frontend** (`pirate.html`, `pricing.html`, `newquest.html`, `profile.html`, `gold.html`, `quest.html`). This is a shared secret for user-triggered actions (checkout, payouts). Since it's used by regular users' browsers, moving it fully server-side requires migrating auth to Supabase JWT verification on every API endpoint.
- **Short-term fix**: rotate the secret value periodically. Update `NOTIFY_SECRET` in Vercel env, then search-replace in all HTML files.
- **Proper long-term fix**: update each API endpoint to verify the user's Supabase JWT from the `Authorization` header instead of checking a shared secret. This is a bigger refactor but eliminates the shared-secret problem entirely.

## Test checklist

- [ ] Old password `finderseek2026` no longer works
- [ ] New `ADMIN_PASSWORD` logs in successfully
- [ ] Dashboard loads data after login
- [ ] Admin actions (ban, pay, schedule) still work
- [ ] Email notifications still fire when admin approves quests
- [ ] View page source on `admin.html` — no password visible
