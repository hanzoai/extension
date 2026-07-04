# Hanzo AI for Canvas LMS

AI over your Canvas course — **summarize a course**, **draft assignment feedback**,
**generate quiz/discussion questions**, **summarize student submissions**, and
**draft an announcement**, plus a freeform "ask about the course" box. An
embedded-app **panel** you host at `canvas.hanzo.ai`, backed by a small **OAuth +
API-proxy service** that keeps the Canvas client secret and access tokens
server-side.

Built on the published Hanzo SDK:

- **[`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai)** — the headless client.
  `createAiClient({ baseUrl, token }).chat.completions.create({ model, messages })`
  and `.models.list()`. All model calls go to `https://api.hanzo.ai` on `/v1/...`
  (never an `/api/` prefix). We import it; we do not reimplement the transport.
- **[`@hanzo/iam`](https://www.npmjs.com/package/@hanzo/iam)** — Hanzo identity /
  the `hk-…` API key the panel uses as its gateway bearer.

Canvas is the dominant higher-ed / K12 LMS: courses, syllabi, modules, assignments,
pages, discussions, and student submissions. This app reads those records through
the Canvas REST API and grounds every AI draft in them. Everything it produces —
feedback, questions, announcements, summaries — is a **draft for an educator to
review**, not an authoritative grade or decision.

> **Package name:** `@hanzo/canvas-lms` (directory `packages/canvas-lms`) — named to
> avoid colliding with the design-tool package `packages/canva`.

---

## Architecture

```
Browser panel (dist/index.html, app.js)          Server service (dist/server.js)
─────────────────────────────────────           ──────────────────────────────
  reads Canvas via  ──►  /proxy/*  ──────────►   injects OAuth Bearer + refresh,
  same-origin proxy      (cookie)                forwards to {canvas-host}/api/v1
  (never sees a Canvas token)                    with the user's access token
        │
        └── calls api.hanzo.ai /v1 directly with the pasted hk-… Hanzo key
            (@hanzo/ai headless client)
```

- The **panel** never holds a Canvas token or the client secret. It reaches Canvas
  only through the same-origin `/proxy/*` endpoint (with an HttpOnly session
  cookie). It talks to `api.hanzo.ai` directly with the user's pasted Hanzo key.
- The **service** is the only place `CANVAS_CLIENT_SECRET` and the OAuth tokens
  exist. It runs the install flow, holds the session, refreshes the token
  transparently, and proxies REST calls.

### Source layout (all pure logic is unit-tested)

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Canvas host normalization, REST version, gateway URL, server-secret config (`readServerConfig` fails fast). |
| `src/canvas-oauth.ts` | OAuth2 Authorization-Code shaping: `authorizeUrl`, `tokenExchange`, `refreshExchange`, token parsing, non-rotating-refresh carry + expiry math. Pure. |
| `src/canvas-api.ts` | REST v1 request wrappers (`listCourses`, `getCourse`, `listAssignments`, `listSubmissions`, `postSubmissionComment`, `createAnnouncement`, …) with pagination + `Link`-header parsing, and response parsers. Pure. |
| `src/course.ts` | Course/assignment/submission/page/module JSON → windowed context text, HTML→text, honest truncation. Pure. |
| `src/hanzo.ts` | Thin over `@hanzo/ai`: prompt assembly + the single `ask` path + `listModels`. |
| `src/actions.ts` | The five AI actions (id → prompt) over `ask`. One code path to the model. |
| `src/panel.ts` | Browser proxy-client request shaping + launch-context parsing. Pure. |
| `src/app.ts` | The DOM glue for the panel (the one impure browser entry). |
| `src/server.ts` | Node http service: OAuth install/callback + `/proxy/*`. |

---

## 1. Create a Canvas Developer Key

Canvas OAuth apps authenticate with a **Developer Key** (an OAuth2
client-id/secret). An account admin creates it in **Admin → Developer Keys → +
Developer Key → API Key**:

1. **Key Name**: `Hanzo AI for Canvas` (any label).
2. **Redirect URIs** — exactly the URL your service serves the callback at:

   ```
   https://canvas.hanzo.ai/oauth/callback
   ```

   (For local development, add `http://localhost:8791/oauth/callback` too.)
3. **Scopes** — leave **Enforce Scopes** *off* for the simplest setup (permissions
   then follow the authorizing user's Canvas role). If you enable enforcement, add
   the granular URL-scopes exported as `RECOMMENDED_SCOPES` in `src/config.ts`
   (the read surface plus `PUT …/submissions/:user_id` and
   `POST …/discussion_topics` for the two write-backs).
4. **Save**, then **ON** the key's state, and copy the **Client ID** (the numeric
   key id) and **Client Secret** (the "Key" / secret value).
5. Note your institution's **Canvas host** (e.g. `school.instructure.com` or your
   custom Canvas domain) — the app builds every OAuth + API URL from it.

Because Canvas is self-hosted per institution, the host is a required deployment
value (`CANVAS_HOST`); there is no fixed host list.

---

## 2. OAuth flow

Standard **Authorization Code** grant (server-side secret):

1. `GET /oauth/install` → 302 to
   `https://{canvas-host}/login/oauth2/auth?client_id=…&response_type=code&redirect_uri=…&state=…`.
2. The user consents; Canvas redirects back to `GET /oauth/callback?code=…&state=…`.
3. The service verifies `state`, then POSTs to `/login/oauth2/token` with
   `grant_type=authorization_code`, the `code`, the `client_id` + `client_secret`
   (**in the body, server-side only**), and the same `redirect_uri`.
4. It opens a session, sets an HttpOnly cookie, and the panel is authenticated.
5. Access tokens are short-lived (~1h). The service refreshes with
   `grant_type=refresh_token` **before** each proxied call when the token has
   expired. Canvas does **not** rotate the refresh token (the refresh response omits
   it), so the original refresh token is carried forward.

> In-memory sessions here are for a single instance. For a multi-instance
> deployment behind `hanzoai/ingress`, persist sessions + the OAuth `state` set to
> `hanzoai/kv` (Valkey), and read `CANVAS_CLIENT_SECRET` from KMS (`kms.hanzo.ai`) —
> never from a committed env file.

---

## 3. Canvas REST API

All reads/writes go through `https://{canvas-host}/api/v1/...` with the user's
`Authorization: Bearer {token}`. Canvas's own path is `/api/v1` — this is unrelated
to the Hanzo gateway (which is always `api.hanzo.ai/v1/...`, never `/api/`).

| Resource | Endpoint (relative to `/api/v1`) |
| --- | --- |
| Courses | `GET /courses`, `GET /courses/{id}?include[]=syllabus_body` |
| Assignments | `GET /courses/{id}/assignments`, `GET /courses/{id}/assignments/{id}` |
| Submissions | `GET /courses/{id}/assignments/{aid}/submissions`, `GET …/submissions/{user_id}` |
| **Submission comment** (write) | `PUT /courses/{id}/assignments/{aid}/submissions/{user_id}` — body `{ "comment": { "text_comment": "…" } }` |
| Discussions | `GET /courses/{id}/discussion_topics` |
| **Announcement** (write) | `POST /courses/{id}/discussion_topics` — body `{ "title", "message", "is_announcement": true }` |
| Pages | `GET /courses/{id}/pages`, `GET /courses/{id}/pages/{url_or_id}` |
| Modules | `GET /courses/{id}/modules?include[]=items` |
| Enrollments | `GET /courses/{id}/enrollments` |

> Canvas models a submission comment as an **update to the submission** (a `PUT`
> with `comment[text_comment]`), not a separate comments collection — there is no
> `POST …/submissions/{id}/comments`. This app uses the correct `PUT` shape.

List endpoints paginate with `page` (1-based) + `per_page` (max 100) and return the
page relations in the **RFC 5988 `Link`** response header
(`<…?page=2…>; rel="next"`), parsed by `parseLinkHeader` / `nextPage`.

---

## 4. The summarize-course / draft-feedback flow

1. Connect the app (`/oauth/install`) so the service holds a Canvas token.
2. Open the panel and **Load** a course (the picker lists the courses the connected
   user can see). The panel pulls the course's syllabus, modules, assignments,
   pages, and discussions through the proxy and assembles a windowed,
   truncation-honest context (Canvas HTML is stripped to plain text).
3. **Summarize course** — the model writes a course overview from the syllabus and
   module structure, grounded only in the records.
4. **Draft feedback** — pick an assignment and **Load submissions**; the model
   drafts specific, constructive feedback for a student submission, grounded in what
   the student actually wrote and the assignment's requirements. The result lands in
   the Result box.
5. Optional write-backs (gated, behind a confirm):
   - **Post as submission comment** posts the Result back via
     `PUT …/submissions/{user_id}` with `comment[text_comment]`, targeting the first
     submitted student on the loaded assignment.
   - **Post as announcement** posts the Result as a course announcement via
     `POST …/discussion_topics` (`is_announcement: true`), first line as the subject.

The other actions — **Generate questions** (quiz + discussion prompts from a
page/module), **Summarize submissions** (submitted/missing/late, score spread,
common strengths and problems), and **Draft announcement** — run the same way.

---

## Build & run

```bash
pnpm install
pnpm --filter @hanzo/canvas-lms build      # → dist/ (panel + server)
pnpm --filter @hanzo/canvas-lms test       # vitest
pnpm --filter @hanzo/canvas-lms typecheck  # tsc --noEmit

# run the service
CANVAS_HOST=school.instructure.com   \
CANVAS_CLIENT_ID=…   \
CANVAS_CLIENT_SECRET=…   \
CANVAS_REDIRECT_URI=https://canvas.hanzo.ai/oauth/callback   \
node packages/canvas-lms/dist/server.js
```

### Required environment (service)

| Var | Notes |
| --- | --- |
| `CANVAS_HOST` | Institution Canvas host, e.g. `school.instructure.com`. Normalized (scheme/path stripped). |
| `CANVAS_CLIENT_ID` | Developer Key client id (public). |
| `CANVAS_CLIENT_SECRET` | **Server only.** From KMS in production. |
| `CANVAS_REDIRECT_URI` | Must match the key's registered redirect. |
| `PORT` | Listen port (default `8791`). |

`readServerConfig` throws on a missing value — the service refuses to start rather
than pretend it can complete an OAuth exchange or reach an unknown Canvas host.

---

## Deploy over hanzoai/ingress

Host the static panel (`dist/index.html`, `app.js`, `styles.css`) with the
**hanzoai/static** plugin and run `dist/server.js` as a small service, both behind
**hanzoai/ingress** at `canvas.hanzo.ai` (no nginx, no caddy):

- `/` and the static assets → the panel.
- `/oauth/*`, `/proxy/*`, `/healthz` → the service.

Secrets come from **KMS** as `KMSSecret`-synced env; sessions from **Valkey**
(`hanzoai/kv`) for multi-instance. Image published to
`ghcr.io/hanzoai/canvas-lms:<tag>` by CI/CD (platform.hanzo.ai / Tekton) — never
built locally.

---

## Alternative embed path: LTI 1.3

This package ships the **OAuth2 + REST API** app (an external app the instructor
connects, ideal for a standalone panel at `canvas.hanzo.ai`). Canvas also supports
**LTI 1.3 / Advantage** as an in-Canvas launch: Canvas issues a signed OIDC launch
JWT and the tool calls the same REST API (or LTI Advantage services — Names & Roles,
Assignment & Grade Services). LTI is the better fit for a deep in-course placement
(course navigation, assignment menu) and passes the course context (`custom_canvas_course_id`)
in the launch — which `parseLaunchContext` already reads. The AI + context modules
(`course.ts`, `hanzo.ts`, `actions.ts`, `canvas-api.ts`) are transport-agnostic and
would be reused unchanged behind an LTI launch; only the auth front-door differs.
This build ships the OAuth+API app.

---

*Routed through `api.hanzo.ai`. Answers are grounded in your Canvas course records —
a draft for an educator to review, not an authoritative grade, decision, or the
final word to a student.*
