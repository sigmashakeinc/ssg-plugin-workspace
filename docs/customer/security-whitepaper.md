# sigmashake-workspace — Customer Security Whitepaper

Customer-facing summary of how sigmashake-workspace protects your data, your operations,
and your audit trail. Written for a security or compliance reviewer at a
customer evaluating SigmaShake as part of their AI-governance stack.

## What sigmashake-workspace is

sigmashake-workspace is a component of the SigmaShake platform. It runs on Cloudflare's edge platform and is subject to the same security controls as the rest of the platform.

You retain control of the data we process on your behalf. We retain
custody only of records needed to run the service and produce the audit
log you contracted us for.

## Architecture summary

- Cloudflare Workers (edge platform) for compute.
- Cloudflare D1 / KV / R2 for storage.
- Cloudflare Secrets Store for credentials.
- TLS 1.3 enforced end-to-end.


For deeper architectural detail, see the public ADRs in `docs/adr/`.

## Data we hold about you

| Data | Purpose | Retention | Location |
|---|---|---|---|
| Operator email / SSO subject | authentication | until membership removed | per data residency declaration |
| Audit log of operations | tamper-evident operational record | 7 years (then cold storage) | per data residency declaration |
| Operational telemetry (anonymized) | service-health monitoring | 90 days | aggregated metrics only |

## Encryption

- **In transit.** TLS 1.3 enforced; no TLS 1.0/1.1 supported.
- **At rest.** AES-256 storage-layer + AES-GCM-256 application-layer for
  sensitive surfaces. Full attestation in `docs/privacy/encryption-at-rest.md`.

## Access controls

- Operator accounts MFA-required.
- RBAC enforced at the handler boundary (auditor / member / org_admin).
- Permission escalation blocked at the API layer.
- Every mutating action emits an audit event tied to the actor.

## Incident response

- 24/7 on-call for P1 outages and security incidents.
- 24-hour SLA for confirmed Critical CVEs; 72-hour for High.
- Customer notification within 72 hours of confirmed customer-impacting incident.
- Post-incident report ("postmortem") shared within 5 business days.

Full SLA in `docs/cve-response-sla.md`.

## Compliance posture

- SOC 2 Type II (in progress; trust report at trust.sigmashake.com).
- GDPR / CCPA data-subject rights honored — DSAR runbook in `docs/privacy/dsar-runbook.md`.

## Contact

- **Security issues:** `security@sigmashake.com`
- **Support:** sigmashake.com/support
- **Compliance:** trust.sigmashake.com
