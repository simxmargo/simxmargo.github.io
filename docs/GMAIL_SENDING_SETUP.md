# Gmail sending account — setup

One-time wiring for **Settings → Sending account**. The code is built and deployed-ready;
these are the steps that need *your* Google account and *your* Supabase secrets.

Related: `docs/BACKEND_DESIGN.md` §6 (why a secondary Gmail, the warmup plan, and the
still-to-build `send-one` + `pg_cron` half).

---

## 0. What this connects

The studio needs permission to send mail **as one Gmail account** — the address cold
outreach goes out from. Brands reply to your *Reply-to* address, not this one.

**Use a fresh secondary Gmail, never your main account.** A cold-outreach sender can get
throttled or suspended; you don't want that account to be the one holding your real mail.

---

## 1. Create the Google OAuth app (~5 min)

1. <https://console.cloud.google.com/> → create a project (e.g. `simxmargo-outreach`).
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name / support email / developer email: anything sensible
   - **Scopes:** add `https://www.googleapis.com/auth/gmail.send`
     (`openid` and `email` are added automatically and are non-sensitive)
   - **Test users:** add the secondary Gmail address you'll connect
4. ⚠️ **Publishing status → PUBLISH APP** (it stays *unverified* — that's fine, you just
   click through a warning screen once).

   > **This is the single most important step.** While the app is in *Testing*, Google
   > **expires refresh tokens after 7 days** and you will be reconnecting every week.
   > Publishing (even unverified) makes the token long-lived. `gmail.send` is classified
   > *Sensitive*, not *Restricted*, so an unverified personal app is allowed to use it.

5. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs** → add exactly:

     ```
     https://zzgypushqcpchfxrjexc.supabase.co/functions/v1/gmail-oauth/callback
     ```

     Byte-exact. No trailing slash. Google rejects anything else.
   - Copy the **Client ID** and **Client secret**.

---

## 2. Apply the migration — ✅ ALREADY DONE (2026-07-31)

`gmail_account`, `oauth_states` and the `sending_account_status()` RPC
(`supabase/migrations/0012_sending_account.sql`) are **applied** on
`zzgypushqcpchfxrjexc`. Verified: both tables exist with RLS enabled and **zero
policies** (the intended deny-all), and the seed row `id=1` is present.

Nothing to run. If you ever rebuild the project from scratch, apply that ONE file —
`npm run db:apply` re-runs *every* migration, which is more than you want here.

---

## 3. Set the Edge Function secrets

```bash
npm run sb -- secrets set GMAIL_CLIENT_ID=<client-id> --project-ref zzgypushqcpchfxrjexc
npm run sb -- secrets set GMAIL_CLIENT_SECRET=<client-secret> --project-ref zzgypushqcpchfxrjexc

# optional — puts a "Back to the studio" link on the success page
npm run sb -- secrets set STUDIO_URL=https://simxmargo.github.io/admin --project-ref zzgypushqcpchfxrjexc
```

These never touch the browser bundle. Without them the Connect button answers a calm
503 telling you to set them, rather than failing obscurely.

---

## 4. Deploy the functions

Two functions, and **they do not take the same flags.**

```bash
# The OAuth handshake — the ONE function in the repo that must skip JWT verification.
./node_modules/.bin/supabase functions deploy gmail-oauth \
  --project-ref zzgypushqcpchfxrjexc --use-api --no-verify-jwt

# The sender. Standard flags — it is called from the studio with an admin session.
./node_modules/.bin/supabase functions deploy send-email \
  --project-ref zzgypushqcpchfxrjexc --use-api
```

Google redirects your *browser* to the callback, and a top-level navigation cannot carry
an `Authorization` header — platform JWT verification would reject every successful
consent. Authorization instead lives inside the function:

- every `POST` action runs `requireAdmin()` (`_shared/auth.ts` → `is_admin()`)
- the `GET /callback` must present a **single-use `state`** that only an admin `POST`
  could have minted, consumed atomically and expiring in 10 minutes

(Per `.claude/skills` notes: `npm run sb -- functions deploy` silently no-ops — use the
local binary as above.)

---

## 5. Connect

