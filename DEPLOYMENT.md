# Fresh deployment from zero — Netlify Server + Neon, no credit card

This is the complete start-to-finish guide for a brand-new deployment of the Mr Paint
Srilanka / Peradeniya attendance system. It starts at the Google OAuth client and the empty
GitHub repository, then creates the database, deploys the app, and prints the QR poster.

The chosen stack is:

| Piece | Service | Cost / card |
| --- | --- | --- |
| App + HTTPS | **Netlify Server** (long-lived Node.js process) | Free plan, no card |
| Database | **Neon PostgreSQL** free plan | Free, no card |
| Sign-in | **Google Identity Services** | Free |
| QR poster | Generated locally | Free |

Netlify Server runs the existing Express app as a normal long-lived process, so there is no
serverless adapter, no database connection pool churn, and no 15-minute sleep timer to fight.
It scales to zero after five minutes of inactivity and starts again on the next request.

> **Do not use the Neon connection string or Google client secret that were pasted into chat.**
> The Neon password must be treated as public. The Google client secret is not used by this app
> at all. Delete or rotate both, then continue with new values. Never paste either one into a chat
> again.

---

## Before you begin

Have these ready:

- [ ] A Google account for the admin.
- [ ] A GitHub account.
- [ ] A Netlify account (created in Step 4; sign up with GitHub).
- [ ] A Neon account (created in Step 3).
- [ ] Node.js 22 or newer on this PC. Netlify Server itself requires Node.js 24, which is set in
      `netlify.toml`; the local copy can use Node 22 or newer.
- [ ] The office latitude and longitude. In Google Maps, right-click the exact entrance and copy
      the two numbers.
- [ ] A long admin password (10+ characters, not a dictionary word).
- [ ] Access to the project folder:
      `C:\Users\user\OneDrive\Documents\Opencode\Attendance`.

The repository already contains `netlify.toml` and `netlify/server/index.mjs`, so most platform
settings are committed. You only need to create the accounts, enter secrets, and deploy.

---

## Step 1 — Create the Google OAuth client

You only need a **client ID**. This app never uses a Google client secret. If a client already
exists and its secret was exposed, keep the client ID (it is public) and reset/delete the secret,
or delete the whole client and make a new one.

### 1.1 Create or select the Google Cloud project

1. Open <https://console.cloud.google.com/>.
2. Accept the terms if prompted.
3. At the top, click the project selector → **New project**.
4. Name it `Mr Paint Attendance` (the name is not shown to employees).
5. Click **Create**, then select the new project.

### 1.2 Configure the OAuth consent screen

The screens in the current Google Cloud console are called **Google Auth Platform** in some
accounts; the older name is **OAuth consent screen**. The values are the same.

1. Go to **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Audience**).
2. Choose **External** as the user type.
3. Fill in:
   - **App name:** `Mr Paint Attendance`
   - **User support email:** your email
   - **Developer contact information:** your email
4. Save and continue.
5. Add the scopes used by the app:
   - `openid`
   - `email`
   - `profile`
6. For **Test users**, add every Google account that will use the app, or publish the app:
   - While the app is in **Testing**, only listed test users can sign in.
   - Click **Publish app** to move it to **In production**. These basic sign-in scopes normally do
     not require Google verification. If Google asks for verification, adding each employee as a
     test user is a valid temporary workaround for a small team.
7. Save.

### 1.3 Create the OAuth client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name: `Attendance web`.
5. Under **Authorized JavaScript origins**, add only:
   - `http://localhost:3000` (for local testing)
   - You will add the production Netlify URL in Step 4.5. Do not guess it now.
6. Leave **Authorized redirect URIs** empty. This app uses Google Identity Services, not a redirect
   flow.
7. Click **Create**.
8. Copy the **Client ID**, which ends in
   `.apps.googleusercontent.com`. This is a public identifier; it is safe to keep in the app
   configuration.
9. Do **not** copy the client secret into the app, a file, Git, or chat. The app does not read it.
   If a secret was exposed, click the client → **Reset secret** (or delete the client and create a
   new one).

For this deployment, the new client ID is:

```text
603722643576-0nqut2msb9abfqf3p00koiable9etjq6.apps.googleusercontent.com
```

