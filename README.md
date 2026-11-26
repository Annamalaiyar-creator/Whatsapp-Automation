# WhatsApp Automation

A standalone, multi-company AI assistant for **WhatsApp chat, WhatsApp calls and phone calls**. It connects to any CRM
through connectors (Businz is the first). This first part is the **call routing rules engine and console**: each client
company decides, without code changes, when the AI answers and who gets the callback.

## What works now

- **Routing rules**, editable in the console: conditions (forwarded because busy / not answered / switched off,
  working hours, holidays, time windows, salesperson on leave or away, VIP tags, new or known customer, channel,
  number dialled, language) and steps (AI answers, ring someone, create a callback task, send a message).
  Rules are checked top to bottom; the first match wins; "Otherwise" catches the rest.
- **Built-in safety**: a forwarded call never rings the salesperson it came from (no loops), and someone always answers.
- **Versioned changes**: every save is a new version with a note and author; any old version can be restored.
- **Rule tester**: shows what would happen to a call, rule by rule, including with unsaved changes.
- **Callbacks and escalation ladder**: salesperson → backup → manager → CEO, each with its own deadline, all
  configurable. Checked automatically every minute. People on leave are skipped.
- **Team and bot numbers**: one bot number per salesperson for SIM call forwarding (option 2).
- **Separate data per company**: every table has `tenant_id`, enforced by Postgres row-level security. The app logs in
  as a limited role (`wa_app`) that cannot bypass it. Tests check that one company cannot read or change another's data.

Not built yet: the real WhatsApp/telephony connections, the AI voice and chat, CRM connectors, and sending the queued
WhatsApp/SMS messages. Calls are simulated from the console for now.

## Run it locally

Needs Node 22+ and PostgreSQL 16 running locally.

```bash
cp .env.example .env        # then set the CHANGE_ME values
npm install
npm run db:setup            # creates the wa_app role and database, applies migrations
npm run db:seed             # company "Businz" with a sample team and default rules
npm run dev                 # http://localhost:4600
```

Log in with `DEV_OWNER_EMAIL` / `DEV_OWNER_PASSWORD` from `.env`.

```bash
npm test                    # rules engine, escalation, and API tests against a throwaway test database
npm run typecheck
```

## Layout

| Path | What it is |
|---|---|
| `src/routing/schema.ts` | The rule format and its validation |
| `src/routing/engine.ts` | Decides who handles a call and explains why |
| `src/routing/defaults.ts` | Starting rules for a new company |
| `src/escalation/` | Callback escalation ladder and the background check |
| `src/calls/service.ts` | Records a call and creates its callback task and messages |
| `src/routes/` | HTTP API used by the console |
| `migrations/` | Database schema, including row-level security |
| `public/` | The console (plain HTML/JS, no build step) |
