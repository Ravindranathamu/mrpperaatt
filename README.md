# Scan & Go Attendance

A complete, self-hosted QR attendance system for a single branch or office.

Employees scan a printed QR code with their phone camera, sign in with Google once, allow
location, and tap **Check in** or **Check out**. A GPS geofence verifies they are at the office.
The admin dashboard shows live attendance, manages employees and holidays, and downloads a
month-end attendance sheet that opens in Excel.

No employee app to install. No monthly fee if you stay within the free tiers of Neon and Render.

---

## What you get

- **Printed static QR code** — the same poster works every day; nothing to regenerate each morning.
- **Google sign-in** — employees are identified by their verified Google email.
- **One-tap check-in/out** — the app decides which action is next automatically.
- **GPS geofence** — configurable radius around the office; check-in from home is rejected.
- **Admin dashboard** — today's live board, employee management, holidays, date-range reports.
- **Department shifts** — each department can have its own check-in start, finish time, and grace
  period; lateness follows the employee's department.
- **Evening rules by department** — Service, Day Body Wash, Clean Park, and Night Body Wash earn
  Night Body Wash hours. Workshop and Paint departments earn overtime after their scheduled finish.
- **Day-to-night continuity** — an eligible worker who stays from a day shift into Night Body Wash
  keeps one continuous shift; the evening portion is reported as Night Body Wash hours.
- **Report filters** — narrow reports by department and employee before previewing or downloading.
- **Branch-prefixed downloads** — files are named like
  `Peradeniya_attendance_2026-11-01_to_2026-11-11.csv` using `BRANCH_NAME`.
- **Monthly attendance sheet** — a payroll-friendly CSV with totals next to each employee name and
  one column per day. A matching **Excel** download highlights every date cell that includes Night
  Body Wash hours.
- **Raw data CSV** — one row per shift, including department shift, distance, late status, Night
  Body Wash hours, and overtime hours.
- **Timezone-aware** — all dates, times, late calculations, and reports use your office timezone.
- **Free production stack** — Render for the app and Neon for the database, both HTTPS.
- **Secure by default** — server-side Google token verification, signed HttpOnly sessions,
  rate limits, origin checks, protected admin exports, and CSV formula-injection protection.

---

## How it works

```
 Phone camera
      │  scans printed QR
      ▼
 https://your-app.onrender.com  ──►  Express app on Render
      │                                   │
      │  Google ID token                  │  SQL over TLS
      ▼                                   ▼
 Google Identity                     Neon PostgreSQL
      │
      │  browser geolocation
      ▼
 Server checks distance from office coordinates
```

1. The QR code contains only your app URL. It can be printed once and left on the wall.
2. On first use, the employee signs in with Google. The server verifies the Google ID token
   itself, so a forged browser request cannot fake an email.
3. Each tap sends latitude, longitude, and GPS accuracy to the server.
4. The server calculates the distance to `OFFICE_LAT` / `OFFICE_LNG`. Outside the radius, the
   punch is rejected. The server does not trust a "yes" from the browser.
5. Check-ins and check-outs are stored in UTC; reports are grouped by your office timezone.
6. An eligible day worker who continues into Night Body Wash does not check out at the end of the
   day shift. The same open record runs until the final check-out, and time after the day shift is
   reported as Night Body Wash hours. Workshop and Paint workers are not eligible: time after their
   scheduled finish is reported as overtime instead. A shift that ends after midnight still belongs
   to its starting date.

---

## Project files

| Path | Purpose |
| --- | --- |
| `server.js` | Express app, API routes, auth, reports, startup |
| `src/config.js` | Environment parsing and production safety checks |
| `src/db.js` | SQLite/PostgreSQL connection and automatic table creation |
| `src/time.js` | Timezone, date, duration, and DST-safe conversion helpers |
| `src/schedule.js` | Department and default shift resolution |
| `src/reports.js` | Matrix sheet, raw rows, CSV, and highlighted Excel generation |
| `src/auth.js` | Google token verification, sessions, admin guard |
| `src/geo.js` | Haversine distance calculation |
| `public/index.html`, `public/app.js` | Employee phone page |
| `public/admin.html`, `public/admin.js` | Admin dashboard |
| `public/styles.css` | All styles |
| `scripts/make-qr.js` | QR code and printable A4 poster generator |
| `test/` | Unit tests for distance, time, and report logic |
| `.env.example` | Documented configuration template |
| `data/attendance.db` | Local SQLite database (created automatically, gitignored) |

---

## Before you start

You need:

- **Node.js 20 or newer** and npm.
- A **Google account** for the admin, and Google accounts for employees. Google Workspace
  (company domain) is recommended so accounts can be restricted to your domain.
