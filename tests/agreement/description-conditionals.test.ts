import { evaluateDescriptionSchema } from '../../src/utils/dynamic-job-builder/agreement/description-schema-evaluator';

// The Lighting matrix row from the backend hand-over (MOBILE-DESCRIPTION-TEMPLATE-CONDITIONALS.md).
const LIGHTING_TEMPLATE =
  "1st Story: [lighting_1st_ft]'[IF lighting_2nd_ft > 0], 2nd Story: [lighting_2nd_ft]'[/IF][IF lighting_3rd_ft > 0], 3rd Story: [lighting_3rd_ft]'[/IF] — Total: [lighting_total_ft]'";

const GRID = 'field_grid';

const stateWith = (grid: any, extra: any = {}) => ({
  lighting: { sectionFields: { lighting_section: { [GRID]: grid, ...extra } } },
});

const schemaFor = (template: string, extra: any = {}) => ({
  calculatedLogic: [
    { variableName: 'lighting_1st_ft', formula: { type: 'sum', fields: [`col:${GRID}:1st`] } },
    { variableName: 'lighting_2nd_ft', formula: { type: 'sum', fields: [`col:${GRID}:2nd`] } },
    { variableName: 'lighting_3rd_ft', formula: { type: 'sum', fields: [`col:${GRID}:3rd`] } },
    { variableName: 'lighting_total_ft', formula: { type: 'sum', fields: [GRID] } },
  ],
  primaryMappings: [{ outputTemplate: template }],
  ...extra,
});

const run = (template: string, grid: any, extraSchema: any = {}, extraState: any = {}) =>
  evaluateDescriptionSchema(schemaFor(template, extraSchema), {}, stateWith(grid, extraState));

const TWO_STOREYS = { 'Left Side': { '1st': 30, '2nd': 10 }, 'Right Side': { '1st': 20, '2nd': 5 } };

