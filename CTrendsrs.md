# 📄 Software Requirements Specification (SRS)
## Project Name: CTrend

---

## 1. Introduction

### 1.1 Purpose
This document defines the requirements for **CTrend**, a cross-platform (iOS, Android, Web) social voting application where users can create comparison posts and vote on them. The platform emphasizes trending decisions based on user engagement.

---

### 1.2 Scope
CTrend will allow:
- Users to create comparison-based posts (text/image)
- Other users to vote on options
- Display of vote percentages
- Personalized and global feeds
- Organization-based posting with subscription
- Admin-generated priority posts

---

### 1.3 Definitions
- **Compare Post**: A post with multiple options for voting
- **Vote**: User selection of one option
- **Organization**: Paid entity that can post globally
- **System Post**: Admin-created high-priority post

---

## 2. System Overview

### 2.1 Product Perspective
CTrend combines:
- Social media (feed-based UI)
- Polling/voting system
- Trend discovery engine

---

### 2.2 Target Users
- General Users
- Organizations (business accounts)
- Admins

---

## 3. System Architecture

### 3.1 Tech Stack

#### Frontend
- Web: Next.js
- Mobile: React Native (Expo)

#### Backend
- Node.js
- NestJS
- GraphQL (Apollo)

#### Database
- MongoDB (Atlas)

#### Storage
- Cloudinary / AWS S3

#### Authentication
- JWT
- OAuth (optional)

#### Payments
- Stripe (global)
- bKash (Bangladesh)

---

## 4. Functional Requirements

---

### 4.1 Authentication

- User registration (email, phone, social login)
- Login/logout
- JWT-based authentication
- Password reset

---

### 4.2 User Profile

- View and edit profile
- Add bio, profile image
- Select interests
- View user posts

---

### 4.3 Interests System

- Users select interests during onboarding
- Feed personalization based on interests

---

### 4.4 Post System

#### 4.4.1 User Posts
- Create post with:
  - Text and/or images
  - Minimum 2 options
- Assign category
- Visibility:
  - Public
  - Private (followers/associated users)

---

#### 4.4.2 Organization Posts
- Available for paid users
- Free Plan:
  - Post to connected users only
- Premium Plan:
  - 20 global posts/month

---

#### 4.4.3 System Posts (Admin)
- Created by admin
- Highest priority in feed
- Visible to all users
- Users can:
  - Vote
  - Comment
- Users cannot:
  - Like

---

### 4.5 Voting System

- One vote per user per post
- Vote options ≥ 2
- Display:
  - Percentage per option
  - Total votes
- Real-time updates (GraphQL subscriptions)

---

### 4.6 Comments System

- Add comments to posts
- Optional nested replies
- Moderation support

---

### 4.7 Feed System

#### 4.7.1 Global Feed
- Shows all public posts
- Sorted by:
  - Trending
  - Latest
  - Admin priority

---

#### 4.7.2 Personalized Feed
- Based on:
  - Interests
  - User activity

---

### 4.8 Categories

- Predefined categories (e.g., Tech, Fashion, Food)
- Posts must belong to a category

---

### 4.9 Organization Module

#### Features:
- Organization profile
- Dashboard with:
  - Post analytics
  - Engagement stats
  - Vote count
  - Reach

---

### 4.10 Subscription & Payments

#### Plans:

**Free Plan**
- Limited posting (connected users only)

**Premium Plan**
- Price:
  - 200 BDT (bKash)
  - $2 USD (Stripe)
- Features:
  - 20 global posts/month

---

#### Stripe Integration

- Create checkout session
- Redirect to Stripe payment page
- Handle webhooks:
  - checkout.session.completed
  - invoice.paid
  - invoice.payment_failed
  - subscription.canceled

---

#### bKash Integration

- Payment initiation
- Transaction verification
- Subscription activation

---

### 4.11 Notifications (Recommended)

- New comments
- Vote updates
- Subscription alerts

---

### 4.12 Admin Panel

- Manage users
- Create system posts
- Moderate content
- Manage categories
- View platform analytics

---

## 5. Non-Functional Requirements

### 5.1 Performance
- API response time < 300ms
- Real-time updates supported

---

### 5.2 Scalability
- Modular NestJS architecture
- Horizontal scaling support

---

### 5.3 Security
- JWT authentication
- Input validation (GraphQL)
- Rate limiting
- Webhook signature verification

---

### 5.4 Availability
- Target uptime: 99.5%

---

## 6. Database Design (MongoDB)

### 6.1 Users
- id
- username
- email
- password
- interests[]
- role (user | org | admin)

---

### 6.2 Posts
- id
- type (user | org | system)
- content (text/images)
- options[]
- category
- visibility
- createdBy
- createdAt

---

### 6.3 Votes
- id
- userId
- postId
- selectedOption

---

### 6.4 Comments
- id
- postId
- userId
- content
- createdAt

---

### 6.5 Organizations
- id
- name
- subscriptionPlan
- postLimit
- postsUsed

---

### 6.6 Subscriptions
- id
- userId / organizationId
- provider (stripe | bkash)
- plan (free | premium)
- status (active | canceled | expired)
- startDate
- endDate
- postLimit
- postsUsed
- stripeCustomerId
- stripeSubscriptionId

---

## 7. API Design (GraphQL)

### Queries
- getFeed
- getPostById
- getUserProfile

---

### Mutations
- createPost
- votePost
- commentPost
- createStripeCheckoutSession
- verifyBkashPayment
- cancelSubscription

---

### Subscriptions
- voteUpdates
- newPosts

---

## 8. UI/UX Requirements

### Design Style
- Instagram-like feed
- Card-based UI
- Mobile-first design

---

### Key Screens
- Login / Register
- Feed (Global + Personalized)
- Post Creation
- Post Details (Vote + Comments)
- Profile
- Organization Dashboard
- Admin Panel

---

## 9. Deployment

- Web: Vercel
- Backend: AWS / DigitalOcean
- Database: MongoDB Atlas
- Storage: Cloudinary

---

## 10. Future Enhancements

- Trending algorithm (time decay + engagement)
- Recommendation engine (ML-based)
- Ads & sponsored posts
- Localization (English + Bangla)
- Advanced analytics dashboard

---

## 11. Constraints

- Payment gateway dependency (Stripe, bKash)
- Real-time scalability challenges
- Content moderation requirements

---

## 12. Success Metrics

- Daily Active Users (DAU)
- Vote engagement rate
- Post creation rate
- Subscription conversion rate

---

# 🚀 Tagline Suggestion

**CTrend — Compare. Vote. See the Trend.**