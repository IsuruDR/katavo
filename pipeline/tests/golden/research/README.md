# Golden research docs

5 frozen briefs + their frozen output docs. Run `npm run golden:research` to re-run all
of them and compare against the frozen output. Diffs are reported, not asserted — this is
a human-review tool, not a CI gate.

Run before:
- Any prompt change in `nodes/research/`
- Any model swap
- Any change to subagent/synthesizer/auditor logic

After running, eyeball the diff. If quality improved, regenerate the frozen file:

    cp last-run-<id>.json <id>.json

Don't ship if word count or source kind distribution regresses noticeably.

## Files

- `breadth-<topic>.json` — parent episode brief + frozen doc
- `depth-<topic>.json` — expansion brief + frozen doc

Schema (TypeScript types in `fixtures.ts`):

    {
      "id": "breadth-espresso",
      "input": { topic, tier, clarifyingAnswers, parentResearchDocument?, sourceChapterTitle? },
      "expected": { minSectionCount, minSourceCount, minFetchedRatio }
    }

## First-run thresholds

The `expected` block in each fixture is a placeholder until v22 has run in production for
a week. After that, copy the actual numbers (sectionCount, sourceCount, fetchedRatio)
from `last-run-*.json` into the fixture's `expected` block to lock in the baseline.
