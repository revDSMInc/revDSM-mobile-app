const SEC = {
  vinylSoffit: 'section_1781849987288',
  porchCeiling: 'section_1782132023135',
  nailerBuildOut: 'section_1782132355246',
  fasciaWrap: 'section_1782217400602',
  fasciaBoards: 'section_1782218944506',
  aluminumFascia: 'section_1782288956043',
  gutterCombination: 'section_1781585651515',
  downspoutAccessories: 'section_1781607258483',
  gutterExtras: 'section_1781685061809',
  guard6in: 'section_1782365542087',
  guard7in: 'section_1782373723139',
  guard45in: 'section_1782373742457',
  guardSpecial: 'section_1782386890583',
  guardExtras: 'section_1782389423259',
  additionalMain: 'section_1782477680389',
};

const F = {
  soffitType: 'field_1782131179372_t440g',
  soffitFootage: 'field_1782131354732_vgm7s',
  soffitSoffitType: 'field_1782131403608_u5zbn',
  soffitColor: 'field_1782131715424_ctppy',
  porchLocation: 'field_1782131179372_t440g',
  porchFootage: 'field_1782131354732_vgm7s',
  porchColor: 'field_1782131715424_ctppy',
  nailerFootage: 'field_1782132730844_243mp',
  fasciaWrapFootage: 'field_1782218687782_n0kkd',
  fasciaWrapColor: 'field_1782218865557_vwev9',
  fasciaBoardFootage: 'field_1782287677728_dz3wj',
  fasciaBoardSize: 'field_1782287942879_g1ddu',
  fasciaBoardWoodType: 'field_1782288212365_l83w2',
  alumFasciaFootage: 'field_1782288981252_37h62',
  gutterSizeToggle: 'field_1781585688652_fwjf5',
  gutterColor: 'field_1782469684711_jr4od',
  gutterGrid: 'field_1781585719275_fw2xm',
  downspoutSize: 'field_1781607278391_wib3v',
  downspoutColor: 'field_1782470518250_bl57c',
  downspoutFootage: 'field_1781607648707_tc2wf',
  elbowsA: 'field_1781608255573_gjc9w',
  elbowsB: 'field_1781676436065_z5my0',
  wedges: 'field_1781685314090_f75xt',
  straps: 'field_1781691079165_vu6qk',
  modifyHeight: 'field_1781693520792_ipauj',
  groundspout: 'field_1781873407628_9hhi0',
  splashGuard: 'field_1781873543896_fjptt',
  splashGuardColor: 'field_1781873546952_ide0x',
  splashGuard32: 'field_1781873549873_sdpt6',
  splashGuard32Color: 'field_1781873553401_ewfp1',
  guard6Grid: 'field_1782366872815_83p3i',
  guard6Color: 'field_1782366823048_xzbe6',
  guard6Width: 'field_1782365664306_t7qef',
  guard7Grid: 'field_1782373723140_jk9oo',
  guard7Color: 'field_1782373723140_r40ft',
  guard7Width: 'field_1782373723140_8g53n',
  guard45Grid: 'field_1782373742457_1vp2m',
  guard45Color: 'field_1782373742457_uphks',
  guard45Size: 'field_1782386579569_kft50',
  guardSpecialGrid: 'field_1782386890584_ceuls',
  guardSpecialColor: 'field_1782386890584_xl0xw',
  guardSpecialWidth: 'field_1782386890583_7rjo3',
  csr: 'field_1782389454491_0qgrv',
  extraLabor: 'field_1782477692853_mjb9v',
  screenPulls: 'field_1782477694448_p6sxu',
  additionalNotes: 'field_1782477864148_3sj98',
  walkboards: 'field_1782478239747_bi1be',
};

const APPROVED_PAINT_COLORS = ['white', 'clay', 'linen', 'musket brown'];

const GRID_ROW_KEYS = ['Front', 'Left Side', 'Right Side', 'Rear', 'Garage', 'Other'];
const GRID_LOCATION_LABELS: Record<string, string> = {
  Front: 'Front',
  'Left Side': 'Left',
  'Right Side': 'Right',
  Rear: 'Rear',
  Garage: 'Garage',
  Other: 'Other',
};

