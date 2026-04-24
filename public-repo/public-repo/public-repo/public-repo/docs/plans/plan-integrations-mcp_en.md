# Plan: Integrations and MCP Framework

**Status:** Draft — pending maintainer review before implementation begins.

## Vision

s2s is an orchestration layer, not an LLM. Integrations extend what s2s can feed into each stage
as context and what each stage can produce. An integration is opt-in: the user decides which tools
they have, which stages they want enriched, and activates each one explicitly.

The integration framework must hold to three principles:

1. **No surprise side-effects** — activating an integration never silently touches external systems.
   Each integration is a context enrichment at stage-start or an artifact-writing step at stage-end.
2. **Opt-in at the user level** — integrations are declared in `.s2s/project.json` under an
   `integrations` key. A missing key means no enrichment. A present key means only those listed
   integrations are active.
3. **Graceful degradation** — every integration is optional. When an integration is not configured
   or not reachable, s2s falls back to its baseline output with no crash and a clear message.

---

## Current integrations (baseline)

| Integration | Stage | What it does |
|------------|-------|-------------|
| Figma MCP  | `design` | Writes/reads Figma frames from `PrototypeSpec.md`; reads frame diffs on iteration |

The Figma integration is the only live integration as of v0.2.49. Everything in this plan is
additive and does not change existing Figma behavior.

---

## Framework: opt-in registry

### Config shape (`.s2s/project.json`)

```json
{
  "integrations": {
    "github":     { "enabled": true },
    "linear":     { "enabled": true, "projectId": "PROJ-123" },
    "notion":     { "enabled": true, "databaseId": "abc..." },
    "stitch":     { "enabled": true },
    "playwright": { "enabled": true },
    "sentry":     { "enabled": true, "projectSlug": "my-app" },
    "vercel":     { "enabled": true },
    "slack":      { "enabled": true, "channel": "#deploys" }
  }
}
```

Each integration entry follows the same shape: `enabled` flag plus zero or more integration-specific
fields. Disabled or absent entries are silently ignored by every stage.

### Activation command (proposed)

```
s2s config integrations          # list current state + available integrations
s2s config integrations enable github
s2s config integrations disable slack
```

Mirrors the `s2s config chat-permissions` pattern.

### Context injection

When a stage starts, s2s checks `integrations` in `project.json`, identifies which are enabled and
which MCP tools are reachable (via env var presence or config file), and appends an
`## Integrations` section to the stage context package. The section lists what is available and
exactly what s2s expects the AI to do with it — create a frame, open an issue, push a deploy, etc.

---

## Integrations by stage

### PM stage

**Problem:** PM artifacts (PRD, user stories) are written in isolation. There's no connection
between the product requirement and where tickets land, what competitor research exists, or what
the stakeholder dashboard looks like.

| Integration | Value added | How | Trigger |
|------------|-------------|-----|---------|
| **Notion MCP** | Read an existing product brief, competitive analysis, or OKR doc from Notion | MCP `search`/`retrieve` call; result injected as `## Existing context` into PM context package | Stage start, if `notionPageId` is set on the integration config |
| **Linear MCP** | After PRD is approved, create an Epic in Linear for the change | MCP `createIssue` with type=Epic; issue URL stored in ledger | Gate approval (`spec_review` approved) |
| **Google Workspace MCP** | Read an existing Google Doc spec or proposal | MCP `read` call; result injected as context | Stage start, if `docId` is set |

Priority: **Notion MCP** and **Linear MCP** are highest value. Google Workspace is nice-to-have.

---

### Research stage

**Problem:** Research artifacts are written by the AI from memory. There's no live web data, no
real user feedback, and no access to the team's own analytics.

| Integration | Value added | How | Trigger |
|------------|-------------|-----|---------|
| **Brave Search MCP** | Live web research — competitive landscape, library comparisons, API docs | MCP `web_search` calls injected as raw results; AI synthesizes into `Research.md` | Stage prompt instructs AI to call Brave Search for each open question |
| **Playwright MCP** | Screenshot competitor apps or live documentation for visual research | MCP `screenshot`/`navigate` calls; screenshots stored as artifacts | Stage prompt, optional — only when `playwright.enabled` |
| **PostgreSQL/DB MCP** | Read production analytics or user behavior data to ground research | MCP `query` call with read-only credentials; result rows summarized in context | Stage start, if `databaseUrl` configured |

Priority: **Brave Search** is the highest immediate value — real data grounds research artifacts
dramatically. Playwright for visual research is secondary. DB access is advanced/opt-in.

---

### Design stage

**Problem:** Design artifacts (`PrototypeSpec.md`) describe screens in markdown. Without a visual
tool there's no way to see how screens look or iterate with a designer.

