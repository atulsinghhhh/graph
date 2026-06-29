# AI Incident Investigation Platform — Claude Code Instructions

You are my senior full-stack engineer and technical co-founder.

Your responsibility is to build this product end-to-end following this specification.

Do not just explain architecture.
Do not generate pseudo-code.
Implement real production-quality code.

Before writing any code:

1. Read this entire document.
2. Inspect the existing repository structure.
3. Identify what already exists.
4. Create an implementation checklist.
5. Explain the plan for the current phase only.

Do not skip phases.
Do not implement future phases early.

---

# Product

We are building an AI-powered Incident Investigation Platform.

The problem:

When production breaks, engineers waste hours searching:

* GitHub
* Jira
* Datadog
* Slack
* AWS

to answer:

* What happened?
* Why did it happen?
* Which code caused it?
* Who owns the fix?
* Which customers are affected?

The solution:

Create a Company Graph:

Deployment
↓
Pull Request
↓
Engineer
↓
Service
↓
Incident
↓
Bug
↓
Alert

The AI agent reasons over this graph.

---

# First Demo Goal

A user asks:

"Why did checkout fail yesterday?"

The system answers:

"Deployment v1.4.2 at 14:32 triggered the incident.

PR #421 created by Alice changed payment validation logic.

The affected service was checkout-api.

Confidence: 87%.

Rollback PR #430 resolved the issue."

Every answer must reference real graph data.

---

# Engineering Rules

Follow these permanently:

* Never invent data.
* Never create fake integrations.
* Never skip error handling.
* Never expose secrets.
* Never store tokens in frontend.
* Every database operation must support multi-tenancy.
* Every Neo4j query requires orgId filtering.
* Every graph write must use MERGE.
* Every sync operation must be idempotent.
* Every external API call requires retry/error handling.

---

# Tech Stack

- Frontend: Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Backend: Node.js, TypeScript, Express
- Graph DB: Neo4j AuraDB
- Relational DB: PostgreSQL (via Supabase)
- AI: Anthropic Claude API (claude-sonnet-4-6)
- Queue: Bull + Redis
- Auth: Supabase Auth
- Hosting: Vercel (frontend), Railway (backend + workers)

---

# Implementation Process

For every phase:

1. Explain what will be built.
2. Create/update files.
3. Run tests.
4. Explain what was completed.
5. Show remaining tasks.

Do not continue to the next phase until the current phase works.

---

# Phase Execution Order

## Phase 1 — Project Foundation
Setup:

Frontend:

* Next.js 16
* TypeScript
* Tailwind
* shadcn/ui

Backend:

* Node.js
* TypeScript
* Express

Infrastructure:

* Neo4j connection
* PostgreSQL connection
* Redis connection

Create:

* Environment files
* Config loaders
* Health check API

Health endpoint:

GET /health

Response:

{
  "status": "ok",
  "services": {
    "neo4j": "connected",
    "postgres": "connected",
    "redis": "connected"
  }
}

## Phase 2 — Database Schema

* PostgreSQL schema via Supabase (organizations, integrations, sync_jobs, chat_messages)
* Neo4j graph schema (nodes: Deployment, PullRequest, Engineer, Service, Incident, Bug, Alert)
* Neo4j constraints and indexes
* Cypher query library (upsertNode, createRelationship, getIncidentContext)

## Phase 3 — GitHub Integration

* GitHub OAuth app setup
* OAuth callback route
* Sync worker: repos, PRs, deployments, engineers
* Bull queue for async sync jobs

## Phase 4 — Jira Integration

* Jira OAuth 2.0 (Atlassian)
* Sync worker: bugs, incidents, assignees

## Phase 5 — Datadog Integration

* API key + App key auth
* Sync worker: monitors/alerts
* Link alerts to deployments by time proximity

## Phase 6 — Linker Worker

* TRIGGERED edges: deployment → incident (time proximity, confidence score)
* OWNS edges: engineer → service (PR commit frequency)
* LINKED_TO edges: Jira bugs → incidents (ID matching)

## Phase 7 — AI Agent

* Cypher generation from natural language
* Query execution with one retry on error
* Natural language answer synthesis with source citations
* Conversation history support

## Phase 8 — Frontend

* Login page (Supabase magic link)
* Integrations page (connect GitHub, Jira, Datadog)
* Sync status page (real-time polling)
* AI chat page (conversation UI with source cards)

## Phase 9 — Demo Polish

* Seed script for demo data
* Suggested questions
* End-to-end demo flow

---



```
incident-platform/
├── apps/
│   ├── web/                        # Next.js frontend
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   └── layout.tsx
│   │   │   ├── (dashboard)/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── integrations/page.tsx
│   │   │   │   ├── sync/page.tsx
│   │   │   │   ├── chat/page.tsx
│   │   │   │   └── incidents/
│   │   │   │       ├── page.tsx
│   │   │   │       └── [id]/page.tsx
│   │   │   └── api/
│   │   │       └── auth/[...supabase]/route.ts
│   │   ├── components/
│   │   │   ├── ui/                 # shadcn components
│   │   │   ├── chat/
│   │   │   │   ├── ChatWindow.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   └── SourceCard.tsx
│   │   │   ├── integrations/
│   │   │   │   └── ConnectCard.tsx
│   │   │   └── incidents/
│   │   │       └── Timeline.tsx
│   │   └── lib/
│   │       ├── supabase/
│   │       │   ├── client.ts
│   │       │   └── server.ts
│   │       └── api.ts
│   │
│   └── api/                        # Express backend
│       ├── src/
│       │   ├── index.ts
│       │   ├── config/
│       │   │   ├── neo4j.ts
│       │   │   ├── postgres.ts
│       │   │   └── redis.ts
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── integrations.ts
│       │   │   ├── sync.ts
│       │   │   ├── chat.ts
│       │   │   └── incidents.ts
│       │   ├── workers/
│       │   │   ├── github.worker.ts
│       │   │   ├── jira.worker.ts
│       │   │   ├── datadog.worker.ts
│       │   │   └── linker.worker.ts
│       │   ├── graph/
│       │   │   ├── schema.ts
│       │   │   ├── queries.ts
│       │   │   └── linker.ts
│       │   ├── ai/
│       │   │   ├── agent.ts
│       │   │   ├── prompts.ts
│       │   │   └── cypher-gen.ts
│       │   └── integrations/
│       │       ├── github/
│       │       ├── jira/
│       │       └── datadog/
│       └── package.json
│
├── packages/
│   └── shared/
│       └── src/
│           └── types.ts
│
├── package.json
├── turbo.json
└── .env.example
```

---

# Important

Start only with Phase 1.

Do not build:

* GitHub integration
* Jira integration
* Datadog integration
* AI agent
* Frontend pages

until Phase 1 is complete.

---

Before coding Phase 1:

Reply exactly:

"Ready. Starting Phase 1 — monorepo setup."

Then begin implementation.
