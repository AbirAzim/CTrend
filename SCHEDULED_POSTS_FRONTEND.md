# Frontend Changes Required: Scheduled Posts

Backend doc only — frontend repo should mirror these fragments and enums.

## New GraphQL Fields

### `PostGql` now has two extra fields on every post response:

```graphql
status: PostStatus!      # "published" | "scheduled"
scheduledAt: Date        # ISO datetime — only set when status = "scheduled"
```

Import/use `PostStatus` enum:
```graphql
enum PostStatus {
  published
  scheduled
}
```

Add both fields to every `PostGql` fragment you use:
```graphql
fragment PostFields on PostGql {
  # ... existing fields ...
  status
  scheduledAt
}
```

---

## Updated Mutation: `createPost`

`CreatePostInput` now accepts an optional `scheduledAt`:

```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ...PostFields
  }
}
```

```ts
// Immediate publish (existing behaviour — no change needed)
createPost({ input: { ...fields } })

// Schedule for a future time
createPost({ input: { ...fields, scheduledAt: "2025-06-01T09:00:00.000Z" } })
```

Rules enforced by the backend:
- `scheduledAt` must be a future datetime (throws `BAD_REQUEST` otherwise).
- The post will not appear in any feed until the scheduled time passes (backend cron flips it every minute).

---

## New Query: `myScheduledPosts`

Returns the authenticated user's queue of pending scheduled posts, sorted by `scheduledAt` ascending.

```graphql
query MyScheduledPosts {
  myScheduledPosts {
    id
    contentText
    imageUrls
    options { label imageUrl }
    category { id name }
    status
    scheduledAt
    createdAt
  }
}
```

Use this to render a "Scheduled" tab or queue view in the post management screen.

---

## New Mutation: `cancelScheduledPost`

Permanently deletes a scheduled post that has not yet been published. Only the author can cancel their own scheduled posts.

```graphql
mutation CancelScheduledPost($postId: ID!) {
  cancelScheduledPost(postId: $postId)
}
```

Returns `true` on success. Throws `NOT_FOUND` if post doesn't exist, `FORBIDDEN` if caller is not the author, `BAD_REQUEST` if the post is already published.

---

## UX Recommendations

### Post Composer / Create Flow

1. Add a **"Schedule for later"** toggle below the "Post" button.
2. When toggled on, show a **date + time picker** (min value = now + 1 min).
3. On submit, pass the chosen datetime as `scheduledAt` in the mutation input.
4. On success, show a confirmation toast: _"Your post is scheduled for [formatted date]."_
5. Do **not** optimistically add the post to the feed — it should only appear once published.

### Scheduled Posts Queue (new screen or tab)

- Route: e.g. `/profile/scheduled` or a "Scheduled" tab on the profile page.
- Call `myScheduledPosts` on mount.
- Display each card with:
  - Post preview (images / options)
  - Countdown or formatted date: _"Publishing in 2 hours · Jun 1, 9:00 AM"_
  - A **"Cancel"** button that calls `cancelScheduledPost` and removes the card.
- Poll every 30–60 s (or refetch after navigation) so cards disappear once published.

### Feed / Profile Post List

- Posts with `status === "scheduled"` will **never** appear in feed queries — the backend already filters them out.
- In the profile post list (`getPostsByUser`), scheduled posts are also excluded.
- Only `myScheduledPosts` returns them to the author.
- If you fetch `getPostById` for a scheduled post and the viewer is not the author, the API returns `NOT_FOUND`.

### Visual Indicator

If you render a post card in the scheduled queue, display a **clock badge** or `"Scheduled"` chip so it's visually distinct from published posts. You can use the `status` field to drive this: `post.status === 'scheduled'`.

---

## Error Handling

| Scenario | GraphQL error code | Message to show |
|---|---|---|
| `scheduledAt` is in the past | `BAD_REQUEST` | "Scheduled time must be in the future" |
| Cancel a non-scheduled post | `BAD_REQUEST` | "Post is not scheduled" |
| Cancel another user's post | `FORBIDDEN` | — (shouldn't be reachable via UI) |
| Fetch a scheduled post as non-author | `NOT_FOUND` | Standard 404 handling |