describe('description templates: [IF] blocks and grid columns', () => {
  it('renders the Lighting Footage line with the 3rd storey ABSENT when none was sold', () => {
    expect(run(LIGHTING_TEMPLATE, TWO_STOREYS)).toEqual(["1st Story: 50', 2nd Story: 15' — Total: 65'"]);
  });

  it('shows the 3rd-storey clause once it has footage', () => {
    const grid = { ...TWO_STOREYS, Front: { '3rd': 8 } };
    expect(run(LIGHTING_TEMPLATE, grid)).toEqual(["1st Story: 50', 2nd Story: 15', 3rd Story: 8' — Total: 73'"]);
  });

  it('drops both optional clauses when only the 1st storey was sold', () => {
    expect(run(LIGHTING_TEMPLATE, { 'Left Side': { '1st': 40 } })).toEqual(["1st Story: 40' — Total: 40'"]);
  });

  it('resolves conditionals BEFORE the merge: a token inside a false branch is never read', () => {
    const out = run('A[IF lighting_3rd_ft > 0][leak][/IF]B', TWO_STOREYS, {}, { leak: 'LEAK' });
    expect(out).toEqual(['AB']);
    expect(JSON.stringify(out)).not.toContain('LEAK');
  });

  it('supports [ELSE]', () => {
    const t = 'Zones: [IF lighting_3rd_ft > 0]three[ELSE]none[/IF]';
    expect(run(t, TWO_STOREYS)).toEqual(['Zones: none']);
    expect(run(t, { ...TWO_STOREYS, Front: { '3rd': 1 } })).toEqual(['Zones: three']);
  });

  it('nests blocks', () => {
    const t = '[IF lighting_1st_ft > 0]1[IF lighting_2nd_ft > 0]2[IF lighting_3rd_ft > 0]3[/IF][/IF][/IF]';
    expect(run(t, TWO_STOREYS)).toEqual(['12']);
    expect(run(t, { 'Left Side': { '1st': 5 } })).toEqual(['1']);
  });

  it('accepts every operator, the = / <> aliases and the word forms', () => {
    const ok = (expr: string) => run(`[IF ${expr}]yes[ELSE]no[/IF]`, TWO_STOREYS)[0] === 'yes';
    expect(ok('lighting_1st_ft >= 50')).toBe(true);
    expect(ok('lighting_1st_ft <= 49')).toBe(false);
    expect(ok('lighting_1st_ft < 51')).toBe(true);
    expect(ok('lighting_1st_ft == 50')).toBe(true);
    expect(ok('lighting_1st_ft = 50')).toBe(true);
    expect(ok('lighting_1st_ft != 50')).toBe(false);
    expect(ok('lighting_1st_ft <> 49')).toBe(true);
    // isEmpty is the existing rule semantics (a numeric 0 variable is a value, not 'empty'), so it is tested on an absent field.
    expect(ok('nothing_here isEmpty')).toBe(true);
    expect(ok('lighting_2nd_ft isNotEmpty')).toBe(true);
    expect(ok('lighting_2nd_ft exists')).toBe(true);
    expect(ok('lighting_2nd_ft')).toBe(true); // bare ref = truthy
    expect(ok('lighting_3rd_ft')).toBe(false);
  });

  it('[IF Value > 0] resolves against the line\'s own valueReferenceId, like [Value]', () => {
    const schema = {
      ...schemaFor(''),
      primaryMappings: [{ valueReferenceId: 'lighting_2nd_ft', outputTemplate: '[IF Value > 0]2nd: [Value][/IF]' }],
    };
    expect(evaluateDescriptionSchema(schema, {}, stateWith(TWO_STOREYS))).toEqual(['2nd: 15']);
    expect(evaluateDescriptionSchema(schema, {}, stateWith({ 'Left Side': { '1st': 3 } }))).toEqual([]);
  });

  it('reads a column directly in a merge token and in a rule', () => {
    const schema = {
      ...schemaFor(''),
      primaryMappings: [
        {
          outputTemplate: '2nd: [col:field_grid:2nd]',
          condition: { type: 'all', rules: [{ fieldId: 'col:field_grid:2nd', operator: '>', value: 0 }] },
        },
      ],
    };
    expect(evaluateDescriptionSchema(schema, {}, stateWith(TWO_STOREYS))).toEqual(['2nd: 15']);
    expect(evaluateDescriptionSchema(schema, {}, stateWith({ 'Left Side': { '1st': 3 } }))).toEqual([]);
  });

  it('a column selector means nothing for a scalar stored under the same id', () => {
    const schema = {
      ...schemaFor(''),
      primaryMappings: [{ outputTemplate: '[IF col:plain:2nd > 0]yes[ELSE]no[/IF]' }],
    };
    expect(evaluateDescriptionSchema(schema, {}, { t: { sectionFields: { s: { plain: 99 } } } })).toEqual(['no']);
  });

  it('is forgiving: an unclosed [IF] closes at the end, stray [ELSE] / [/IF] are dropped, never printed', () => {
    expect(run('A[IF lighting_2nd_ft > 0]B', TWO_STOREYS)).toEqual(['AB']);
    expect(run('A[IF lighting_3rd_ft > 0]B', TWO_STOREYS)).toEqual(['A']);
    expect(run('A[ELSE]B[/IF]C', TWO_STOREYS)).toEqual(['ABC']);
  });

  it('leaves templates without any marker exactly as before', () => {
    expect(run('Total: [lighting_total_ft]\'', TWO_STOREYS)).toEqual(["Total: 65'"]);
  });

  it('a combination-scoped bare column reads the CURRENT row; a variable stays GLOBAL', () => {
    const state = {
      tab: {
        comboGroups: {
          combo_sec: {
            combinations: [
              { [GRID]: { Front: { '1st': 10 } } },
              { [GRID]: { Front: { '1st': 7 } } },
            ],
          },
        },
      },
    };
    const schema = {
      calculatedLogic: [{ variableName: 'all_1st', formula: { type: 'sum', fields: [`col:${GRID}:1st`] } }],
      primaryMappings: [
        { scope: 'combination', sectionId: 'combo_sec', outputTemplate: 'row: [col:field_grid:1st] of [all_1st]' },
      ],
    };
    expect(evaluateDescriptionSchema(schema, {}, state)).toEqual(['row: 10 of 17', 'row: 7 of 17']);
  });
});