| Integration | Value added | How | Trigger |
|------------|-------------|-----|---------|
| **Figma MCP** (existing) | Write screen specs as Figma frames; read back designer changes | MCP create/update frames; diff on next iteration | Stage start (write) and `s2s stage design --pull` |
| **Google Stitch MCP** | Generate live UI previews from `PrototypeSpec.md` — HTML/CSS components | MCP `generate` call with screen spec input; Stitch returns a rendered preview URL or artifact | Stage end, after `PrototypeSpec.md` is written |
| **Playwright MCP** | Take a screenshot of the Stitch or Figma preview for inclusion in the design artifact | MCP `screenshot` call targeting preview URL | Stage end, after Stitch generates preview |

**Stitch + Playwright pairing:** Stitch generates a rendered preview; Playwright screenshots it.
The screenshot is stored in `.s2s/artifacts/design/preview.png` and referenced in `PrototypeSpec.md`.
This creates a visual artifact that persists across sessions and doesn't require a Figma account.

Priority: Stitch + Playwright is the most novel value here. Figma MCP is already live.

---

### Engineering stage

**Problem:** `TechSpec.md` and `Backlog.md` are created with no link to existing issues, open PRs,
or deployment topology. The AI doesn't know what's already been tried or what's in-flight.

| Integration | Value added | How | Trigger |
|------------|-------------|-----|---------|
| **GitHub MCP** | Read open issues, PRs, and recent commits related to the change scope | MCP `search_issues`, `list_commits`; results injected as `## Existing work` context | Stage start |
| **Linear MCP** | Read the Epic created at PM stage; populate `Backlog.md` tasks with Linear issue IDs | MCP `getIssue` to pull Epic; `createIssue` for each Backlog task; issue IDs written into `Backlog.md` | Stage end, after `Backlog.md` is written |
| **Vercel MCP** | Read current deployment environment details (env vars, domains) for infra-aware tech spec | MCP `listDeployments`, `listEnvVars`; injected as context | Stage start, if project is Vercel-hosted |
| **PostgreSQL/DB MCP** | Read schema for data-model-aware tech spec generation | MCP `describe_table` calls; schema summary injected as context | Stage start, if `databaseUrl` configured |

Priority: **GitHub MCP** eliminates re-invention of what's already open. **Linear MCP** closes the
loop between PRD approval and engineering backlog. Both are high value.

---

### Engineering exec stage

**Problem:** The AI executing code has no visibility into test results running in CI, no access to
the Figma design it's supposed to implement, and no structured way to report back which acceptance
criteria passed.

| Integration | Value added | How | Trigger |
|------------|-------------|-----|---------|
| **GitHub MCP** | Read CI check status after a push; create a draft PR when slice is done | MCP `getCheckRuns`, `createPullRequest`; PR URL stored in run record | After each commit push |
| **Playwright MCP** | Run E2E tests against the running dev server after implementation | MCP `navigate`, `click`, `assert`; test results stored in run record | `s2s run --test` or post-commit hook |
| **Figma MCP** | Read design frames to verify the implementation matches the spec visually | MCP `getFrame`; frame metadata injected into exec context | Stage start, if `figmaFileKey` is set |
| **Sentry MCP** | Check for new errors introduced by the change against a pre-run baseline | MCP `listEvents`, `searchIssues`; error delta injected into delivery check | Stage end / pre-delivery |

Priority: **Playwright MCP** for E2E tests is the highest value — it closes the loop between
implementation and acceptance criteria. **GitHub MCP** for PR automation is second.

---

### Delivery stage

**Problem:** Delivery is currently a human judgment call with no live data. No error rate, no
deployment status, no customer-facing signal.

| Integration | Value added | How | Trigger |
|------------|-------------|-----|---------|
| **GitHub MCP** | Read PR reviews, merge status, and CI status for the delivery gate | MCP `getPullRequest`, `listReviews`; status shown in delivery gate context | Gate creation |
| **Sentry MCP** | Compare error rate before and after the change; show delta in delivery gate | MCP `listEvents` with time filter; delta shown as delivery gate context | Gate creation |
| **Vercel MCP** | Trigger a production deployment after final_review is approved | MCP `createDeployment`; deployment URL stored in ledger | `final_review` gate approved |
| **Slack MCP** | Post a deploy notification with change summary and artifact links | MCP `postMessage` to configured channel | `final_review` gate approved |
| **Linear MCP** | Mark the Epic as completed and update issue statuses | MCP `updateIssue` with status=Done | `final_review` gate approved |

Priority: **Sentry MCP** for error delta is the highest signal quality. **Vercel MCP** for
automated deploy closes the full SDLC loop. **Slack** and **Linear** state sync are polish.

---

## Integration profiles

Some integrations are so commonly paired that they should have named profiles to simplify setup.

| Profile | Includes | Typical user |
|---------|----------|-------------|
| `github-first` | GitHub MCP, Linear MCP, Sentry MCP | Teams already on GitHub + Linear |
| `vercel-full` | GitHub MCP, Vercel MCP, Sentry MCP, Slack MCP | Vercel-deployed apps |
| `design-visual` | Figma MCP, Stitch MCP, Playwright MCP | Design-heavy products |
| `research-live` | Brave Search MCP, Playwright MCP | Products with competitive research needs |

