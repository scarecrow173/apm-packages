/**
 * Baseline read metrics for progressive context retrieval (Issue #124).
 *
 * Separates the runtime artifact scan's reads (filesRead/bytesRead — the
 * whole-repo projection channel, which is allowed) from the document bodies
 * actually passed to delegates (dispatched focus paths). The ratio makes the
 * separation measurable: full-scan bytes vs delegate-passed bytes. A third
 * channel exists — in-process canonicalReference fingerprint reads — which
 * is intentionally not included in `scan`; do not read `scan` as "all bytes
 * read by the run."
 */

export type ReadMetrics = { files: number; bytes: number };

export type ContextBaseline = {
  scan: ReadMetrics;
  delegateInputs: ReadMetrics;
  /** delegateInputs.bytes / scan.bytes — 0 when the scan read nothing. */
  ratio: number;
};

export function summarizeBaseline(
  scan: { filesRead: number; bytesRead: number },
  delegatePaths: string[],
  readSize: (p: string) => number,
): ContextBaseline {
  const scanMetrics: ReadMetrics = { files: scan.filesRead, bytes: scan.bytesRead };
  const uniquePaths = [...new Set(delegatePaths)].sort((left, right) => left.localeCompare(right));
  const delegateInputs: ReadMetrics = {
    files: uniquePaths.length,
    bytes: uniquePaths.reduce((total, file) => total + readSize(file), 0),
  };
  return {
    scan: scanMetrics,
    delegateInputs,
    ratio: scanMetrics.bytes === 0 ? 0 : delegateInputs.bytes / scanMetrics.bytes,
  };
}
