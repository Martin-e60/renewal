# Duedar Settings UI refresh

Replace these files in the project root, keeping the same folders:

- `public/assets/app.js`
- `public/assets/styles.css`
- `public/assets/locales.js`
- `tests/ui.test.js`

No `.env`, server, database, or Resend settings are changed.

## What changed

- Split Settings into Account & appearance, Security & reminders, and Data & billing.
- Stop short cards from stretching to the height of their neighbour.
- Group related form fields and actions with consistent spacing.
- Make the reminder verification state explicit before the enable checkbox.
- Move Delete account into a full-width, clearly separated danger zone.
- Stack the layout cleanly on tablet and mobile screens.
- Add missing Settings translations for German and Spanish.

## Verify

```powershell
npm test
```

Expected result: 45 passing tests.
