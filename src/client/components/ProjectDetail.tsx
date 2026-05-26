import { useEffect, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type { ProjectCard } from "../api/types";
import { CloudGate } from "./CloudGate";
import { ContextPanel } from "./ContextPanel";
import { EditPanel } from "./EditPanel";
import { InfrastructureGraph } from "./InfrastructureGraph";
import { InspectPanel } from "./InspectPanel";
import { RunPanel } from "./RunPanel";
import { SimplePanel } from "./SimplePanel";
import { TestsPanel } from "./TestsPanel";

type Tab = "simple" | "map" | "run" | "inspect" | "tests" | "context" | "edit";

const TAB_LABELS: Record<Tab, string> = {
  simple: "Simple",
  map: "Service map",
  run: "Run",
  inspect: "Inspect",
  tests: "Tests",
  context: "Context",
  edit: "Edit",
};

const PROJECT_TYPE_LABEL: Record<ProjectCard["type"], string> = {
  "cf-worker": "Website or web app",
  bun: "Script or local app",
  elixir: "Always-on service",
  native: "Native binary",
  unknown: "Project",
};

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient | null;
}

export function ProjectDetail({ card, client }: Props) {
  const [tab, setTab] = useState<Tab>("simple");
  // Reset to Simple whenever the user picks a different project. Keeps the
  // landing experience friendly for non-technical operators.
  useEffect(() => {
    setTab("simple");
  }, []);
  const local = !!client?.hasLocalCapabilities;
  return (
    <div className="detail">
      <header className="detail__header">
        <div className="detail__header-row">
          <span className={`simple__chip simple__chip--${card.type}`}>
            {PROJECT_TYPE_LABEL[card.type]}
          </span>
          <h2 className="detail__slug">{card.slug}</h2>
        </div>
        <div className="detail__path" title={card.dir}>
          {card.dir}
        </div>
      </header>
      <div className="detail__tabs" role="tablist">
        {(["simple", "map", "run", "inspect", "tests", "context", "edit"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className={`detail__tab${t === tab ? " detail__tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "simple" && (
        <SimplePanel
          card={card}
          client={client}
          onSwitchToAdvanced={local ? () => setTab("run") : undefined}
        />
      )}
      {tab === "map" && client && <InfrastructureGraph card={card} client={client} />}
      {tab === "run" &&
        (local && client ? <RunPanel card={card} client={client} /> : <CloudGate feature="Run" />)}
      {tab === "inspect" &&
        (local && client ? (
          <InspectPanel card={card} client={client} />
        ) : (
          <CloudGate feature="Inspect" />
        ))}
      {tab === "tests" &&
        (local && client ? (
          <TestsPanel card={card} client={client} />
        ) : (
          <CloudGate feature="Tests" />
        ))}
      {tab === "context" &&
        (local && client ? (
          <ContextPanel card={card} client={client} />
        ) : (
          <CloudGate feature="Context" />
        ))}
      {tab === "edit" &&
        (local && client ? (
          <EditPanel card={card} client={client} />
        ) : (
          <CloudGate feature="Edit" />
        ))}
    </div>
  );
}
