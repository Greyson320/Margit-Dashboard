# Grant Portal

A grant application portal: applicants browse open calls, fill in a form that is
generated from the requirements an administrator defined for that specific
grant, upload documents and submit before the deadline. Staff define the grants,
review and score the applications, decide, and export the results.

Stack: Postgres + Express/TypeScript/Prisma on the backend, React/Vite/Tailwind
on the frontend, S3/MinIO for document storage.

---

## Quick start

```bash
git clone <this repo> && cd Margit-Dashboard
cp .env.example .env          # optional for docker compose; defaults work
docker compose up --build
```

| Service              | URL                            |
| -------------------- | ------------------------------ |
| Frontend             | http://localhost:5173          |
| API                  | http://localhost:4000          |
| MinIO console        | http://localhost:9001          |
| Postgres             | `localhost:5432` (postgres/postgres) |

The backend runs migrations and seeds demo data on first boot, so the portal has
grants, applications and a review the moment it comes up.

### Demo accounts

| Role       | E-mail                        | Password       |
| ---------- | ----------------------------- | -------------- |
| Admin      | `admin@grant-portal.local`    | `Admin12345!`  |
| Reviewer   | `reviewer@grant-portal.local` | `Review12345!` |
| Applicant  | `applicant@grant-portal.local`| `Apply12345!`  |
| Applicant  | `sam@grant-portal.local`      | `Apply12345!`  |

The sign-in page lists these and fills them in on click. **Change or remove them
before deploying anywhere real.**

---

## What it does

### For applicants
- **Registration & login** — bcrypt-hashed passwords, short-lived JWT access
  tokens with rotating refresh tokens.
- **Grant catalogue** — search, filter by status and target group, see deadline,
  maximum amount, eligibility and expected impact.
- **Dynamic application form** — the fields *are* the grant's requirements. Ten
  field types: short/long text, number, amount, date, single and multiple
  choice, confirmation checkbox, file upload and link.
- **Autosave** — every change is saved as a draft after a short pause; the
  sidebar shows save state and warns before you close an unsaved tab.
- **Progress tracking** — a live percentage plus a list of what is still missing.
- **File uploads** — per-field size and type limits, stored in S3/MinIO with a
  checksum, downloaded through short-lived signed URLs.
- **Submission** — validated server-side against the same rules, confirmed by
  e-mail and an in-app notification, downloadable as a PDF receipt at any time.
- **Withdraw** — an applicant can pull back a draft or a submitted application.

### For administrators and reviewers
- **Dashboard** — totals, approval rate, a 30-day trend, a status breakdown,
  applications per grant and the deadlines coming up.
- **Grant management** — create and edit calls, and build the requirement set
  with a drag-free reorder, per-field validation rules and a **live applicant
  preview** beside the editor.
- **Application review** — filter and search, read every answer, download the
  attachments, score and annotate, and move an application through
  `submitted → under review → approved / rejected` with a note to the applicant.
- **Reviewers vs. admins** — a reviewer can start a review and score; only an
  admin decides.
- **Notifications** — submission confirmations, status changes, "documents
  missing" nudges and bulk deadline reminders.
- **Exports** — CSV of any filtered list (one column per requirement when scoped
  to a single grant) and PDF per application.
- **Users** — create staff accounts, change roles, deactivate accounts.
- **Audit log** — every change to grants, applications, users, reviews and files.

---

## Running without Docker

You need Node 22+ and a Postgres 16 database.

```bash
# --- backend ---
cd backend
cp ../.env.example .env        # point DATABASE_URL at your Postgres
npm install
npx prisma migrate deploy
npm run seed
npm run dev                    # http://localhost:4000

# --- frontend (second terminal) ---
cd frontend
npm install
npm run dev                    # http://localhost:5173, proxies /api to :4000
```

To skip MinIO locally, set `STORAGE_PROVIDER=local` — uploads then go to
`backend/uploads/` and are streamed through the API instead of signed URLs.

---

## Project layout

