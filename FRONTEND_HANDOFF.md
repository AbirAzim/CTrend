# CTrend — Frontend handoff (aligned with backend)

This document is for building **Next.js** or **Expo** clients against the **NestJS + GraphQL (Apollo) + MongoDB** API. Source requirements: `CTrendsrs.md`.

## Base URLs and tooling

- Default port: `PORT` env variable (default **`4000`**)
- **HTTP (queries/mutations)**: `http://localhost:<PORT>/graphql` — `POST` with JSON body
- **WebSocket (subscriptions `voteUpdates`, `newPosts`)**: same path, `ws:` / `wss:` — local example: `ws://localhost:4000/graphql`
- When you run `npm run start:dev`, **Bootstrap** logs print the base URL, GraphQL endpoint, and Stripe webhook URL
- **CORS**: `credentials: true`, `Authorization` allowed in preflight, plus common Apollo headers. Set **`CORS_ORIGIN`** to your exact dev origins (comma-separated), e.g. `http://localhost:5173,http://localhost:3000`. If unset in dev, dynamic origin reflection is used (`origin: true`).
- Authentication: `Authorization: Bearer <accessToken>` (JWT). **Cookie-only sessions are not used** for this API; the web client can keep using Bearer + `localStorage`.
- Playground: enabled when `NODE_ENV !== 'production'` (local dev)

## Demo data (local)

On startup in **non-production**, the API seeds three public compare posts if missing: **Ronaldo vs Messi** (sports), **iPhone vs Android** (tech), **Apu Vai vs Mamun Vai** (entertainment).

- **Author**: uses the **first user in the database** (oldest by `createdAt`). If no users exist yet, it creates a local demo author `ctrend.demo@seed.local` once.
- Idempotent (safe on restart)
- Production: set `SEED_DUMMY_POSTS=true` to enable, or `SKIP_DUMMY_POSTS=true` to disable anywhere.

## Environment (backend)

Copy `.env.example` → `.env`. Minimum: `MONGODB_URI`, `JWT_SECRET`.

For Stripe checkout/webhooks: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL`. Webhooks use raw body; `main.ts` sets `rawBody: true`.

Optional: **`CORS_ORIGIN`** — comma-separated origins (e.g. `http://localhost:5173` for Vite). **`GOOGLE_CLIENT_ID`** — Web client ID (same as `VITE_GOOGLE_CLIENT_ID`); required for `googleLogin`.

## User roles and feed logic (summary)

- `UserRole`: `user` | `org` | `admin`
- Normal users: `createPost` defaults to type `user`. For `type: org` the account must be **org** and have an organization.
- `createSystemPost`: **admin** only
- Org free tier: `orgReach` is forced to `connected` (followers). Premium: up to **20** `global` posts per month (`globalPostsThisMonth`)
- Feed:
  - `scope: global` → system posts, public user posts, org posts with `orgReach: global`
  - `scope: personalized` + logged in → all of the above **plus** interest match (user `interests` = category **slugs**), own posts, `private` posts from followed users, `connected` org posts where the viewer follows the org owner

During onboarding, send **category slugs** as interests (e.g. `tech`, `food`) — load `slug` from the `categories` query.

## GraphQL — operations

### Auth (public)

**Web app contract (Vite / `@react-oauth/google`):**

- `login(email: String!, password: String!): AuthPayload!` — wrong credentials → GraphQL error *“Invalid email or password”*
- `signup(email: String!, password: String!, displayName: String): AuthPayload!` — min password length **8**; duplicate email → *“Email already registered”*
- `googleLogin(idToken: String!): AuthPayload!` — verifies ID token with Google (`aud` = `GOOGLE_CLIENT_ID`); invalid token → *“Invalid Google token”*; unverified Google email rejected

**Legacy CTrend:**

- `register(input: RegisterInput!): AuthPayload!` — `username`, `email`, `password`, optional `interests`

`AuthPayload`: `{ accessToken, refreshToken (nullable), user }` — `refreshToken` is always `null` until a refresh flow is added.

`User` includes **`id`**, **`email`**, **`displayName`** (nullable), plus `username`, `role`, `interests`, etc.

**JWT:** HS256, signed with `JWT_SECRET`. Access token expiry is **7 days** (see `auth.module.ts`; `JWT_EXPIRES_IN` in `.env` is reserved for a future wiring).

**Protected operations:** invalid/missing Bearer → `UnauthorizedException` (GraphQL error; HTTP status is usually still 200 unless you add a custom filter).

### Profile (JWT)

- `me: User!`
- `updateProfile(input: UpdateProfileInput!): User!`
- `getUserProfile(userId: ID!): User!` (public)

### Categories

- `categories: [Category!]!`
- `getAllCategories: [Category!]!` (alias of `categories`)

### Feed

- `getFeed(scope: FeedScope!, sort: FeedSort!, skip: Int, take: Int): FeedConnection!`
  - Optional JWT: if present, personalized filtering uses the viewer; if absent, behavior matches public/global content
- `FeedConnection`: `{ nodes: [Post!]!, totalCount: Int! }`

### Posts

