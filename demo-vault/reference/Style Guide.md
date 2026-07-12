# Style Guide

How the team writes notes and closes out a work session.

## End-of-session logging

When wrapping up a work block, do three things:

1. **Commit the code** — small, logical commits with a conventional-commit message.
2. **Update the vault** — append a line to today's `daily/` note (via [[Waypoint Bot]]
   if working away from the vault) and update the relevant `projects/` note if status
   changed.
3. **Note anything worth remembering later** in [[Session History]] if it's a
   cross-project decision, or [[Weekly Log]] if it's routine project progress.

## Note conventions

- Project notes use YAML frontmatter: `emoji`, `state` (active/paused/archived),
  `version`.
- Link liberally with `[[wikilinks]]` — a note that isn't linked from anywhere is hard
  to find later.
- Daily notes are one file per day (`daily/YYYY-MM-DD.md`), short bullet entries, not
  prose.
- Prefer concrete details (what changed, why) over status adjectives ("good progress").
