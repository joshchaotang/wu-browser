/**
 * snapshot/session-legend.ts — UCF Session Legend
 *
 * MCP session 首次 UCF snapshot 自動附上格式說明。
 * 後續呼叫省略（LLM 已學到格式）。
 */

const UCF_LEGEND = `[UCF legend: a=link b=button c=input s=select k=checkbox r=radio h=heading m=menu x=other | states: ✓=checked/expanded ○=disabled !=required -=unchecked | →domain=external link target]`;

// Module-level state: has legend been sent in this session?
let legendSent = false;

/** Get legend text if not yet sent, then mark as sent. */
export function getLegendIfNeeded(): string | null {
  if (legendSent) return null;
  legendSent = true;
  return UCF_LEGEND;
}

/** Check if legend has been sent */
export function isLegendSent(): boolean {
  return legendSent;
}

/** Reset legend state (for testing or new session) */
export function resetLegend(): void {
  legendSent = false;
}

/** Force get the legend text regardless of state */
export function getLegendText(): string {
  return UCF_LEGEND;
}
