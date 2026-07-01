# Solo vs. Organisation Mode

One codebase, two experiences. There is no mode flag anywhere — the UI and
the AI adapt purely based on how many rows exist in `org_members` for the
current org.

- **Solo**: `org_members` has 1 row → the AI says "you", there's no team
  management UI, sync/connect is unrestricted (you're the owner).
- **Org**: `org_members` has 2+ rows → the AI names engineers by name, a
  "Team" page appears in the nav, and role-based permissions apply.

---

## How a user ends up in each mode

### Solo (silent, no form)

1. User signs up at `/login` and verifies their email.
2. The first authenticated API request hits `apps/api/src/middleware/auth.ts`,
   finds no `org_members` row, and **silently** creates one `organizations`
   row + one `org_members` row with `role: 'owner'`.
3. User lands on `/integrations`, connects their own GitHub/Jira/Datadog,
   syncs, and starts asking questions in `/chat`.

Nothing about this path changed — it was already correct.

### Organisation (explicit, invite-based)

1. An owner can go to `/onboarding/create-org` and `POST /api/organizations`
   to create a workspace intentionally (used when someone wants to set up a
   company workspace rather than fall into the silent solo path).
2. The owner connects **company-wide** GitHub/Jira/Datadog on `/integrations`
   — these tokens live on the `integrations` row (no `user_id` column: one
   connection is shared by the whole org).
3. The owner (or an admin) opens `/integrations/team`, enters a teammate's
   email + role, and calls `POST /api/organizations/invite`. This creates a
   row in `org_invites` and returns a link:
   `{FRONTEND_URL}/join?token=...`. **There is no email provider wired up
   yet** — the link is shown with a "Copy link" button for the owner to share
   manually (Slack, email, however). See "Follow-ups" below.
4. The invitee opens `/join?token=...`:
   - Not signed in → prompted to sign in/sign up, then routed back to `/join`
     with the same token (via the `next` query param, which now flows through
     signup → magic-link → `/auth/callback` → back to `/join`).
   - Signed in → `POST /api/organizations/invite/accept` is called
     automatically, adding them to `org_members` with the invited role and
     marking the invite `accepted`.
5. From then on, every API call for that user resolves to the org they
   joined — tools are already connected, `/chat` and `/incidents` work
   immediately.

### The race condition this closes

Previously, `authMiddleware` auto-created a new solo org for **any**
authenticated user with no `org_members` row — including someone who had
just been invited but hadn't clicked their invite link yet (e.g. a
background poll from the Sidebar). Now, before auto-creating, it checks
`org_invites` for a pending invite matching the user's email. If one exists,
it returns `403 { error: 'pending_invite', token, orgName, role }` instead of
creating an orphan org, so the invited user can only ever end up in the org
they were actually invited to.

---

## Role permissions

Enforced server-side by `requireRole(...)` in `apps/api/src/middleware/roles.ts`.

| Action | owner | admin | member |
|---|---|---|---|
| Connect/disconnect integrations | ✓ | ✓ | ✗ |
| Trigger manual sync | ✓ | ✓ | ✗ |
| Invite teammates | ✓ | ✓ | ✗ |
| Remove members | ✓ | ✗ | ✗ |
| View team list | ✓ | ✓ | ✓ |
| Use `/chat`, view `/incidents` | ✓ | ✓ | ✓ |

Guarded routes: `GET /api/integrations/*/connect`, `POST /api/integrations/datadog/connect`,
`POST /api/sync/start`, `POST /api/organizations/invite`, `GET /api/organizations/invites`,
`POST /api/organizations/invite/:id/revoke`, `DELETE /api/organizations/members/:id`.
OAuth `*/callback` routes are intentionally left unguarded — they're hit
unauthenticated by GitHub/Jira's own redirect after the `/connect` step
already checked the role.

---

## New API surface — `apps/api/src/routes/organizations.ts`

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/organizations/me` | any authenticated user | `{ hasOrg, orgId, orgName, role, memberCount, isSolo, pendingInvite }` — powers nav gating, chat suggestions, and the login-time invite check |
| `POST /api/organizations` | any authenticated user, no existing org | Create an org + owner membership |
| `POST /api/organizations/invite` | owner/admin | Create an invite, return the join link |
| `GET /api/organizations/invites` | owner/admin | List pending invites |
| `POST /api/organizations/invite/:id/revoke` | owner/admin | Revoke a pending invite |
| `POST /api/organizations/invite/accept` | any authenticated user | Accept an invite by token |
| `GET /api/organizations/members` | any org member | List members with email + role |
| `DELETE /api/organizations/members/:id` | owner | Remove a member (not self) |

## New pages

- `app/onboarding/create-org/page.tsx` — explicit org creation form.
- `app/join/page.tsx` — public invite-acceptance page.
- `app/(dashboard)/integrations/team/page.tsx` — member list, invite form, pending invites (owner/admin only see invite/revoke controls).

## AI behavior

`apps/api/src/ai/agent.ts` computes the number of `Engineer` nodes in the
org's graph (`countEngineers` in `apps/api/src/graph/queries.ts`) alongside
Cypher generation. `apps/api/src/ai/prompts.ts` builds the answer-synthesis
prompt differently depending on the result:

- **1 engineer (solo)**: "refer to them as 'you' ... never say 'the developer'."
- **2+ engineers (org)**: "always use the engineer's real name or GitHub login ... never say 'the developer'."

`/chat`'s empty-state suggested questions are also solo/org-specific,
switching on `GET /api/organizations/me`'s `isSolo` flag.

## Schema change — manual step required

`supabase/schema.sql` gained an `org_invites` table (id, org_id, email, role,
token, invited_by, status, expires_at) plus indexes and an RLS select policy.
**This must be run manually in the Supabase SQL Editor** — there is no
migration tooling in this project, and it will not apply itself.

## Recurring sync

`apps/api/src/workers/scheduler.ts` registers a Bull repeatable job every 15
minutes that re-triggers sync for every `connected` integration (skipping any
synced within the last 10 minutes), reusing the existing
`triggerGitHubSync`/`triggerJiraSync`/`triggerDatadogSync` functions so the
linker worker still runs afterward exactly as it does for a manual sync.

## Known follow-ups (explicitly out of scope for this change)

- **Invite delivery is copy-link only.** No email provider (Resend, SendGrid,
  etc.) is wired up. `POST /api/organizations/invite` returns the link in
  its response; adding real email delivery is a separate, deliberate choice
  (provider, deliverability, pricing).
- **Sync is not truly incremental.** The scheduler skips integrations synced
  recently, but `syncGitHub`/`syncJira`/`syncDatadog` still pull a fixed
  recent window on every run rather than filtering by `last_synced_at`.
  Safe (writes use `MERGE`), just not bandwidth-optimal.
