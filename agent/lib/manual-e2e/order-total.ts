/** Total a list of dollar prices and return the amount in whole cents. */
export function orderTotalCents(prices: readonly number[]): number {
  return prices.reduce((total, price) => total + Math.round(price * 100), 0);
}
