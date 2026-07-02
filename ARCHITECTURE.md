# Architecture

This document describes how the platform is built, how data flows through it,
and — for every feature — exactly what differs between a **solo** user and an
**organisation**. See [`README.md`](./README.md) for setup and
[`FEATURES.md`](./FEATURES.md) for the original solo/org design rationale.

---

## 1. System overview

```
┌─────────────────────────┐        ┌──────────────────────────────────────┐
│  Next.js (App Router)   │  REST  │  Express API (apps/api)               │
│  repo root, port 3000   │◄──────►│  port 3001                            │
│  Tailwind + shadcn/ui   │        │                                        │
└──────────┬───────────────┘        │  ┌────────────┐  ┌─────────────────┐ │
           │ Supabase Auth (JWT)     │  │ Bull queues │  │ Groq LLM client │ │
           ▼                        │  │ (Redis)     │  │ (llama-3.3-70b) │ │
┌─────────────────────────┐        │  └─────┬──────┘  └────────┬────────┘ │
│  Supabase (Postgres)     │◄───────┤        │                  │          │
│  org/auth/integration    │        │        ▼                  ▼          │
│  metadata, RLS-scoped    │        │  Sync + deep-scan     Cypher gen /   │
└─────────────────────────┘        │  workers (6 tools)    answer synth /  │
                                     │        │              fix suggestions│
┌─────────────────────────┐        │        ▼                             │
│  Neo4j (graph DB)        │◄───────┤  Linker worker (confidence-scored    │
│  the "Company Graph"     │        │  edges between everything)           │
└─────────────────────────┘        └──────────────────────────────────────┘
```

Every piece of state in this system belongs to exactly one `orgId`. There is
no separate "solo" schema or "org" schema — solo is simply an organisation
with one member. This is the single most important architectural decision in
the whole platform (see §6).

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui | Lives at the **repo root**, not `apps/web` |
| Backend | Node.js, TypeScript, Express | `apps/api` — the only real workspace package |
| Graph DB | Neo4j (AuraDB or self-hosted) | The "Company Graph" — deployments, PRs, engineers, incidents, and more |
| Relational DB | PostgreSQL via Supabase | Org/auth/integration metadata, RLS-scoped per org |
| Auth | Supabase Auth | Email/password + email verification, JWT bearer tokens |
| AI | Groq (`llama-3.3-70b-versatile`) | Cypher generation, answer synthesis, deep-scan fix suggestions, report summaries |
| Queue | Bull + Redis | Sync jobs, hourly deep-scans, 15-min recurring sync |
| Hosting | Vercel (frontend) / Railway (API + workers) | Per `CLAUDE.md` target deployment |

---

## 3. Repo structure

```
.
├── app/                        # Next.js App Router (frontend, at repo root)
│   ├── (auth)/login/           # Sign in / sign up (solo vs org toggle)
│   ├── (dashboard)/            # Everything behind the sidebar shell
│   │   ├── integrations/       # Connect GitHub/Jira/Datadog/Slack/PagerDuty/Linear
│   │   │   └── team/           # Org-only: invite/manage members
│   │   ├── sync/                # Sync job status
│   │   ├── chat/                 # AI chat
│   │   ├── incidents/[id]/       # Incident list + detail
│   │   ├── insights/             # AI-generated PR risk analysis
│   │   ├── secrets/              # Secret-scanning alert feed
│   │   ├── graph/                # Force-directed graph visualization
│   │   ├── reports/               # Cross-tool health overview
│   │   └── {github,jira,datadog,slack,pagerduty,linear}/report/  # Per-tool deep-scan report
│   ├── onboarding/create-org/   # Explicit org creation (org signup path)
│   ├── join/                    # Invite acceptance
│   └── auth/callback/           # Supabase code exchange (signup verify + OAuth)
├── components/                 # Sidebar, ConnectCard, chat UI, graph canvas, ui/ (shadcn primitives)
├── lib/                         # Supabase client/server wrappers, axios API client
├── apps/api/src/
│   ├── routes/                  # organizations, integrations, sync, chat, incidents, graph, secrets, insights, reports, github
│   ├── workers/                  # 6× sync workers, 6× deep-scan workers, linker, scheduler
│   ├── graph/                    # Neo4j schema (constraints/indexes) + query library
│   ├── ai/                       # Cypher generation, answer synthesis, fix-suggestion, scan-summary prompts
│   ├── integrations/             # Per-provider OAuth/key auth + sync + deep-scan logic
│   └── middleware/                # auth.ts (org resolution), roles.ts (RBAC)
├── packages/shared/              # Shared TypeScript types
└── supabase/schema.sql           # Postgres schema (run manually — no migration tool)
```