Use that exact value as `GOOGLE_CLIENT_ID` in Netlify and in your local `.env`.

---

## Step 2 — Create the GitHub repository

The target repository for this deployment is:

```text
https://github.com/Ravindranathamu/mrpperaatt.git
```

If you are creating a completely new repository:

1. Open <https://github.com/new>.
2. Repository name: `mrpperaatt` (or another name).
3. Choose **Private** if you do not want the source public.
4. Do **not** add a README, `.gitignore`, or license; the local project already has them.
5. Click **Create repository**.

Then connect this local folder. Open PowerShell in the project folder:

```powershell
cd C:\Users\user\OneDrive\Documents\Opencode\Attendance
git remote set-url origin https://github.com/Ravindranathamu/mrpperaatt.git
git add .
git commit -m "Prepare Netlify deployment"
git push -u origin main
```

If the local repository has no remote yet, use this instead of `git remote set-url`:

```powershell
git remote add origin https://github.com/Ravindranathamu/mrpperaatt.git
```

If Git asks you to sign in, use the browser/Git Credential Manager. Do not create a personal
access token just for this.

Before pushing, confirm secrets are ignored:

```powershell
git check-ignore .env deployment.local.md data\attendance.db qr\attendance-poster.html
git status --short
```

`.env` must **not** appear in `git status`. It contains local secrets and must never be committed.

---

## Step 3 — Create the Neon PostgreSQL database

### 3.1 Discard the exposed database

If the Neon connection string was posted in chat, delete that Neon project. Do not reuse its
password. It is simpler and safer to start clean than to rotate a password that is already public.

### 3.2 Create the new project

1. Sign up or sign in at <https://neon.tech/>. The free plan does not require a card.
2. Click **New project**.
3. Name: `mrpp-attendance`.
4. PostgreSQL version: use the current default (17 or newer).
5. Region: **AWS Europe (Frankfurt) — `eu-central-1`**.
   - This matches the Netlify Server region configured in `netlify.toml` (`fra` / Frankfurt).
   - Keeping the app and database together matters for page and report speed.
