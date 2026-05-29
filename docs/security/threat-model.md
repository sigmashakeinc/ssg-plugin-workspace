# sigmashake-workspace — Threat Model

STRIDE per surface. Last fully reviewed 2026-05-27.

## Surfaces

### 1. Public HTTP API

**Assets.** Session cookies, bearer tokens, audit log, persistent state.

| STRIDE | Threat | Mitigation |
|---|---|---|
| **S**poofing | Forged session cookie | HMAC-signed cookie; rotation via Secrets Store. |
| **T**ampering | Modified Authorization header | Bearer is signed JWT; signature checked on every request. |
| **R**epudiation | Operator denies an action | Every mutating action emits an audit event (chain-protected). |
| **I**nfo disclosure | Cross-tenant data leak via dispatcher bug | RBAC at handler boundary + `org_id` FK on every row. |
| **D**oS | Compute-heavy admin call | Rate limit per session; expensive endpoints offloaded to background jobs. |
| **E**oP | Permission escalation via custom role | Permission-escalation check blocks granting a role you don't hold. |

### 2. Outbound integrations

**Assets.** Vault credentials, third-party API tokens.

| STRIDE | Threat | Mitigation |
|---|---|---|
| **S** | Spoofed outbound destination | Pinned TLS fingerprint where applicable. |
| **T** | Modified request payload | All outbound calls signed where the API supports it. |
| **I** | Credential exfiltration | Credentials read from Secrets Store at request time; never logged. |

## Cross-cutting controls

- **Audit chain.** Mutating operations append to a Merkle-chained audit log.
- **Secrets handling.** All credentials live in Cloudflare Secrets Store.
- **Dependency hygiene.** Nightly `bun audit` blocks high/critical CVEs.
- **Operator MFA.** All operator accounts MFA-required.

## Findings tracker

| # | Finding | Severity | Status |
|---|---|---|---|
| (initial threat model — no open findings as of 2026-05-27) | | | |
