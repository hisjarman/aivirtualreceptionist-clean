# AI Virtual Receptionist — website

A standalone responsive marketing website and demo-request form.

## Deploy on Render
1. In Render, choose **New + → Static Site**.
2. Connect the GitHub repository `hisjarman/aivirtualreceptionist-clean`.
3. Select branch `main`.
4. Leave **Build Command** blank.
5. Set **Publish Directory** to `.`.
6. Create the site.

## Connect the domain
In the Render site's **Settings → Custom Domains**, add `aivirtualreceptionist.online` and optionally `www.aivirtualreceptionist.online`. Follow Render's DNS instructions exactly at your domain registrar.

## Activate the form
The form currently uses FormSubmit and sends requests to `hisjarman@gmail.com`. On the first real form submission, FormSubmit sends an activation email to that inbox. Open it and click its activation link. Test the form afterward.

## Scope
This is a public marketing site and lead-intake form only. It does not yet include a customer dashboard, user accounts, Retell integration, call logs, or subscription billing. Do not put Retell API keys or other secrets in this static website.
