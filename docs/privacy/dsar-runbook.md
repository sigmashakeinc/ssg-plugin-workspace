# sigmashake-workspace — DSAR runbook

How to handle a Data Subject Access Request (GDPR Article 15, CCPA §1798.110):
a person asking what data we have about them, exporting it, or deleting it.

## Eligibility check

1. **Direct customer / operator.** Authenticated user — their data is in
   `memberships`, sessions, and audit-log `actor_id`s.
2. **Customer's monitored device / asset.** Data is in the org's tenant
   resources; the customer (org_admin) is the data controller, not us.
3. **Billing contact.** Listed in `orgs.billing_email`.

For tenant-scoped DSARs, route to the customer org_admin; we process on
their behalf when they file via support. This is the SOC 2 P5.2
"data subject rights" path.

## Find

Given an identifier (email, SSO subject, fingerprint):

```sql
-- adapt to the actual storage for sigmashake-workspace
SELECT * FROM users WHERE email = ?;
SELECT * FROM audit_events WHERE actor_id = ?;
```

## Export

Bundle the rows into a JSON file:

```bash
# placeholder — replace with the actual export tool for sigmashake-workspace
echo '{ "user": {...}, "audit": [...] }' > /tmp/dsar-export.json
```

## Delete

1. Hard-delete identifying rows from primary storage.
2. Redact (do not delete) audit-log entries: replace `actor_id` with
   `redacted:<sha256-prefix>`, drop `actor_ip`. The chain integrity
   depends on the row count and ordering.
3. Confirm completion to the requester within 30 days (GDPR Article 12 §3).

## Audit

Every DSAR action emits an audit event with event_type `dsar.completed`
and the requester's redacted identifier. The completion record is
retained for 3 years per CCPA recordkeeping requirements.
