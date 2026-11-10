# olived-backend

Express 5 + TypeScript API for OLIVED. One server, one `package.json`, one `.env`, split into modules:

| Module | Routes | What it does |
|---|---|---|
| `src/modules/enquiries` | `/api/enquiries` | Quote requests from the website forms: saved to a file and emailed |
| `src/modules/studio` | `/api/studio/*` | OLIVED Studio: accounts, catalog, packaging designs and review (MySQL) |

```
src/
  server.ts        starts the API (port 4000)
  worker.ts        studio background jobs (market checks, cleanup)
  app.ts           mounts the modules
  config.ts        every setting, read from .env
  modules/
    enquiries/     index.ts (routes), enquiry-schema.ts, mailer.ts, storage.ts
    studio/        index.ts (routes), auth/, designs/, jobs/, routes/, db.ts, errors.ts
  scripts/         send-test-email.ts
  generated/       Prisma client (made by `npm install`, not committed)
prisma/            studio database schema, migrations and sample seed
tests/             enquiries.test.ts, studio/
```

The studio is optional: with `DATABASE_URL` empty, `/api/studio/*` answers 503 and the enquiries keep working.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload on http://localhost:4000 |
| `npm run worker:dev` | Start the studio worker (needs `DATABASE_URL`) |
| `npm test` | Run the tests (studio database tests need `TEST_DATABASE_URL`) |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` / `npm start` / `npm run worker` | Compile to `dist/` and run it in production |
| `npm run mail:test` | Send a test enquiry email |
| `npm run db:deploy` | Create or update the studio tables |
| `npm run db:seed` | Add the sample catalog and market rules |
| `npm run db:migrate` | Create a migration after you change `prisma/schema.prisma` |
| `npm run db:studio` | Open a database browser |

Configuration is read from `.env` — see [`.env.example`](.env.example) for every option.

## OLIVED Studio

1. Create a MySQL database and user, and set `DATABASE_URL` in `.env`.
2. Run `npm run db:deploy`, then `npm run db:seed`.
3. Start `npm run dev` and `npm run worker:dev`.

The studio pages are on the website (`olived-frontend`, under `/studio`). It forwards `/api/studio/*` here,
so set `FRONTEND_ORIGIN` to the website's address: changes from any other origin are refused.

- **Client privacy:** MySQL has no row-level security. Every client query for designs must go through
  `designsFor(db, organizationId)` in `src/modules/studio/designs/repository.ts`. Do not query `db.design` directly from a route.
- **Versions** are never edited. Each save adds one, so an approval always points at what was approved.
- **Market rules** are JSON in `rule_sets`. Add new kinds of check in `src/modules/studio/designs/validate.ts`.
- **Background work** goes in the `jobs` table with `enqueue`; handlers live in `src/modules/studio/jobs/handlers.ts`.
- **Login** uses a random token in an HTTP-only cookie. Only its hash is stored.
- The database tests **empty** their database. Use a separate one whose name contains `test`:
  `TEST_DATABASE_URL=mysql://user:password@127.0.0.1:3306/olived_studio_test npm test`

## API

### `POST /api/enquiries`

JSON body:

| Field | Required | Notes |
|---|---|---|
| `source` | yes | `"home"`, `"contact"` or `"bulk"` — decides which extra fields are required |
| `fullName`, `company`, `email`, `country` | yes | |
| `phone` | – | contact form |
| `interests` | contact: at least one | array of `"bulk" \| "packaged" \| "distributor"` |
| `volume` | bulk | |
| `oilCategory`, `organicPreference`, `format`, `targetSpec`, `message` | bulk | |
| `message` | – | free text, up to 5 000 characters |
| `website` | – | honeypot; must be empty |

Responses:

- `201 { success: true, mailed: boolean, id }` — saved; `mailed` is `false` when SMTP is not configured or failed.
- `422 { success: false, error, fields: { field: message } }` — validation failed.
- `429` — rate limit hit (default 5 per 15 minutes per IP).
- `500` — the enquiry could not be saved.

### `GET /api/health`

`{ ok: true }`

## Storage

Each enquiry is appended as one JSON line to `$DATA_DIR/enquiries.jsonl` (default `data/`, git-ignored).
Keep that folder outside any public web root.

## Email

`olived.tn` mail is hosted by **Hostinger** (MX `mx1/mx2.hostinger.com`), and `.env` is already set up for it:

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465            # SSL; 587 with SMTP_SECURE=false also works
SMTP_USER=Contact@olived.tn
SMTP_PASS=               # ← the mailbox password (hPanel → Emails → Email accounts)
MAIL_FROM="OLIVED Website"
MAIL_TO=Contact@olived.tn
```

Then check it with:

```bash
npm run mail:test
```

Notes:

- Emails are sent **from** the `SMTP_USER` mailbox: Hostinger rejects other sender addresses
  (the old site's `no-reply@olived.tn` would have been refused). The startup log warns if `MAIL_FROM` differs.
- `Reply-To` is the buyer, so pressing *Reply* answers them directly.
- On startup the server tests the SMTP login and logs `SMTP ready` or the exact error.
- If SMTP fails, the enquiry is still saved in `data/enquiries.jsonl`. The API returns `mailed: false`, and the
  visitor is told the request is saved and to email us if they get no reply within 24 business hours.
  Nobody is alerted automatically, so check that file if `[mailer]` errors appear in the log.
