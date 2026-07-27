/**
 * Golden-fixture generator for the regular-calculator parity tests.
 *
 * This is NOT a normal test — it is skipped unless GEN_GOLDEN=1. When run, it
 * imports the WEB calculation engine (source of truth) and writes the expected
 * result for every shared parity case to __tests__/fixtures/parity-golden.json.
 * The real parity test then compares the MOBILE engine against that JSON with no
 * dependency on the web repo path.
 *
 * Regenerate after a web-engine change:
 *   GEN_GOLDEN=1 WEB_REPO=/path/to/mhalt-revDSM-sales-frontend \
 *     node ./node_modules/.bin/jest __tests__/_generators/parity-golden.gen.ts
 */
import fs from 'fs';
import path from 'path';
import { pricing, extrasList, extrasList50 } from '../../src/utils/calculator/pricing-data';
import { paymentPlans } from '../../src/utils/calculator/payment-plans';
import { PARITY_CASES } from '../fixtures/parity-cases';

const SHOULD_RUN = process.env.GEN_GOLDEN === '1';
const WEB_REPO = process.env.WEB_REPO || '/Users/macbookpro/Desktop/mhalt-revDSM-sales-frontend';

(SHOULD_RUN ? describe : describe.skip)('generate parity golden', () => {
  it('writes fixtures/parity-golden.json from the web engine', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { calculateResultUtil: webCalc } = require(
      path.join(WEB_REPO, 'src/sections/lf-calculator/components/utils/calculation-results-util'),
    );

    const golden: Record<string, number> = {};
    for (const c of PARITY_CASES) {
      golden[c.key] = Math.round(
        webCalc({
          details: c.details,
          markupKey: c.markupKey,
          pricing,
          extrasList,
          extrasList50,
          paymentPlans,
          paymentMethod: c.paymentMethod,
          isLowesLead: c.isLowesLead ?? false,
          ckToInstallers: c.ckToInstallers ?? 0,
        }),
      );
    }

    const out = path.join(__dirname, '../fixtures/parity-golden.json');
    fs.writeFileSync(out, JSON.stringify(golden, null, 2) + '\n');
    expect(Object.keys(golden).length).toBe(PARITY_CASES.length);
  });
});
