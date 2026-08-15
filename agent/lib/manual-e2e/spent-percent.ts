/** Return the share of a budget already spent, as a whole percentage. */
export function spentPercent(spent: number, budget: number): number {
  return Math.round((spent / budget) * 100);
}
