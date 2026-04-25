# Spec-To-Ship — How It Works

## A. Short product description

Spec-To-Ship (`s2s`) is a command-line tool that adds structure, governance, and state management to AI-assisted software development. It works alongside Claude Code and Codex, guiding those tools through a disciplined workflow — from understanding what was requested, to planning the right amount of process, to executing code changes in an isolated workspace. The developer stays in control at every step. S2S handles the scaffolding and keeps a record of everything.

---

## B. Who it is for

**Technical founders and solo developers** who use AI coding tools daily and want delivery discipline without a full engineering team's overhead.

**Small engineering teams (roughly 3–30 people)** who have adopted Claude Code or Codex and are starting to feel the cost of inconsistent, ungoverned AI output — PRs no one fully understands, features that grew beyond their scope, no audit trail for what was actually built.

**Engineering leads** who need to introduce AI tooling without losing the process controls their team already relies on — approvals, documented decisions, reviewable artifacts.

The common thread: people who find AI coding tools genuinely useful but want the output to be something they can stand behind.

---

## C. What problem it solves

When you work with an AI coding assistant without any surrounding structure, a few things tend to go wrong:

**The AI doesn't know what kind of work you actually need.** Ask it to "fix the login bug" and it may produce a full refactor. Ask it to "add dark mode" and it may skip the design discussion entirely and go straight to implementation. There is no signal about scope.

**There is no record of what happened or why.** The conversation window closes and the reasoning is gone. If something breaks three weeks later, you have no artifact trail to trace back through.

**Approval is ad hoc.** Anyone on the team can push changes driven by AI at any time, with no consistent gate between "the AI suggested this" and "this is ready to ship."

**Parallel work is fragile.** Multiple AI sessions touching the same repository at the same time is a recipe for conflicts and overwritten work.

S2S addresses all four. It classifies what you're asking for, routes it through only the stages that request actually needs, keeps a structured record of every decision and artifact, enforces human approval at meaningful checkpoints, and runs code changes in isolated git worktrees so parallel work stays clean.

---

## D. How the user workflow works

**1. Initialize the project once.**
Run `s2s init` in your project directory. It sets up a `.s2s/` workspace with your configuration, installs governance files that your AI client reads automatically on every session, and registers the project. This takes a few minutes and does not change any existing code.

**2. Submit a work request.**
From your AI chat session — or directly from the terminal — you submit a request: `s2s request "add rate limiting to the API"`. The orchestrator reads the request, classifies the intent (new feature? bug fix? investigation?), and decides the minimum set of stages that work actually needs. It tells you: "route is `pm → engineering → engineering_exec`, approval required before execution."

**3. Work through the stages using a two-phase pattern.**
For each artifact-producing stage — PM, Research, Design, Engineering — the workflow is:

First, run `s2s stage <stage>`. S2S outputs a structured task package: exactly what to build, the context from prior stages, and the file path to write the artifact to. Nothing is sent to an LLM. The AI reads the task, generates the artifact in the chat session, and writes it to the specified path.

Then run `s2s stage <stage> --submit`. S2S reads the artifact, runs quality checks, advances the project state, and tells the AI what to do next — proceed to the next stage, fix quality issues, or wait for a review gate.

S2S handles all orchestration logic — routing, state, quality, gate creation — in the binary. Your AI tokens go to generating the artifact, not to managing the workflow.

**4. Review and approve at gates.**
At meaningful points — after planning is done, before code executes — S2S pauses and asks for human approval via `s2s approve` or `s2s reject`. You can inspect everything: `s2s show change`, `s2s show spec`, `s2s show slices`. Nothing advances without a deliberate decision.

**5. Execute in an isolated workspace.**
When engineering execution runs, it operates on one scoped unit of work at a time (a Slice, derived from the Technical Spec and Backlog) inside an isolated git worktree — a separate working directory on a dedicated branch. Your main working directory is untouched until you review and merge.

**6. Continue safely.**
After execution, S2S records what happened: which branch, which PR, whether verification passed, what artifacts were produced. If you need to refine the work, submit another request. The orchestrator accumulates the new route into the existing work rather than overwriting prior decisions.

---

## E. Why this workflow is valuable

**Less chaos.** Every request goes through classification before anything happens. The AI doesn't decide on its own how much work to do — the orchestrator decides, based on what you asked for.

**Continuity across sessions.** Work state is persisted in `.s2s/` as structured files — changes, specs, slices, runs, approval gates. Close your laptop, switch machines, come back a week later. The project state is exactly where you left it.

**Safer parallel execution.** Code changes run in isolated worktrees, not in your main working directory. Two streams of work can run without stepping on each other, and each stream has its own branch and PR.

**Decisions are documented.** Every orchestration decision — what the request was, how it was classified, what route was planned, who approved what — is stored and queryable. The artifact trail survives the chat window.

**Right amount of process.** A one-line bug fix does not get routed through product and design. A new feature does. The tool applies process proportionally, not uniformly.

---

## F. What makes S2S different

**Intent-aware routing.** S2S does not run a fixed pipeline for every request. It classifies what you asked for across nine intent types — new feature, bug fix, investigation, refinement, hotfix, and others — and selects only the stages that request needs. This is the core behavior, and it is fully implemented.

**Adaptive across refinements.** When you refine existing work, S2S merges the new route into the prior plan rather than replacing it. If earlier decisions required an approval gate, that gate is preserved even after a follow-up request. You cannot accidentally drop a compliance checkpoint by submitting a clarifying message.

**Slice-first execution.** Engineering execution operates one scoped unit at a time — a Slice derived from the Technical Spec and Backlog. This bounds the blast radius of any single execution and makes recovery straightforward if something goes wrong.

**Isolated execution workspaces.** Code changes happen in dedicated git worktrees, not in your live working directory. Your main branch is clean until you explicitly review and merge.

**Governance that the AI actually reads.** S2S writes governance files into `.s2s/guardrails/` and root compatibility shims (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`). Claude Code and Codex read these files automatically at the start of every session. The AI's behavior is shaped by real, versioned, conflict-detected governance — not a prompt you paste into a chat window and hope persists.

**Works with the tools you already use.** S2S does not replace Claude Code or Codex. It runs alongside them. Your chat client stays the same; S2S adds the orchestration and execution layer underneath.

---

## G. Current limitations

S2S currently supports one active work stream per project. Teams running several independent features in parallel through the same project will find this constraining — multi-stream support is a natural next step but is not yet in the product.

The intent classifier uses weighted keyword signals. It handles common cases — bug fixes, new features, investigations — reliably, but ambiguous or compound requests may be routed in unexpected ways. A feedback mechanism to correct mis-classifications does not yet exist.

Engineering execution is built around repositories that have a working verification command. Projects without a test or build command will produce execution runs with no verification signal.

The `iterate` stage — for post-delivery refinement loops — is defined in the data model but is not yet reachable from the CLI surface.

---

## H. Positioning summary

Spec-To-Ship is the governance and orchestration layer for teams that have adopted AI coding tools and want to ship with confidence. It brings intent classification, adaptive stage routing, scoped execution, and persistent audit trails to a workflow that is otherwise fast but ungoverned. It does not replace your AI client or your engineering process — it makes both more disciplined. Open source, CLI-native, and built to work with Claude Code and Codex today.