Profiles are additive: activating `github-first` does not disable `design-visual`.

---

## Implementation phases

### Phase 0 — Framework skeleton (no external calls)
- Add `integrations` key to `ProjectMeta` and `project.json` schema
- Add `s2s config integrations` subcommand (list, enable, disable)
- Add `getActiveIntegrations(projectId)` utility that reads from `project.json`
- Implement graceful-degradation wrapper: any integration call that throws is caught, logged, and
  skipped
- No external calls in this phase — only config plumbing

### Phase 1 — GitHub MCP
- Highest cross-stage value; affects engineering + engineering_exec + delivery
- Inject GitHub context at engineering stage start (open issues, recent PRs on relevant paths)
- Create draft PR from engineering_exec when slice is marked done
- Read CI check status in delivery gate context
- Requires: `GITHUB_TOKEN` env var + `github.enabled: true`

### Phase 2 — Linear MCP
- Close the PM-to-engineering loop
- On `spec_review` approval: create Epic in Linear
- On engineering stage end: create issues for each Backlog.md task, write IDs back into Backlog.md
- On `final_review` approval: mark Epic done
- Requires: `LINEAR_API_KEY` env var + `linear.enabled: true` + `linear.projectId`

### Phase 3 — Stitch + Playwright (design visual preview)
- Most novel: design → visual artifact that is not Figma
- On design stage end: Stitch generates a preview from `PrototypeSpec.md`
- Playwright screenshots the preview; stored at `.s2s/artifacts/design/preview.png`
- Playwright also available for E2E tests in engineering_exec
- Requires: Stitch MCP server running + `PLAYWRIGHT_BASE_URL` for E2E tests

### Phase 4 — Sentry + Vercel (delivery quality gate)
- Error delta before/after change shown in delivery gate
- Auto-deploy to Vercel on `final_review` approval
- Requires: `SENTRY_TOKEN` + `sentry.projectSlug`; `VERCEL_TOKEN` + `vercel.enabled`

### Phase 5 — Brave Search (research enrichment)
- Live web results for each open question in the research stage
- AI synthesizes search results into `Research.md` — no raw dumps
- Requires: `BRAVE_API_KEY` + Brave Search MCP server

### Phase 6 — Notion + Slack + Google Workspace
- Nice-to-have connective tissue
- Notion: inject existing docs as PM/research context
- Slack: deploy notifications at delivery approval
- Google Workspace: inject Google Docs as PM context

---

## MCP server reference

| Integration | MCP server / package | Auth mechanism |
|------------|---------------------|---------------|
| Figma | `@anthropic/figma-mcp-server` | `FIGMA_ACCESS_TOKEN` env var |
| GitHub | `@modelcontextprotocol/server-github` | `GITHUB_TOKEN` env var |
| Linear | `@linear/mcp` | `LINEAR_API_KEY` env var |
| Notion | `@modelcontextprotocol/server-notion` | `NOTION_API_KEY` env var |
| Google Stitch | `@google/stitch-mcp-server` (preview) | GCP credentials |
| Playwright | `@playwright/mcp` | No auth — local browser |
| Sentry | `@sentry/mcp-server` | `SENTRY_TOKEN` env var |
| Vercel | `@vercel/mcp-server` | `VERCEL_TOKEN` env var |
| Slack | `@modelcontextprotocol/server-slack` | `SLACK_BOT_TOKEN` env var |
| Brave Search | `@modelcontextprotocol/server-brave-search` | `BRAVE_API_KEY` env var |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | `DATABASE_URL` env var |

All MCP servers are configured in the chat tool's MCP settings (Claude Code `.claude/settings.json`,
Codex equivalent, etc.) — not in s2s itself. s2s only checks whether the integration is enabled
and whether the required env var is set; it never manages the MCP server process.

---

## Open questions before implementation

1. **Stitch MCP availability** — as of April 2026 Google Stitch MCP is in limited preview. Is it
   accessible without a waitlist? Should Phase 3 be sequenced after general availability?
2. **Playwright test vs Playwright screenshot** — do we want one Playwright integration entry that
   does both, or two separate integration entries (`playwright-design` and `playwright-e2e`)?
3. **Linear Epic vs Issue** — should the PM-stage Linear entity be an Epic (and Backlog tasks be
   child issues) or should each Backlog task be a top-level issue? Depends on the user's Linear
   workspace structure.
4. **Integration detection in `s2s init`** — should `s2s init` detect which MCP servers are
   already configured in the chat tool's settings and auto-offer to enable those integrations?
   This mirrors how `s2s config chat-permissions` detects existing tool configs.
5. **Brave Search vs perplexity vs Tavily** — there are multiple web search MCP options.
   Should s2s support multiple providers under one `webSearch` integration entry?