Studio → **Settings → Sending account → Connect Gmail**. A popup opens Google's consent
screen; approve it (click through the "Google hasn't verified this app" warning →
*Advanced* → *Go to …*). The card flips to **Connected** within a couple of seconds — it
polls the status RPC, so nothing needs to message back across origins.

- **Test** — refreshes an access token to prove the grant is still live. Sends no mail.
  Run it after the first week to confirm step 1.4 took.
- **Disconnect** — revokes the grant at Google and clears the stored token.

---

## 6. Send a test email (the Send Queue is LOCKED until you do)

Settings → Sending account → **Send test email**. It defaults to
`kitdaniellim@gmail.com` and goes through the *same* `send-email` action a brand send
uses — same template, same signature, same Reply-To — so what lands in your inbox is
exactly what a brand receives. Test sends carry no `contactId`, which exempts them
from the daily cap and leaves no contact marked as emailed.

**"Approve & send" in the Send Queue stays disabled until `last_send_at` is set**,
i.e. until one send has actually succeeded. The first message this account ever sends
must not be to a brand: a wrong Reply-To or a broken signature costs nothing to fix on
your own inbox and cannot be retracted from someone else's.

**Preview signature** renders the signature by asking the server for the real thing
(`{ action: 'preview' }`), so the preview cannot drift from what actually ships.

### What to check in the test email

| Check | Should be |
|---|---|
| From | your secondary Gmail, display-named `simxmargo` |
| Reply-To | `simxmargo.collabs@gmail.com` — hit Reply and confirm where it goes |
| Subject | `Collab idea: Sample Brand × simxmargo` (the `×` must not be mojibake) |
| Body | no follower stats, no "reply no thanks" line, the media-kit link present |
| Signature | name, title, email, username, and the site thumbnail image |

---

## Security model

| Thing | Where it lives | Who can read it |
|---|---|---|
| `GMAIL_CLIENT_ID` / `_SECRET` | Edge Function secrets | Functions only |
| Refresh token | `gmail_account.refresh_token` | **Service role only** — the table has RLS enabled with **zero policies**, which is deny-all for `anon` *and* `authenticated` (including you, as the logged-in admin). Table grants are revoked too. |
| Connection status | `sending_account_status()` | The admin, via a `SECURITY DEFINER` RPC that selects an explicit column list **omitting the token** and gates on `is_admin()` |

The browser therefore has no code path that can receive the refresh token — which is
what makes it safe to ship the admin SPA inside a **public** static export.

**Do not add an `admin all` RLS policy to `gmail_account` or `oauth_states`.** Migration
0012 re-drops those policies on every re-apply, on purpose.

---

## Built (2026-07-31)

Sending is **real** — the mocked `markQueuedAsSent` that only flipped local state is
gone. What exists now:

- `supabase/functions/send-email/index.ts` — admin-gated. Refreshes the access token,
  composes `multipart/alternative` (plain text + HTML signature) with `Reply-To:` your
  real address, calls `users.messages.send`, then stamps `gmail_account.last_send_at`
  and the contact's `status='sent'` + `last_emailed_at`. **Bookkeeping happens only
  after Gmail accepts the message.**
- `_shared/gmail.ts` → `buildMime()` + `sendMessage()`. Headers are RFC-2047
  encoded-word (raw UTF-8 in a `Subject:` is illegal and `btoa` throws on the `×` in
  "Mejuri × simxmargo"); base64 body lines wrap at 76.
- `_shared/signature.ts` — the signature, from live profile data. Name/title override
  via `public_profile.content.signature`, image from `seo.og_image_url`.
- **Daily cap enforced server-side** on a rolling 24h window over
  `contacts.last_emailed_at`. The QueuePage meter is a readout, not the control — a
  stale tab or a double-click can't outrun it.

## Still to build (design-only)

- `send_queue` table + `pg_cron` for unattended drip sending. Today the queue is
  session-local and every send is a deliberate click, which is the safer default while
  the account is warming up.
- reply/bounce → `suppression_list`. This matters more than it did: the one-line
  opt-out was removed from the template (see `BACKEND_DESIGN.md` §7), so suppression is
  now the only automated honor-the-removal path.

Start `daily_cap` at ~5/day and ramp to 20 over two weeks (§6d).
