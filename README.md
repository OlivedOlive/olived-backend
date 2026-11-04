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

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and `SMTP_SECURE=true` for port 465).
Emails go to `MAIL_TO` with `Reply-To` set to the buyer, so replying answers them directly.