---

## 4. Data architecture

### 4.1 PostgreSQL (Supabase) — identity, org, and integration metadata

| Table | Role |
|---|---|
| `organizations` | One row per workspace (solo or org — no distinguishing column) |
| `org_members` | `(org_id, user_id, role)` — role is `owner`/`admin`/`member`. **Row count here is the only thing that distinguishes solo from org at runtime.** |
| `integrations` | One row per `(org_id, provider)` — access/refresh tokens, `extra_data` (site IDs, keys), `sync_counts`. No `user_id` column: a connection is shared by the whole org, never owned by one member. |
| `sync_jobs` | Status/progress log for each sync run, polled by `/sync` |
| `chat_messages` | Per-session conversation history (`session_id`, role, content, cited sources, generated Cypher) |
| `org_invites` | Pending/accepted/revoked invites — token, target email, role, 7-day expiry |
| `github_hourly_reports` | Latest GitHub deep-scan result (repo health, CI failures, secrets, PR issues) |
| `tool_scan_reports` | Latest deep-scan result for Jira/Slack/PagerDuty/Linear/Datadog |
| `issue_acknowledgments` | Audit trail when a team member acknowledges/resolves a scan-found issue |

Every table has Row Level Security enabled, scoped through
`current_user_org_id()` — a Postgres function that resolves the caller's
`org_id` from `org_members`. Writes to sensitive tables (`org_invites`,
integration tokens) go through the service-role API, not directly from the
client.

### 4.2 Neo4j — the Company Graph

**Node labels** (constrained by `(id, orgId)` node key — every query must
filter by `orgId`, enforced by convention in `graph/queries.ts` and by an
allow-list in `assertLabel`/`assertRelType`):

`Deployment`, `PullRequest`, `Engineer`, `Service`, `Incident`, `Bug`,
`Alert`, `SecretAlert` — the original "core graph" from `CLAUDE.md` — plus
`WorkflowRun`, `SecurityIncident`, `Message`, `Issue`, `SprintNode`,
`IncidentChannel`, `Decision`, `AlertMessage`, `OnCallSchedule`, `Cycle`,
`Project`, `SLO` — added as GitHub/Jira/Slack/PagerDuty/Linear/Datadog
"deep-scan" monitoring grew beyond the original 7-node model.

**Core relationships** (see `apps/api/src/ai/prompts.ts` for the full,
authoritative direction reference — direction mistakes are the most common
Cypher-generation bug):

```
(Deployment)-[:INCLUDES]->(PullRequest)
(PullRequest)-[:AUTHORED_BY { role }]->(Engineer)
(Engineer)-[:OWNS { confidence }]->(Service)
(Deployment)-[:DEPLOYED_TO]->(Service)
(Deployment)-[:TRIGGERED { confidence }]->(Incident)
(Incident)-[:LINKED_TO]->(Bug)
(Incident)-[:FIRED]->(Alert)
(PullRequest)-[:CHANGED]->(Service)
(Service)-[:HAS_SECRET_ALERT]->(SecretAlert)
(Engineer)-[:PUSHED_SECRET]->(SecretAlert)
(PullRequest)-[:INTRODUCED_SECRET]->(SecretAlert)
(SecretAlert)-[:POSSIBLY_TRIGGERED { confidence }]->(Incident)
```

All writes go through two primitives in `apps/api/src/graph/queries.ts`:

