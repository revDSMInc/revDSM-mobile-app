/**
 * Roofing Description Generator
 *
 * Generates description lines for roofing components based on job state.
 * Reads from the actual dynamic job builder vertical state using correct tab IDs,
 * section IDs, and field IDs from the job builder config.
 *
 * Lines are output in the exact order specified by the description table.
 *
 * Faithful TS port of web `roofing-description-generator.js`.
 *
 * @param verticalState - The current vertical state keyed by tab IDs
 * @returns Array of description lines for the "Description of Work"
 */

const SEC = {
  tearOffCombos: 'section_1782302701612',
  shingleCombos: 'section_1782364022364',
  underlaymentCombos: 'section_1782359838754',
  ridgeVentilation: 'section_1782364960474',
  chimneyFlashing: 'section_1782362764190',
  otherFlashing: 'section_1782362932859',
  deckingCombos: 'section_1782359292295',
  labor: 'section_1782365717498',
};

const F = {
  tearOffLayers: 'field_1782302814463_vszwf',
  tearOffStory: 'field_1782302895481_x9nlg',
  tearOffSqFt: 'field_1782303034164_zc3zs',

  shingleType: 'field_1782364046393_53dqa',
  shingleColor: 'field_1782364458416_o7noj',
  shingleSquares: 'field_1782364509257_nb3gn',

  underlaymentType: 'field_1782359875362_u1k6u',
  iceWaterShield: 'field_1782360059402_73lei',
  dripEdgeType: 'field_1782360210041_avwfw',
  dripEdgeFt: 'field_1782360310148_cm90f',
  starterStripFt: 'field_1782360333823_10bcz',

  ridgeCapType: 'field_1782365067912_zsag6',
  ridgeCapFt: 'field_1782365165081_jwn8d',
  ridgeVentFt: 'field_1782365611720_1ayq5',
  boxVentCount: 'field_1782365660838_di96m',
  pipeBootCount: 'field_1782365678577_i0gl7',

  chimneyType: 'field_1782362838864_1sdvn',
  skylightCount: 'field_1782362962894_2omq6',
  stepFlashingFt: 'field_1782362982813_ji3wo',
  valleyMetalFt: 'field_1782362994669_uqw0z',

  deckingType: 'field_1782359385694_dn2z1',
  deckingSheets: 'field_1782359509277_ape0y',

  laborStory: 'field_1782365731551_378r9',
  laborPitch: 'field_1782365834824_6hw86',
  laborSqFt: 'field_1782365914587_37bvf',
};

function buildTab(verticalId: string) {
  return {
    tearOff: `${verticalId}__tear-off`,
    shingles: `${verticalId}__shingles`,
    underlayment: `${verticalId}__underlayment-moisture`,
    ridgeVentilation: `${verticalId}__ridge-ventilation`,
    flashing: `${verticalId}__flashing`,
    decking: `${verticalId}__decking`,
    labor: `${verticalId}__labor`,
  };
}

function extractVerticalId(verticalState: any): string {
  const firstKey = Object.keys(verticalState || {})[0];
  if (!firstKey) return '';
  const sep = firstKey.indexOf('__');
  return sep > 0 ? firstKey.substring(0, sep) : '';
}

function getSectionField(vs: any, tabId: string, secId: string, fieldId: string): any {
  const val = vs?.[tabId]?.sectionFields?.[secId]?.[fieldId];
  return val !== undefined && val !== null && val !== '' ? val : undefined;
}

