# sigmashake-workspace — Paging policy

Who gets woken up, when, and why. Rotation in `oncall.toml`.

## Severity matrix

| Severity | Definition | Page channel | Acknowledge | Resolve target |
|---|---|---|---|---|
| **P1** | Customer-visible outage (5xx > 1% sustained 5m, security incident, data-loss event) | PagerDuty (phone + push) | 10 min, 24/7 | 60 min |
| **P2** | Customer-visible degradation (latency burn rate ≥ 6, regional outage, single-tenant 5xx) | PagerDuty (push only) | 4 business hours | 1 business day |
| **P3** | Trend or warning (latency burn rate ≥ 3, cert score dropped a tier, dependency CVE high) | Slack | next-business-day | within the sprint |
| **P4** | Informational (deploy completed, weekly SLO summary) | Slack (low-noise) | — | — |

## What pages

1. Headline availability burn rate ≥ 14.4 over 1h AND ≥ 6 over 6h → **P1**
2. Sustained 5xx > 1% for 5m → **P1**
3. Any data-loss event recorded → **P1**
4. Workspace cert score for `sigmashake-workspace` drops below silver → **P3**

## What does NOT page

- Single 5xx response
- Cron job duration > expected (sweep is allowed to take longer)
- Cron job missed at expected time (CF can shift cron up to ~15m)

## After-hours rules

P1 always wakes the on-call. P2 holds until business hours. P3/P4 batched
to one digest per morning.

## Escalation

If the primary doesn't ack a P1 within 10 minutes, PagerDuty re-pages.
With `escalation = "self"` today, the alert re-fires every 5 minutes
until acked.
