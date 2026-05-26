// Placeholder shown when WorkspaceMode is "services" or "hybrid" before any
// connectors have been wired. Once src/connectors/* lands this component
// becomes the empty state for "no connectors yet" — the catalog grid renders
// in its place when at least one connector is installed.

interface Props {
  onOpenSettings: () => void;
}

export function ServicesEmptyState({ onOpenSettings }: Props) {
  return (
    <div className="state-card">
      <div className="state-card__mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="state-card__title">Services mode is on</h2>
      <p className="state-card__body">
        This is where your connected accounts will live — Slack, Stripe, GitHub, and the rest.
        Connectors are landing in the next release. Until then, the rail will stay empty.
      </p>
      <ul className="state-card__hints">
        <li>
          Want to keep using the monorepo manager in the meantime? Open{" "}
          <button type="button" className="state-card__inline-btn" onClick={onOpenSettings}>
            Workspace mode
          </button>{" "}
          and switch to <strong>Manage your monorepo</strong> or <strong>Show both</strong>.
        </li>
        <li>
          Have a connector you want first? Tell us on the SigmaShake Discord — we&apos;re
          prioritizing by request.
        </li>
      </ul>
    </div>
  );
}
