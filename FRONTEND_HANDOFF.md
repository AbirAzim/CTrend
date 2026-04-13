# CTrend — ফ্রন্টএন্ড হ্যান্ডঅফ (ব্যাকএন্ড অনুযায়ী)

এই ডকুমেন্ট **NestJS + GraphQL (Apollo) + MongoDB** ব্যাকএন্ডের সাথে Next.js / Expo ক্লায়েন্ট তৈরির জন্য। মূল SRS: `CTrendsrs.md`।

## বেস URL ও টুলিং

- ডিফল্ট পোর্ট: `PORT` env (ডিফল্ট `4000`) — `http://localhost:4000/graphql`
- **HTTP**: একই এন্ডপয়েন্টে `POST` (JSON body) GraphQL
- **WebSocket (সাবস্ক্রিপশন)**: `graphql-ws` — ক্লায়েন্টে `graphql-ws` + `@apollo/client` বা অনুরূপ সেটআপ লাগবে
- অথেন্টিকেশন: `Authorization: Bearer <accessToken>`
- Playground: `NODE_ENV !== 'production'` হলে চালু (লোকাল ডেভ)

## এনভায়রনমেন্ট (ব্যাকএন্ড)

কপি: `backend/.env.example` → `backend/.env`। মিনিমাম: `MONGODB_URI`, `JWT_SECRET`।