- `upsertNode(label, id, orgId, props)` — always `MERGE`s on `(id, orgId)`, so
  every sync run is idempotent by construction.
- `createRelationship(fromLabel, fromId, toLabel, toId, relType, orgId, props)`
  — same `MERGE` guarantee for edges.

---

## 5. Backend architecture

### 5.1 Request lifecycle & auth

Every route (except OAuth callbacks) passes through `authMiddleware`
(`apps/api/src/middleware/auth.ts`):

1. Verify the Supabase JWT (or accept the `x-org-id` dev bypass header when no
   Bearer token is present — local dev only).
2. Look up the caller's `org_members` row.
3. **If none exists**, check `org_invites` for a pending invite matching their
   email first (race-condition guard — see §6.3). If none, silently
   auto-provision a brand-new solo org (`role: 'owner'`).
4. Attach `{ id, orgId, role }` to `req.user` and continue.

`requireRole('owner', 'admin')` (`middleware/roles.ts`) gates mutating
actions on top of that — see the RBAC table in §7.

### 5.2 Routes

| Route | Guard | Purpose |
|---|---|---|
| `POST /api/organizations`, `GET /me`, `/invite*`, `/members*` | `requireAuth` / `authMiddleware` + role | Org lifecycle, invites, membership |
| `GET/POST /api/integrations/*` | `authMiddleware` + role for connect | OAuth/key connect flow for 6 providers, status, disconnect |
| `POST /api/sync/start`, `GET /status` | `authMiddleware` + role for start | Manually trigger sync across all connected providers |
| `POST /api/chat`, `GET /history/:sessionId` | `authMiddleware` | Natural-language Q&A over the graph |
| `GET /api/incidents`, `GET /:id` | `authMiddleware` | Incident list + full graph context for one incident |
| `GET /api/insights` | `authMiddleware` | AI risk analysis over recent merged PRs |
| `GET /api/secrets` | `authMiddleware` | Secret-scanning alert feed |
| `GET /api/graph` | `authMiddleware` | Full graph payload for the visualization page |
| `GET /api/reports/overview`, `/:tool`, `POST /issue/:id/acknowledge`, `/resolve` | `authMiddleware` | Cross-tool deep-scan report data |

### 5.3 Workers (Bull + Redis)

Two families of background job, one queue per provider each:

- **Sync workers** (`github`, `jira`, `datadog`, `slack`, `pagerduty`,
  `linear` `.worker.ts`) — pull the provider's core objects (repos, PRs,
  deployments, engineers / bugs, incidents / monitors, alerts / channels,
  messages / pages, schedules / issues, cycles) into the graph via
  `upsertNode`/`createRelationship`. Triggered manually (`POST
  /api/sync/start`) or every 15 minutes by `workers/scheduler.ts`, which skips
  any integration synced within the last 10 minutes.
- **Deep-scan workers** (`*-deep-scan.worker.ts`) — run **hourly** (`cron: '0
  * * * *'`) per connected integration, independent of the core sync. Each
  calls a `runDeepScan()` in `integrations/<provider>/deep-scan.ts` that looks
  for *problems*, not just objects: CI failures, exposed secrets, PR issues,
  and repo health for GitHub; SLA breaches for Jira; unresolved incident
  channels for Slack; unacknowledged pages for PagerDuty; blocked
  issues/at-risk cycles for Linear; prolonged alerts/SLOs-at-risk for
  Datadog. Every found problem is written once via `recordIssue()`
  (`integrations/scan-types.ts`), which also resolves an AI-generated fix
  suggestion — reusing a cached one from a prior scan of the same issue
  instead of re-generating it, so re-scans are cheap and stable.
