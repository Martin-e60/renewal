# Duedar dashboard, pricing and contact refresh

This package updates only the presentation and browser-side interactions. It does not change the database schema, Stripe settings, Resend settings, or API routes.

## Changed files

- `public/assets/app.js`
- `public/assets/styles.css`
- `public/assets/locales.js`
- `tests/ui.test.js`

## What changed

- Dashboard: the radar now sits beside the next payment, the spending chart and upcoming renewals share the next row, review cards move lower, and the `Manual tracking` card is removed.
- Calendar: desktop cells and spacing are more compact.
- Landing page: added a keyboard-accessible testimonial carousel with placeholder names, lorem ipsum quotes, and varied ratings.
- Pricing: Starter and Pro now list their included capabilities in separate, readable cards.
- Contact: the email action uses `mailto:`, includes a copy-email fallback, and the page has an expandable FAQ.

## Test locally

From the repository root:

```powershell
npm test
npm start
```

Then open `http://localhost:3000` and check:

1. Dashboard with at least two subscriptions.
2. Calendar on desktop and mobile-width browser view.
3. Landing page testimonial arrows and dots.
4. Pricing lists.
5. Contact email button, Copy email, and FAQ expansion.

## Commit

```powershell
git status
git add public/assets/app.js public/assets/styles.css public/assets/locales.js tests/ui.test.js
git commit -m "Refine dashboard and public pages"
git push origin michael
```

Create a pull request from `michael` into `main`, then merge it after the checks pass.
