# Registration password visibility control

This package adds an eye button to the password field on the registration page.

## Replace these files

Copy the package contents into the Duedar project and replace matching files:

```text
public/assets/app.js
public/assets/styles.css
public/assets/locales.js
tests/ui.test.js
```

The control:

- shows and hides the entered password without changing its value;
- works with keyboard focus and screen readers;
- keeps `autocomplete="new-password"` for password managers;
- has English, German and Spanish labels.

## Verify

Run this from the project folder:

```powershell
npm test
```

Expected result: 44 passing tests.