- **Linker worker** (`linker.worker.ts`) — the only place graph *edges*
  between different tools' data get created, all confidence-scored and
  time-window based:
  - `Deployment -[:TRIGGERED]-> Incident` if the incident started within 90
    minutes of the deploy (`confidence = 1 - gapSeconds/5400`)
  - `Engineer -[:OWNS]-> Service` from PR-authorship frequency
    (`confidence = author's PRs / total PRs on that service`)
  - `Incident -[:LINKED_TO]-> Bug` by Jira-ID substring match
  - `Incident -[:FIRED]-> Alert` within a ±30 minute window
  - `SecretAlert -[:POSSIBLY_TRIGGERED]-> Incident` if the secret was pushed
    within 60 minutes before the incident (`confidence = 1 -
    minutesGap/60`)
  - Runs after every sync (manual or scheduled), for every provider.

### 5.4 AI layer (`apps/api/src/ai/`)

Four distinct AI responsibilities, all via Groq (`llama-3.3-70b-versatile`),
never mixed:

1. **Cypher generation** (`agent.ts` + `CYPHER_GENERATION_PROMPT` in
   `prompts.ts`) — turns a natural-language question into a graph query.
   Always `orgId`-parameterized (never hardcoded), capped at `LIMIT 20`. One
   automatic retry with the failed query + error message as context if the
   first attempt errors.
2. **Answer synthesis** (`buildAnswerSynthesisPrompt(isSolo)`) — turns raw
   graph rows into a cited, human answer. The **only** place solo/org
   phrasing differs (see §6.4): solo gets "you" attribution, org gets
   real names.
3. **Fix suggestions** (`fix-suggestion.ts`) — one-off, cached-per-issue
   suggestion text generated the first time a deep-scan finds a given issue.
4. **Scan summaries** (`scan-summary.ts` / `GITHUB_SUMMARY_SYSTEM_PROMPT`) —
   a short paragraph summarizing a deep-scan run for the reports UI.

---

## 6. Solo vs. organisation: the core architectural rule

**There is no `mode` flag anywhere in the schema.** Every behavioral
difference is derived at request time from one fact: how many rows exist in
`org_members` for the caller's `org_id`.

### 6.1 Signup — where the paths diverge

- `/login?mode=signup` now shows a **"Just me" / "My team"** toggle
  (`app/(auth)/login/page.tsx`).
- **Just me**: `emailRedirectTo` points at `/integrations`. The first
  authenticated request there (`GET /api/integrations/status`, guarded by
  `authMiddleware`) auto-provisions a solo org named after the user's email
  domain — silently, no form.
- **My team**: `emailRedirectTo` points at `/onboarding/create-org` instead —
  a route with zero `authMiddleware`-guarded calls on it, so nothing can
  auto-provision a solo org before the user names their workspace via `POST
  /api/organizations`. This ordering is load-bearing: hitting any
  `authMiddleware` route before creating the named org would 409 the create
  call (`"You already belong to an organisation"`).

### 6.2 Growing from solo → org

Nothing is irreversible: a solo owner can invite teammates from
`/integrations/team` at any time (the link is visible once `role === 'owner'`
even with `memberCount === 1`). The moment a second member accepts, every
"solo" behavior below (chat phrasing, hidden Team nav) flips automatically —
there's no migration step.

### 6.3 Invite race-condition guard

If an invited-but-not-yet-joined user's browser fires any authenticated
request before they click their invite link (e.g. a background poll),
`authMiddleware` checks `org_invites` for a pending match on their email
*before* auto-provisioning, and returns `403 { error: 'pending_invite',
token, orgName, role }` instead of creating an orphan solo org. The frontend
uses this to redirect them to `/join?token=...`.

### 6.4 Runtime differences, feature by feature

