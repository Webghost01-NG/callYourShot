export function cadenceLabel(intervalSec: string | null | undefined): string {
  const seconds = Number(intervalSec);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Custom duration";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function isDirectionalQuestion(question: string): boolean {
  return /closes? at or above (?:its|the) opening/i.test(question);
}

export function outcomeLabels(question: string) {
  return isDirectionalQuestion(question)
    ? { up: "Higher", down: "Lower", upDetail: "YES · UP", downDetail: "NO · DOWN" }
    : { up: "Yes", down: "No", upDetail: "YES contract", downDetail: "NO contract" };
}

export function callLabel(question: string, side: "UP" | "DOWN"): string {
  const labels = outcomeLabels(question);
  return side === "UP" ? labels.up : labels.down;
}
