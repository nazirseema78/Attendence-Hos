# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- `AGENTS.md` (imported above) is the single source of truth for project rules, commands and the codebase map. Put shared rules there, not here. Keep this file for Claude-only notes.
- Stay inside "Phase 1 scope" in `AGENTS.md`. If a request goes beyond it, say so and confirm with the user before building.
- When a new decision is made, record it under "Decisions" in `AGENTS.md`.
- Never read or print the values in `.env.local`. To check configuration, report only which keys are filled.
- Before finishing a change, run `npm test`, `npm run typecheck` and `npm run lint`; run `npm run build` for anything touching pages or config.
- Do not commit or push unless the user asks.
