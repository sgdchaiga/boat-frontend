import test from 'node:test';
import assert from 'node:assert/strict';
import { manufacturingStatementTotals } from '../src/lib/manufacturingStatementMath.ts';

test('unsold production remains in finished inventory rather than cost of sales', () => {
  const result = manufacturingStatementTotals({ material: 1000, labour: 200, overhead: 100, openingWip: 50, closingWip: 150, openingFinished: 300, closingFinished: 700 });
  assert.equal(result.cogm, 1200);
  assert.equal(result.costOfSales, 800);
});
test('50 kg per bag affects material cost once, not twice at sale', () => {
  const bagCost = 50 * 3000;
  const result = manufacturingStatementTotals({ material: 10 * bagCost, labour: 0, overhead: 0, openingWip: 0, closingWip: 0, openingFinished: 0, closingFinished: 4 * bagCost });
  assert.equal(result.cogm, 1500000);
  assert.equal(result.costOfSales, 6 * bagCost);
});
test('inventory reversals remain visible as negative cost rather than being clamped', () => {
  const result = manufacturingStatementTotals({ material: 0, labour: 0, overhead: 0, openingWip: 0, closingWip: 0, openingFinished: 100, closingFinished: 150 });
  assert.equal(result.costOfSales, -50);
});
