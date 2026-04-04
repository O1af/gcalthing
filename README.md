# GCalthing

A single-page chat workspace where an AI assistant helps you **read and manage Google Calendar**—search events, check availability, and create or change meetings—with optional **approval-first** mode so writes wait for your OK.

Built with [TanStack Start](https://tanstack.com/start) (React 19, file routes), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/) v4, and deployed on **Cloudflare Workers** with session state in **KV**. Calendar access uses **Google OAuth**; reasoning and tools run through the **Vercel AI SDK**, **OpenAI**, and **Cloudflare AI Gateway**.

---

## Features

- Natural-language calendar queries and actions (list, search, get event, availability)
- Create, update, reschedule, and delete events via tool calls; drafts and confirmations when needed
- Sign in with Google; tokens stored server-side
- Streaming chat UI with markdown (Streamdown), attachments, and execution modes

---

## Scripts

| Command        | Description                 |
| -------------- | --------------------------- |
| `pnpm install` | Install dependencies        |
| `pnpm dev`     | Dev server (port 3000)      |
| `pnpm build`   | Production build            |
| `pnpm preview` | Preview production build    |
| `pnpm test`    | Vitest                      |
| `pnpm lint`    | Oxlint                      |
| `pnpm format`  | Oxfmt (write)               |
| `pnpm deploy`  | Build and `wrangler deploy` |

---

## Configuration

Runtime env is validated in `src/lib/server/env.ts` (Cloudflare Workers bindings). You will need:

| Variable                                    | Role                                           |
| ------------------------------------------- | ---------------------------------------------- |
| `AUTH_KV`                                   | KV namespace binding for sessions              |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth app                                      |
| `GOOGLE_REDIRECT_URI`                       | OAuth redirect URL (must match Google console) |
| `SESSION_SECRET`                            | Session signing (≥16 chars)                    |
| `TOKEN_ENCRYPTION_SECRET`                   | Token encryption (≥16 chars)                   |
| `CF_AIG_ACCOUNT_ID`                         | Cloudflare account id for AI Gateway           |
| `CF_AIG_GATEWAY`                            | AI Gateway name                                |
| `CF_AIG_TOKEN`                              | AI Gateway token                               |
| `OPENAI_API_KEY`                            | OpenAI API key                                 |
| `OPENAI_MODEL`                              | Model id (default `gpt-5-mini`)                |
| `APP_URL`                                   | Public app URL                                 |
| `AI_DEBUG`                                  | Optional `0` or `1`                            |

KV bindings are declared in `wrangler.jsonc`. Use `wrangler secret` / dashboard vars for production secrets. The app routes OpenAI model calls through Cloudflare AI Gateway before they reach the upstream provider.

---

## Project layout

- `src/routes/` — File-based routes (`index` is the main workspace)
- `src/lib/server/` — Auth, Google Calendar API, chat pipeline, tools, env
- `src/components/` — UI and AI chat primitives (`ai-elements`, `app`, `ui`)

---

## License

Private project (`package.json`).
