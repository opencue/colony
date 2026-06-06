---
"colonyq": minor
---

`colony install` now auto-wires the Colony skill into the active cue profile so
the agent discovers Colony as a pullable capability (loads on a real trigger)
instead of relying on forced session prefaces. New `colony skills wire` /
`colony skills unwire` subcommands shell out to cue's own `cue skills
add-to-profile` / `remove-from-profile`, targeting the cue-resident
`colony/colony` skill. Wiring is best-effort: a missing cue is a soft no-op that
prints the manual `npx skills add` fallback (now with the `recodee` typo fixed),
never a failed install. Opt out with `colony install --no-skills` or
`COLONY_SKILL_WIRE=0`; uninstall removes the skill symmetrically.