6. Create the project.
7. Open **Connect** (or **Connection string**).
8. Enable **Pooled connection** and copy the full string. It looks like:

   ```text
   postgresql://neondb_owner:PASSWORD@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

9. Keep the pooled host and both query parameters. The app strips `sslmode` and
   `channel_binding` before passing the URL to `node-postgres`, and enables TLS explicitly.
10. Store the string in a password manager. It will be entered only in Netlify as `DATABASE_URL`.

Do not create tables or run SQL. On the first API request the app creates:

- `employees`
- `attendance`
- `departments`
- `holidays`

It also seeds the nine standard departments: **Service**, **Day Body Wash**, **Clean Park**,
**Night Body Wash**, **Workshop 1**, **Workshop 2**, **Paint A**, **Paint B**, and **Paint C**.

### 3.3 If you must keep a Singapore Neon project

The app will work with a Singapore database, but the Netlify Server runs in Frankfurt or Ohio.
Every query crosses regions, making the dashboard and reports noticeably slower. For this build,
recreate the database in Frankfurt as described above. Do not reuse the exposed project.

---

## Step 4 — Deploy to Netlify

Netlify's free plan does not require a credit card. Netlify Server is in Early Access and is free
to use during that period. The free plan allows one small server instance, which is enough for an
attendance system with a few dozen employees.

### 4.1 Create the Netlify account

1. Open <https://app.netlify.com/signup>.
2. Sign up with **GitHub**. No card is requested.
3. Authorize Netlify to see your GitHub repositories. You can grant access to only
   `Ravindranathamu/mrpperaatt` if Netlify offers repository selection.

### 4.2 Import the project

1. In the Netlify dashboard, click **Add new project** (older UI: **Add new site**) →
   **Import an existing project**.
2. Choose **GitHub**.
3. Select `mrpperaatt`.
4. Set:
   - **Branch to deploy:** `main`
   - **Build command:** `npm ci --ignore-scripts`
   - **Publish directory:** `public`
   - **Functions directory:** leave empty
   - **Server directory:** leave empty; Netlify detects `netlify/server/`
5. Do not click Deploy yet. Add the environment variables first (Step 4.3).

`netlify.toml` repeats the build command and publish directory, sets Node.js 24, chooses the
Frankfurt server region, and adds security headers. It also sets `includedFiles` so the server
archive ships `node_modules`; Netlify's server bundler leaves npm packages external, and without
that setting the deployed server cannot resolve Express, Knex, `pg`, and the rest. Do not remove
it. The dashboard values may be filled from the file.

### 4.3 Add environment variables

In the project, open **Site configuration → Environment variables** (or **Project configuration →
Environment variables**) and add every row below. Use the **Add a variable** button; do not upload
a `.env` file.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `COMPANY_NAME` | `Mr Paint Srilanka` |
| `BRANCH_NAME` | `Peradeniya` |
| `COPYRIGHT_NAME` | `RavSOFT` |
| `CONTACT_PHONE` | `+94755756803` |
| `CONTACT_EMAIL` | `ravindranath@hotmail.co.uk` |
| `TIMEZONE` | `Asia/Colombo` |
| `GOOGLE_CLIENT_ID` | the client ID from Step 1 |
| `ADMIN_PASSWORD` | your long, unique admin password |
| `SESSION_SECRET` | 64 random hex characters (command below) |
| `DATABASE_URL` | the pooled Neon connection string from Step 3 |
| `DATABASE_SSL` | `true` |
| `OFFICE_LAT` | office latitude, e.g. `6.9271` (replace with Peradeniya) |
| `OFFICE_LNG` | office longitude, e.g. `79.8612` (replace with Peradeniya) |
| `ALLOWED_RADIUS_METERS` | `75` to start; 50–150 is practical |
| `MAX_GPS_ACCURACY_METERS` | `250` |
| `WORK_START` | `07:00` |
| `WORK_END` | `16:00` |
| `NIGHT_SHIFT_START` | `16:00` |
| `GRACE_MINUTES` | `10` |
| `WORK_DAYS` | `1,2,3,4,5` |
| `PUNCH_COOLDOWN_SECONDS` | `45` |
| `OPEN_SHIFT_HOURS` | `20` |
| `ALLOW_SELF_REGISTRATION` | `false` |
| `ALLOWED_EMAIL_DOMAINS` | leave empty when self-registration is off |

For every variable, open its **Scopes** and make sure **Functions** (or **All scopes**) is enabled.
A variable scoped only to builds is not visible to the running server.

Generate the session secret locally:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output directly into Netlify. Do not save it in the repository, and do not paste it into
chat.

Do **not** set `PORT`. Netlify gives the server a port through `process.env.PORT`.

The app refuses to start in production if `ADMIN_PASSWORD` is missing, shorter than 10 characters,
or a known weak value, or if `SESSION_SECRET` is missing, shorter than 32 characters, or a
placeholder.

For a personal Gmail team, `ALLOW_SELF_REGISTRATION=false` is recommended. You will add each
employee's exact Gmail address in the admin dashboard. The geofence still applies.

### 4.4 Deploy

1. Click **Deploy** / **Deploy site**.
2. The first build installs dependencies and bundles the server. It normally takes a few minutes.
3. A successful log shows the site is live and the server was detected. The exact wording changes
   during Early Access; look for a completed deploy with no red errors.
4. Open **Site configuration → General → Site details → Change site name** and choose something
   stable, for example `mrpp-attendance`. The production URL becomes:

   ```text
   https://mrpp-attendance.netlify.app
   ```

   Netlify may add a random suffix if the name is taken. Use whatever exact URL the dashboard
   shows; it is stable until you change it.

5. Open these URLs:

   ```text
   https://YOUR-SITE.netlify.app/api/ping
   https://YOUR-SITE.netlify.app/api/health
   ```

   Both should eventually return `{"ok":true}`. `/api/ping` never touches the database.
   `/api/health` is the first request that wakes Neon, creates the tables, and seeds departments;
   it can take a few seconds on the very first call.

6. Open `https://YOUR-SITE.netlify.app/admin` and sign in with `ADMIN_PASSWORD`.

