# olived-backend

Express 5 + TypeScript API that receives quote requests from the OLIVED website.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload on http://localhost:4000 |
| `npm test` | Run the API tests (vitest + supertest) |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` / `npm start` | Compile to `dist/` and run it in production |

Configuration is read from `.env` — see [`.env.example`](.env.example) for every option.

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
