import { buildRoofWaiverText } from '../../src/utils/roof-waiver-text';

describe('buildRoofWaiverText', () => {
  it('names the signed-in company throughout the agreement', () => {
    const text = buildRoofWaiverText({ companyName: 'Acme Exteriors', products: ['gutters'] });

    // The company is named four times in the original copy; all four must follow the tenant.
    expect(text.match(/Acme Exteriors/g)).toHaveLength(4);
    expect(text).toContain('I have contracted Acme Exteriors to install gutters on my home.');
  });

  it('never leaks LeafFilter branding, whatever the inputs', () => {
    const cases = [
      undefined,
      {},
      { companyName: '' },
      { companyName: '   ', products: [] },
      { companyName: 'Acme', products: ['Gutter Guard'] },
      { companyName: null, products: [null, undefined, ''] },
    ];

    cases.forEach((args) => {
      expect(buildRoofWaiverText(args as any)).not.toMatch(/leaf\s*filter/i);
    });
  });

  it('falls back to complete, signable wording when company and products are absent', () => {
    const text = buildRoofWaiverText();

    expect(text).toContain('I have contracted the company to install gutters and/or gutter protection on my home.');
    expect(text.trim().endsWith('walking on the roof.')).toBe(true);
  });

  describe('product list phrasing', () => {
    const installsFrom = (products: string[]) =>
      buildRoofWaiverText({ companyName: 'Acme', products })
        .replace(/^I have contracted Acme to install /, '')
        .replace(/ on my home\..*$/s, '');

    it('renders one product bare', () => {
      expect(installsFrom(['gutters'])).toBe('gutters');
    });

    it('joins two products with "and/or"', () => {
      expect(installsFrom(['gutters', 'gutter protection'])).toBe('gutters and/or gutter protection');
    });

    it('comma-separates three or more, with "and/or" before the last', () => {
      expect(installsFrom(['gutters', 'siding', 'gutter protection'])).toBe(
        'gutters, siding and/or gutter protection'
      );
    });

    it('drops blank and nullish entries before joining', () => {
      expect(
        buildRoofWaiverText({ companyName: 'Acme', products: ['gutters', '', null, '  ', 'siding'] as any })
      ).toContain('install gutters and/or siding on my home.');
    });

    it('trims whitespace around product names', () => {
      expect(installsFrom(['  gutters  '])).toBe('gutters');
    });
  });
});
