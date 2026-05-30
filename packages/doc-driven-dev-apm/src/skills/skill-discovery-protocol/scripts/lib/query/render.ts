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
  render(_data: unknown): string {
    throw new Error("Markdown renderer not yet implemented");
  }
}

class TableRenderer implements Renderer {
  render(_data: unknown): string {
    throw new Error("Table renderer not yet implemented");
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
