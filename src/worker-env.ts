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
}
