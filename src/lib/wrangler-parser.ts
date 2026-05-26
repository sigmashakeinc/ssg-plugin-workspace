// Minimal wrangler config parser — extracts just the binding shapes we care
// about for the infrastructure graph. Handles both `wrangler.toml` and
// `wrangler.json`/`wrangler.jsonc` (Cloudflare's current default for new
// projects). Hand-rolled (no TOML/JSONC lib) so the same code can be
// copy-pasted into the zero-runtime-dep sigmashake-gov daemon.
//
// Coverage:
//   name, main
//   [[routes]] pattern, zone_name
//   [[d1_databases]] binding, database_name, database_id
//   [[kv_namespaces]] binding, id
//   [[r2_buckets]] binding, bucket_name
//   [[services]] binding, service, entrypoint
//   [[queues.producers]] binding, queue
//   [[queues.consumers]] queue
//   [[tail_consumers]] service
//   [[secrets_store_secrets]] binding, secret_name, store_id
//   [[dispatch_namespaces]] binding, namespace
//   [[analytics_engine_datasets]] binding, dataset
//   [durable_objects] bindings = [{name, class_name}, ...]
//   [triggers] crons = [...]
//   [assets] directory, binding

export interface ParsedWrangler {
  filePath: string;
  /** Directory-derived project slug — the stable identity used for graph
   *  node ids. Independent of the wrangler `name`, which only has to be
   *  unique on Cloudflare's side and need not match the folder. */
  slug: string;
  name: string;
  main?: string;
  routes: Array<{ pattern: string; zoneName?: string }>;
  d1: Array<{ binding: string; databaseName?: string; databaseId?: string }>;
  kv: Array<{ binding: string; id?: string }>;
  r2: Array<{ binding: string; bucketName?: string }>;
  services: Array<{ binding: string; service: string; entrypoint?: string }>;
  queueProducers: Array<{ binding: string; queue: string }>;
  queueConsumers: Array<{ queue: string }>;
  tailConsumers: Array<{ service: string }>;
  secrets: Array<{ binding: string; secretName?: string; storeId?: string }>;
  dispatchNamespaces: Array<{ binding: string; namespace?: string }>;
  analytics: Array<{ binding: string; dataset?: string }>;
  durableObjects: Array<{ name: string; className?: string }>;
  crons: string[];
  assets?: { directory?: string; binding?: string };
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

/** `/abs/path/sigmashake-foo/wrangler.toml` → `sigmashake-foo`. The parent
 *  directory name is the project slug. Callers with authoritative knowledge
 *  of the directory should still set `slug` explicitly. */
function slugFromPath(filePath: string): string {
  const parts = filePath.split(/[/\\]+/).filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
}

function stripComments(toml: string): string {
  // Strip "# comment" suffixes but skip # inside double-quoted strings. We
  // don't handle TOML's full string-literal grammar (multi-line, raw) because
  // wrangler.toml in this repo doesn't use those.
  return toml
    .split("\n")
    .map((line) => {
      let inStr = false;
      let prev = "";
      for (let i = 0; i < line.length; i++) {
        const ch = line[i] as string;
        if (ch === '"' && prev !== "\\") inStr = !inStr;
        if (ch === "#" && !inStr) return line.slice(0, i);
        prev = ch;
      }
      return line;
    })
    .join("\n");
}

function parseStringArray(raw: string): string[] {
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  const out: string[] = [];
  const re = /"([^"]*)"/g;
  let m: RegExpExecArray | null = re.exec(inner);
  while (m !== null) {
    out.push(m[1] ?? "");
    m = re.exec(inner);
  }
  return out;
}

function blankParsed(filePath: string): ParsedWrangler {
  return {
    filePath,
    slug: slugFromPath(filePath),
    name: "",
    routes: [],
    d1: [],
    kv: [],
    r2: [],
    services: [],
    queueProducers: [],
    queueConsumers: [],
    tailConsumers: [],
    secrets: [],
    dispatchNamespaces: [],
    analytics: [],
    durableObjects: [],
    crons: [],
  };
}

function flushArrayRow(result: ParsedWrangler, section: string, row: Record<string, string>): void {
  switch (section) {
    case "routes":
      if (row.pattern) {
        result.routes.push({
          pattern: row.pattern,
          ...defined({ zoneName: row.zone_name }),
        });
      }
      return;
    case "d1_databases":
      if (row.binding) {
        result.d1.push({
          binding: row.binding,
          ...defined({
            databaseName: row.database_name,
            databaseId: row.database_id,
          }),
        });
      }
      return;
    case "kv_namespaces":
      if (row.binding) {
        result.kv.push({
          binding: row.binding,
          ...defined({ id: row.id }),
        });
      }
      return;
    case "r2_buckets":
      if (row.binding) {
        result.r2.push({
          binding: row.binding,
          ...defined({ bucketName: row.bucket_name }),
        });
      }
      return;
    case "services":
      if (row.binding && row.service) {
        result.services.push({
          binding: row.binding,
          service: row.service,
          ...defined({ entrypoint: row.entrypoint }),
        });
      }
      return;
    case "queues.producers":
      if (row.binding && row.queue) {
        result.queueProducers.push({
          binding: row.binding,
          queue: row.queue,
        });
      }
      return;
    case "queues.consumers":
      if (row.queue) {
        result.queueConsumers.push({ queue: row.queue });
      }
      return;
    case "tail_consumers":
      if (row.service) {
        result.tailConsumers.push({ service: row.service });
      }
      return;
    case "secrets_store_secrets":
      if (row.binding) {
        result.secrets.push({
          binding: row.binding,
          ...defined({
            secretName: row.secret_name,
            storeId: row.store_id,
          }),
        });
      }
      return;
    case "dispatch_namespaces":
      if (row.binding) {
        result.dispatchNamespaces.push({
          binding: row.binding,
          ...defined({ namespace: row.namespace }),
        });
      }
      return;
    case "analytics_engine_datasets":
      if (row.binding) {
        result.analytics.push({
          binding: row.binding,
          ...defined({ dataset: row.dataset }),
        });
      }
      return;
  }
}

