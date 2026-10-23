/** Render an insight's evidence object faithfully, formatting values by their key. */
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

const PERCENT_KEYS = /(margin|share|discount|quantile|threshold$)/i;
const CURRENCY_KEYS = /(sales|profit)/i;

export function humanize(key: string): string {
  const text = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatEvidenceValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  if (/rho|spearman/i.test(key)) return value.toFixed(2);
  if (/sales_threshold/i.test(key)) return formatCurrency(value);
  if (PERCENT_KEYS.test(key)) return formatPercent(value);
  if (CURRENCY_KEYS.test(key)) return formatCurrency(value);
  if (/count|orders|key/i.test(key)) return formatNumber(value);
  return Number.isInteger(value) ? formatNumber(value) : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function RecordsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1 text-left font-medium">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {columns.map((c) => (
                <td key={c} className="px-2 py-1 tabular-nums">
                  {formatEvidenceValue(c, row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Evidence({ value, name = "" }: { value: unknown; name?: string }) {
  if (Array.isArray(value)) {
    if (value.every(isRecord)) return <RecordsTable rows={value} />;
    return <span>{value.map((v) => formatEvidenceValue(name, v)).join(", ")}</span>;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    // Objects of objects (e.g. by_category) read best as a table with a key column.
    if (entries.length > 0 && entries.every(([, v]) => isRecord(v))) {
      return <RecordsTable rows={entries.map(([key, v]) => ({ [humanize(name) || "item"]: key, ...(v as object) }))} />;
    }
    return (
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
        {entries.map(([key, v]) => (
          <div key={key} className="contents">
            <dt className="font-medium text-muted-foreground">{humanize(key)}</dt>
            <dd className="mb-1 tabular-nums sm:mb-0">
              {isRecord(v) && Object.values(v).every((x) => typeof x !== "object") ? (
                Object.entries(v)
                  .map(([k, x]) => `${k}: ${formatEvidenceValue(key, x)}`)
                  .join(" · ")
              ) : typeof v === "object" && v !== null ? (
                <Evidence value={v} name={key} />
              ) : (
                formatEvidenceValue(key, v)
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{formatEvidenceValue(name, value)}</span>;
}
