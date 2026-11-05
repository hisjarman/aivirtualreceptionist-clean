# AIVirtualReceptionist.online — SaaS rebuild

This branch turns the existing static marketing site into the first stage of a managed receptionist SaaS.

## Preserved
- The existing marketing homepage and demo-request/intake form are retained in `public/index.html`.
- The original root `index.html` remains untouched on this branch.
- The separate `electrician-survey` Render service/repository is not modified.

## Stack
- Node.js + Express API
- Clerk for sign-up/sign-in, Google social login, and session management
- PostgreSQL for tenant-scoped business profiles and lead records
- Render for application hosting and PostgreSQL

## Local setup
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set Clerk keys and a PostgreSQL connection string.
4. Run `npm start`.
5. Open `http://localhost:10000` and choose **Client login**.

## Clerk setup
1. Create a Clerk application.
2. Enable Google as a social connection in Clerk.
3. Enable email and password sign-in (and email verification).
4. Add the deployed application domain to Clerk's allowed origins/redirect URLs.
5. Put the Clerk publishable and secret keys in Render environment variables. Never commit secret keys.

The browser receives only `CLERK_PUBLISHABLE_KEY`. The Clerk secret key stays server-side. API routes verify the Clerk session and scope every database query to the authenticated Clerk user ID.

## Render
The `render.yaml` Blueprint defines a Node web service and PostgreSQL database on free plans in Oregon. Free database availability, limits, and retention can change; verify the plan shown in Render before applying. Applying the Blueprint is a separate step and creates resources. It does not alter the separate survey service.

1. Open the Render Blueprint flow for this repository.
2. Select branch `rebuild-clerk-saas`.
3. Review the web service and database resources.
4. Supply `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in the secure environment-variable fields.
5. Apply only after reviewing the resource/plan details.

## Current implementation boundary
The portal currently supports Clerk sign-in UI, a tenant-scoped business profile, and tenant-scoped lead records. Voice-agent provisioning, Retell/HelloAnswer sync, subscription checkout, HubSpot sync, admin tooling, and production acceptance testing still need to be connected. No Manus SDK or Firebase Auth dependency is used in this implementation.