Stripe চেকআউট/ওয়েবহুকের জন্য: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL`। Raw body ওয়েবহুকের জন্য `main.ts`-এ `rawBody: true` আছে।

## ইউজার রোল ও ফিড লজিক (সংক্ষেপ)

- `UserRole`: `user` | `org` | `admin`
- সাধারণ ইউজার: `createPost` → টাইপ `user` (ডিফল্ট)। `type: org` দিলে অ্যাকাউন্ট **org** হতে হবে এবং সংস্থা থাকতে হবে।
- `createSystemPost`: শুধু **admin**
- অর্গ ফ্রি: `orgReach` জোর করে `connected` (ফলোয়ারদের কাছে)। প্রিমিয়াম: `global` মাসে সর্বোচ্চ **২০** পোস্ট (`globalPostsThisMonth`)
- ফিড:
  - `scope: global` → সিস্টেম পোস্ট, পাবলিক ইউজার পোস্ট, `orgReach: global` অর্গ পোস্ট
  - `scope: personalized` + লগইন → উপরেরগুলো **সাথে** ইন্টারেস্ট ম্যাচ (ইউজারের `interests` = ক্যাটেগরি **slug**), নিজের পোস্ট, ফলো করা ইউজারের `private` পোস্ট, ফলো করা অর্গ-মালিকের `connected` অর্গ পোস্ট

অনবোর্ডিংয়ে ইন্টারেস্ট হিসেবে **ক্যাটেগরি slug** পাঠান (যেমন `tech`, `food`) — `categories` কুয়েরি থেকে `slug` নিন।

## GraphQL — অপারেশন তালিকা

### Auth (পাবলিক)

- `register(input: RegisterInput!): AuthPayload!`
- `login(input: LoginInput!): AuthPayload!`

`AuthPayload`: `{ accessToken, user }`

### প্রোফাইল (JWT)

- `me: User!`
- `updateProfile(input: UpdateProfileInput!): User!`
- `getUserProfile(userId: ID!): User!` (পাবলিক)

### ক্যাটেগরি

- `categories: [Category!]!`

### ফিড

- `getFeed(scope: FeedScope!, sort: FeedSort!, skip: Int, take: Int): FeedConnection!`
  - অপশনাল JWT: থাকলে পার্সোনালাইজড ফিল্টারে `viewer` ধরা হয়; না থাকলে `global`-সমতুল্য পাবলিক কনটেন্ট
- `FeedConnection`: `{ nodes: [Post!]!, totalCount: Int! }`

### পোস্ট

- `createPost(input: CreatePostInput!): Post!` (JWT)
- `createSystemPost(input: CreatePostInput!): Post!` (JWT + admin)
- `getPostById(id: ID!): Post!` (JWT অপশনাল — `mySelectedOptionIndex`)
- `getPostsByUser(userId: ID!): [Post!]!` (JWT অপশনাল)

`CreatePostInput` গুরুত্বপূর্ণ ফিল্ড:

- `options`: কমপক্ষে **২টি** `{ label, imageUrl? }`
- `categoryId`: Mongo ObjectId স্ট্রিং
- `visibility`: `public` | `private` (ইউজার পোস্ট)
- `type`: সাধারণত ছেড়ে দিন (`user`); অর্গ পোস্টের জন্য `org` + `orgReach`: `connected` | `global`

`Post` টাইপে ভোট সারাংশ:

- `totalVotes`, `optionStats[]` (`index`, `label`, `count`, `percentage`), `mySelectedOptionIndex`
- সিস্টেম পোস্ট: `likesDisabled: true` (UI-তে লাইক লুকান)

### ভোট (JWT)

- `votePost(postId: ID!, selectedOptionIndex: Int!): VoteResult!`

### সাবস্ক্রিপশন

- `voteUpdates(postId: ID!): VoteUpdate!` — রিয়েলটাইম শতাংশ/কাউন্ট
- `newPosts: NewPost!` — `{ postId }`; নতুন পোস্ট তৈরি হলে ইভেন্ট

### কমেন্ট

- `commentPost(input: CommentPostInput!): Comment!` (JWT)
- `commentsByPost(postId: ID!): [Comment!]!`

### ফলো

- `followUser(userId: ID!): Boolean!` (JWT)

### অর্গ

- `createOrganization(name: String!): Organization!` (JWT — ইউজার রোল `org` করে)
- `myOrganization: Organization` (JWT, org রোল)
- `organizationDashboard(organizationId: String!): OrganizationDashboard!` (JWT, org)

### বিলিং (JWT মিউটেশন; ওয়েবহুক REST)

- `createStripeCheckoutSession(plan: SubscriptionPlan!, organizationId: ID): CheckoutSession!`
  - প্রিমিয়ামের জন্য `organizationId` বাধ্যতামূলক; রেসপন্সে `url` থাকলে রিডাইরেক্ট
- `verifyBkashPayment(payload: String!): BkashVerification!` — বর্তমানে স্টাব (`success: false`)
- `cancelSubscription(organizationId: ID): Boolean!`

REST ওয়েবহুক (GraphQL নয়): `POST /webhooks/stripe` — `Stripe-Signature` হেডার + raw body।

## Enums (GraphQL)

- `UserRole`, `PostType`, `Visibility`, `OrgPostReach`
- `FeedScope`: `global` | `personalized`
- `FeedSort`: `trending` | `latest` | `admin_priority`
- `SubscriptionPlan`: `free` | `premium`
- `PaymentProvider`, `SubscriptionStatus`

## UI ফ্লো সাজেশন (SRS ম্যাপ)

| স্ক্রিন | ব্যাকএন্ড |
|----------|-----------|
| লগইন/রেজিস্টার | `login`, `register` |
| অনবোর্ডিং ইন্টারেস্ট | `categories` + `updateProfile` / `register(..., interests: [slug])` |
| গ্লোবাল/পার্সোনাল ফিড | `getFeed` + ট্যাবে `sort` বদল |
| পোস্ট ডিটেইল | `getPostById`, `commentsByPost`, `votePost`, `voteUpdates` |
| প্রোফাইল | `getUserProfile`, `getPostsByUser`, `followUser` |
| পোস্ট তৈরি | `createPost` (২+ অপশন, ক্যাটেগরি) |
| অর্গ ড্যাশবোর্ড | `myOrganization`, `organizationDashboard` |
| প্রিমিয়াম | `createStripeCheckoutSession` → Stripe → সাক্সেস URL |
| অ্যাডমিন | `createSystemPost` (আলাদা অ্যাডমিন অ্যাকাউন্ট; রোল DB-তে `admin`) |

**নোট:** প্রথম অ্যাডমিন তৈরি করতে MongoDB-তে সরাসরি ইউজার ডকুমেন্টে `role: "admin"` সেট করুন, বা পরে একটি অ্যাডমিন-ইনভাইট মিউটেশন যোগ করা যেতে পারে।

## স্কিমা ফাইল

অ্যাপ চালু হলে `backend/src/schema.gql` অটো-জেনারেট হয় — ক্লায়েন্ট codegen-এর জন্য এটি ব্যবহার করতে পারেন।

## ত্রুটি ও রেট লিমিট

- ইনপুট ভ্যালিডেশন: `class-validator` (whitelisted ফিল্ড)
- গ্লোবাল থ্রটল: ~১২০ রিকোয়েস্ট/মিনিট/IP (প্রোডাকশনে টিউন করুন)

---

**ট্যাগলাইন (SRS):** *CTrend — Compare. Vote. See the Trend.*