If the first request returns `502` or takes longer than 20 seconds, check **Logs → Functions/Server**
in Netlify and confirm every environment variable is present. A cold Netlify Server plus a cold
Neon database is the slowest request the app will ever make.

### 4.5 Authorize the production URL in Google

Until this is done, the Google button fails with `origin_mismatch` or
`The given origin is not allowed for this client`.

1. Open Google Cloud Console → **APIs & Services → Credentials**.
2. Open the OAuth client created in Step 1.
3. Under **Authorized JavaScript origins**, add the exact production origin:

   ```text
   https://YOUR-SITE.netlify.app
   ```

   Use **only** the scheme and host. No trailing slash, no `/admin`, no path.
4. Save. Allow a few minutes for Google to apply the change.
5. Hard-refresh the employee page on a phone and test sign-in.

If you later add a custom domain, add that exact origin too. Changing the Netlify site name changes
the origin and requires updating Google and regenerating the QR poster.

---

## Step 5 — First-run setup and acceptance test

Do these in order:

1. Open `/admin` and log in.
2. Open **Departments**. Confirm all nine standard departments exist.
   - Service, Day Body Wash, Clean Park: `07:00–16:00`
   - Night Body Wash: `16:00–21:00`
   - Workshop 1, Workshop 2, Paint A, Paint B, Paint C: `07:00–16:00` defaults
   - Adjust any shift that differs at your branch. The Workshop/Paint times are editable defaults.
3. Open **Employees** and add each real employee. Use their exact Google email address and assign
   their department.
4. On a phone, scan a temporary QR or open the site URL, tap **Sign in with Google**, allow
   location, and check in near the office.
5. Test the rejection path away from the office:
   - Check-in outside the radius must be rejected.
   - Check-out outside the radius must close the shift at the department end time and mark it
     **Pending approval**.
   - The employee must be blocked from the next check-in until an admin approves it.
6. In **Reports**, approve the pending row once with the saved time and once after editing the time.
7. Download the monthly CSV, raw CSV, and Excel file. Confirm:
   - Email addresses are absent.
   - Totals appear next to employee names.
   - Night Body Wash cells are yellow.
   - Pending cells are red.
8. Confirm the Excel and CSV filenames start with `Peradeniya_attendance_...`.
9. Test a day worker staying into Night Body Wash: one continuous shift, with only the evening
   portion counted as Night Body Wash.
10. Test Workshop/Paint overtime: time after the scheduled finish counts as overtime, not Night
    Body Wash.

---

## Step 6 — Print the QR poster

Only do this after the final HTTPS URL is known.

```powershell
cd C:\Users\user\OneDrive\Documents\Opencode\Attendance
npm run qr -- https://YOUR-SITE.netlify.app "Main entrance"
```

Output is written to the gitignored `qr/` folder. Open `qr/attendance-poster.html` in a browser and
print it at 100% on A4. Check that the QR resolves to the production URL, not `localhost` and not a
Netlify deploy-preview URL.

The QR is static. It can stay on the wall permanently as long as the site name and domain do not
change. If you change the domain, regenerate and reprint the poster.

---

## Step 7 — Day-to-day operation

### No keep-awake monitor is needed

Netlify Server scales to zero after about five minutes without requests. The next visitor may wait
a few seconds for the server and Neon to wake. That is normal and does not require UptimeRobot or
cron-job.org.

Do not continuously ping `/api/health`. It queries Neon and can keep the free database awake. If
you ever need a database-free liveness check, use `/api/ping`; it is intentionally not connected to
Postgres.

### Updating the app

```powershell
cd C:\Users\user\OneDrive\Documents\Opencode\Attendance
npm test
git add .
git commit -m "Describe the change"
git push
```

Netlify builds and deploys every push to `main` automatically. Environment-variable changes do not
reach a running server until you trigger a new deploy: **Deploys → Trigger deploy → Deploy site**.

Changing `SESSION_SECRET` signs every admin and employee out. Changing `ADMIN_PASSWORD` affects
future admin logins; existing admin sessions can last up to 12 hours unless you also rotate
`SESSION_SECRET`.

### Free-tier behaviour

- Netlify Free does not require a card and permits commercial projects.
- The free plan runs one small server instance. It scales to zero after inactivity and has a cold
  start on the next request.
