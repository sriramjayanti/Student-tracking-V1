# SafeRide — School Student Transport Tracking System

Production-grade MVP for real-time student transport tracking. GPS from the driver's phone, QR-based student check-in/check-out, live map for parents, push notifications via FCM.

---

## Table of Contents

1. [Architecture Overview](#architecture)
2. [Prerequisites](#prerequisites)
3. [Database Setup (Supabase)](#database-setup)
4. [Firebase Setup (Push Notifications)](#firebase-setup)
5. [Local Development](#local-development)
6. [Environment Variables](#environment-variables)
7. [User Roles & Access](#user-roles)
8. [Workflow — Scan Sequence](#workflow)
9. [Deployment to Vercel](#deployment)
10. [Creating Test Data](#test-data)
11. [Future Upgrades](#future-upgrades)

---

## Architecture

```
Clients                     Application Layer              Infrastructure
──────────                  ─────────────────              ──────────────
Parent Browser  ─────────►  Next.js 14 (App Router)  ───► Supabase PostgreSQL
Driver Browser  ─────────►  TypeScript API Routes     ───► Supabase Auth
Admin Browser   ─────────►  Server Components         ───► Supabase Realtime
                            Middleware (RBAC)          ───► Firebase FCM
                                                       ───► Vercel CDN
```

**Key design decisions:**
- One driver phone = one bus GPS source. No dedicated hardware needed.
- QR codes embedded in student ID cards. Scan at boarding / arrival / drop.
- Supabase Realtime pushes GPS pings and status changes to parent browsers instantly.
- Row Level Security enforces data isolation at the database layer — no accidental data leaks.

---

## Prerequisites

- Node.js 18+
- [Supabase account](https://supabase.com) (free tier works)
- [Firebase project](https://console.firebase.google.com) (free tier works)
- [Vercel account](https://vercel.com) for deployment

---

## Database Setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project. Note your:
- Project URL
- `anon` (public) key
- `service_role` key (keep secret)

### 2. Run the schema

Open the SQL Editor in your Supabase dashboard and paste the entire contents of `schema.sql`. Run it.

This creates all 14 tables, Row Level Security policies, indexes, triggers, and a realtime publication.

### 3. Enable Realtime

In Supabase → Database → Replication, confirm the `supabase_realtime` publication includes:
- `bus_locations`
- `scan_events`
- `notifications`
- `trip_sessions`
- `students`

### 4. Configure Auth

In Supabase → Authentication → Providers, enable **Email** provider.

Disable "Confirm email" for internal-only deployments, or set up SMTP for production.

---

## Firebase Setup

### 1. Create a Firebase project

Go to [console.firebase.google.com](https://console.firebase.google.com), create a project.

### 2. Enable Cloud Messaging

Firebase Console → Project Settings → Cloud Messaging → Enable.

### 3. Get Service Account key

Project Settings → Service Accounts → "Generate new private key".

Download the JSON file. Minify it and set it as `FIREBASE_SERVICE_ACCOUNT_JSON` in your env.

### 4. Client-side FCM (optional, for web push)

To request FCM tokens from parent browsers, add a `firebase-messaging-sw.js` in `/public/`:

```js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  messagingSenderId: "...",
  appId: "..."
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon-192.png'
  });
});
```

Then on the parent dashboard, request notification permission and save the token:

```ts
import { getMessaging, getToken } from 'firebase/messaging'
const messaging = getMessaging(firebaseApp)
const token = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' })
await fetch('/api/notifications', { method: 'POST', body: JSON.stringify({ fcm_token: token }) })
```

---

## Local Development

```bash
# 1. Clone and install
git clone <your-repo>
cd school-transport-tracker
npm install

# 2. Set up environment
cp .env.example .env.local
# Fill in your Supabase and Firebase credentials

# 3. Run dev server
npm run dev

# App runs at http://localhost:3000
```

---

## Environment Variables

| Variable | Description | Where to get |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only) | Supabase → Settings → API |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Firebase → Project Settings |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service account JSON (minified) | Firebase → Service Accounts |
| `NEXT_PUBLIC_APP_URL` | Your deployed app URL | Your Vercel domain |

---

## User Roles

### Creating users

Currently user creation is done via Supabase Auth admin or a future admin UI. To create the first admin:

1. Go to Supabase → Authentication → Users → Invite user.
2. After creation, run this SQL to set the role:

```sql
UPDATE public.users SET role = 'admin' WHERE email = 'admin@yourschool.com';
```

3. Then also create the admin profile:

```sql
-- Get the user ID from auth.users first
INSERT INTO public.parents (id, school_id)
SELECT id, '00000000-0000-0000-0000-000000000001'
FROM public.users WHERE email = 'admin@yourschool.com';
```

### Parent setup

1. Create user in Supabase Auth.
2. Role defaults to `parent`.
3. Admin links parent to student(s) via `parent_student` table.

### Driver setup

1. Create user in Supabase Auth.
2. Set role to `driver`:
```sql
UPDATE public.users SET role = 'driver' WHERE email = 'driver@school.com';
```
3. Create driver profile:
```sql
INSERT INTO public.drivers (id, bus_id, school_id)
VALUES ('<user_id>', '<bus_id>', '<school_id>');
```

---

## Workflow

### Scan sequence (strictly enforced)

```
MORNING_BOARD → SCHOOL_ARRIVAL → EVENING_BOARD → HOME_DROP
```

Invalid sequences are rejected with HTTP 422. This prevents:
- `SCHOOL_ARRIVAL` before `MORNING_BOARD`
- `HOME_DROP` before `EVENING_BOARD`
- Any scan without an active trip session

### Student status states

| Status | Meaning |
|---|---|
| `not_boarded` | Default — start of day |
| `boarded_morning` | Scanned onto morning bus |
| `reached_school` | Scanned at school gate |
| `boarded_evening` | Scanned onto evening bus |
| `reached_home` | Scanned at home stop |

### Status resets daily

Student statuses should be reset each morning. Add this to a Supabase Edge Function on a cron:

```sql
-- Run at 04:00 every morning
UPDATE public.students 
SET current_status = 'not_boarded' 
WHERE is_active = true 
  AND current_status != 'not_boarded';
```

---

## Deployment to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

When prompted, set all environment variables in the Vercel dashboard under:
**Project Settings → Environment Variables**

### Vercel settings

- Framework: Next.js (auto-detected)
- Root directory: `/`
- Build command: `npm run build`
- Output directory: `.next`

---

## Test Data

Run this SQL in Supabase to create a complete test scenario:

```sql
-- Insert a route
INSERT INTO public.routes (id, school_id, name)
VALUES ('r1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Route A - North');

-- Insert a bus
INSERT INTO public.buses (id, school_id, bus_number, plate_number, capacity)
VALUES ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'BUS-01', 'TS09AB1234', 40);

-- Assign bus to route
INSERT INTO public.bus_route_assignments (bus_id, route_id)
VALUES ('b1000000-0000-0000-0000-000000000001', 'r1000000-0000-0000-0000-000000000001');

-- Insert stops
INSERT INTO public.stops (route_id, name, latitude, longitude, sequence_no) VALUES
('r1000000-0000-0000-0000-000000000001', 'Jubilee Hills Stop',  17.4319, 78.4077, 1),
('r1000000-0000-0000-0000-000000000001', 'Banjara Hills Stop',  17.4156, 78.4347, 2),
('r1000000-0000-0000-0000-000000000001', 'School Gate',          17.3850, 78.4867, 3);

-- Insert a test student
INSERT INTO public.students (id, school_id, full_name, admission_no, class_name, bus_id)
VALUES (
  's1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Rahul Sharma', 'ADM001', 'Class 5',
  'b1000000-0000-0000-0000-000000000001'
);
```

---

## Future Upgrades

The architecture is designed to support:

| Feature | Notes |
|---|---|
| RFID cards | Replace `qr_code` column with `rfid_uid`; scan API accepts either |
| Mobile parent app | React Native — same Supabase/FCM backend |
| Driver mobile app | React Native — same GPS API |
| Geofencing alerts | PostGIS `ST_DWithin` on `bus_locations` + Supabase Edge Functions |
| Bus arrival prediction | ML model on historical `bus_locations` data |
| SMS alerts | Twilio/MSG91 fallback when FCM fails |
| Multi-school support | `school_id` column already on all tables |
| Emergency panic button | New `panic_events` table + priority FCM + SMS |
| Attendance export | Export `scan_events` as Excel per student/class |

---

## Project Structure

```
school-transport-tracker/
├── app/
│   ├── (auth)/login/          # Login page
│   ├── (dashboard)/
│   │   ├── parent/            # Parent live tracking dashboard
│   │   ├── driver/            # Driver GPS + QR scan dashboard
│   │   └── admin/             # Admin fleet management
│   ├── api/
│   │   ├── trips/             # Start/end trip sessions
│   │   ├── scans/             # QR scan processing + notifications
│   │   ├── location/          # GPS ping ingestion
│   │   └── notifications/     # Notification read/mark
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── map/BusMap.tsx         # Leaflet + OpenStreetMap live map
│   ├── qr/QRScanner.tsx       # Camera QR code scanner
│   ├── qr/StudentQR.tsx       # Student QR code display + download
│   └── dashboard/
│       ├── StudentCard.tsx    # Status card with journey timeline
│       └── NotificationPanel.tsx
├── lib/
│   ├── supabase/              # Browser + server + admin clients
│   ├── firebase/fcm.ts        # Push notification sender
│   └── types/index.ts         # All TypeScript types + helpers
├── middleware.ts               # Auth + RBAC route protection
├── schema.sql                  # Complete DB schema with RLS
├── .env.example
├── package.json
└── README.md
```

---

## License

MIT — build on it freely.
