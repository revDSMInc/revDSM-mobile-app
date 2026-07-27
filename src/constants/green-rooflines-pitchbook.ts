// Green Rooflines company-scoped pitchbook deck. Web parity:
//   src/sections/pitch-book/green-rooflines-images-data.js
// For this one company the pitchbook swaps from the default LeafFilter deck to a
// single-tab, 12-slide deck. The selection is a company-id equality check (web
// `isGreenRooflines`), NOT a schema/API fetch — there is no dynamic pitchbook
// config endpoint on either platform.

// Web: GREEN_ROOFLINES_COMPANY_ID (green-rooflines-images-data.js:6).
export const GREEN_ROOFLINES_COMPANY_ID = '6a570a1a4a3c86dc2601a7cf';

// Single tab holding all slides in order (web GREEN_ROOFLINES_TABS).
export const GREEN_ROOFLINES_CATEGORIES = [
  { id: 'green_rooflines', label: 'Green Roofline' },
];

// { [tabId]: { [slideKey]: image } } — same shape as `pitchBookImages`, so the
// screen renders it through the exact same path. Keys are `Slide-1..Slide-12` to
// match web (`Object.fromEntries(... [`Slide-${i+1}`, `/slides/${i+1}.png`])`).
const greenRooflinesPitchbookImages: Record<string, Record<string, any>> = {
  green_rooflines: {
    'Slide-1': require('../assets/images/green-rooflines-pitchbook/1.png'),
    'Slide-2': require('../assets/images/green-rooflines-pitchbook/2.png'),
    'Slide-3': require('../assets/images/green-rooflines-pitchbook/3.png'),
    'Slide-4': require('../assets/images/green-rooflines-pitchbook/4.png'),
    'Slide-5': require('../assets/images/green-rooflines-pitchbook/5.png'),
    'Slide-6': require('../assets/images/green-rooflines-pitchbook/6.png'),
    'Slide-7': require('../assets/images/green-rooflines-pitchbook/7.png'),
    'Slide-8': require('../assets/images/green-rooflines-pitchbook/8.png'),
    'Slide-9': require('../assets/images/green-rooflines-pitchbook/9.png'),
    'Slide-10': require('../assets/images/green-rooflines-pitchbook/10.png'),
    'Slide-11': require('../assets/images/green-rooflines-pitchbook/11.png'),
    'Slide-12': require('../assets/images/green-rooflines-pitchbook/12.png'),
  },
};

export default greenRooflinesPitchbookImages;