| Feature | Solo (`org_members` = 1) | Organisation (`org_members` ≥ 2) |
|---|---|---|
| **Signup** | Default path, lands on `/integrations` | "My team" toggle → `/onboarding/create-org` first |
| **Integrations** | Connects personal accounts; sole owner passes every `requireRole` check | Owner/admin connect shared, company-wide tokens once; `member` role is read-only here |
| **Sync** | Same code path, same workers | Same code path, same workers |
| **AI Chat** | `countEngineers()` returns 1 → prompt uses **"you"** ("You changed the rate limiter logic") | 2+ engineers → prompt uses **real names/GitHub logins** ("PR #421 was authored by Alice Chen...") |
| **Chat suggestions** | Solo-flavored ("Why did *my* last deployment fail?") | Org-flavored ("Who was assigned to recent incidents?") |
| **Incidents / Insights / Secrets / Graph / Reports** | Identical pages and data model — just fewer engineers in the results | Identical pages and data model |
| **Team nav link** | Hidden unless the viewer is owner/admin | Shown once `memberCount >= 2` or viewer is owner/admin |
| **Roles** | Irrelevant — the one member is always `owner` | Enforced via `requireRole()`: owner/admin connect/sync/invite/remove; member is chat/incidents/team-list read-only |
| **Invites** | Not applicable until teammates are added | `/integrations/team` — owner/admin generate copy-link invites (no email delivery yet), track pending/accepted/revoked |

The only genuinely org-specific *pages* are `/onboarding/create-org`,
`/join`, and `/integrations/team`. Every other route — `/chat`, `/incidents`,
`/insights`, `/secrets`, `/graph`, `/reports` and its six per-tool report
pages, `/sync` — is the exact same code and UI for both, differing only in
the data returned for that `orgId`.

---

## 7. Role-based access control

Enforced server-side by `requireRole(...allowed)` in
`apps/api/src/middleware/roles.ts`, never trusted from the client.

| Action | owner | admin | member |
|---|:---:|:---:|:---:|
| Connect/disconnect any integration | ✓ | ✓ | ✗ |
| Trigger manual sync | ✓ | ✓ | ✗ |
| Invite teammates | ✓ | ✓ | ✗ |
| Remove members | ✓ | ✗ | ✗ |
| View team list | ✓ | ✓ | ✓ |
| Use `/chat`, `/incidents`, `/insights`, `/secrets`, `/graph`, `/reports` | ✓ | ✓ | ✓ |

OAuth `*/callback` routes are intentionally left unguarded — they're hit
unauthenticated by the provider's own redirect after the `/connect` step
already checked the role.

---

## 8. Frontend architecture

- **App Router groups**: `(auth)` for unauthenticated screens, `(dashboard)`
  for everything behind the sidebar shell, plus top-level `onboarding/`,
  `join/`, and `auth/callback/` for flows that intentionally sit outside the
  dashboard chrome.
- **Design system**: shadcn/ui (`components.json`, `new-york` style, `zinc`
  base) with a dark-first Linear/Vercel-inspired theme defined in
  `app/globals.css` (indigo primary, near-black background, subtle borders).
  Primitives live in `components/ui/`; every page composes them rather than
  hand-rolling styled `<div>`s.
- **`components/Sidebar.tsx`** is the single source of truth for nav — it
  polls `GET /api/organizations/me` for role/member-count-gated links (Team)
  and `GET /api/secrets` / `GET /api/reports/overview` for alert-count
  badges.
- **`lib/api.ts`** is the one axios instance every page uses; its request
  interceptor attaches the Supabase session's access token as a Bearer
  header (or the dev `x-org-id` header when no session exists, for local
  testing against the API directly).

---

## 9. Data flow walkthroughs

**Connecting a tool → asking a question:**

```
/integrations → OAuth or API-key connect → integrations row (org-scoped)
   → POST /api/sync/start → per-provider sync worker → upsertNode/createRelationship (MERGE)
   → linker worker → confidence-scored edges (TRIGGERED, OWNS, LINKED_TO, FIRED, POSSIBLY_TRIGGERED)
   → /chat → generateCypher(question) → runQuery(cypher, { orgId }) → synthesizeAnswer(isSolo)
   → cited answer + source chips, persisted to chat_messages
```

**Continuous monitoring (independent of the above):**

```
workers/scheduler.ts (every 15 min) → re-sync each connected integration → linker
*-deep-scan.worker.ts (hourly, per tool) → runDeepScan() → recordIssue() (Issue/SecurityIncident nodes + cached fix suggestion)
   → tool_scan_reports / github_hourly_reports → /reports overview + per-tool report pages
```
