# Duedar Resend template integration

This package is based on Duedar `main` commit `26172ff`.

## Replace exactly one code file

Replace this file in the project:

```text
server/server.js
```

Do **not** replace `.env` and do not put API keys in Git.

## One Vercel variable for the Welcome sender

Add this variable to both **Production** and **Preview**:

```text
MAIL_FROM_WELCOME=Duedar <hello@duedar.com>
```

If it is not set, Welcome emails safely fall back to the normal `MAIL_FROM`
sender (`support@duedar.com`).

## Template aliases used by the server

The aliases are built-in defaults. No additional Vercel variables are needed
unless an alias is renamed later.

| App flow | Alias | Variables |
| --- | --- | --- |
| New registration | `duedar-welcome` | none |
| Password changed or reset completed | `duedar-password-changed` | none |
| Confirm a new email address | `duedar-confirm-new-email-address` | `EMAIL_CONFIRM_URL` |
| Renewal reminder | `duedar-renewal-reminder` | `SERVICE_NAME`, `RENEWAL_DATE`, `AMOUNT`, `SUBSCRIPTION_URL` |
| Forgot password | `duedar-password-reset` | `RESET_URL` |
| Verify reminder email | `duedar-confirm-reminder-email` | `VERIFY_URL` |

## Safety behavior

- Email delivery remains plain-text when Resend is not configured, so local mail-relay tests continue to work.
- Welcome and password-changed notification delivery never blocks registration or a successful password change.
- Password reset, email-change confirmation, and reminder-email verification remain delivery-critical: an error is returned if their email cannot be sent.

## Before committing

```powershell
npm test
git add server/server.js
git commit -m "Wire Duedar Resend email templates"
git push origin michael
```

Then open a pull request to `main`, merge it, and wait for the Vercel deployment.
