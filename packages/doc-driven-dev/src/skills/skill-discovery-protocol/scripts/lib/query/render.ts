"use strict";

export type OutputFormat = "json" | "md" | "table";

export interface Renderer {
  render(data: unknown): string;
}

class JsonRenderer implements Renderer {
  render(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }
}

class MarkdownRenderer implements Renderer {
  render(data: unknown): string {
    if (data == null || typeof data !== "object") {
      return String(data);
    }
    if (Array.isArray(data)) {
      return data
        .map((item) => {
          if (item == null || typeof item !== "object") {
            return `- ${String(item)}`;
          }
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length === 0) return `- (empty)`;
          const [firstKey, firstVal] = entries[0];
          const heading = `- **${firstKey}:** ${String(firstVal)}`;
          const rest = entries
            .slice(1)
            .map(([k, v]) => `  - ${k}: ${String(v)}`);
          return [heading, ...rest].join("\n");
        })
        .join("\n");
    }
    const entries = Object.entries(data as Record<string, unknown>);
    return entries.map(([k, v]) => `- **${k}:** ${String(v)}`).join("\n");
  }
}

class TableRenderer implements Renderer {
  render(data: unknown): string {
    if (data == null || typeof data !== "object") {
      return String(data);
    }
    if (Array.isArray(data)) {
      if (data.length === 0) return "";
      const cols = [
        ...new Set(
          data.flatMap((item) =>
            item != null && typeof item === "object"
              ? Object.keys(item as Record<string, unknown>)
              : []
          )
        ),
      ];
      if (cols.length === 0) return data.map((item) => String(item)).join("\n");
      const widths = cols.map((col) =>
        Math.max(
          col.length,
          ...data.map((item) => {
            const val =
              item != null && typeof item === "object"
                ? String((item as Record<string, unknown>)[col] ?? "")
                : "";
            return val.length;
          })
        )
      );
      const header = `| ${cols.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
      const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
      const rows = data.map((item) => {
        const cells = cols.map((col, i) => {
          const val =
            item != null && typeof item === "object"
              ? String((item as Record<string, unknown>)[col] ?? "")
              : "";
          return val.padEnd(widths[i]);
        });
        return `| ${cells.join(" | ")} |`;
      });
      return [header, sep, ...rows].join("\n");
    }
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return "";
    const keyWidth = Math.max(...entries.map(([k]) => k.length));
    const valWidth = Math.max(
      ...entries.map(([, v]) => String(v).length),
      5
    );
    const header = `| ${"key".padEnd(keyWidth)} | ${"value".padEnd(valWidth)} |`;
    const sep = `| ${"-".repeat(keyWidth)} | ${"-".repeat(valWidth)} |`;
    const rows = entries.map(
      ([k, v]) => `| ${k.padEnd(keyWidth)} | ${String(v).padEnd(valWidth)} |`
    );
    return [header, sep, ...rows].join("\n");
  }
}

const renderers: Record<OutputFormat, Renderer> = {
  json: new JsonRenderer(),
  md: new MarkdownRenderer(),
  table: new TableRenderer(),
};

export function getRenderer(format: OutputFormat): Renderer {
  return renderers[format];
}
