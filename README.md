# Food Rescue — One Website Monorepo

> **Hyper-local surplus food dispatch connecting small food contributors, restaurants, NGOs, and dispatch admins in ONE website, ONE codebase, and ONE server.**

---

## Table of Contents
1. [Mission & Overview](#mission--overview)
2. [Core Constraints](#core-constraints)
3. [Architecture & Monorepo Structure](#architecture--monorepo-structure)
4. [Quick Start & Running Locally](#quick-start--running-locally)
5. [Testing & Verification](#testing--verification)
6. [Demo Accounts & Shop Links](#demo-accounts--shop-links)
7. [Device Behavior & Honest Limitations](#device-behavior--honest-limitations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Out of Scope & Next Steps](#out-of-scope--next-steps)

---

## 1. Mission & Overview

Food Rescue serves four distinct user groups on a single web origin:

| Who | Area | Purpose | Needs Login? |
|---|---|---|---|
| **Contributors / Small Shops** | `/post`, `/s/:shopToken`, `/track/:itemToken` | Quick surplus food posting in < 30 seconds | **No install. No login.** |
| **Registered Providers** | `/provider` | Banquet halls & hotels viewing history & shop links | Optional login |
| **NGO Drivers / Pickups** | `/ngo` | Mobile-first PWA receiving waves of offers and GPS trip navigation | Yes |
| **System Admin** | `/admin` | Live operations map, time-to-post metrics, audits, config adjustments | Yes |

### Core Business Flow
1. **Surplus Food Posted:** Contributors post surplus food without installing an app or logging in.
2. **Cluster & Safety Validation:** The server groups nearby compatible food into viable trips.
3. **Wave Offering:** Nearby online NGOs receive exclusive, timed trip offers expanding outward in 4 waves (2 km, 4 km, 7 km, 10 km).
4. **Atomic Accept Lock:** The first NGO to accept secures the trip with atomic database locking (HTTP 200 vs HTTP 409 `TAKEN`).
5. **Collection & Delivery:** The NGO follows step-by-step turn guidance to collect food, confirms donor status, and delivers it safely to the NGO receiver base.

---

## 2. Core Constraints

### Constraint-1: Viable Trips and Safe Windows
- **Minimum Trip Size:** No trip is dispatched below **20 meals** (`MIN_TRIP_MEALS`, editable in admin).
- **Receiver Arrival Deadline:** Every item in the trip must arrive at the receiver before `expiresAt - SAFETY_MARGIN_MIN` (default 10 minutes). It is never sufficient to just reach the pickup stop in time.
- **Automated Left-Out Explanations:** Any item that cannot make it in time is automatically excluded with calculated reason sentences:
  - `CANNOT_REACH_IN_TIME`: *"Left out: needs {need} min to reach the receiver, but only {have} min of safe time is left."*
  - `WOULD_MAKE_TRIP_LATE`: *"Left out: adding it would make the trip arrive {late} min after {title}'s safe time."*
  - `TRIP_FULL`: *"Left out: the trip already has {max} stops."*
  - `WAITING_FOR_FOOD`: *"Waiting: {have} of {min} meals nearby. We decide by {time}."*
  - `NOT_ENOUGH_FOOD`: *"Not dispatched: only {have} meals were nearby before the safe time ended. A trip needs {min}."*
- **Server Enforced Everywhere:** All constraints are calculated and enforced on the server; clients never decide trip viability.

### Constraint-2: Zero Install, Zero Login, Under 30 Seconds
- **No Friction:** Small shop owners do not need an account, password, or OTP.
- **Strict Interaction Budget:**
  - First-time new contributor: **at most 8 interactions** (taps/fields).
  - Returning contributor (remembered in browser): **at most 3 interactions**.
  - Shop link / QR code (`/s/:shopToken`): **at most 3 interactions** (often 1 tap).
  - Smart one-line input (e.g. `20 veg cooked 3h`): **2 interactions** (type + Post).
- **Page Weight Budget:** JavaScript payload for `/post` is **< 90 KB gzipped** (currently 62.4 KB). Map libraries (`leaflet`) are lazy-loaded only if the user explicitly taps "Change location".
- **Real-Time Telemetry:** The server records client time-to-post (`post_ms`) from page load to post submission. Median, 90th percentile, and share under 30 seconds are monitored live on `/admin`.

---

## 3. Architecture & Monorepo Structure

```
food-rescue/
├── packages/
│   └── engine/               # Pure JS ESM: trip planner, cluster heuristics, reason sentences, parser (0 I/O)
│       ├── src/              # constants.js, geo.js, reasons.js, parser.js, planner.js, index.js
│       └── test/             # 13 pure unit tests
├── apps/
│   ├── server/               # Express + SQLite + WebSocket + Web Push (serves API & apps/web/dist)
│   │   ├── src/
│   │   │   ├── db/           # better-sqlite3 schema, indexes, migrations, seed script
│   │   │   ├── services/     # dispatch loop, websocket manager, web-push, rate limiter, injectable clock
│   │   │   └── routes/       # /api/public, /api/auth, /api/ngo, /api/provider, /api/admin, /api/inbound
│   │   └── test/             # 16 server integration tests
│   └── web/                  # Vite + React 18 + React Router PWA
│       ├── public/           # manifest.webmanifest, sw.js, icon.svg
│       └── src/              # QuickPostPage, TrackingPage, NgoPage, ProviderPage, AdminPage, components
├── e2e/                      # Playwright end-to-end tests (multi-context, interaction budgets, race conditions)
├── scripts/
│   ├── check-bundle.mjs      # Enforces < 90 KB gzipped budget on /post JavaScript
│   ├── simulate.mjs          # Autonomous demo simulation driver (Section 11)
│   └── dev.mjs               # Development orchestrator (Express + Vite dev server)
├── .env.example
├── package.json              # Monorepo workspaces & pinned scripts
└── README.md
```

---

## 4. Quick Start & Running Locally

### Prerequisites
- Node.js **v20.x** (or v20.18+)
- npm **10.x+**

### 1. Installation
Clone the repository and install all monorepo dependencies:
```bash
npm install
```

### 2. Seed the Database
Populates the SQLite database with default admin, NGOs, providers, and test shops centered on Bangalore (`12.9716, 77.5946`):
```bash
npm run seed
```

### 3. Start Development Mode
Runs both the backend Express API (port 4000) and the Vite frontend dev server (port 3000) with hot-module reloading:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build & Production Run
To build the optimized frontend and serve the entire application from a single unified server:
```bash
# Build the client bundle into apps/web/dist
npm run build

# Start the unified Express production server on port 4000
npm start
```
Access the application at [http://localhost:4000](http://localhost:4000).

### 5. Running with HTTPS (Self-Signed)
Mobile browser features like **Geolocation**, **Service Workers**, and **Push Notifications** require a Secure Context (`localhost` or `https:`):
```bash
npm run start:https
```
Access the site at `https://localhost:4000` (accept the self-signed certificate warning in your browser).

### 6. Opening on a Real Phone via Secure Tunnel
To test with real phone cameras and sensors without certificate warnings, use a free tunnel (e.g. Cloudflare Tunnel):
```bash
# In a separate terminal while `npm start` is running:
cloudflared tunnel --url http://localhost:4000
```
This generates a secure HTTPS URL (e.g. `https://xxxx.trycloudflare.com`) that you can open directly on any smartphone browser.

---

## 5. Testing & Verification

The codebase includes automated test suites covering pure logic, integration endpoints, bundle weight, and browser interaction budgets.

### Run All Unit and Integration Tests
```bash
npm test
```
*Executes all 13 `@food-rescue/engine` tests and all 16 `@food-rescue/server` integration tests.*

### Check Page Weight Budget (< 90 KB gzipped)
```bash
npm run check-bundle
```
*Analyzes `/post` assets. Passes if total gzipped JavaScript is $\le 90$ KB (currently ~62.4 KB).*

### Run Playwright End-to-End Suite
```bash
npm run e2e
```
*Runs 8 browser scenarios verifying interaction budgets ($\le 8$ new, $\le 3$ returning/shop), offline draft recovery, multi-context NGO notification and accept locks, and mobile responsive viewports (360x640).*

### Full Verification Gate
```bash
npm run verify
```
*Sequentially executes: `npm test` -> `npm run build` -> `npm run check-bundle` -> `npm run e2e`.*

### Run Autonomous Demo Simulation (Section 11)
```bash
npm run demo
```
*Drives the complete end-to-end simulation using only public HTTP API calls:*
1. NGOs 1 & 2 log in and broadcast online locations.
2. Contributor posts 12 meals cooked veg without logging in (verifies "Waiting: 12 of 20 meals nearby").
3. Contributor posts 10 meals packed veg via shop link (trip forms with 22 meals and offers to NGOs).
4. Contributor posts 15 meals with 25-minute expiry 6 km away (excluded with `CANNOT_REACH_IN_TIME`).
5. NGOs 1 & 2 execute simultaneous accept race (verifies exactly one HTTP 200 and one HTTP 409 `TAKEN`).
6. Winner advances all stops to delivery; executes second run with `NOT_AVAILABLE` strike penalty.
7. Logs median time-to-post metrics and exits code 0.

---

## 6. Demo Accounts & Shop Links

| Role | Name | Phone | Password | Base / Location | Capabilities |
|---|---|---|---|---|---|
| **Admin** | Super Admin | `9000000000` | `admin123` | Center | Full dashboard & live map |
| **NGO 1** | Hope Kitchen | `9100000001` | `ngo123` | ~1.3 km NE | Veg/Non-veg, Cooked/Packed |
| **NGO 2** | City Care Foundation | `9100000002` | `ngo123` | ~2.2 km SE | Veg/Non-veg, Cooked/Packed |
| **NGO 3** | Feed Bangalore | `9100000003` | `ngo123` | ~4.5 km NW | Veg/Non-veg, Cooked/Packed |
| **NGO 4** | Pure Veg Seva | `9100000004` | `ngo123` | ~2.5 km SW | **Veg Only**, Cooked/Packed |
| **Provider** | Green Leaf Manager | `9000000001` | `provider123` | Brigade Road | Provider portal & history |

### Quick-Post Shop Links (Instant Zero-Click Geolocation)
- **Green Leaf Restaurant:** [http://localhost:4000/s/shop_greenleaf](http://localhost:4000/s/shop_greenleaf) (VERIFIED)
- **Sunrise Bakery:** [http://localhost:4000/s/shop_sunrise](http://localhost:4000/s/shop_sunrise) (VERIFIED)
- **Royal Banquet Hall:** [http://localhost:4000/s/shop_royal](http://localhost:4000/s/shop_royal) (VERIFIED)
- **Corner Tea Stall:** [http://localhost:4000/s/shop_cornertea](http://localhost:4000/s/shop_cornertea) (UNVERIFIED — requires call confirmation)

---

## 7. Device Behavior & Honest Limitations

Building "Food Rescue as ONE website" enables contributors to post surplus food with zero installation barriers. However, browser environments have well-documented technical boundaries:

1. **Background GPS Tracking:**
   - Standard mobile web browsers (Safari iOS and Chrome Android) pause `navigator.geolocation` updates when a tab is hidden, minimized, or when the phone screen is locked.
   - *Mitigation:* The NGO interface utilizes the **Screen Wake Lock API** while an NGO driver is on duty, and displays a prominent warning if the page is obscured: *"Location pauses in the background. Keep this page open."*
   - Any driver GPS fix older than 180 seconds (`GPS_FRESH_SEC`) is marked stale and excluded from receiving new trip offers.
2. **Push Notifications on iPhone (iOS):**
   - Web Push notifications on iOS Safari require iOS 16.4+ AND require the user to explicitly select **"Add to Home Screen"** before notification permissions can be requested.
   - *Mitigation:* The `/ngo` view detects iOS standalone status and provides step-by-step instructions for adding the app to the Home Screen.
3. **Native Packaging (Phase 2):**
   - If dedicated NGO fleets require persistent 24/7 background geofencing and locked-screen ringing alarms (similar to native Swiggy/Uber driver apps), the existing codebase is designed to be bundled directly into a native shell using **Capacitor** or **React Native WebView**.

---

## 8. Troubleshooting Guide

### 1. "Geolocation blocked on HTTP / Insecure Origin"
- **Cause:** Browsers block geolocation APIs on unencrypted non-localhost HTTP addresses (e.g., `http://192.168.1.10:4000`).
- **Fix:** Run with `npm run start:https` or use a secure tunnel (`cloudflared tunnel --url http://localhost:4000`).

### 2. "Push notifications not arriving on iPhone"
- **Cause:** Mobile Safari on iOS does not support the Web Push API for regular browser tabs.
- **Fix:** Tap the Share icon in Safari, select **"Add to Home Screen"**, launch the Food Rescue PWA from your home screen, and tap "Go Online" to grant push permissions.

### 3. "Port 4000 is already in use (EADDRINUSE)"
- **Cause:** A previous instance of the server or another service is listening on port 4000.
- **Fix:**
  - On Windows PowerShell: `Get-Process node | Stop-Process -Force`
  - Or specify a custom port in `.env`: `PORT=5000 npm start`

### 4. "Map is not loading / displays gray tiles"
- **Cause:** Lack of internet access to OpenStreetMap tile servers (`tile.openstreetmap.org`) or browser ad-blocker interference.
- **Fix:** Maps are wrapped in an `ErrorBoundary` that automatically falls back to clean, legible turn-by-turn text coordinates if tiles cannot be fetched.

### 5. `better-sqlite3` installation on Windows
- **Cause:** Missing C++ build tools if attempting to compile from source.
- **Fix:** This project pins `better-sqlite3@11.8.1`, which provides official prebuilt binaries for Node 20 on Windows 64-bit (`win32-x64`). No Visual Studio C++ toolchain is needed.

---

## 9. Out of Scope & Next Steps

The following features were intentionally excluded from this phase to focus on ultra-fast, robust dispatch logic:
- **Commercial Payments & Invoicing:** Direct micro-grants or NGO reimbursement workflows.
- **Mutual Ratings & Feedback:** 5-star scoring and qualitative food reviews.
- **Multi-City Geofencing:** Autonomous city boundary detection (currently bounded to `SERVICE_AREA_RADIUS_KM = 50 km` around Bangalore).
- **Road Network Routing API:** Uses straight-line distance scaled by city road factor (`ROAD_FACTOR = 1.3`) rather than paid Google Maps or Mapbox Directions API calls.
- **External SMS / WhatsApp Vendors:** `POST /api/inbound/message` is implemented with an agnostic secret header; wiring Twilio or Gupshup webhooks is ready for phase 2.
- **Native Driver Shell:** Wrapping the PWA into a Capacitor APK/IPA for background GPS services.
