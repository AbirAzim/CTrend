# Frontend Prompt: Guest Browsing (Lazy Auth)

## Context

This is the frontend for **CTrend** — a polling/voting app. The backend is NestJS + GraphQL (Apollo Server). The frontend stack is **Next.js** (or Expo for mobile) with **Apollo Client** and JWT auth stored in `localStorage`.

The backend API is at `http://localhost:4000/graphql` (or your deployed URL).

**The backend requires zero changes.** It already uses `OptionalJwtGqlGuard` on all content-viewing endpoints — meaning they are publicly accessible but will personalize results if a valid JWT is present. Only `votePost`, `me`, and other write/profile mutations enforce auth (`GqlAuthGuard`).

---

## Goal

Implement **guest browsing**: unauthenticated users can freely view all content (feed, post detail, public profiles). Auth is only required when they try to **vote on a post** or navigate to **their own profile (`/profile/me`)**.

---

## What to Change

### 1. Apollo Client — Send Token If Present, Never Block

Your Apollo auth link must attach the JWT if it exists in `localStorage`, but must **not** block requests when there is no token. Many setups currently throw or skip the request if no token is found — remove that behavior.

```ts
// apollo-client.ts
import { ApolloClient, InMemoryCache, ApolloLink, HttpLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

const httpLink = new HttpLink({ uri: 'http://localhost:4000/graphql' });

const authLink = new ApolloLink((operation, forward) => {
  const token = localStorage.getItem('accessToken');
  // Only set header if token exists — do not throw or short-circuit
  if (token) {
    operation.setContext({
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  return forward(operation);
});

const wsLink = new GraphQLWsLink(
  createClient({
    url: 'ws://localhost:4000/graphql',
    connectionParams: () => {
      const token = localStorage.getItem('accessToken');
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  }),
);

const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  authLink.concat(httpLink),
);

export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
```

---

### 2. Auth Context — Expose `user` and `isAuthenticated`

You need a global auth context that components can read to decide whether to show a login prompt.

```tsx
// context/AuthContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';

interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const stored = localStorage.getItem('user');
    if (token && stored) {
      setAccessToken(token);
      setUser(JSON.parse(stored));
    }
  }, []);

  const login = (token: string, user: AuthUser) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('user', JSON.stringify(user));
    setAccessToken(token);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

---

### 3. Router — Only Protect `/profile/me`

Remove any route guard currently wrapping the feed, home page, or post detail pages. Only `/profile/me` (the logged-in user's own profile) should be a protected route.

```tsx
// app/router.tsx (React Router v6 example)
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/" element={<Feed />} />
      <Route path="/post/:id" element={<PostDetail />} />
      <Route path="/profile/:userId" element={<UserProfile />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Auth-required routes */}
      <Route path="/profile/me" element={<PrivateRoute><MyProfile /></PrivateRoute>} />
      <Route path="/create-post" element={<PrivateRoute><CreatePost /></PrivateRoute>} />
    </Routes>
  );
}
```

For **Next.js App Router**, do not add middleware that redirects unauthenticated users away from `/`, `/post/[id]`, or `/profile/[userId]`. Only protect `/profile/me` (and `/create-post`) using a check inside the page component or via middleware scoped to those paths only.

---

### 4. Vote Button — Intercept and Prompt Login

In your vote button component, check `isAuthenticated` before firing the `votePost` mutation. If the user is not logged in, redirect to login (or open a login modal) instead.

```tsx
// components/VoteButton.tsx
import { useMutation } from '@apollo/client';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { VOTE_POST } from '../graphql/mutations';

interface Props {
  postId: string;
  optionIndex: number;
  label: string;
  isSelected: boolean;
  isVotingOpen: boolean;
}

