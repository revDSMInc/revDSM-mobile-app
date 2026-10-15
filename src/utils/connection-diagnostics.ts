/**
 * A short, readable account of what the app currently believes about the connection.
 *
 * ⚠️ WHY THIS EXISTS. Reps report "it said offline" and there is no way to tell which of several
 * very different things happened: the API was down, a probe packet was lost on a weak cell, the
 * work queue was stuck, or the app simply never asked. Testing on WiFi reproduces none of them.
 * This turns an unanswerable report into one the rep can read out in a sentence.
 *
 * Pure so it can be tested; the caller gathers the values (CLAUDE.md §6).
 */
import type { NetworkStatus } from './network-status';

export interface ConnectionDiagnostics {
  status: NetworkStatus;
  /** What the OS says it is attached to: 'wifi', 'cellular', 'none'… */
  connectionType: string;
  /** '5g' | 'lte' | '3g'… when on cellular. */
  cellularGeneration?: string | null;
  /** NetInfo's own reachability verdict, which drives the offline banner. */
  isInternetReachable?: boolean | null;
  /** The url reachability is actually testing — the whole point of the netinfo config. */
  reachabilityUrl: string;
  /** Items still waiting to sync. */
  pendingCount: number;
  /** ms since the last successful /health, or null if never. */
  lastOkAgoMs?: number | null;
  lastProbeMs?: number | null;
  clockSkewMs?: number | null;
}

const ago = (ms?: number | null): string => {
  if (ms == null) return 'never';
  if (ms < 1000) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

export const describeStatus = (status: NetworkStatus): string => {
  switch (status) {
    case 'online':
      return 'Online';
    case 'degraded':
      return 'Weak connection';
    case 'offline':
      return 'Offline';
    default:
      return 'Checking…';
  }
};

/**
 * The lines to show, in the order a rep should read them out.
 *
 * ⚠️ The reachability URL is included on purpose. The single most misleading default in this
 * app was NetInfo testing `clients3.google.com` instead of our own API - invisible unless
 * something prints it.
 */
export const diagnosticLines = (d: ConnectionDiagnostics): Array<{ label: string; value: string }> => {
  const lines: Array<{ label: string; value: string }> = [
    { label: 'Status', value: describeStatus(d.status) },
    {
      label: 'Network',
      value: d.cellularGeneration
        ? `${d.connectionType} (${String(d.cellularGeneration).toUpperCase()})`
        : d.connectionType || 'unknown',
    },
    {
      label: 'Reachable',
      value:
        d.isInternetReachable === true
          ? 'yes'
          : d.isInternetReachable === false
            ? 'no'
            : 'checking',
    },
    { label: 'Checking', value: d.reachabilityUrl },
    { label: 'Last success', value: ago(d.lastOkAgoMs) },
  ];

  if (d.lastProbeMs != null) {
    lines.push({ label: 'Last check took', value: `${d.lastProbeMs}ms` });
  }
  lines.push({ label: 'Waiting to sync', value: String(d.pendingCount) });

  // Only worth showing when it is actually a problem: last-write-wins depends on the clock.
  if (d.clockSkewMs != null && Math.abs(d.clockSkewMs) > 5 * 60 * 1000) {
    lines.push({
      label: 'Device clock',
      value: `off by ${Math.round(Math.abs(d.clockSkewMs) / 60000)}m`,
    });
  }

  return lines;
};

/** One line the rep can read down the phone. */
export const diagnosticSummary = (d: ConnectionDiagnostics): string =>
  diagnosticLines(d)
    .map((l) => `${l.label}: ${l.value}`)
    .join(' · ');