- Netlify Server is in Early Access and is free during that period. Pricing will be announced
  before general availability. Watch the Netlify usage/billing page; do not add a card unless you
  deliberately choose to upgrade.
- Neon Free includes a monthly compute allowance and scales to zero when idle. For a single
  branch, normal attendance use is far below it. Read the current Neon limits in the dashboard.
- Free tiers have no uptime SLA. The app is designed to survive restarts and cold starts, but a
  request in flight can fail during a deploy. For guaranteed uptime, a paid host is the eventual
  answer.

### Keep local deployment notes

`deployment.local.md` is gitignored. Fill in the repository, Netlify URL, Neon region, Google
client ID, and last deployed commit. Never write the Neon password, `ADMIN_PASSWORD`, or
`SESSION_SECRET` there.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Netlify asks for a credit card | You are on a paid flow or added a domain/feature that requires billing. The Free plan itself requires no card. Create the site from the Free team and do not add a payment method. |
| Build says Node.js version is too old | Netlify Server needs Node.js 24. Confirm `NODE_VERSION = "24"` in `netlify.toml` and that the file is committed. |
| Build cannot find the server | Keep the entry at `netlify/server/index.mjs`. There must be exactly one of `index.js`, `index.mjs`, `index.ts`, or `index.mts` in that folder. |
| `502` on every request | Check Netlify server logs. The usual cause is a missing/invalid environment variable. `ADMIN_PASSWORD`, `SESSION_SECRET`, and `DATABASE_URL` are required. |
| First request takes several seconds | Netlify Server and Neon were asleep. This is expected. Retry; subsequent requests are fast. |
| `origin_mismatch` / origin not allowed | Add the exact `https://….netlify.app` origin to the Google OAuth client. No trailing slash. Wait a few minutes and hard-refresh. |
| Google sign-in says `invalid_client` | `GOOGLE_CLIENT_ID` is missing or does not match the client. Fix it in Netlify and redeploy. |
| `relation "employees" does not exist` | The first API request could not initialize the database. Check `DATABASE_URL`, SSL, and Netlify logs, then retry `/api/health`. |
| `channel_binding` or `sslmode` error | The deployed code is old. This version strips both parameters. Confirm the latest commit is deployed. |
| Admin password rejected | Check `ADMIN_PASSWORD` for typos and redeploy after changing it. The app rejects weak/short values at boot. |
| Site works but reports are slow | The Neon project may be in Singapore while Netlify Server is in Frankfurt. Recreate Neon in `eu-central-1`. |
| Employee cannot check in | Confirm their exact Gmail is in Employees and active, `ALLOW_SELF_REGISTRATION=false` is intentional, and location permission is allowed. |
| Out-of-office checkout says pending | That is the designed workflow. Approve or edit the time in **Reports**. |
| Lost admin password | Change `ADMIN_PASSWORD` in Netlify, redeploy, then rotate `SESSION_SECRET` to invalidate old sessions. |

---

## Credential rotation checklist

Because credentials were pasted into chat, do this once:

- [ ] Delete the exposed Neon project (recommended) or reset `neondb_owner`'s password in Neon.
- [ ] If the Neon project is kept, replace `DATABASE_URL` in Netlify with the new connection string.
- [ ] Reset the Google OAuth client secret (or delete the client and create a new client ID).
      Remember: the app does not use a client secret.
- [ ] Confirm no secret is present in Git: `git log --all -- .env`, GitHub secret scanning, and
      `git status`.
- [ ] Never place `DATABASE_URL`, `ADMIN_PASSWORD`, or `SESSION_SECRET` in a file that is committed.

---

## What changed in this repository for Netlify

- `netlify.toml` — build settings, Node 24, Frankfurt server region, security headers, `/admin`
  rewrite, and `includedFiles` for the server's `node_modules`.
- `netlify/server/index.mjs` — wraps the existing Express app in a long-lived Node HTTP server.
- `server.js` — initializes the schema and seeds departments lazily on the first API request, so
  startup is fast and serverless/scale-to-zero hosts work correctly.
- `src/db.js` — strips `channel_binding` as well as `sslmode`, which Neon includes in its connection
  string but `node-postgres` does not understand.
