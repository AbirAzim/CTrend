# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

## Commands

```bash
# Development
npm run start:dev        # Watch mode with hot reload
npm run start:debug      # Debug mode with hot reload

# Build & Production
npm run build            # Compile to dist/
npm run start:prod       # Run compiled output (node dist/main)

# Testing
npm test                 # Run all unit tests (rootDir: src, *.spec.ts)
npm run test:watch       # Watch mode
npm run test:cov         # With coverage report
npm run test:e2e         # End-to-end tests (test/jest-e2e.json)

# Single test file
npx jest src/posts/posts.service.spec.ts

# Code quality
npm run lint             # ESLint with auto-fix
npm run format           # Prettier format
```

The server starts on port `4000` by default (`PORT` env var overrides it).
- GraphQL playground: `http://localhost:4000/graphql` (disabled in production)
- Stripe webhook endpoint: `POST http://localhost:4000/webhooks/stripe`

## Architecture

CTrend is a **NestJS + GraphQL + MongoDB** API (code-first schema). It is the backend for a social voting platform where users create comparison posts and vote on options.

### Module Structure

Each domain is a self-contained NestJS module under `src/`:

| Module | Responsibility |
|--------|---------------|
| `auth` | JWT auth, Google OAuth, register/login resolvers |
| `users` | User CRUD, profile, `toGql()` serialization |
| `posts` | Post creation (user/org/system types), `toGql()` with live vote stats |
| `votes` | Cast/change votes, per-option stats, `getStats()` + `getMyVoteIndex()` |
| `comments` | Threaded comments on posts |
| `feed` | Feed query with scope (global/personalized) and sort (trending/latest/admin_priority) |
| `categories` | Predefined categories; posts must reference one |
| `organizations` | Org profiles, ownership, global post quota tracking |
| `follows` | Follow/unfollow users; used by feed for personalization |
| `billing` | Stripe checkout sessions, webhook handling, bKash stub, subscription records |
| `seed` | Dev-only dummy data seeder |

### Authentication Flow

JWT is resolved at the GraphQL context level in `app.module.ts`, not per-resolver. The `GraphQLModule` factory verifies the Bearer token (from HTTP header or WebSocket `connectionParams`) and attaches the user to `req.user`. Guards then read from there:

- `GqlAuthGuard` — requires a valid JWT (throws if missing)
- `OptionalJwtGqlGuard` — attaches user if token present, allows unauthenticated
- `RolesGuard` — checks `user.role` against `@Roles()` decorator
- `GqlThrottlerGuard` — rate limiting (120 req/60s), applied globally via `APP_GUARD`

### Post Types & Visibility

Three post types are defined in `src/common/enums.ts`:

- `USER` — regular user posts, can be `PUBLIC` or `PRIVATE`
- `ORG` — organization posts; reach is `CONNECTED` (free) or `GLOBAL` (premium, capped at 20/month)
- `SYSTEM` — admin-only, highest feed priority (`feedPriority: 100`), likes disabled

### Feed Logic (`src/feed/feed.service.ts`)

The feed `buildFilter()` constructs a MongoDB `$or` query based on scope:

- **GLOBAL** — system posts + public user posts + global org posts
- **PERSONALIZED** — adds: viewer's own posts, posts matching user interest categories, private posts from followed users, connected org posts from followed org owners

Sort options: `LATEST` (createdAt), `TRENDING` (voteCount + createdAt), `ADMIN_PRIORITY` (feedPriority + voteCount + createdAt).

### Real-Time Subscriptions

A single in-process `PubSub` instance is exported from `src/pubsub.ts`. Events:
- `NEW_POST` — published when any post is created
- `POST_VOTE_UPDATED` — published on vote cast or voting window extension

Subscriptions use `graphql-ws` protocol. For multi-instance deployments, this in-process pubsub must be replaced with a Redis adapter.

### Billing

`BillingService` wraps Stripe lazily — if `STRIPE_SECRET_KEY` is absent, checkout returns a message instead of throwing. The `StripeWebhookController` (`POST /webhooks/stripe`) verifies signatures using `STRIPE_WEBHOOK_SECRET` and handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, and `customer.subscription.deleted`. bKash integration is stubbed and not yet implemented.

### Schema Generation

GraphQL schema is code-first, auto-generated to `src/schema.gql` at startup (`autoSchemaFile`). Do not edit `schema.gql` directly — it is overwritten on each start.

## Required Environment Variables

```
MONGODB_URI=
JWT_SECRET=
GOOGLE_CLIENT_ID=        # optional, enables Google OAuth
STRIPE_SECRET_KEY=       # optional, enables Stripe billing
STRIPE_WEBHOOK_SECRET=   # optional, required for webhook verification
FRONTEND_URL=            # used for Stripe redirect URLs
CORS_ORIGIN=             # comma-separated allowed origins
PORT=                    # default 4000
NODE_ENV=                # set to "production" to disable GraphQL playground
```
