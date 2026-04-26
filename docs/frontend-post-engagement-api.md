# Frontend Integration: Post Engagement + Voting Updates

This document lists all backend GraphQL changes needed by frontend for the new features:

1. comment count
2. hype count
3. most recent 2 comments
4. like count
5. keep/save post
6. list current user's saved posts
7. comment like
8. email verification copy button fix
9. tap to see who voted list
10. anonymous vote

---

## 1) New fields on `PostGql`

Update post queries/fragments to include:

- `commentCount: Int!`
- `likeCount: Int!`
- `hypeCount: Int!`
- `saveCount: Int!`
- `viewerHasSaved: Boolean!`
- `recentComments: [CommentGql!]!` (latest 2 comments, newest first)

Existing post queries such as `getPostById`, `getPostsByUser`, feed queries, and `mySavedPosts` can request these fields.

---

## 2) `CommentGql` additions

Comment objects now include:

- `likeCount: Int!`
- `viewerHasLiked: Boolean!`

Use these in comment UI to show total likes and current-user state.

---

## 3) Save/Keep post APIs

### Mutation

- `setPostKeep(postId: ID!, keep: Boolean!): Boolean!`
  - `keep: true` => save the post
  - `keep: false` => unsave the post

### Query

- `mySavedPosts: [PostGql!]!`
  - returns the logged-in user's saved posts in newest-saved order
  - for multi-image rendering, use `imageUrls` (array), not legacy `imageUrl` (single first image)

---

## 4) Post like + hype APIs

### Mutations

- `setPostLike(postId: ID!, active: Boolean!): Boolean!`
- `setPostHype(postId: ID!, active: Boolean!): Boolean!`

Use these for toggle buttons. Then re-read `likeCount`/`hypeCount` from post response or refresh post query/subscription payload.

---

## 5) Comment like API

### Mutation

- `setCommentLike(commentId: ID!, liked: Boolean!): CommentGql!`
  - returns updated comment with latest `likeCount` and `viewerHasLiked`

---

## 6) Vote updates: anonymous support

### Mutation change

- `votePost` now supports optional argument:
  - `anonymous: Boolean`
- UX copy recommendation: `Tap a side to vote — switch anytime with another tap`

Example:

```graphql
mutation Vote($postId: ID!, $selectedOptionIndex: Int!, $anonymous: Boolean) {
  votePost(
    postId: $postId
    selectedOptionIndex: $selectedOptionIndex
    anonymous: $anonymous
  ) {
    postId
    totalVotes
    countsPerOption
    percentages
  }
}
```

When `anonymous` is true, the vote contributes to counts, but voter identity is hidden in voter list.
`votePost` already supports changing vote by tapping another option again.

---

## 7) Voter list for "tap to see who voted"

### New query

- `votersByPost(postId: ID!, optionIndex: Int): [PostVoterGql!]!`

### `PostVoterGql`

- `voteId: ID!`
- `selectedOptionIndex: Int!`
- `anonymous: Boolean!`
- `user: UserGql` (null when anonymous)
- `createdAt: Date!`
- `updatedAt: Date!` (use this for "recently changed vote" ordering)

Frontend recommendation:

- Show "Anonymous voter" when `anonymous = true` and `user = null`
- Use optional `optionIndex` filter to open list for a specific option
- Use `updatedAt` for recent sorting/time label (vote change should move to recent)

---

## 8) Email verification copy button

Verification email HTML now uses a real `Copy` button (`<button>` with clipboard action) instead of static text. In clients that block clipboard JS, users still can manually copy the code.

Frontend impact: no API change required.

---

## 9) Suggested frontend rollout checklist

- Update GraphQL fragments/types for `PostGql`, `CommentGql`, and new `PostVoterGql`
- Add Keep/Save button wiring (`setPostKeep`) and Saved Posts screen (`mySavedPosts`)
- Add Like + Hype buttons and call `setPostLike` / `setPostHype`
- Add Comment Like button using `setCommentLike`
- Add "Voted by" modal/page using `votersByPost`
- Add anonymous toggle in vote UI and pass `anonymous` in `votePost`
- Ensure anonymous voters are rendered without profile identity

