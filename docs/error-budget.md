# sigmashake-workspace — Error budget policy

This document is the contract between the team and the service: how SLO
budget consumption changes engineering behavior. SLOs themselves live in
`docs/slo.toml`.

## Definitions

- **Budget** = `(1 - target) × window_seconds`. For the headline availability SLO
  (target 99.9%, 28-day window), that is ~40 minutes of error time per window.
- **Burn rate** = `actual_error_rate / budget_error_rate`. A burn rate of 14.4
  consumes a 28-day budget in two days.

## Burn-rate response matrix

| Burn rate (1h avg) | Burn rate (6h avg) | Severity | Response |
|---|---|---|---|
| ≥ 14.4 | ≥ 6 | **Page** (P1) | On-call investigates immediately. Deploy freeze for any change touching the affected surface until burn returns < 1. |
| ≥ 6 | ≥ 3 | **Ticket** (P2) | File a P2 inside business hours. Risky changes deferred. |
| ≥ 3 | ≥ 1.5 | **Trend** (P3) | Slack channel notification; investigate before next sprint. |
| < 3 | < 1.5 | Healthy | Normal operations. |

The two-window rule (1h + 6h) is the Google SRE practice — avoids
single-spike false positives.

## Deploy freeze

When a burn-rate page fires:

1. The current deploy is allowed to roll out.
2. No new deploys to the affected surface without on-call acknowledgment.
3. Migrations are frozen regardless of surface.
4. Freeze auto-lifts when the 1h burn rate returns < 1 for 30 consecutive minutes.

## Budget exhaustion

If a budget is fully consumed in the 28-day window:

1. Full freeze on the affected surface until the next budget reset (exception: fix to the burning SLO).
2. The team owes a postmortem by end of window.
3. Next sprint allocates ≥ 1 engineer-week to reliability work.

## Manual override

The org_admin operator may declare a **budget waiver** for a specific deploy when:

- The deploy is a fix for an actively burning SLO, OR
- The deploy is a customer-blocking security patch.

Waivers are logged in the service audit log.
