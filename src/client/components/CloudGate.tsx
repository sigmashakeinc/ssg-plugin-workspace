interface Props {
  feature: "Run" | "Inspect" | "Edit" | "Service map" | "Tests" | "Context";
}

export function CloudGate({ feature }: Props) {
  return (
    <div className="cloud-gate">
      <div className="cloud-gate__mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2 L21 6.5 V14 C21 18.5 17 21.5 12 22.5 C7 21.5 3 18.5 3 14 V6.5 Z"
            fill="currentColor"
            opacity="0.18"
          />
          <path
            d="M12 2 L21 6.5 V14 C21 18.5 17 21.5 12 22.5 C7 21.5 3 18.5 3 14 V6.5 Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8.5 11 L12 8.5 L15.5 11 V15 L12 17.5 L8.5 15 Z" fill="currentColor" />
        </svg>
      </div>
      <h3 className="cloud-gate__title">{feature} needs SigmaShake on your computer</h3>
      <p className="cloud-gate__body">
        You&apos;re viewing Workspace on the web. It can show you every project in the monorepo, but
        it can&apos;t reach the files on your computer — so <strong>{feature}</strong> only works in
        the SigmaShake desktop app, or when you open Workspace from SigmaShake running on your own
        machine.
      </p>
      <a
        className="cloud-gate__cta"
        href="https://sigmashake.com/desktop"
        target="_blank"
        rel="noopener"
      >
        Download SigmaShake Desktop
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 8 H 12 M 9 5 L 12 8 L 9 11"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </a>
    </div>
  );
}
