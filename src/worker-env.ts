// Worker-only bindings. Kept out of `types.ts` so the client tsconfig doesn't
// need the Cloudflare workers-types lib to compile.

export interface WorkerEnv {
  WORKSPACE_ENV: string;
  /** Comma-separated GitHub user ids allowed to use workspace.sigmashake.com. */
  ALLOWED_GITHUB_USER_IDS: string;
  /** Shared SESSIONS KV written by accounts.sigmashake.com. Read-only here. */
  ACCOUNTS_SESSIONS: KVNamespace;
  /** Cloudflare static assets fetcher — required because run_worker_first=true. */
  ASSETS: Fetcher;
  /** Service binding to sigmashake-support. Used by the Inbox proxy to call
   *  /agent/tickets — required because same-zone HTTPS fetches get dropped. */
  SUPPORT: Fetcher;
  /** Service binding to sigmashake-sales. Used by the Inbox proxy to call
   *  /leads — sales has no public route so service binding is the only way. */
  SALES: Fetcher;
  /** Service binding to sigmashake-observ. Used by the Observability proxy to
   *  read the consolidated service-health board. Optional so `wrangler dev`
   *  boots without it — the proxy answers 503 `unconfigured` when absent. */
  OBSERV?: Fetcher;
  /** Bearer token (`ssk_agent_…`) provisioned via sigmashake-support's
   *  seed-agent.ts. Forwarded as `Authorization: Bearer …` on every SUPPORT
   *  fetch. Scopes must include at minimum `read` — add `respond` + `resolve`
   *  for inline reply / close from the Inbox view. Optional so local
   *  `wrangler dev` boots without provisioning. */
  SUPPORT_AGENT_TOKEN?: string;
  /** Bearer token gating sigmashake-sales `/agent/leads*`. Must match the
   *  `SALES_AGENT_TOKEN` secret on sigmashake-sales. Forwarded as
   *  `Authorization: Bearer …` on every SALES fetch. Optional so local dev
   *  surfaces an `unconfigured` source instead of failing. */
  SALES_AGENT_TOKEN?: string;
  /** Cross-OS platform parity matrix store. Each daemon writes its OS column
   *  here (cell:<feature_id>:<os>) on attest, and reads sibling columns back
   *  on snapshot build so the Linux/macOS/Windows matrix converges across all
   *  three operator hosts. Optional so local `wrangler dev` boots without a
   *  KV namespace; absent binding → /parity-matrix routes 503 unconfigured. */
  PARITY_MATRIX?: KVNamespace;
  /** Bearer token presented by the SSG daemon on /api/workspace/parity-matrix
   *  reads + writes. Daemon stores it at ~/.sigmashake/workspace-parity-token.
   *  Provision via:
   *    token=$(openssl rand -hex 32)
   *    echo "$token" | wrangler secret put PARITY_AGENT_TOKEN
   *    # then push the SAME value to each operator host:
   *    #   echo "$token" > ~/.sigmashake/workspace-parity-token && chmod 600 …
   *  Optional so local dev boots without it — bearer routes reject when
   *  unset. Cookie-session operator access still works without it. */
  PARITY_AGENT_TOKEN?: string;
  /** sigmashake-downloads R2 bucket (read-only here). Used by the
   *  distribution-drift probe to read stable-<lane>-update.json keys directly.
   *  Direct HTTPS to download.sigmashake.com fails with HTTP 522 because both
   *  Workers live on the sigmashake.com zone (same-zone Worker fetches get
   *  dropped); the R2 binding sidesteps the loopback. Optional so local
   *  `wrangler dev` boots without it — the probe falls back to fetch(). */
  DOWNLOADS?: R2Bucket;
}
