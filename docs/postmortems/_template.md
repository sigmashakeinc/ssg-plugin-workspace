# Postmortem: <one-line summary>

**Date.** YYYY-MM-DD
**Author.** <name or email>
**Severity.** P1 / P2 / P3
**Status.** Draft / Reviewed / Filed

## TL;DR

One paragraph: what happened, who was affected, and what we changed so it
doesn't recur.

## Timeline (UTC)

| Time | Event |
|---|---|
| HH:MM | First user impact (or first metric burn) |
| HH:MM | Alert fired |
| HH:MM | On-call acknowledged |
| HH:MM | Mitigation applied |
| HH:MM | Service fully recovered |

## Impact

- Number of customers / agents affected.
- Duration of impact.
- Visible symptoms.

## Root cause

What technically caused the incident. Be specific — files, functions, recent
commits. Not "a bad deploy" — "commit abc123 changed X to skip Y".

## What went well

Things that contained the blast radius; things that detected the issue quickly.

## What went badly

Things that delayed detection or recovery. Missing playbooks, alerts, tests.

## Action items

| # | Action | Owner | Due | Priority |
|---|---|---|---|---|
| 1 | Add alert on `<metric>` at `<threshold>` | | | P1 |
| 2 | Add test for `<scenario>` | | | P2 |

## Lessons learned

Blameless. The system allowed the incident — what about the system needs
to change so the next person can't fall into the same trap?