export function parseWrangler(toml: string, filePath = ""): ParsedWrangler {
  const result = blankParsed(filePath);
  const cleaned = stripComments(toml);

  // [durable_objects] bindings = [{...}, {...}] is the only multi-line
  // construct we need. Extract it with a regex pass before the line walker.
  const doBlock = cleaned.match(/\[durable_objects\][\s\S]*?bindings\s*=\s*\[([\s\S]*?)\]/);
  if (doBlock) {
    const inner = doBlock[1] ?? "";
    const itemRe = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null = itemRe.exec(inner);
    while (m !== null) {
      const fields = (m[1] ?? "").split(",");
      const obj: Record<string, string> = {};
      for (const f of fields) {
        const kv = f.trim().match(/^([a-z_]+)\s*=\s*"([^"]*)"/);
        if (kv) obj[kv[1] ?? ""] = kv[2] ?? "";
      }
      if (obj.name) {
        result.durableObjects.push({
          name: obj.name,
          ...defined({ className: obj.class_name }),
        });
      }
      m = itemRe.exec(inner);
    }
  }

  // Single-pass line walker for everything else.
  const lines = cleaned.split("\n");
  let header: "" | "root" | "triggers" | "assets" | "ignore" = "root";
  let arraySection: string | null = null;
  let row: Record<string, string> | null = null;

  function commit() {
    if (arraySection && row) flushArrayRow(result, arraySection, row);
    row = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const sec = line.match(/^\[(\[?)([a-z0-9_.]+)\]?\]$/i);
    if (sec) {
      commit();
      const isArray = sec[1] === "[";
      const name = sec[2] ?? "";
      if (isArray) {
        arraySection = name;
        row = {};
        header = "ignore";
      } else {
        arraySection = null;
        switch (name) {
          case "triggers":
            header = "triggers";
            break;
          case "assets":
            header = "assets";
            break;
          default:
            header = "ignore";
        }
      }
      continue;
    }

    const kv = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/i);
    if (!kv) continue;
    const key = kv[1] ?? "";
    const val = (kv[2] ?? "").trim();

    if (arraySection && row) {
      row[key] = unquote(val);
      continue;
    }

    if (header === "root") {
      if (key === "name") result.name = unquote(val);
      else if (key === "main") result.main = unquote(val);
      continue;
    }

    if (header === "triggers") {
      if (key === "crons" && val.startsWith("[")) {
        result.crons = parseStringArray(val);
      }
      continue;
    }

    if (header === "assets") {
      if (!result.assets) result.assets = {};
      if (key === "directory") result.assets.directory = unquote(val);
      else if (key === "binding") result.assets.binding = unquote(val);
    }
  }
  commit();

  return result;
}

// ── JSONC (wrangler.json / wrangler.jsonc) ───────────────────────────────────

/**
 * Strip `//` + block comments and trailing commas from a JSONC document so
 * the result is plain JSON for `JSON.parse`. String-literal aware: `//`, `,`,
 * `}` etc. inside quoted strings are left untouched. Hand-rolled to keep this
 * file zero-dependency.
 */
