# AI Virtual Receptionist — managed onboarding MVP

This branch adds a Node/Express backend and private admin dashboard while retaining the public marketing website.

## What works
- Public demo request form saves directly into PostgreSQL.
- Private admin sign-in using an environment-configured password and signed, HTTP-only session cookie.
- Admin dashboard lists requests and lets you update status and private notes.
- Workflow: New → Contacted → Demo scheduled → Demo sent → Approved → Active (or Closed).
- Basic request rate limits, input validation, and security headers.

## Deploy as a Render Web Service (not Static Site)
1. Create a PostgreSQL database in Render.
2. Create a **Web Service** from this repository and select branch `backend-mvp`.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Add environment variables:
   - `DATABASE_URL`: use the PostgreSQL database's **Internal Database URL** from Render.
   - `ADMIN_PASSWORD`: create a long, unique password.
   - `SESSION_SECRET`: generate a random secret with at least 32 characters.
   - `NODE_ENV`: `production`.
5. Deploy. The server creates the leads table automatically at startup.
6. Test `/api/health`, then submit a demo request through the homepage.
7. Open `/admin` and sign in with your admin password.

## Connect your domain
After the Web Service is healthy, add `aivirtualreceptionist.online` and `www.aivirtualreceptionist.online` in the Web Service's **Settings → Custom Domains**, then follow Render's DNS records. Keep the existing Static Site online until the new Web Service is tested and the domain is switched.

## Important boundaries
- This is an owner-managed intake/admin MVP, not customer self-service.
- Retell and Stripe are not connected yet. No API credentials or payment secrets belong in browser code.
- Admin access is a single operator password configured in Render. Use a unique strong password and keep it private.
- Back up the Render PostgreSQL database and restrict access to your Render account.
- Demo requests contain business contact information; protect access and use it only to respond to the request.
