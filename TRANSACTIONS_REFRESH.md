# Transactions workspace refresh

This package replaces duedar-simplified-20260913.zip. Do not apply that older package afterwards.
Base: main commit 4e18b12. Includes the existing import picker and Pro pricing changes.

## Changes

- Payment list first: date, merchant, amount, and category at a glance.
- Per-payment Details & edit reveals account, type, and category controls.
- Import CSV is the primary action; manual additions share one menu.
- Search and result count live together above the list.
- Sort and page size are under Sort & display.
- Filters always show the current scope and can be cleared in one click.
- Spending totals and import metadata remain available below the list.
- Bulk actions appear when at least one payment is selected.
- Mobile rows become cards; editing targets stay touch sized.

## Install and verify

Start with a clean working tree. Update michael from the remote before extracting.
If Martin has changed the same files since 4e18b12, merge the changes instead of overwriting them.
Extract the ZIP into D:\renewal, preserving its public/assets and tests directories.

```powershell
npm test
git diff --check
npm start
```

Open http://localhost:3000/dashboard/transactions and hard refresh.
Check desktop and phone widths (320, 390, and 440 pixels), light and dark themes:

1. Search for a known merchant, type several characters, then clear the search.
2. Search for an unknown merchant; Clear filters restores the full list.
3. Apply date, account, category and type filters; the visible scope reflects them.
4. Open Details & edit, change a category, then reload to confirm persistence.
5. Select a payment, change categories in bulk, then clear selection.
6. Open Sort & display; check sorting and pagination.
7. Expand Spending summary; EUR and USD totals remain separate.
8. Open Add manually and verify both actions; import a CSV through the existing wizard.
9. Open removal confirmation for an imported file and cancel it.

49 automated tests pass, including real API/database workflows. Browser visual QA was unavailable in the build environment; do not treat these tests as a browser screenshot review.

## Commit after review

```powershell
git add -- public/assets/app.js public/assets/transactions.css public/assets/locales.js tests/ui.test.js TRANSACTIONS_REFRESH.md
git commit -m "Simplify transaction navigation and payment editing"
git push origin michael
```
