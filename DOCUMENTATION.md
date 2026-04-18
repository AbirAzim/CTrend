# CTrend Documentation

## Overview
CTrend is a modular backend application built with NestJS, designed to handle authentication, billing, categories, comments, feeds, follows, organizations, posts, users, and votes. It uses GraphQL for API communication and integrates with Stripe for billing.

## Features
- **Authentication**: JWT-based authentication with role-based access control.
- **Billing**: Stripe integration for subscriptions and webhooks.
- **Categories & Posts**: Organize and manage posts by categories.
- **Comments & Votes**: Engage users with comments and voting features.
- **Organizations & Follows**: Support for organizations and user following.
- **Seeding**: Dummy data seeding for development/testing.

## Technologies
- **NestJS**: Main framework
- **GraphQL**: API layer
- **MongoDB**: Data storage (implied by schema usage)
- **Stripe**: Payment processing

## Folder Structure
- `src/`
  - `auth/`: Authentication logic
  - `billing/`: Billing and Stripe integration
  - `categories/`, `comments/`, `feed/`, `follows/`, `organizations/`, `posts/`, `users/`, `votes/`: Feature modules
  - `common/`: Shared enums, decorators, guards
  - `seed/`: Seeding utilities

## Getting Started
1. Install dependencies: `npm install`
2. Configure environment variables (e.g., Stripe keys, DB URI)
3. Run the server: `npm run start:dev`

---

# Architecture

## High-Level Diagram

```
[Client]
   |
[GraphQL API (NestJS)]
   |
[Modules: Auth, Billing, ...]
   |
[Database (MongoDB)]
   |
[External Services: Stripe]
```

## Module Interaction
- Each feature is a NestJS module with its own resolver, service, and schema.
- Common utilities (decorators, guards) are shared across modules.
- Billing module listens to Stripe webhooks for subscription events.

## Example Request Flow
1. **User Login**: Auth module validates credentials, issues JWT.
2. **Create Post**: Posts module checks JWT, validates input, saves post.
3. **Subscribe**: Billing module creates Stripe session, handles webhook updates.

## Extending the System
- Add new modules under `src/`.
- Register new modules in `app.module.ts`.
- Use shared logic from `common/` for consistency.

---

For more details, see the code in the `src/` directory and module-specific README sections (if available).
