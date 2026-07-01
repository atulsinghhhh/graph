# AI Incident Investigation Platform

An AI-powered platform that reasons over a graph of your engineering data —
deployments, pull requests, engineers, services, incidents, bugs, and alerts —
to answer questions like *"Why did checkout fail yesterday?"* with a real,
cited answer instead of hours of digging through GitHub, Jira, and Datadog.

The same codebase serves two kinds of users:

- **Solo developers** — connect your own GitHub/Jira/Datadog, get answers
  about your own code and incidents.
- **Organisations** — one owner connects shared company tools once, every
  invited teammate shares the same graph, and answers name who caused what.

See [`FEATURES.md`](./FEATURES.md) for how solo vs. org mode works.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Backend | Node.js, TypeScript, Express |
| Graph DB | Neo4j (AuraDB or self-hosted) |
| Relational DB | PostgreSQL via Supabase (org/auth/integration metadata) |
| AI | Groq (`llama-3.3-70b-versatile`) for Cypher generation + answer synthesis |
| Queue | Bull + Redis (sync jobs, recurring 15-min sync) |
| Auth | Supabase Auth |

## Repo structure

The Next.js frontend lives at the **repo root**, not in `apps/web` — only the
Express API is a real workspace package.

```
.
├── app/                       # Next.js App Router pages
│   ├── (auth)/login/          # Sign in / sign up
│   ├── (dashboard)/           # Integrations, sync, chat, incidents, team
│   ├── onboarding/create-org/ # Explicit org creation
│   ├── join/                  # Invite acceptance
│   └── auth/callback/         # Supabase magic-link/OAuth code exchange
├── components/                # Shared React components (Sidebar, ConnectCard, chat UI)
├── lib/                       # Supabase client/server wrappers, axios API client
├── apps/
│   └── api/                   # Express backend
│       └── src/
│           ├── routes/        # organizations, integrations, sync, chat, incidents, graph, secrets, insights
│           ├── workers/       # github/jira/datadog sync workers, linker, 15-min scheduler
│           ├── graph/         # Neo4j schema + query library
│           ├── ai/            # Cypher generation + answer synthesis prompts/agent
│           ├── integrations/  # Provider-specific OAuth + sync logic
│           └── middleware/    # auth, role-based access control
├── packages/shared/           # Shared TypeScript types
└── supabase/schema.sql        # Postgres schema (run manually in Supabase SQL Editor)
```

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` (repo root) and `apps/api/.env`, and fill in:
   - Supabase project URL + service role key
   - Neo4j connection URI/credentials
   - Redis URL
   - GitHub OAuth app + Jira OAuth 2.0 app credentials
   - `GROQ_API_KEY` (used by `apps/api/src/ai/agent.ts` for Cypher generation and answer synthesis)
3. Run the Postgres schema manually: open the Supabase SQL Editor and execute
   `supabase/schema.sql` top to bottom. There is no migration tool — this file
   is the single source of truth and must be re-run (safe, uses
   `CREATE TABLE IF NOT EXISTS`) whenever it changes.
4. Start both apps:
   ```
   npm run dev
   ```
   This runs the Next.js frontend on `:3000` and the Express API on `:3001`
   concurrently.

## Health check

```
GET http://localhost:3001/health
```
Returns connection status for Neo4j, Postgres, and Redis.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run frontend + API together |
| `npm run dev:web` | Frontend only |
| `npm run dev:api` | API only |
| `npm run build` | Build all workspaces via Turbo |
| `npm run lint` | Lint all workspaces via Turbo |



Solo Developer Workflow

1. Sign up — user goes to /login, signs up with email/password, verifies via the magic-link email.
2. Silent org creation — the moment their first authenticated API call hits apps/api/src/middleware/auth.ts, it finds no org_members row and silently creates one organizations row + one org_members row with role: 'owner'. No form, no prompt — the user never sees this happen.
3. Connect tools — lands on /integrations, connects their own personal GitHub, Jira, Datadog. Since they're the sole owner, requireRole('owner','admin') passes on all connect actions.
4. Sync — /sync triggers POST /api/sync/start, pulling their repos/PRs/deployments/bugs/alerts into the graph, then linker.worker.ts builds TRIGGERED/OWNS/LINKED_TO edges. After that, a 15-minute Bull job keeps it fresh automatically.
5. Ask questions — in /chat, they see solo-flavored suggestions ("Why did my last deployment fail?"). Because countEngineers() finds exactly 1 Engineer node in their graph, the AI prompt switches to "you" phrasing — "You changed the rate limiter logic" instead of naming them.
6. Nav stays minimal — Sidebar.tsx checks GET /api/organizations/me; with memberCount === 1 and no admin-worthy reason to show it, the "Team" link stays hidden.

Organisation Workflow                                                                                
1. Owner creates a workspace explicitly — instead of falling into the silent solo path, the owner    visits /onboarding/create-org and canaming the company workspace onpurpose.                                                                                             2. Connect company-wide tools — ownera workspace, Datadog org keys on/integrations. These live on the integrations table with no user_id — one shared token for the whole org.
3. Invite teammates — owner/admin opens /integrations/team, enters an email + role, hits POST          /api/organizations/invite. This writa random token and returns a/join?token=... link (copy-link only right now — no email provider wired up), shown with a "Copy link" button.
4. Invitee joins:
  - Not signed in → /join shows "Siggh /login?next=/join?token=... →signup/magic-link → /auth/callback → back to /join.
  - Signed in → POST /api/organizatiatically, adds them to org_memberswith the invited role, marks the invite accepted.
  - Race condition guard: if this saes any other authenticated API callbefore clicking the invite, authMiddleware checks org_invites for a pending match on their email first
and returns 403 pending_invite insteolo org for them.
5. Immediate access — new member lands on /integrations with everything already connected (shared org
tokens), can use /chat and /incident
6. Roles enforce what they can do — per requireRole() in apps/api/src/middleware/roles.ts: owner/admin
can connect tools, trigger sync, inve members; plain member can only view/chat, /incidents, and the team list (read-only, no invite/remove buttons rendered).
7. Richer AI answers — with 2+ EnginI prompt switches to real-nameattribution: "PR #421 was authored by Alice Chen... Rollback PR #430 by Bob Kim resolved it."
8. Nav shows "Team" — once memberCouer/admin), Sidebar surfaces the/integrations/team link for managing members and invites.

The only thing distinguishing the two paths at runtime is the row count in org_members — everything else (/chat, /incidents, /sync, /intcode and pages for both.