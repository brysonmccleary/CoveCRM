# Meta (Facebook) Native Lead Webhook — Setup Checklist

## Environment Variables

Add these to `.env.local` (and Vercel production env):

```env
# Meta OAuth App credentials (from Meta for Developers → Your App → Settings → Basic)
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret

# System User token (long-lived, from Meta Business Suite → System Users)
# Used as fallback for Graph API calls when user token not available
META_SYSTEM_USER_TOKEN=your_system_user_access_token

# Webhook verify token — must match what you enter in Meta webhook setup
# Current value: covecrm-fb-verify-2026
FB_WEBHOOK_VERIFY_TOKEN=covecrm-fb-verify-2026

# Page access token (optional fallback — prefer OAuth flow)
FB_PAGE_ACCESS_TOKEN=get_this_from_facebook_developer_portal

# OAuth redirect (must match Allowed Redirect URIs in Meta App settings)
NEXT_PUBLIC_BASE_URL=https://www.covecrm.com
# Callback route: https://www.covecrm.com/api/meta/callback
```

---

## Meta Developer Dashboard

1. **Create / open your Meta App** at [developers.facebook.com](https://developers.facebook.com)
2. Set App Type to **Business**
3. Under **Settings → Basic**:
   - Copy App ID → `META_APP_ID`
   - Copy App Secret → `META_APP_SECRET`
4. Add these to **Valid OAuth Redirect URIs** (under Facebook Login → Settings):
   ```
   https://www.covecrm.com/api/meta/callback
   ```
5. Under **Permissions and Features**, add and request approval for:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_read_engagement`
   - `pages_show_list`
   - `leads_retrieval`
6. Under **Webhooks** (left sidebar):
   - Select object type: **Page**
   - Click **Subscribe to this object**
   - Callback URL: `https://www.covecrm.com/api/meta/webhook`
   - Verify Token: `covecrm-fb-verify-2026`
   - Click **Verify and Save**
   - Subscribe to field: **leadgen**

---

## Meta Business Suite

1. Go to [business.facebook.com](https://business.facebook.com)
2. **System Users** (under Business Settings → Users → System Users):
   - Create a System User with Admin role
   - Generate a token with these scopes: `ads_management`, `ads_read`, `business_management`, `leads_retrieval`, `pages_read_engagement`
   - Copy token → `META_SYSTEM_USER_TOKEN`
3. **Page Webhook Subscription** (Settings → Advanced → Subscribed Apps):
   - Ensure your Meta App is subscribed to leadgen events on each agent's page

---

## Per-Agent OAuth Flow

Each agent connects their own Meta account:

1. Agent goes to **Facebook Lead Manager → Meta Connection → Connect Meta Account**
2. They are redirected to `/api/meta/connect` → Meta OAuth
3. After authorization, callback at `/api/meta/callback`:
   - Short-lived token exchanged for long-lived token (60-day expiry)
   - Token + pageId saved to `User` model
4. Agent selects their **Facebook Page** and **Ad Account** in the Meta Connection panel
5. Leads automatically flow into CRM when form is submitted

---

## Testing Steps

### Test 1: Webhook Verification (GET)
```bash
curl "https://www.covecrm.com/api/meta/webhook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=covecrm-fb-verify-2026"
# Expected response: test123
```

### Test 2: Webhook Lead Delivery (POST)
Use the Admin panel → **Meta Diagnostics** tab → **Test Meta Webhook**:
- Enter agent email, a valid leadgen ID from Meta, and the page ID
- Click **Run Test**
- Check that a new Lead is created in the agent's CRM

### Test 3: OAuth Flow
1. Click **Connect Meta Account** in the Meta Connection panel
2. Authorize all requested permissions
3. Verify redirect returns to `/facebook-leads?meta=connected`
4. Verify User model has `metaAccessToken`, `metaPageId` saved

### Test 4: Ad Insights Sync
1. Agent has `metaAdAccountId` set
2. Click **Sync Ad Data Now** in Meta Connection panel
3. Verify `AdMetricsDaily` documents are created in MongoDB
4. Check Attribution report in FB Ads Manager reflects the synced data

---

## Production Deployment (Vercel)

1. Add all env vars to Vercel project settings (Settings → Environment Variables)
2. Ensure `NEXTAUTH_URL` is `https://www.covecrm.com`
3. Add cron job for `sync-meta-insights`:
   - In `vercel.json`:
     ```json
     {
       "crons": [
         {
           "path": "/api/cron/sync-meta-insights",
           "schedule": "0 6 * * *"
         }
       ]
     }
     ```
   - Or use Vercel Cron (Pro plan) — runs daily at 6:00 AM UTC
4. Verify webhook delivery in **Meta for Developers → Webhooks → Recent Deliveries**

---

## Webhook HMAC Signature (Security)

All incoming POST requests from Meta are verified with HMAC-SHA256:

- Header: `X-Hub-Signature-256: sha256=<hmac>`
- Secret: `META_APP_SECRET`
- Implementation: `pages/api/meta/webhook.ts` uses `crypto.timingSafeEqual`
- The webhook always returns **200** to Meta even on processing errors (to avoid retry storms)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook verification fails | Check `FB_WEBHOOK_VERIFY_TOKEN` matches exactly |
| Leads not appearing | Check Meta App is subscribed to `leadgen` on the correct Page |
| "Lead not found" from Graph API | System user token may lack `leads_retrieval` permission |
| Token expired | Agent re-connects via Connect Meta Account button |
| Sync returns 0 results | Verify `metaAdAccountId` is set on User (check Meta Connection panel) |
| HMAC mismatch | Ensure `META_APP_SECRET` matches the app generating webhooks |