function getSectionNumber(vs: any, tabId: string, secId: string, fieldId: string): number {
  const raw = getSectionField(vs, tabId, secId, fieldId);
  if (raw === undefined) return 0;
  const n = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getSectionString(vs: any, tabId: string, secId: string, fieldId: string): string {
  const raw = getSectionField(vs, tabId, secId, fieldId);
  return raw !== undefined ? String(raw).trim() : '';
}

function getCombos(vs: any, tabId: string, secId: string): any[] {
  return vs?.[tabId]?.comboGroups?.[secId]?.combinations || [];
}

function parseNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = Number(String(val).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getComboNumber(combo: any, fieldId: string): number {
  const raw = combo?.[fieldId];
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getComboString(combo: any, fieldId: string): string {
  const raw = combo?.[fieldId];
  return raw !== undefined && raw !== null ? String(raw).trim() : '';
}

export function generateRoofingDescriptions(verticalState: any): string[] {
  if (!verticalState) return [];
  const vs = verticalState;
  const TAB = buildTab(extractVerticalId(vs));
  const descriptions: string[] = [];

  // Pre-collect combo data
  const tearOffCombos = getCombos(vs, TAB.tearOff, SEC.tearOffCombos);
  const shingleCombos = getCombos(vs, TAB.shingles, SEC.shingleCombos);
  const underCombos = getCombos(vs, TAB.underlayment, SEC.underlaymentCombos);
  const deckingCombos = getCombos(vs, TAB.decking, SEC.deckingCombos);

  const hasTearOff = tearOffCombos.some((c: any) => getComboNumber(c, F.tearOffSqFt) > 0);
  const hasShingles = shingleCombos.some((c: any) => getComboNumber(c, F.shingleSquares) > 0);
  const hasDecking = deckingCombos.some((c: any) => getComboNumber(c, F.deckingSheets) > 0);

  // 1. Tear-Off
  if (hasTearOff) {
    tearOffCombos.forEach((combo: any) => {
      const sqFt = getComboNumber(combo, F.tearOffSqFt);
      if (sqFt <= 0) return;
      const layers = getComboString(combo, F.tearOffLayers);
      const story = getComboString(combo, F.tearOffStory);
      descriptions.push(`Tear-Off ${layers} Existing Roof — Story ${story}, ${sqFt} sq`);
    });
  }

  // 2. Tear-Off Description
  if (hasTearOff) {
    descriptions.push('Installation: Remove existing roofing material(s) to decking, clear all debris from property, inspect decking for damage prior to installation');
  }

  // 3. Decking Repair
  if (hasDecking) {
    deckingCombos.forEach((combo: any) => {
      const sheets = getComboNumber(combo, F.deckingSheets);
      if (sheets <= 0) return;
      const type = getComboString(combo, F.deckingType);
      descriptions.push(`Decking ${type} — ${sheets} sheet(s)`);
    });
  }

  // 4. Drip Edge
  underCombos.forEach((combo: any) => {
    const ft = getComboNumber(combo, F.dripEdgeFt);
    if (ft <= 0) return;
    const type = getComboString(combo, F.dripEdgeType);
    descriptions.push(`Install ${type} Drip Edge — ${ft}'`);
  });

  // 5. Starter Strip
  underCombos.forEach((combo: any) => {
    const ft = getComboNumber(combo, F.starterStripFt);
    if (ft <= 0) return;
    descriptions.push(`Install Starter Strip — ${ft}'`);
  });

  // 6. Ice & Water Shield
  underCombos.forEach((combo: any) => {
    const sqft = getComboNumber(combo, F.iceWaterShield);
    if (sqft <= 0) return;
    descriptions.push(`Install Ice & Water Shield — ${sqft} sq ft`);
  });

  // 7. Underlayment
  underCombos.forEach((combo: any) => {
    const uwType = getComboString(combo, F.underlaymentType);
    if (!uwType) return;
    const sqft = getComboNumber(combo, F.iceWaterShield);
    if (sqft <= 0) return;
    descriptions.push(`Install ${uwType} Underlayment — ${sqft} sq ft`);
  });

  // 8. Valley Metal
  const valleyMetalFt = getSectionNumber(vs, TAB.flashing, SEC.otherFlashing, F.valleyMetalFt);
  if (valleyMetalFt > 0) {
    descriptions.push(`Install Valley Metal — ${valleyMetalFt}'`);
  }

  // 9. Step Flashing
  const stepFlashingFt = getSectionNumber(vs, TAB.flashing, SEC.otherFlashing, F.stepFlashingFt);
  if (stepFlashingFt > 0) {
    descriptions.push(`Install Step Flashing — ${stepFlashingFt}'`);
  }

  // 10. Chimney Flashing
  const chimneyType = getSectionString(vs, TAB.flashing, SEC.chimneyFlashing, F.chimneyType);
  if (chimneyType) {
    descriptions.push(`Chimney Flashing (${chimneyType})`);
  }

  // 11. Skylight Flashing
  const skylightCount = getSectionNumber(vs, TAB.flashing, SEC.otherFlashing, F.skylightCount);
  if (skylightCount > 0) {
    descriptions.push(`Install Skylight Flashing — ${skylightCount} unit(s)`);
  }

  // 12. Shingle Install
  if (hasShingles) {
    shingleCombos.forEach((combo: any) => {
      const sq = getComboNumber(combo, F.shingleSquares);
      if (sq <= 0) return;
      const type = getComboString(combo, F.shingleType);
      const color = getComboString(combo, F.shingleColor);
      descriptions.push(`Install ${type} ${color} Shingles — ${sq} sq`);
    });
  }

  // 13. Shingle Install Description
  if (hasShingles) {
    descriptions.push('Installation: Install per manufacturer specs, nail pattern per local code, step flash all wall intersections, seal all penetrations');
  }

  // 14. Pipe Boot
  const pipeBootCount = getSectionNumber(vs, TAB.ridgeVentilation, SEC.ridgeVentilation, F.pipeBootCount);
  if (pipeBootCount > 0) {
    descriptions.push(`Install Pipe Boot(s) — ${pipeBootCount} ea`);
  }

  // 15. Box Vent
  const boxVentCount = getSectionNumber(vs, TAB.ridgeVentilation, SEC.ridgeVentilation, F.boxVentCount);
  if (boxVentCount > 0) {
    descriptions.push(`Install Box Vent(s) — ${boxVentCount} ea`);
  }

  // 16. Continuous Ridge Vent
  const ridgeVentFt = getSectionNumber(vs, TAB.ridgeVentilation, SEC.ridgeVentilation, F.ridgeVentFt);
  if (ridgeVentFt > 0) {
    descriptions.push(`Install Continuous Ridge Vent — ${ridgeVentFt}'`);
  }

  // 17. Ridge Cap
  const ridgeCapFt = getSectionNumber(vs, TAB.ridgeVentilation, SEC.ridgeVentilation, F.ridgeCapFt);
  if (ridgeCapFt > 0) {
    const ridgeCapType = getSectionString(vs, TAB.ridgeVentilation, SEC.ridgeVentilation, F.ridgeCapType);
    descriptions.push(`Install ${ridgeCapType} Ridge Cap — ${ridgeCapFt}'`);
  }

  // 18. Labor - Story/Pitch
  const laborSqFt = getSectionNumber(vs, TAB.labor, SEC.labor, F.laborSqFt);
  if (laborSqFt > 0) {
    const laborStory = getSectionString(vs, TAB.labor, SEC.labor, F.laborStory);
    const laborPitch = getSectionString(vs, TAB.labor, SEC.labor, F.laborPitch);
    descriptions.push(`Roofing Labor — Story ${laborStory}, ${laborPitch} Pitch — ${laborSqFt} sq ft`);
  }

  // 19. Notes — no field in config, skipped

  return descriptions;
}