```
.
├─ docker-compose.yml          Postgres + MinIO + backend + frontend
├─ openapi.yaml                Full API specification (import into Postman/Swagger)
├─ .env.example                Every setting, documented
├─ backend/
│  ├─ prisma/
│  │  ├─ schema.prisma         Data model
│  │  ├─ migrations/           Generated SQL migrations
│  │  └─ seed.ts               Demo grants, users and applications
│  └─ src/
│     ├─ app.ts, index.ts      Express wiring and bootstrap
│     ├─ env.ts, db.ts         Configuration and Prisma client
│     ├─ middleware/           JWT auth/RBAC and the error handler
│     ├─ routes/               auth, grants, applications, uploads,
│     │                        reviews, notifications, users, stats
│     ├─ services/             responses (dynamic validation), storage,
│     │                        notifications, tokens, audit, pdf, csv
│     └─ lib/                  errors, async wrapper, serialization
└─ frontend/
   ├─ src/
   │  ├─ components/           Layout, dynamic Field, shared UI
   │  ├─ context/              Auth and toast providers
   │  ├─ lib/                  API client, validation mirror, formatting
   │  └─ pages/                Catalogue, grant, application form,
   │                           my applications, profile, admin/*
   └─ nginx.conf               Production static hosting + /api proxy
```

---

## Data model

`users`, `grants`, `requirements`, `applications`, `application_responses`,
`file_uploads`, `reviews`, `audit_logs`, plus `notifications` and
`refresh_tokens`. See `backend/prisma/schema.prisma` for the authoritative
version.

Two details worth knowing:

- **Answers are stored in typed columns.** `application_responses` has
  `value_text`, `value_number`, `value_date`, `value_json` and `file_id`; the
  field type decides which one is used. Numbers stay sortable, dates stay
  comparable, and nothing is stringly typed.
- **Requirement `key` is the stable identifier.** Renaming a label keeps the
  answers; the key is what appears as a CSV column and in the API.

---

## API

`openapi.yaml` documents all 30 endpoints. Auth is `Authorization: Bearer <access_token>`.

```
POST   /auth/register | /auth/login | /auth/refresh | /auth/logout
GET    /grants                         list, filter and search
POST   /grants                         create with requirements (admin)
GET    /grants/:id                     details + requirements + your application
PATCH  /grants/:id                     update, including the requirement set
POST   /applications                   start a draft
GET    /applications                   yours, or all for staff
PUT    /applications/:id/responses     upsert answers (autosave)
PATCH  /applications/:id               submit / withdraw / review / decide
GET    /applications/:id/pdf           PDF receipt
GET    /applications/export.csv        CSV export (staff)
POST   /uploads                        multipart upload
GET    /uploads/:id                    signed download
POST   /reviews                        score and annotate (staff)
GET    /notifications                  in-app inbox
POST   /notifications/deadline-reminders
GET    /users, POST /users, PATCH /users/:id     (admin)
GET    /stats/overview | /stats/timeline | /stats/audit
```

Ids are 64-bit and serialized as **strings** in JSON, so they survive
JavaScript's number precision intact.

---

## How the dynamic form works

1. An admin defines requirements on a grant: `key`, `label`, `field_type`,
   `required`, options, validation rules and file constraints.
2. `GET /grants/:id` returns them ordered; the frontend renders one input per
   `field_type` and the applicant fills them in.
3. Autosave `PUT`s the changed answers. The server maps each value onto the
   column matching its type and returns fresh progress and validation state.
4. On submit the server re-runs every rule
   (`backend/src/services/responses.ts`) and refuses an incomplete application
   with a list of issues. The browser runs the same rules
   (`frontend/src/lib/validation.ts`) purely for instant feedback — **the server
   is the authority**.

Adding a field type means touching three places: the `FieldType` enum in
`schema.prisma`, the mapping in `services/responses.ts`, and the renderer in
`components/Field.tsx`.

---

## Security

Implemented:

- bcrypt password hashing (cost 12), minimum 8 characters.
- Short-lived access tokens; refresh tokens are hashed at rest, single-use and
  rotated. Changing a password or deactivating an account revokes all of them.
- Role checks on every route — never trusted from the client.
- Zod validation on every request body and query.
- Upload allow-list on MIME type plus a size cap; files are stored under
  generated keys, never the user's filename.
- Rate limiting on login and registration.
- Helmet, an explicit CORS allow-list, and a full audit trail.

Before going to production:

- Set a real `JWT_SECRET`, and remove or rotate the seeded demo accounts.
- Serve over TLS and pin `ALLOWED_ORIGINS` to your domain.
- Swap `MAIL_TRANSPORT=console` for a real provider (SES, Postmark, SMTP) in
  `backend/src/services/notifications.ts`.
- Wire a virus scanner into the upload route — `file_uploads.virus_scanned` and
  `virus_status` already exist for it.
- Use managed Postgres with backups, and a private S3 bucket.

---

## Production build

```bash
docker build -t grant-portal-api ./backend --target production
docker build -t grant-portal-web ./frontend --target production
```

The API image runs `prisma migrate deploy` before starting. The web image is
nginx serving the static build and proxying `/api` to the backend.