- `createPost(input: CreatePostInput!): Post!` (JWT)
- `createSystemPost(input: CreatePostInput!): Post!` (JWT + admin)
- `extendPostVoting(postId: ID!, newVotingEndsAt: DateTime!): Post!` (JWT, post author only)
- `getPostById(id: ID!): Post!` (JWT optional — `mySelectedOptionIndex`)
- `getPostsByUser(userId: ID!): [Post!]!` (JWT optional)

Important `CreatePostInput` fields:

- `options`: at least **two** `{ label, imageUrl? }`
- `imageUrls`: required array with at least **two** image URLs
- `caption`: optional alias for `contentText` (send either one)
- `votingEndsAt`: optional `DateTime` in the **future**; if set, voting auto-closes at this time
- `categoryId`: MongoDB ObjectId string
- `visibility`: `public` | `private` (user posts)
- `type`: usually omit (defaults to `user`); for org posts use `org` + `orgReach`: `connected` | `global`

Vote summary on `Post`:

- `totalVotes`, `optionStats[]` (`index`, `label`, `count`, `percentage`), `mySelectedOptionIndex`
- `isVotingOpen`, `votingEndsAt` for time-limited posts
- System posts: `likesDisabled: true` (hide like UI)

### Votes (JWT)

- `votePost(postId: ID!, selectedOptionIndex: Int!): VoteResult!`
  - Returns error if `isVotingOpen` is false / deadline passed

### Subscriptions

- `voteUpdates(postId: ID!): VoteUpdate!` — live percentages/counts
- `newPosts: NewPost!` — `{ postId }` when a new post is created
- `postVoteUpdated(postId: ID!): Post!` — live post snapshot (counts, viewer vote state, option stats, voting window state)

For websocket auth, pass `Authorization: Bearer <accessToken>` in `connectionParams` so viewer-specific fields (like `mySelectedOptionIndex`) are resolved for that user.

### Comments

- `commentPost(postId: ID!, input: CommentPostInput!): Comment!` (JWT) — `CommentPostInput` is `{ content, parentId? }` only; do not send `postId` inside `input`.
- `commentsByPost(postId: ID!): [Comment!]!`

### Follows

- `followUser(userId: ID!): Boolean!` (JWT)
- `addFriend(userId: ID!): String!` (JWT) — sends friend request; returns `requested` or `accepted`
- `incomingFriendRequests: [User!]!` (JWT) — users who requested to be your friend
- `friendRequests: FriendRequests!` (JWT) — both lists in one call:
  - `requestedByMe` (outgoing pending)
  - `requestedMe` (incoming pending)
- `respondFriendRequest(requesterId: ID!, accept: Boolean!): Boolean!` (JWT)
- `myFriends: [User!]!` (JWT) — accepted friends list
- `friendSuggestions(limit: Int): [User!]!` (JWT) — excludes accepted/pending relations

### Organizations

- `createOrganization(name: String!): Organization!` (JWT — promotes user to `org` role)
- `myOrganization: Organization` (JWT, org role)
- `organizationDashboard(organizationId: String!): OrganizationDashboard!` (JWT, org)

### Billing (JWT mutations; Stripe webhook is REST)

- `createStripeCheckoutSession(plan: SubscriptionPlan!, organizationId: ID): CheckoutSession!`
  - Premium requires `organizationId`; redirect if response includes `url`
- `verifyBkashPayment(payload: String!): BkashVerification!` — stub for now (`success: false`)
- `cancelSubscription(organizationId: ID): Boolean!`

REST webhook (not GraphQL): `POST /webhooks/stripe` — `Stripe-Signature` header + raw body.

## Enums (GraphQL)

- `UserRole`, `PostType`, `Visibility`, `OrgPostReach`
- `FeedScope`: `global` | `personalized`
- `FeedSort`: `trending` | `latest` | `admin_priority`
- `SubscriptionPlan`: `free` | `premium`
- `PaymentProvider`, `SubscriptionStatus`

## UI flow mapping (SRS)

| Screen | Backend |
|--------|---------|
| Login / register | `login`, `register` |
| Onboarding interests | `categories` + `updateProfile` / `register(..., interests: [slug])` |
| Global / personalized feed | `getFeed` + change `sort` in tabs |
| Post detail | `getPostById`, `commentsByPost`, `votePost`, `voteUpdates` |
| Profile | `getUserProfile`, `getPostsByUser`, `followUser` |
| Create post | `createPost` (2+ options, category) |
| Org dashboard | `myOrganization`, `organizationDashboard` |
| Premium | `createStripeCheckoutSession` → Stripe → success URL |
| Admin | `createSystemPost` (dedicated admin account; `role: "admin"` in DB) |

**Note:** Create the first admin by setting `role: "admin"` on a user document in MongoDB, or add an admin-invite mutation later.

## Schema file

After the app starts, `src/schema.gql` is auto-generated — use it for client codegen.

## Errors and rate limits

- Input validation: `class-validator` (whitelisted fields)
- Global throttle: ~**120** requests/minute/IP (tune in production)

---

**Tagline (SRS):** *CTrend — Compare. Vote. See the Trend.*
