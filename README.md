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

## Clerk setup — use the existing application

This project already contains Clerk integration. Do **not** run `clerk init` and do not create a second application.

The selected existing Clerk application ID is `app_3LforXQ9gwFjAR2ulQo87gr4ukE`.

From a local checkout of this branch, open a terminal in the project directory and:

1. Authenticate the CLI: `npx -y clerk@latest auth login`.
2. If this project is not already linked to a different Clerk application, link the selected application: `npx -y clerk@latest link --app app_3LforXQ9gwFjAR2ulQo87gr4ukE`.
3. Run `npx -y clerk@latest doctor` to check the integration.
4. If the local development keys are missing, run `npx -y clerk@latest env pull`. Do not overwrite working keys or link away from another application without confirming first.

Configure the selected Clerk application's sign-in methods in the Clerk Dashboard: enable email/password and Google as desired. The current portal UI is already wired to Clerk's sign-in component.

For Render, set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in the web service's environment settings. The publishable key is public; the secret key must remain server-side and must never be committed or pasted into chat. Do not use production keys until the Clerk application is claimed and production configuration is complete.

The browser receives only `CLERK_PUBLISHABLE_KEY`. The Clerk secret key stays server-side. API routes verify the Clerk session and scope database queries to the authenticated Clerk user ID.

## Render
The `render.yaml` Blueprint defines a Node web service and PostgreSQL database on free plans in Oregon. Free database availability, limits, and retention can change; verify the plan shown in Render before applying. Applying the Blueprint is a separate step and creates resources. It does not alter the separate survey service.

1. Open the Render Blueprint flow for this repository.
2. Select branch `rebuild-clerk-saas`.
3. Review the web service and database resources.
4. Supply `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in the secure environment-variable fields.
5. Apply only after reviewing the resource/plan details.

## Current implementation boundary
The portal currently supports Clerk sign-in UI, a tenant-scoped business profile, and tenant-scoped lead records. Voice-agent provisioning, Retell/HelloAnswer sync, subscription checkout, HubSpot sync, admin tooling, and production acceptance testing still need to be connected. No Manus SDK or Firebase Auth dependency is used in this implementation.


## Retell AI integration (initial backend)
- Add RETELL_API_KEY in Render as a secret. Use the Retell API key marked as the webhook key; the backend uses it to verify webhook signatures.
- Add OWNER_CLERK_USER_ID in Render with the platform owner's Clerk user ID. This protects customer and agent assignment endpoints.
- Set the Retell account webhook URL to https://YOUR-RENDER-HOST/api/webhooks/retell and enable call events.
- The backend verifies webhook signatures and timestamps, maps events to a customer by assigned Retell agent ID, and stores call status, transcript, recording URL, duration, analysis and cost.
- Owner-only API endpoints list customers and assign each customer's Retell agent ID and phone number. Customers can only read their own calls.
- The dashboard will display recent call activity after the customer is assigned a Retell agent ID.

This is an initial integration foundation, not a complete self-serve provisioning flow. It does not yet automatically create Retell agents or purchase phone numbers. Add those actions with plan and usage controls before exposing them to customers.