- For production: free accounts at **[Neon](https://neon.tech)** and **[Render](https://render.com)**.
- The **latitude and longitude of your office door** (see Part 4).

This project is already built. You only need to supply the account-level credentials below;
there is no app code to write.

---

## Part 1 — Run it locally

Local mode uses SQLite, so no database setup is needed. Google sign-in will not work until
Part 2, but the admin dashboard works immediately.

### 1.1 Install dependencies

```powershell
cd C:\Users\user\OneDrive\Documents\Opencode\Attendance
npm install
```

### 1.2 Create your local environment file

```powershell
Copy-Item .env.example .env
```

Open `.env` and set at least:

```dotenv
NODE_ENV=development
PORT=3000
COMPANY_NAME=Your Company Name
BRANCH_NAME=Your Branch Name
TIMEZONE=Asia/Colombo
ADMIN_PASSWORD=choose-a-long-unique-password
SESSION_SECRET=generate-a-random-value-see-below
OFFICE_LAT=6.9271
OFFICE_LNG=79.8612
```

Generate a session secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The office coordinates above are central Colombo — **replace them**. Leave `GOOGLE_CLIENT_ID`
empty for now if you only want to look at the admin dashboard.

### 1.3 Start the app

```powershell
npm start
```

You should see:

```
[attendance] Your Company Name
[attendance] Listening on http://localhost:3000
[attendance] Database: SQLite (...\data\attendance.db)
[attendance] Timezone: Asia/Colombo · Default shift: 07:00–16:00
```

Open:

- Employee page: <http://localhost:3000>
- Admin page: <http://localhost:3000/admin>

Sign in to the admin page with `ADMIN_PASSWORD`. Add a test employee under **Employees**, then
use **Reports** to try the CSV export.

To create the company's standard departments in one step, run this in a second terminal:

```powershell
npm run setup:departments
```

It creates the standard departments:

| Department | Default shift | Evening rule |
| --- | --- | --- |
| Service | `07:00–16:00` | Night Body Wash hours |
| Day Body Wash | `07:00–16:00` | Night Body Wash hours |
| Clean Park | `07:00–16:00` | Night Body Wash hours |
| Night Body Wash | `16:00–21:00` | Night Body Wash hours |
| Workshop 1, Workshop 2 | `07:00–16:00` | Overtime after shift finish |
| Paint A, Paint B, Paint C | `07:00–16:00` | Overtime after shift finish |

Existing departments keep their shift times, but the script corrects the evening rule if it does
not match this table. It is safe to run again. All times remain editable under
**Admin → Departments**.

> If Google is not configured, the employee page shows a "Setup needed" card. That is expected
> until Part 2. The admin dashboard still works.

### 1.4 Stop the server

Press `Ctrl+C` in the terminal. Your SQLite data stays in `data/attendance.db`.

---

## Part 2 — Google sign-in (required for employees)

You need a Google **OAuth Web client ID**. This app uses the Google Identity Services button,
which returns an ID token. No client secret and no redirect URI are used.

### 2.1 Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Click the project selector → **New project**.
3. Name it, for example, `Office Attendance`, and click **Create**.
4. Make sure the new project is selected.

### 2.2 Configure the OAuth consent screen

Google's console changes labels occasionally; look for **APIs & Services → OAuth consent screen**
or **Google Auth Platform**.

1. Choose **External** unless you have Google Workspace and want **Internal**.
   - **Internal** is best for a company: only your Workspace users can sign in, and no
     verification is required.
   - **External** works with any Google account. Add employee accounts as **test users** while
     the app is in Testing, or publish it for general use.
2. Fill in the app name, user support email, and developer contact email.
3. Scopes: the app only needs basic profile/email (`openid`, `email`, `profile`). You do not need
   to add Gmail, Drive, Calendar, or any sensitive scope.
4. If using External and staying in **Testing**, add each employee's Google email under
   **Test users**. Testing-mode apps show an "unverified app" warning; that is normal.
5. When ready, click **Publish app**. Google may ask for verification if your branding or scopes
   require it. For a simple internal attendance page, Internal mode avoids this entirely.

### 2.3 Create the OAuth client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name: `Attendance web`.
5. Under **Authorized JavaScript origins**, add:

   ```
   http://localhost:3000
   ```

   For production, you will add your Render URL later (Part 4.5).

6. Leave **Authorized redirect URIs** empty. Click **Create**.
7. Copy the **Client ID**. It looks like `1234567890-abc123.apps.googleusercontent.com`.

Origin rules:

- Include the scheme and port: `http://localhost:3000`, not `localhost:3000`.
- No path, no trailing slash.
- `http://127.0.0.1:3000` is a different origin; use `localhost` consistently.
- Changes can take a few minutes to propagate.

### 2.4 Add it to `.env`

```dotenv
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
```

Restart the server (`Ctrl+C`, then `npm start`). The employee page should now show a Google
sign-in button instead of the setup card.

### 2.5 Test Google sign-in locally

1. Open <http://localhost:3000> in Chrome or Edge.
2. Click **Sign in with Google** and use a test user (or any Workspace account if Internal).
3. The first sign-in auto-creates an employee if `ALLOW_SELF_REGISTRATION=true`. Otherwise add
   the employee first under **Employees**.
4. Allow location when prompted.
5. Tap **Check in**. If the browser's real location is not near your configured office, the
   server will correctly reject it with a distance message. That is the geofence working.

> To test the full check-in locally without being at the office, temporarily set
> `OFFICE_LAT` / `OFFICE_LNG` to your current location, or use your browser's developer tools
> to override geolocation. Change the coordinates back before deploying.

---

## Part 3 — Production database (Neon PostgreSQL)

Render's free web service has an **ephemeral filesystem**. A SQLite file would be erased on every
deploy or restart. Production therefore uses a free Neon PostgreSQL database.

### 3.1 Create the Neon database

1. Sign up at <https://neon.tech>.
2. Create a project. Choose the region closest to your Render region (for Sri Lanka, Singapore
   is usually the closest available region on both services).
3. In the project dashboard, open **Connect** / **Connection string**.
4. Copy the PostgreSQL connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```

5. Keep `?sslmode=require` (the app also sets SSL explicitly). The **pooled** host is fine and
   recommended for a web service.

### 3.2 Add it to the Render environment (not to `.env` in Git)

You will paste this value into Render as `DATABASE_URL` in Part 4.3. The app creates the
`employees`, `attendance`, and `holidays` tables automatically on first boot. There is no
migration command to run.

> Local SQLite data is **not** copied to Neon automatically. If you created test employees
> locally, add them again in the production admin dashboard (or keep testing locally). Plan to
> start production with a clean employee list.

---

## Part 4 — Deploy to Render (free HTTPS)

The app is a standard Node web service. Render supplies HTTPS automatically, which is required
for both Google sign-in and browser geolocation.

### 4.1 Put the project in a Git repository

Render deploys from Git. If Git is not installed, install Git for Windows or use GitHub Desktop.
From the project folder:

```powershell
git init
git add .
git commit -m "Initial attendance app"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

`.gitignore` already excludes `.env`, the local SQLite database, and generated QR artwork.
**Never commit `.env`.** Verify with `git status` that `.env` is not listed.

If you prefer not to use GitHub, Render can also deploy from GitLab or a public Git repository.
The steps below are the same.

### 4.2 Create the Render web service

1. Sign up at <https://render.com> and connect your Git account.
2. Click **New + → Web Service**.
3. Select the repository.
4. Configure:

   | Setting | Value |
   | --- | --- |
   | Name | `attendance` (or anything you like) |
   | Region | Closest to Neon, e.g. Singapore |
   | Branch | `main` |
   | Runtime | `Node` |
   | Build command | `npm ci` |
   | Start command | `npm start` |
   | Instance type | `Free` |
   | Health check path | `/api/health` |

5. Do not add a persistent disk. The database lives in Neon.

### 4.3 Add environment variables

In Render, open **Environment** and add every value below. Do **not** set `PORT`; Render sets it
automatically.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `COMPANY_NAME` | Your company name |
| `BRANCH_NAME` | Your branch name, e.g. `Peradeniya` (prefixes report filenames) |
| `COPYRIGHT_NAME` | `RavSOFT` (copyright owner in footers and on the QR poster) |
| `CONTACT_PHONE` | `+94755756803` |
| `CONTACT_EMAIL` | `ravindranath@hotmail.co.uk` |
| `TIMEZONE` | `Asia/Colombo` (or your IANA timezone) |
| `GOOGLE_CLIENT_ID` | Your OAuth client ID |
| `ADMIN_PASSWORD` | A long, unique password (10+ chars, not `admin12345`) |
| `SESSION_SECRET` | 64 random hex characters from the command in 1.2 |
| `DATABASE_URL` | Your Neon connection string |
| `DATABASE_SSL` | `true` |
| `OFFICE_LAT` | Office latitude, e.g. `6.9271` |
| `OFFICE_LNG` | Office longitude, e.g. `79.8612` |
| `ALLOWED_RADIUS_METERS` | `75` to start (50–150 is practical) |
| `MAX_GPS_ACCURACY_METERS` | `250` |
| `WORK_START` | `07:00` |
| `WORK_END` | `16:00` |
| `NIGHT_SHIFT_START` | `16:00` (fallback when no Night Body Wash department exists) |
| `GRACE_MINUTES` | `10` |
| `WORK_DAYS` | `1,2,3,4,5` (Monday=1, Sunday=7) |
| `PUNCH_COOLDOWN_SECONDS` | `45` |
| `OPEN_SHIFT_HOURS` | `20` |
| `ALLOW_SELF_REGISTRATION` | `true` or `false` (see below) |
| `ALLOWED_EMAIL_DOMAINS` | Your company domain, e.g. `mycompany.com` |

Production safety checks: the app **refuses to start** if `ADMIN_PASSWORD` is missing, shorter
than 10 characters, or a well-known value, or if `SESSION_SECRET` is missing, shorter than 32
characters, or still a placeholder.

Self-registration:

- `ALLOW_SELF_REGISTRATION=true` + `ALLOWED_EMAIL_DOMAINS=mycompany.com` is the easiest setup:
  the first Google sign-in creates the employee automatically, but only for your domain.
- `ALLOW_SELF_REGISTRATION=false` is stricter: the admin must add every employee email first.
- Leaving both open allows any Google user who scans the QR to self-register. The geofence still
  applies, but set your domain in production.

### 4.4 Deploy

1. Click **Create Web Service** / **Deploy**.
2. Watch **Logs**. A healthy boot ends with:

   ```
   [attendance] Your Company
   [attendance] Listening on http://localhost:10000
   [attendance] Database: PostgreSQL
   ```

   (Render may inject a different port; that is normal.)
3. Open `https://YOUR-SERVICE.onrender.com/api/health`. It should return `{"ok":true}`.
4. Open `https://YOUR-SERVICE.onrender.com/admin` and sign in with the production password.
5. Open **Departments** and create **Service**, **Day Body Wash**, **Clean Park**, **Night Body
   Wash**, **Workshop 1**, **Workshop 2**, **Paint A**, **Paint B**, and **Paint C** with their
   shifts and evening rules. You can also run `npm run setup:departments` against the production
   database by setting `DATABASE_URL` and `DATABASE_SSL` in the environment first.
6. Add your real employees and assign their departments, or let domain-restricted
   self-registration create them and assign departments afterwards.

### 4.5 Authorize the Render URL in Google

This step is easy to forget. Until it is done, the Google button fails with `origin_mismatch`.

1. Google Cloud Console → **APIs & Services → Credentials** → your OAuth client.
2. Add under **Authorized JavaScript origins**:

   ```
   https://YOUR-SERVICE.onrender.com
   ```

   Exact host, no trailing slash, no path.
3. Save and wait a few minutes.
4. Hard-refresh the employee page on your phone and test sign-in.

If you later add a custom domain (for example `attendance.mycompany.com`), add that origin too,
then regenerate the QR poster with the new URL.

### 4.6 First production check

- [ ] `/api/health` returns `{"ok":true}`.
- [ ] Admin login works at `/admin`.
- [ ] All nine standard departments exist with the right shifts and evening rules.
- [ ] An employee is in the list (added manually or via self-registration) and has a department.
- [ ] Google sign-in works on a real phone.
- [ ] Location permission is requested.
- [ ] Check-in succeeds near the office and fails away from it.
- [ ] Check-out succeeds near the office and fails away from it.
- [ ] Check-out works.
- [ ] The record appears in the admin **Today** board.
- [ ] The monthly CSV downloads and opens in Excel.
- [ ] The Excel download opens and Night Body Wash date cells are highlighted.
- [ ] The QR link points to the real HTTPS URL, not `localhost`.

### 4.7 Render free-plan behavior

- The free web service **sleeps after a period of inactivity** (currently about 15 minutes) and
  takes roughly a minute to wake on the next visit. Tell employees to wait if the first scan
  feels slow.
- Free services have limited memory/CPU and may restart. Sessions are stored in signed cookies,
  and data is in Neon, so restarts do not lose attendance.
- Do not rely on Render's local disk for anything. The app intentionally uses Neon.
- Provider limits can change. Check the Render and Neon pricing pages before relying on the free
  tiers for a large team.

### 4.8 Updating the app

Push changes to the connected branch. Render rebuilds automatically:

```powershell
git add .
git commit -m "Describe the change"
git push
```

Environment-variable changes trigger a restart. Changing `SESSION_SECRET` signs everyone out.
Changing `ADMIN_PASSWORD` changes future logins; existing admin sessions last up to 12 hours.
To force an immediate admin logout, also change `SESSION_SECRET`.

### 4.9 Free no-card alternative — Back4App Containers

If Render asks for a credit card, **Back4App Containers** has a free plan that does not require
one: 0.25 CPU, 256 MB RAM, 100 GB transfer, and a free HTTPS URL. The repository includes a
`Dockerfile`, so no code changes are needed.

1. Sign up at <https://www.back4app.com> and open **Containers**.
2. Click **Create New App** and connect your GitHub account.
3. Select this repository.
4. Configure:
   - **Branch:** `main`
   - **Root:** `/` (the folder containing `Dockerfile`)
   - **Auto Deployment:** on
5. Add the same environment variables listed in Part 4.3, except **do not set `PORT`**.
   `NODE_ENV=production`, `DATABASE_URL`, and `DATABASE_SSL=true` are still required.
6. Click **Create App** and watch the deployment logs.
7. Copy the generated HTTPS URL from the app dashboard.
8. Open `https://YOUR-APP-URL/api/health`. It should return `{"ok":true}`.
9. Add that exact origin under **Authorized JavaScript origins** in Google (Part 4.5).
10. Sign in at `/admin`, then create departments, employees, and test a real phone.

Back4App's free region is in the USA, so requests from Sri Lanka have more latency than a
Singapore region. The 256 MB memory limit is enough for a small team, but a very large monthly
Excel export may be slower. Free plans can change; check the current limits before relying on one
for payroll.

As a no-card fallback, you can also run the app on an always-on office PC and publish it with
Tailscale Funnel. That requires a stable PC and gives a `https://....ts.net` URL.

---

## Part 5 — Print the QR poster

Generate the poster **after** you know the final HTTPS URL.

### 5.1 Generate the artwork

```powershell
npm run qr -- https://YOUR-APP-URL "Main entrance"
```

The second argument is the location label printed on the poster. Output:

```
qr/attendance-qr.png          High-resolution QR (1400 px)
qr/attendance-qr.svg          Vector QR
qr/attendance-poster.html     A4 poster with instructions
qr/README.txt                 Plain-text record of URL and label
```

`qr/` is gitignored, so posters are generated locally and are never deployed.

To make posters for several entrances, run the command again with a different label and copy
the folder after each run. All posters can point to the same URL.

### 5.2 Print it

1. Open `qr/attendance-poster.html` in Chrome or Edge.
2. Print (`Ctrl+P`).
3. Set:
   - Paper: **A4**
   - Scale: **100%** (not "Fit to page")
   - Margins: **None**
   - **Background graphics: ON**
4. Print on thick paper or card and laminate it.
5. Test the printed code with an iPhone and an Android phone before printing for every entrance.

### 5.3 Place it well

- Eye level, flat, well lit, near the entrance or lift lobby.
- Avoid glass reflections, direct sunlight, and curved surfaces.
- Keep the code large enough to scan from 20–40 cm.
- The QR is public by design. Security comes from Google sign-in plus the GPS geofence, not from
  keeping the code secret. Anyone can photograph it, but only signed-in employees inside the
  radius can record attendance.

---

## Part 6 — Admin guide

Open `https://YOUR-SERVICE.onrender.com/admin`.

### Today

- Live board for the current office date, auto-refreshing.
- **Present** = has a record today, **Working now** = open shift, **Completed** = checked out,
  **Not checked in** = active employee with no record on a working day.
- Shows each employee's shift, check-in/out times, hours, late badge, and distance from the office.
- Holiday name is shown if today is a holiday.

### Departments and shifts

- Open **Departments** to give a team its own **shift start**, **shift end**, **grace period**, and
  **evening rule**. For example, Production might run `08:00–16:30` while Accounts runs
  `09:00–17:00`.
- Assign an employee to a department when adding or editing them. Employees with no department use
  the default `WORK_START` / `WORK_END` / `GRACE_MINUTES` from the environment.
- Lateness is always calculated from that employee's department shift, not a single office-wide
  start time.
- A check-in stores a snapshot of the shift and evening rule that applied that day. Changing a
  department's schedule or eligibility later does not rewrite past results.
- A department cannot be deleted while employees are assigned to it. Reassign them first.
- The monthly sheet and raw CSV include a **Shift** column so payroll can see which schedule applied.

#### Night Body Wash eligibility

- Tick **Night Body Wash eligible** for Service, Day Body Wash, Clean Park, and Night Body Wash.
  Only these departments can earn **Night Body Wash (NB)** hours.
- If an eligible day worker stays on, they **must not check out at 16:00**. They stay checked in and
  check out once when they leave. One record then covers the day and the evening.
- Time after that worker's day shift finishes (and after Night Body Wash starts) is counted as
  **Night Body Wash hours**. It is a subset of **Total hours**, not an extra amount.
- A worker who arrives only for Night Body Wash checks in at the night shift start. Their whole
  shift is Night Body Wash hours.
- The **Night Body Wash** department controls when night hours begin. Edit its start/end under
  **Departments** whenever the night schedule changes. The sheet shows the default `16:00–21:00`
  until you change it. If the department is missing or renamed, `NIGHT_SHIFT_START` is used.
- A night shift that ends after midnight remains on its **starting date** in reports. The next day
  is a fresh attendance record.
- Because a day can only have one record, an accidental 16:00 check-out cannot be followed by a
  second check-in. Make sure employees who are staying on keep the shift open.

#### Overtime for Workshop and Paint teams

- Workshop 1, Workshop 2, Paint A, Paint B, and Paint C are **not** Night Body Wash eligible.
  Leave **Night Body Wash eligible** unticked for them.
- Time after their scheduled **shift end** is reported as **overtime (OT)**. It is never labelled
  Night Body Wash, even when they work past 16:00.
- Overtime is also a subset of **Total hours**, not an extra amount.
- Departments with no tick, including employees with no department, follow the overtime rule. This
  keeps the rule explicit: only ticked departments earn NB.

### Employees

- **Add employee**: name, Google email, and department. The email must match the Google account
  exactly (case-insensitive). Create departments first; the department field is a dropdown.
- **Edit**: change name/department.
- **Deactivate**: prevents sign-in and future absences; historical records remain in reports.
- Email is the identity key and cannot be edited in the dashboard. If someone's Google address
  changes, deactivate the old record and add the new address.
- Self-registration: when enabled and domain-allowed, an employee is created on first Google
  sign-in with no department. The list then shows them automatically; assign a department when
  convenient.

### Holidays

- Add a date and name under **Reports → Holidays**.
- Holidays are marked `H` in the monthly sheet and are **not** counted as absences.
- Add known holidays in advance. You can also add a past holiday later; regenerate the report.

### Reports and Excel

1. Open **Reports**.
2. Choose **From** and **To** (defaults to the 1st of the current month through today).
3. Optionally choose a **Department** and/or **Employee**. The filters apply to the preview and to
   all downloads.
4. Click **Load report** to preview records and totals.
5. Click **Download monthly sheet (CSV)** for the payroll-style matrix.
6. Click **Download monthly sheet (Excel, NB highlighted)** for the same matrix with Night Body
   Wash date cells filled in yellow.
7. Click **Download raw data (CSV)** for one row per shift.

Monthly sheet layout:

- One row per employee, one column per day.
- Column order: **Employee**, **Present days**, **Late days**, **Absent days**, **Open shifts**,
  **Total hours**, **Night Body Wash hours**, **Overtime hours**, then Department, Shift, and
  the day columns. Totals stay next to the name so they are easy to read without scrolling to the
  far right. Email is deliberately excluded from both CSV downloads and the Excel file.
- A **Shift** column shows the employee's department schedule.
- `P 07:00–21:00 (14h 00m) · NB 5h 00m` = present from 07:00 to 21:00, with 5 hours of that time
  labelled Night Body Wash (`NB`).
- `P 07:00–18:00 (11h 00m) · OT 2h 00m` = present from 07:00 to 18:00 in a Workshop/Paint
  department, with 2 hours after the 16:00 finish labelled overtime (`OT`).
- `L ...` = late check-in (after that employee's department shift start + grace).
- `A` = absent on a working day before today.
- `H` = holiday.
- Blank = weekend, future date, or today before a record exists.
- Totals: Present days, Late days, Absent days, Open shifts, Total hours, Night Body Wash hours,
  and Overtime hours (all decimal). NB and OT are included in Total hours, not added on top.
- The **Attendance records** preview has separate **Night Body Wash** and **Overtime** columns, and
  the raw CSV includes both next to the total.
- In the **Excel** download, any date cell with Night Body Wash hours is filled pale yellow with
  bold brown text. This includes Night Body Wash workers and day workers who stayed into the
  evening. CSV cannot store cell colours, so use the Excel download when the highlight is needed.
- Downloaded filenames start with `BRANCH_NAME`. For example, Peradeniya’s monthly sheet is
  `Peradeniya_attendance_2026-11-01_to_2026-11-11.csv`, the highlighted version is
  `Peradeniya_attendance_2026-11-01_to_2026-11-11.xlsx`, and the raw export is
  `Peradeniya_attendance_raw_2026-11-01_to_2026-11-11.csv`.

There is no join-date field. If you add an employee in the middle of a month and then generate
that whole month, the earlier working days in the range will show `A`. Add employees at the start
of a period, or adjust the range/notes for that person, until a join-date feature is added.

The CSV includes a UTF-8 BOM, so Excel opens accents correctly. If your Excel splits columns,
use **Data → From Text/CSV**, choose comma, and set the file origin to UTF-8.

Both CSV files start with a header row. In Excel, select the header and use **Data → Filter**
(shortcut `Ctrl+Shift+L`) to add filter arrows. The Department and Employee choices in the app
are applied when the file is generated, so the download already contains only the selected rows.
The Excel workbook already includes filter arrows and a frozen header.

Month-end routine:

1. On the last working day (or the 1st of the next month), set the range to the full month.
2. Confirm holidays were added.
3. Fix any open shifts.
4. Download the monthly sheet and the raw CSV.
5. Keep both files with your payroll records.

### Fixing an open shift

If someone forgets to check out, the shift stays open and appears as **Open** in Reports. Find
the row, click **Fix checkout**, and enter the correct local check-out time. The correction is
saved with no GPS distance (because it was entered by the admin). A shift cannot be fixed to a
time before check-in, in the future, or longer than 24 hours.

### Monthly/occasional checks

- Deactivate people who leave the company.
- Verify `ALLOWED_EMAIL_DOMAINS` still matches your company domain.
- Download a backup CSV at least monthly.
- Review open shifts before payroll.

---

## Part 7 — Instructions for employees

Copy this into WhatsApp, email, or a noticeboard:

> **Office attendance — how to use it**
>
> 1. Point your phone's **camera** at the QR code at the entrance.
> 2. Tap the link that appears.
> 3. Sign in with your **work Google account** the first time.
> 4. When your phone asks, tap **Allow** for location. Keep **Precise Location** on.
> 5. Tap **Check in** when you arrive.
> 6. Tap **Check out** when you leave.
>
> **If you stay from the day shift into Night Body Wash, do not check out at 4:00 PM.** Stay
> checked in and tap **Check out** once, when you leave for the night.
>
> That's it — no app to install. If the page is slow the first time, wait a minute and refresh
> (the free server may be waking up).

Device notes:

- **iPhone**: Settings → Privacy & Security → Location Services → Safari (or Chrome) →
  **While Using the App** + **Precise Location**. If you denied the prompt, open the website
  settings (`AA` in Safari) → Location → Allow, then reload.
- **Android**: Chrome → site settings → Location → Allow. Turn on **Precise location**.
- Use the phone's own camera app. In-app scanners (Instagram, Facebook, etc.) may block Google
  sign-in or location.
- Optional: use **Share → Add to Home Screen** for a one-tap icon.
- If you see "Shift complete for today", you already checked in and out. If you forgot to check
  out, ask the admin to fix it.

---

## Attendance rules and status codes

| Rule | Behavior |
| --- | --- |
| Office timezone | All dates and report columns use `TIMEZONE`, not the phone's timezone |
| Working days | `WORK_DAYS`; weekends are blank in the monthly sheet |
| Late | Check-in after the employee's department shift start + that department's grace. Employees with no department use `WORK_START` + `GRACE_MINUTES` |
| Absent | Active employee, working day, no record, and date is before today |
| Holiday | Added by admin; marked `H`, never absent |
| Today | No `A` until the day has passed |
| Open shift | Checked in with no check-out; shown as `OPEN` and counted in Open shifts |
| Night Body Wash | Only departments marked eligible (Service, Day Body Wash, Clean Park, Night Body Wash). Time after the day shift finishes and after the night shift starts. Night Body Wash staff count their whole shift |
| Overtime | Workshop and Paint departments (and any department not marked eligible). Time after the employee's scheduled shift end |
| One shift per day | A second check-in on the same office date is not allowed. A day-to-night worker stays checked in instead |
| Overnight | A check-out after midnight closes the current open shift and stays on the shift's starting date |
| Cooldown | After check-in, a check-out within `PUNCH_COOLDOWN_SECONDS` is rejected to stop double taps |
| Stale open shift | Not treated as active after `OPEN_SHIFT_HOURS` (default 20h); admin fixes it in Reports |
| Deactivated employee | Cannot sign in; historical records stay in reports |

---

## Configuration reference

All values go in `.env` locally or in Render's **Environment** page in production.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set `production` on Render for secure cookies and strict checks |
| `PORT` | `3000` | Render sets this automatically; do not override it there |
| `COMPANY_NAME` | `My Company` | Shown in the app and on posters |
| `BRANCH_NAME` | empty | Prefix for downloaded reports, e.g. `Peradeniya` produces `Peradeniya_attendance_...csv` and `.xlsx` |
| `COPYRIGHT_NAME` | `COMPANY_NAME` | Copyright owner shown in footers and on the QR poster |
| `CONTACT_PHONE` | empty | Phone shown next to the copyright; clickable on web pages |
| `CONTACT_EMAIL` | empty | Email shown next to the copyright; clickable on web pages |
| `TIMEZONE` | `Asia/Colombo` | IANA name, e.g. `Asia/Colombo`, `Asia/Kolkata`, `Europe/London` |
| `GOOGLE_CLIENT_ID` | empty | OAuth Web client ID; employee sign-in is disabled without it |
| `ADMIN_PASSWORD` | dev fallback | Required in production; at least 10 chars, not a known weak value |
| `SESSION_SECRET` | dev fallback | Required in production; 32+ random chars, 64 hex recommended |
| `DATABASE_URL` | empty | Empty = local SQLite; set to Neon PostgreSQL in production |
| `DATABASE_SSL` | `true` | Set `false` only for a local Postgres without SSL |
| `SQLITE_PATH` | `data/attendance.db` | Local SQLite path |
| `OFFICE_LAT`, `OFFICE_LNG` | empty | Decimal degrees; latitude first. Check-in is disabled if missing |
| `ALLOWED_RADIUS_METERS` | `75` | 50–150 is practical; indoor GPS drifts |
| `MAX_GPS_ACCURACY_METERS` | `250` | Reject readings worse than this |
| `WORK_START` | `07:00` | Default shift start for employees with no department, 24-hour `HH:MM` |
| `WORK_END` | `16:00` | Default shift end for employees with no department |
| `NIGHT_SHIFT_START` | `16:00` | Fallback Night Body Wash start; the Night Body Wash department's own start takes priority |
| `GRACE_MINUTES` | `10` | Default grace period; each department can override it in the dashboard |
| `WORK_DAYS` | `1,2,3,4,5` | Monday=1 … Sunday=7 |
| `PUNCH_COOLDOWN_SECONDS` | `45` | Prevents an immediate double-tap check-out |
| `OPEN_SHIFT_HOURS` | `20` | Age after which an open shift is no longer "today's shift" |
| `ALLOW_SELF_REGISTRATION` | `true` | Auto-create employees on first Google sign-in |
| `ALLOWED_EMAIL_DOMAINS` | empty | Comma-separated allowed domains, e.g. `mycompany.com,mycompany.lk` |

Finding office coordinates: open Google Maps, right-click the exact spot at the entrance, and
copy the numbers. Latitude comes first. Example: `6.9271, 79.8612`. Do not use a place name.
For a large building, test at the actual QR location and adjust the radius.

---

## Security and privacy

What the app does:

- Verifies the Google ID token **on the server** with the configured client ID. The browser
  cannot simply claim an email.
- Requires a verified Google email. Domain allow-listing is optional but recommended.
- Stores sessions in **signed, HttpOnly, SameSite=Lax cookies**. Production cookies are
  `Secure` (HTTPS only).
- Requires an admin password with a timing-safe comparison and a 12-hour admin session.
- Rate-limits login, Google auth, punch, and admin write endpoints.
- Blocks cross-origin state-changing requests and sets a strict Content Security Policy.
- Protects report exports behind the admin session.
- Stores check-in/out in UTC and converts to the office timezone for display/reports.
- Stores only the **distance from the office**, GPS accuracy, and IP for each punch — not a
  continuous location history.
- Escapes CSV cells that could be interpreted as spreadsheet formulas.

Important limitations:

- **GPS is not fraud-proof.** A determined user with a rooted/jailbroken phone or a GPS-spoofing
  app can fake a location. This system is appropriate for normal workplace attendance, not
  high-security auditing.
- The QR poster is public. Anyone who visits the URL can attempt sign-in; domain restrictions,
  employee active status, and the geofence are the real controls.
- One attendance record per employee per office date. A continuous day-to-night shift is supported,
  but split shifts (check out, then check in again the same day) are not. There is no support for
  multiple offices, leave types, overtime approval, or payroll integration.
- There is no built-in database backup UI. Use Neon's backup/restore features and download
  monthly CSVs.
- Admin actions are not written to a separate audit log.
- No two-factor authentication for the admin password. Use a long unique password.
- Free hosting can sleep, restart, or change limits. Check provider policies for your team size.

Recommended production settings:

- Google consent screen **Internal** (Workspace) or External with a published app.
- `ALLOW_SELF_REGISTRATION=true` plus `ALLOWED_EMAIL_DOMAINS=yourcompany.com`, or disable
  self-registration and pre-add everyone.
- A unique 16+ character admin password stored in a password manager.
- A unique `SESSION_SECRET`.
- HTTPS only (Render provides it).
- Download a monthly CSV and keep it somewhere safe.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Google sign-in is not configured" | `GOOGLE_CLIENT_ID` is empty or still a placeholder. Set it and restart. |
| Google button missing or blank | Wrong client ID, origin not authorized, ad-blocker, or Google script blocked. Check the browser console; add the exact origin in Google Cloud. |
| `origin_mismatch` / "The given origin is not allowed" | Add the exact scheme+host+port to **Authorized JavaScript origins**; wait a few minutes; hard-refresh. |
| "Access blocked" / app not verified | External app is in Testing and the user is not a test user. Add them, or publish the app; Internal Workspace apps avoid this. |
| "Use your company Google account" | `ALLOWED_EMAIL_DOMAINS` does not include the signed-in email's domain. |
| "Your email is not on the employee list" | Self-registration is off and the admin has not added that email. |
| "Location permission was denied" | Allow location for the site, enable Precise Location, then reload. See Part 7 device notes. |
| "You must be at the office… Xm away" | Wrong `OFFICE_LAT`/`OFFICE_LNG`, or you are genuinely outside the radius. Test with a maps app at the door. |
| "Location accuracy is too low" | Move near a window/outside, wait for GPS, enable Wi-Fi scanning, disable VPN, retry. Or raise `MAX_GPS_ACCURACY_METERS` carefully. |
| "Please wait N seconds before checking out" | `PUNCH_COOLDOWN_SECONDS` cooldown after check-in. Wait and retry. |
| "Attendance is already complete for today" | A check-out was already recorded. A day-to-night worker must not check out at 4:00 PM; if they already did, the closed shift cannot be reopened in the dashboard. |
| "Shift complete" but the time is wrong | Admin: Reports → find the record → **Fix checkout** (only works for open shifts; closed shifts cannot be reopened). |
| Open shift from a previous day | The employee can check out within `OPEN_SHIFT_HOURS`; otherwise admin fixes it in Reports. |
| Admin password rejected | Check `ADMIN_PASSWORD` in the running environment. Changing `.env` requires a restart. Rate limit after 10 failures: wait 15 minutes. |
| 429 "Too many attempts" | Rate limiting. Wait, then retry. |
| Render page takes ~1 minute to load | Free service was asleep. Wait for it to wake; consider a paid instance for a busy office. |
| Render deploy fails on `better-sqlite3` | Local Node version mismatch or missing build tools. Production uses Postgres, but the package still installs. Set a supported Node version and redeploy; check Render build logs. |
| App crashes at boot in production | Read the log: usually a weak/missing `ADMIN_PASSWORD` or `SESSION_SECRET`, invalid timezone, or bad `DATABASE_URL`. |
| `{"ok":false}` from `/api/health` | Database connection problem. Check `DATABASE_URL`, Neon project status, and SSL settings. |
| Timezone looks wrong | Set `TIMEZONE` to the correct IANA name and restart. Phones may show their own local time; reports use the server setting. |
| CSV opens as one column / garbled | Use Excel's **Data → From Text/CSV**, comma delimiter, UTF-8. The file includes a BOM for direct opening. |
| QR camera does not open the link | Print larger/clearer, improve lighting, avoid reflections, test at 100% scale. Use the phone's own camera app. |
| Printed QR still points to localhost | Regenerate with the final HTTPS URL: `npm run qr -- https://... "Main entrance"`. |
| Lost admin password | Change `ADMIN_PASSWORD` in Render and restart. Change `SESSION_SECRET` too to invalidate old sessions. |
| Employee left the company | Deactivate them under **Employees**; their historical records remain in reports. |

---

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm start` | Start the app (port 3000 by default) |
| `npm run dev` | Start with Node's watch mode for development |
| `npm test` | Run the unit tests |
| `npm run setup:departments` | Create the nine standard departments and correct their evening rules |
| `npm run qr -- https://URL "Label"` | Generate QR PNG/SVG and printable A4 poster |
| `node --check server.js` | Syntax-check the server |
| `git status` | Confirm `.env` and `data/` are not staged |

---

## Tests

```powershell
npm test
```

The suite covers:

- Production config safety (weak admin passwords, short session secrets, invalid timezones).
- Haversine distance accuracy and invalid-coordinate fail-closed behavior.
- Timezone conversion, DST handling, date ranges, and duration formatting.
- Department shift resolution, default fallback, and historical shift snapshots.
- Monthly matrix statuses (present, late, absent, holiday, weekend, open shift) and summary column order.
- Day-to-night continuous shifts, Night Body Wash boundaries, and after-midnight shifts.
- Department-specific Night Body Wash eligibility and overtime for Workshop/Paint teams.
- Branch-prefixed report filenames.
- CSV escaping and formula-injection protection.
- Email-free monthly and raw CSV exports.
- Highlighted Excel monthly export for Night Body Wash day cells.
- Copyright name and contact detail configuration.

The app has also been exercised end-to-end locally: admin password login, employee creation,
holiday creation, geofenced check-in/out with a mocked location, live board, date-range reports,
department/employee report filters, both filtered CSV downloads, the highlighted Excel download, the
Night Body Wash and overtime preview columns, branch-prefixed filenames, and the copyright footer. A full real-Google sign-in
requires your OAuth client ID and is covered by the Part 2 / 4.6 checklist.

---

## Possible next steps

- Split shifts or multiple punches per day.
- Leave/ vacation categories and approvals.
- Overtime rules and payroll export formats.
- Multiple office locations with per-location QR codes.
- Admin audit log and CSV of admin corrections.
- Automated daily backups.
- Per-employee shift overrides for one-off exceptions.
- Email/Slack reminders for missing check-outs.

None of these are required for the core scan-and-go workflow.

---

## License

MIT. Use and modify it freely for your company.