function stripJsonc(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // Index in `out` of a comma that may turn out to be trailing — cleared by
  // any significant token, dropped if the next significant char is `}`/`]`.
  let pendingComma = -1;
  while (i < n) {
    const ch = src[i] as string;
    const next = i + 1 < n ? src[i + 1] : "";
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        const c = src[i] as string;
        out += c;
        i++;
        if (c === "\\") {
          if (i < n) {
            out += src[i] as string;
            i++;
          }
          continue;
        }
        if (c === '"') break;
      }
      pendingComma = -1;
      continue;
    }
    if (ch === ",") {
      pendingComma = out.length;
      out += ch;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (pendingComma >= 0 && /^\s*$/.test(out.slice(pendingComma + 1))) {
        out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
      }
      pendingComma = -1;
      out += ch;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      out += ch;
      i++;
      continue;
    }
    pendingComma = -1;
    out += ch;
    i++;
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function recordArray(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

/** Drop keys whose value is `undefined`, so the result is safe to spread
 *  into objects with strict (`exactOptionalPropertyTypes`) optional fields. */
function defined<T extends Record<string, string | undefined>>(o: T): { [K in keyof T]?: string } {
  const out: { [K in keyof T]?: string } = {};
  for (const k of Object.keys(o) as Array<keyof T>) {
    const v = o[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Parse a `wrangler.json` / `wrangler.jsonc` document. */
export function parseWranglerJsonc(text: string, filePath = ""): ParsedWrangler {
  const result = blankParsed(filePath);
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonc(text));
  } catch {
    // Unparseable — return empty, matching the TOML path's graceful skip.
    return result;
  }
  if (!raw || typeof raw !== "object") return result;
  const obj = raw as Record<string, unknown>;

  result.name = str(obj.name) ?? "";
  const main = str(obj.main);
  if (main) result.main = main;

  if (Array.isArray(obj.routes)) {
    for (const r of obj.routes) {
      if (typeof r === "string") {
        result.routes.push({ pattern: r });
      } else if (r && typeof r === "object") {
        const rr = r as Record<string, unknown>;
        const pattern = str(rr.pattern);
        if (pattern) {
          result.routes.push({
            pattern,
            ...defined({ zoneName: str(rr.zone_name) }),
          });
        }
      }
    }
  }
  const singleRoute = str(obj.route);
  if (singleRoute) result.routes.push({ pattern: singleRoute });

  for (const db of recordArray(obj.d1_databases)) {
    const binding = str(db.binding);
    if (binding) {
      result.d1.push({
        binding,
        ...defined({
          databaseName: str(db.database_name),
          databaseId: str(db.database_id),
        }),
      });
    }
  }

  for (const kv of recordArray(obj.kv_namespaces)) {
    const binding = str(kv.binding);
    if (binding) result.kv.push({ binding, ...defined({ id: str(kv.id) }) });
  }

  for (const r2 of recordArray(obj.r2_buckets)) {
    const binding = str(r2.binding);
    if (binding) {
      result.r2.push({
        binding,
        ...defined({ bucketName: str(r2.bucket_name) }),
      });
    }
  }

  for (const svc of recordArray(obj.services)) {
    const binding = str(svc.binding);
    const service = str(svc.service);
    if (binding && service) {
      result.services.push({
        binding,
        service,
        ...defined({ entrypoint: str(svc.entrypoint) }),
      });
    }
  }

  const queues = obj.queues;
  if (queues && typeof queues === "object") {
    const q = queues as Record<string, unknown>;
    for (const prod of recordArray(q.producers)) {
      const binding = str(prod.binding);
      const queue = str(prod.queue);
      if (binding && queue) result.queueProducers.push({ binding, queue });
    }
    for (const cons of recordArray(q.consumers)) {
      const queue = str(cons.queue);
      if (queue) result.queueConsumers.push({ queue });
    }
  }

  for (const t of recordArray(obj.tail_consumers)) {
    const service = str(t.service);
    if (service) result.tailConsumers.push({ service });
  }

  for (const sec of recordArray(obj.secrets_store_secrets)) {
    const binding = str(sec.binding);
    if (binding) {
      result.secrets.push({
        binding,
        ...defined({
          secretName: str(sec.secret_name),
          storeId: str(sec.store_id),
        }),
      });
    }
  }

  for (const dn of recordArray(obj.dispatch_namespaces)) {
    const binding = str(dn.binding);
    if (binding) {
      result.dispatchNamespaces.push({
        binding,
        ...defined({ namespace: str(dn.namespace) }),
      });
    }
  }

  for (const an of recordArray(obj.analytics_engine_datasets)) {
    const binding = str(an.binding);
    if (binding) {
      result.analytics.push({
        binding,
        ...defined({ dataset: str(an.dataset) }),
      });
    }
  }

  const doObj = obj.durable_objects;
  if (doObj && typeof doObj === "object") {
    const bindings = (doObj as Record<string, unknown>).bindings;
    for (const b of recordArray(bindings)) {
      const name = str(b.name);
      if (name) {
        result.durableObjects.push({
          name,
          ...defined({ className: str(b.class_name) }),
        });
      }
    }
  }

  const triggers = obj.triggers;
  if (triggers && typeof triggers === "object") {
    const crons = (triggers as Record<string, unknown>).crons;
    if (Array.isArray(crons)) {
      result.crons = crons.filter((c): c is string => typeof c === "string");
    }
  }

  const assets = obj.assets;
  if (assets && typeof assets === "object") {
    const a = assets as Record<string, unknown>;
    const directory = str(a.directory);
    const binding = str(a.binding);
    result.assets = {};
    if (directory) result.assets.directory = directory;
    if (binding) result.assets.binding = binding;
  }

  return result;
}

/** Wrangler config filenames, in wrangler's own resolution order. */
export const WRANGLER_FILENAMES = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"] as const;

/**
 * Parse a wrangler config by file extension: `.json`/`.jsonc` → JSONC,
 * anything else → TOML. Both paths yield the same `ParsedWrangler` shape.
 */
export function parseWranglerConfig(content: string, filePath: string): ParsedWrangler {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return parseWranglerJsonc(content, filePath);
  }
  return parseWrangler(content, filePath);
}