export function VoteButton({ postId, optionIndex, label, isSelected, isVotingOpen }: Props) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [votePost, { loading }] = useMutation(VOTE_POST);

  const handleClick = async () => {
    if (!isAuthenticated) {
      // Redirect to login, preserving current page so user returns after login
      navigate('/login', { state: { from: location } });
      return;
    }
    if (!isVotingOpen || isSelected) return;
    await votePost({ variables: { postId, selectedOptionIndex: optionIndex } });
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading || isSelected || !isVotingOpen}
      title={!isAuthenticated ? 'Login to vote' : undefined}
    >
      {label}
      {!isAuthenticated && <span> (Login to vote)</span>}
    </button>
  );
}
```

GraphQL mutation to use:
```graphql
mutation VotePost($postId: ID!, $selectedOptionIndex: Int!) {
  votePost(postId: $postId, selectedOptionIndex: $selectedOptionIndex) {
    postId
    selectedOptionIndex
    totalVotes
  }
}
```

---

### 5. Login Page — Redirect Back After Login

After a successful login, redirect the user back to the page they came from (which was preserved in `location.state.from`).

```tsx
// pages/Login.tsx
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@apollo/client';
import { useAuth } from '../context/AuthContext';
import { LOGIN } from '../graphql/mutations';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || '/';

  const [loginMutation] = useMutation(LOGIN);

  const handleSubmit = async (email: string, password: string) => {
    const { data } = await loginMutation({ variables: { email, password } });
    login(data.login.accessToken, data.login.user);
    navigate(from, { replace: true }); // Return to where the user came from
  };

  // ... render form
}
```

GraphQL mutation:
```graphql
mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    accessToken
    user {
      id
      email
      displayName
      role
    }
  }
}
```

---

### 6. Feed Page — Works for Both Guests and Logged-in Users

The `getFeed` query works without a token (returns global public content). When a token is present, Apollo will attach it automatically (from Step 1), and the backend will return personalized content.

```tsx
// pages/Feed.tsx
import { useQuery } from '@apollo/client';
import { useAuth } from '../context/AuthContext';
import { GET_FEED } from '../graphql/queries';

export function Feed() {
  const { isAuthenticated } = useAuth();

  // Use 'personalized' scope for logged-in users, 'global' for guests
  const { data, loading } = useQuery(GET_FEED, {
    variables: {
      scope: isAuthenticated ? 'personalized' : 'global',
      sort: 'trending',
      skip: 0,
      take: 20,
    },
  });

  // ... render posts
}
```

GraphQL query:
```graphql
query GetFeed($scope: FeedScope!, $sort: FeedSort!, $skip: Int, $take: Int) {
  getFeed(scope: $scope, sort: $sort, skip: $skip, take: $take) {
    nodes {
      id
      contentText
      imageUrls
      totalVotes
      isVotingOpen
      votingEndsAt
      mySelectedOptionIndex
      optionStats {
        index
        label
        count
        percentage
      }
      author {
        id
        displayName
      }
      category {
        id
        name
      }
    }
    totalCount
  }
}
```

---

### 7. My Profile Nav Link — Redirect to Login If Not Authenticated

In your navigation bar, clicking "My Profile" or the profile icon should redirect to login if the user is not authenticated.

```tsx
// components/Navbar.tsx
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleProfileClick = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: '/profile/me' } } });
    } else {
      navigate('/profile/me');
    }
  };

  return (
    <nav>
      <button onClick={() => navigate('/')}>Feed</button>
      <button onClick={handleProfileClick}>
        {isAuthenticated ? user?.displayName || 'My Profile' : 'Login'}
      </button>
      {isAuthenticated && <button onClick={logout}>Logout</button>}
    </nav>
  );
}
```

---

## Summary of All Changes

| What | Where | Change |
|------|-------|--------|
| Apollo auth link | `apollo-client.ts` | Attach token only if present, never block request |
| Auth context | `context/AuthContext.tsx` | Create/update to expose `user`, `isAuthenticated`, `login`, `logout` |
| Router | `app/router.tsx` | Remove auth guards from feed/post/profile routes; keep only on `/profile/me` and `/create-post` |
| Vote button | `components/VoteButton.tsx` | Check `isAuthenticated` before mutation; redirect to login if not |
| Login page | `pages/Login.tsx` | After successful login, redirect to `location.state.from` |
| Feed page | `pages/Feed.tsx` | Use `scope: global` for guests, `scope: personalized` for logged-in users |
| Navbar | `components/Navbar.tsx` | Profile link redirects to login if unauthenticated |

**No backend changes are needed.** The API already handles unauthenticated requests on all content endpoints.
