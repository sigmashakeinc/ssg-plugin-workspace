# sigmashake-workspace — Data retention policy

Table-by-table TTLs. Every retention rule has a corresponding deletion
process in `dsar-runbook.md` plus an enforcement mechanism (cron sweep,
TTL, or customer-initiated).

The rule of thumb is **minimize and time-bound**. The audit log is the
longest-lived data we hold; everything else is shorter.

## Retention rules

### session_retention
- **Storage.** Sessions / auth state.
- **TTL.** Sliding 30-day expiry; sessions inactive > 30d auto-deleted.
- **Deletion process.** Automatic via TTL; manual sign-out deletes immediately.

### audit_retention
- **Storage.** Service audit log.
- **TTL.** **7 years.** SOC 2 + standard customer-contract retention.
- **After 7 years.** Migrated to cold storage (still chain-anchored).
- **Deletion process.** None at row level; chain is immutable. An org's
  entire chain is deleted only when the org itself is deleted.

### operational_retention
- **Storage.** Operational records (jobs, runs, metrics rollups).
- **TTL.** 90 days. Beyond that the records are pruned by a daily cron sweep.

## Customer-initiated deletion (DSAR right-to-be-forgotten)

See `dsar-runbook.md` for operational steps. Summary:

- Identifying data is redactable on request.
- The audit log is **not** redactable — chain integrity depends on it. We
  redact personally-identifying fields within an event (replace `actor_id`
  with `redacted:<sha256-prefix>`, drop `actor_ip`) but the event stays
  so the chain stays valid.

## Backup retention

Cloud-provider-managed snapshots: 30 days. We do not run our own backups
today (the provider snapshots are the only copies).

## Audit

The retention policy is reviewed at every quarterly SOC 2 evidence cycle.
Any deviation per customer contract is recorded as an explicit exception
in sigmashake-compliance.