function buildTab(verticalId: string) {
  return {
    gutters: `${verticalId}__gutters`,
    gutterGuards: `${verticalId}__gutter-guards`,
    soffit: `${verticalId}__soffit`,
    fascia: `${verticalId}__fascia`,
    additionalServices: `${verticalId}__additional-services`,
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

function getSectionColor(vs: any, tabId: string, secId: string, swatchFieldId: string): string {
  return vs?.[tabId]?.sectionFields?.[secId]?.colorValues?.[swatchFieldId] || '';
}

function getCombos(vs: any, tabId: string, secId: string): any[] {
  return vs?.[tabId]?.comboGroups?.[secId]?.combinations || [];
}

function getComboColor(vs: any, tabId: string, secId: string, swatchFieldId: string, idx = 0): string {
  const combo = getCombos(vs, tabId, secId)[idx];
  return combo?.colorValues?.[swatchFieldId] || '';
}

function parseNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = Number(String(val).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getGridTotal(vs: any, tabId: string, secId: string, gridFieldId: string): number {
  let total = 0;
  getCombos(vs, tabId, secId).forEach((combo: any) => {
    const grid = combo[gridFieldId];
    if (!grid || typeof grid !== 'object') return;
    Object.values(grid).forEach((rowData: any) => {
      if (rowData && typeof rowData === 'object') {
        Object.values(rowData).forEach((v: any) => { total += parseNum(v); });
      }
    });
  });
  return total;
}

function getComboGridTotal(combo: any, gridFieldId: string): number {
  let total = 0;
  const grid = combo[gridFieldId];
  if (!grid || typeof grid !== 'object') return 0;
  Object.values(grid).forEach((rowData: any) => {
    if (rowData && typeof rowData === 'object') {
      Object.values(rowData).forEach((v: any) => { total += parseNum(v); });
    }
  });
  return total;
}

function getComboGridLocations(combo: any, gridFieldId: string): string {
  const active: string[] = [];
  GRID_ROW_KEYS.forEach((rowKey) => {
    const rowData = combo[gridFieldId]?.[rowKey];
    if (rowData && typeof rowData === 'object') {
      const rowTotal = Object.values(rowData).reduce((sum: number, v: any) => sum + parseNum(v), 0);
      if (rowTotal > 0) active.push(GRID_LOCATION_LABELS[rowKey] || rowKey);
    }
  });
  return active.join(', ');
}

function getGridRowTotal(vs: any, tabId: string, secId: string, gridFieldId: string, rowKey: string): number {
  let total = 0;
  getCombos(vs, tabId, secId).forEach((combo: any) => {
    const rowData = combo[gridFieldId]?.[rowKey];
    if (rowData && typeof rowData === 'object') {
      Object.values(rowData).forEach((v: any) => { total += parseNum(v); });
    }
  });
  return total;
}

function getGridLocations(vs: any, tabId: string, secId: string, gridFieldId: string): string {
  const active: string[] = [];
  GRID_ROW_KEYS.forEach((rowKey) => {
    if (getGridRowTotal(vs, tabId, secId, gridFieldId, rowKey) > 0) {
      active.push(GRID_LOCATION_LABELS[rowKey] || rowKey);
    }
  });
  return active.join(', ');
}

function getGridColTotal(vs: any, tabId: string, secId: string, gridFieldId: string, colKey: string): number {
  let total = 0;
  getCombos(vs, tabId, secId).forEach((combo: any) => {
    const grid = combo[gridFieldId];
    if (!grid || typeof grid !== 'object') return;
    Object.values(grid).forEach((rowData: any) => {
      if (rowData && typeof rowData === 'object') {
        total += parseNum(rowData[colKey]);
      }
    });
  });
  return total;
}

function anyGuardHasData(vs: any, TAB: any): boolean {
  return (
    getGridTotal(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Grid) > 0 ||
    getGridTotal(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Grid) > 0 ||
    getGridTotal(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Grid) > 0
  );
}

function getGuardTotalFt(vs: any, TAB: any): number {
  return (
    getGridTotal(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Grid) +
    getGridTotal(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Grid) +
    getGridTotal(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Grid)
  );
}

function getGuardLocations(vs: any, TAB: any): string {
  const allRows: Record<string, number> = {};
  GRID_ROW_KEYS.forEach((rowKey) => {
    allRows[rowKey] =
      getGridRowTotal(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Grid, rowKey) +
      getGridRowTotal(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Grid, rowKey) +
      getGridRowTotal(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Grid, rowKey);
  });
  const active: string[] = [];
  GRID_ROW_KEYS.forEach((rowKey) => {
    if (allRows[rowKey] > 0) active.push(GRID_LOCATION_LABELS[rowKey] || rowKey);
  });
  return active.join(', ');
}

function getGuardColor(vs: any, TAB: any): string {
  return (
    getComboColor(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Color) ||
    getComboColor(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Color) ||
    getComboColor(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Color)
  );
}

function getGuardSize(vs: any, TAB: any): string {
  const w6 = getSectionString(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Width);
  if (w6) return w6;
  const w7 = getSectionString(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Width);
  if (w7) return w7;
  const w45 = getSectionString(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Size);
  if (w45) return w45;
  return '';
}

function getGuardStory(vs: any, TAB: any): string {
  const stories: string[] = [];
  const cols1 = getGridColTotal(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Grid, '1st') +
    getGridColTotal(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Grid, '1st') +
    getGridColTotal(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Grid, '1st');
  const cols2 = getGridColTotal(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Grid, '2nd') +
    getGridColTotal(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Grid, '2nd') +
    getGridColTotal(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Grid, '2nd');
  const cols3 = getGridColTotal(vs, TAB.gutterGuards, SEC.guard6in, F.guard6Grid, '3rd') +
    getGridColTotal(vs, TAB.gutterGuards, SEC.guard7in, F.guard7Grid, '3rd') +
    getGridColTotal(vs, TAB.gutterGuards, SEC.guard45in, F.guard45Grid, '3rd');
  if (cols1 > 0) stories.push('1st Story');
  if (cols2 > 0) stories.push('2nd Story');
  if (cols3 > 0) stories.push('3rd Story');
  return stories.join(', ');
}

function isSpecGuardWidthLessThan34(vs: any, TAB: any): boolean {
  const w = getSectionString(vs, TAB.gutterGuards, SEC.guardSpecial, F.guardSpecialWidth);
  if (!w) return false;
  if (w === '< 2.5') return true;
  if (w === '2.5 - 3.4') return true;
  return false;
}

export function generateGutterRooflineDescriptions(verticalState: any): string[] {
  if (!verticalState) return [];
  const vs = verticalState;
  const TAB = buildTab(extractVerticalId(vs));
  const descriptions: string[] = [];

  const soffitFt = getSectionNumber(vs, TAB.soffit, SEC.vinylSoffit, F.soffitFootage);
  if (soffitFt > 0) {
    const color = getSectionColor(vs, TAB.soffit, SEC.vinylSoffit, F.soffitColor);
    const soffitType = getSectionString(vs, TAB.soffit, SEC.vinylSoffit, F.soffitSoffitType);
    const subType = getSectionString(vs, TAB.soffit, SEC.vinylSoffit, F.soffitType);
    const typeLabel = subType === 'PARTIAL' ? 'Partial Home' : subType === 'FULL' ? 'Full Home' : 'Partial Home or Full Home';
    descriptions.push(`Install ${color} ${soffitType} Soffit — ${soffitFt}'; Type: ${typeLabel}`);

    descriptions.push(`Installation: Install ${color} J Channel on structure every 12", cut and install soffit ${color} to edge and secure.`);
  }

  const porchFt = getSectionNumber(vs, TAB.soffit, SEC.porchCeiling, F.porchFootage);
  if (porchFt > 0) {
    const color = getSectionColor(vs, TAB.soffit, SEC.porchCeiling, F.porchColor);
    const location = getSectionString(vs, TAB.soffit, SEC.porchCeiling, F.porchLocation);
    descriptions.push(`Install ${color} soffit on Porch Ceiling: ${location}`);
  }

  const nailerFt = getSectionNumber(vs, TAB.soffit, SEC.nailerBuildOut, F.nailerFootage);
  if (nailerFt > 0) {
    descriptions.push(`Install Nailer Build Out — ${nailerFt}'`);
  }

  const boardFt = getSectionNumber(vs, TAB.fascia, SEC.fasciaBoards, F.fasciaBoardFootage);
  if (boardFt > 0) {
    const size = getSectionString(vs, TAB.fascia, SEC.fasciaBoards, F.fasciaBoardSize);
    const woodType = getSectionString(vs, TAB.fascia, SEC.fasciaBoards, F.fasciaBoardWoodType);
    descriptions.push(`Install Fascia Board (${size} ${woodType}) — ${boardFt}'`);
  }

  const wrapFt = getSectionNumber(vs, TAB.fascia, SEC.fasciaWrap, F.fasciaWrapFootage);
  if (wrapFt > 0) {
    const color = getSectionColor(vs, TAB.fascia, SEC.fasciaWrap, F.fasciaWrapColor);
    descriptions.push(`Install ${color} Fascia Wrap — ${wrapFt}'`);
  }

  const alumFt = getSectionNumber(vs, TAB.fascia, SEC.aluminumFascia, F.alumFasciaFootage);
  if (alumFt > 0) {
    descriptions.push(`Install Aluminum 2"x2" Fascia Board — ${alumFt}'`);
  }

  const rrFt = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.modifyHeight);
  const hasRR = rrFt > 0;
  if (hasRR) {
    descriptions.push(`Remove and Rehang — ${rrFt}'`);
  }

  const gutterCombos = getCombos(vs, TAB.gutters, SEC.gutterCombination);
  const hasGutter = gutterCombos.some((c: any) => getComboGridTotal(c, F.gutterGrid) > 0);

  gutterCombos.forEach((combo: any) => {
    const comboFt = getComboGridTotal(combo, F.gutterGrid);
    if (comboFt <= 0) return;

    const gutterColor = combo?.colorValues?.[F.gutterColor] || '';
    const gutterSize = String(combo?.[F.gutterSizeToggle] || '');
    const locations = getComboGridLocations(combo, F.gutterGrid);
    descriptions.push(`Install ${gutterSize} ${gutterColor} Gutters on ${locations} — ${comboFt}'`);
  });

  if (hasGutter || hasRR) {
    const wedgeCount = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.wedges);
    let installText = 'Installation: Align, pitch';
    if (wedgeCount > 0) {
      installText += ', install wedges for slanted/step fascia';
    }
    installText += ', install hidden hangers every 25"';
    installText += ', seal each seam, miter and connection with 50yr silicone';
    descriptions.push(installText);
  }

  if (hasGutter) {
    const firstColor = getComboColor(vs, TAB.gutters, SEC.gutterCombination, F.gutterColor);
    if (firstColor && APPROVED_PAINT_COLORS.includes(firstColor.toLowerCase())) {
      descriptions.push("Includes 50-year Sherwin Williams paint warranty with Kynar (Won't Chip & Scratch) and TrueCoat (Won't Fade or Stain)");
    }
  }

  const dsFt = getSectionNumber(vs, TAB.gutters, SEC.downspoutAccessories, F.downspoutFootage);
  if (dsFt > 0) {
    const size = getSectionString(vs, TAB.gutters, SEC.downspoutAccessories, F.downspoutSize);
    const color = getSectionColor(vs, TAB.gutters, SEC.downspoutAccessories, F.downspoutColor);
    descriptions.push(`Install ${dsFt}' of ${size} ${color} Downspouts`);
  }

  const elbowsA = getSectionNumber(vs, TAB.gutters, SEC.downspoutAccessories, F.elbowsA);
  const elbowsB = getSectionNumber(vs, TAB.gutters, SEC.downspoutAccessories, F.elbowsB);
  if (elbowsA > 0 || elbowsB > 0) {
    descriptions.push(`Total Elbows — A: ${elbowsA}, B: ${elbowsB}`);
  }

  const groundspoutCount = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.groundspout);
  if (groundspoutCount > 0) {
    descriptions.push(`Install ${groundspoutCount} Groundspouts`);
  }

  const splashGuardFt = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.splashGuard);
  if (splashGuardFt > 0) {
    const color = getSectionColor(vs, TAB.gutters, SEC.gutterExtras, F.splashGuardColor);
    descriptions.push(`Install ${color} Splash Guard — ${splashGuardFt}'`);
  }

  const splashGuard32Ft = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.splashGuard32);
  if (splashGuard32Ft > 0) {
    const color = getSectionColor(vs, TAB.gutters, SEC.gutterExtras, F.splashGuard32Color);
    descriptions.push(`Install ${color} Splash Guard .032 Gauge — ${splashGuard32Ft}'`);
  }

  const wedgeCount = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.wedges);
  if (wedgeCount > 0) {
    descriptions.push(`Install ${wedgeCount} Wedges for slanted/step fascia`);
  }

  const strapFt = getSectionNumber(vs, TAB.gutters, SEC.gutterExtras, F.straps);
  if (strapFt > 0) {
    descriptions.push(`Install Roof Straps — ${strapFt}'`);
  }

  if (anyGuardHasData(vs, TAB)) {
    const guardTotalFt = getGuardTotalFt(vs, TAB);
    const guardColor = getGuardColor(vs, TAB);
    const guardSize = getGuardSize(vs, TAB);
    const guardLocations = getGuardLocations(vs, TAB);

    descriptions.push(`Install ${guardColor} ${guardSize} Micro Mesh Guard on ${guardLocations} — ${guardTotalFt}'`);

    if (hasGutter) {
      descriptions.push("Gutter Tune-Up: Remove debris from gutter and downspouts to ground, clean gutter and downspouts thoroughly, realign and repitch if needed, Install Hidden Hangers every 25\", seal each seam, miter and connection with 50yr silicone");
    }
  }

  const specGuardFt = getGridTotal(vs, TAB.gutterGuards, SEC.guardSpecial, F.guardSpecialGrid);
  if (specGuardFt > 0) {
    const color = getComboColor(vs, TAB.gutterGuards, SEC.guardSpecial, F.guardSpecialColor);
    const locations = getGridLocations(vs, TAB.gutterGuards, SEC.guardSpecial, F.guardSpecialGrid);
    descriptions.push(`Install ${color} SpecGuard on ${locations} — ${specGuardFt}'`);
    descriptions.push("Existing Fascia Gutter Tune-Up: Remove all debris from gutter and downspouts interior, seal each seam, miter and connection with 50yr silicone");

    if (isSpecGuardWidthLessThan34(vs, TAB)) {
      descriptions.push("Due to gutter width, cleaning or sealing cannot be guaranteed");
    }
  }

  if (anyGuardHasData(vs, TAB) || specGuardFt > 0) {
    descriptions.push("Includes No Clog and No Leak Guarantee and Lifetime Transferable Warranty on Guard");
  }

  const csrFt = getSectionNumber(vs, TAB.gutterGuards, SEC.guardExtras, F.csr);
  if (csrFt > 0) {
    descriptions.push(`Clean, Seal and Reinforce: Clean interior of Gutter and Downspouts, Seal each seam with 50yr Silicone, Install Hidden Hangers to reinforce — ${csrFt}'`);
  }

  const extraLabor = getSectionString(vs, TAB.additionalServices, SEC.additionalMain, F.extraLabor);
  if (extraLabor && parseNum(extraLabor) > 0) {
    const notes = getSectionString(vs, TAB.additionalServices, SEC.additionalMain, F.additionalNotes);
    descriptions.push(`Additional Labor: ${notes || 'N/A'} — ${extraLabor} hrs`);
  }

  const screenCount = getSectionNumber(vs, TAB.additionalServices, SEC.additionalMain, F.screenPulls);
  if (screenCount > 0) {
    descriptions.push(`Remove and reinstall ${screenCount} screens`);
  }

  const walkboardsVal = getSectionString(vs, TAB.additionalServices, SEC.additionalMain, F.walkboards);
  if (walkboardsVal && walkboardsVal.toLowerCase() === 'yes') {
    descriptions.push('Walkboards needed for installation');
  }

  const notes = getSectionString(vs, TAB.additionalServices, SEC.additionalMain, F.additionalNotes);
  if (notes && (extraLabor === '' || parseNum(extraLabor) === 0)) {
    descriptions.push(notes);
  }

  return descriptions;
}
