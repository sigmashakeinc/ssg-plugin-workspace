# sigmashake-workspace — Encryption at rest

What sigmashake-workspace encrypts, with what algorithm, and where the keys live.
Attestation map for the SOC 2 CC6.7 control.

## Summary

| Surface | Encryption | Key custody | Key rotation |
|---|---|---|---|
| Cloudflare D1 (per-tenant) | AES-256 (CF-managed) | Cloudflare | Cloudflare (transparent) |
| Cloudflare KV | AES-256 (CF-managed) | Cloudflare | Cloudflare |
| Cloudflare R2 | AES-256 (CF-managed) | Cloudflare | Cloudflare |
| Cloudflare Secrets Store | AES-256 (CF-managed) | Cloudflare; Quicksilver propagation | Operator-initiated; ≤ 60s |
| Vault-stored secrets | AES-GCM-256 envelope | Cloudflare Secrets Store master key | Quarterly |

## Cloudflare-managed encryption

D1, KV, R2, and Secrets Store are encrypted at rest by Cloudflare's edge
platform with AES-256. Cloudflare publishes their key management
attestation in the Cloudflare Trust Hub; we cite that as evidence under
CC6.7 ("The entity restricts the transmission, movement, and removal of
information…").

We do NOT control the data-at-rest key for the underlying storage.
Cloudflare does. We accept standard cloud-provider-managed-key risk; the
offset is operational simplicity and the SOC 2 attestation inherited
from CF's compliance.

## Application-layer encryption

For data where storage-layer encryption is not enough — typically because
we want to limit which Workers can decrypt — we add an application-layer
envelope using AES-GCM-256 keyed by `SIGMASHAKE_WORKSPACE_DEK_MASTER`
in the secrets store.

## Key rotation

- **Storage-layer keys.** Provider-managed; we inherit the rotation cadence.
- **Application-layer keys.** Quarterly overlap rotation: a new `_V2` secret
  is added, every encrypted row is re-encrypted on next write, then the
  `_V1` secret is removed once the audit confirms no `_V1` reads remain.

## Audit

The encryption posture is reviewed every quarter as part of the SOC 2
evidence cycle. Any deviation (e.g. a temporary plaintext column to
support a migration) is logged as an explicit exception.
