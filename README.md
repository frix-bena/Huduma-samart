# Huduma Smart — HELB / HEF AI Automation Consultant

## Overview
Huduma Smart is a web application and AI assistant that connects directly to the Higher Education Financing (HEF) & Higher Education Loans Board (HELB) portal at [portal.hef.co.ke](https://portal.hef.co.ke). It automates login, statement retrieval, balance checking, and disbursement tracking.

## Architecture
- **Frontend**: HTML5, Vanilla CSS design system, and dynamic client script with real-time health probing and conversational UI.
- **Backend Microservice**: Express.js server providing dual-mode portal connectivity:
  1. **Direct Session Engine**: Fast direct HTTP handshake with `portal.hef.co.ke/auth/signin`.
  2. **Playwright Stealth Automation**: Headless Chromium browser automation with stealth plugins and DOM fallbacks.
- **Vercel Serverless Function**: Serverless endpoints in `api/` for serverless deployment.

## Prerequisites
- Node.js (v18+)
- Playwright Chromium (`npx playwright install chromium`)

## Quick Start (Local Development)

1. **Install backend dependencies**:
   ```bash
   cd server
   npm install
   npx playwright install chromium
   ```

2. **Start the application**:
   From the project root:
   ```bash
   npm start
   ```
   Or from the `server/` directory:
   ```bash
   cd server
   npm start
   ```

3. **Open in browser**:
   Navigate to [http://localhost:3001](http://localhost:3001).

## Supported Login Credentials
Users can log into the HEF portal using either:
- **Registered Email Address** (e.g. `student@gmail.com`)
- **Kenyan National ID Number** (e.g. `12345678`)

## Environment Variables
- `PORT` — Port for the Express server (default: `3001`)
- `DEBUG_VISIBLE` — Set to `true` to run Playwright with a visible browser window for debugging
- `PROXY_SERVER` — (Optional) Proxy URL (e.g. `http://proxy.example.com:8080`) to route Playwright headless browser and Node HTTP/HTTPS requests through a Kenyan or residential proxy if the hosting provider's IP is throttled/blocked.
- `PROXY_USERNAME` — (Optional) Username for proxy authentication.
- `PROXY_PASSWORD` — (Optional) Password for proxy authentication.
