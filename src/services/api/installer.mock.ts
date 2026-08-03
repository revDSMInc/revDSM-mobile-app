/**
 * Placeholder Installer data.
 *
 * The installer endpoints are not built yet. `InstallerService` serves this while
 * `INSTALLER_USE_MOCKS` is true; flip that flag off once the API ships and this
 * file can be deleted outright.
 */
import type { InstallerJob } from '../../config/types/installer';

export const MOCK_INSTALLER_JOBS: InstallerJob[] = [
  {
    _id: 'mock-job-1',
    leadId: '35499449',
    leadTime: '8AM – 12NOON ARRIVAL',
    leadDate: new Date().toISOString(),
    fullAddress: '8761 Castries Prt Pl, Tampa, FL 33619, USA',
    customerDetails: {
      firstName: 'Henry',
      lastName: 'Pord',
      phone: '+1 (594) 665-5446',
      email: 'henry.pord@example.com',
    },
    resulted: false,
    status: 'scheduled',
    notes: [
      {
        id: 'n1',
        author: 'Rep',
        at: 'at job build',
        body: 'Gate code 4412. Two dogs in backyard — homeowner will crate them. Down payment collected by check.',
      },
      {
        id: 'n2',
        author: 'IM',
        at: 'today 7:02 AM',
        body: 'Customer back around 10am — OK to start without her there.',
        pinned: true,
      },
    ],
    contract: {
      contractPrice: 22411,
      downPayment: 2000,
      downPaymentMethod: 'CHECK',
      remainingBalance: 20411,
      balanceMethod: 'GREENSKY2521',
      loanAuth: 'N/A',
    },
    packet: { fileName: 'Job_Packet_05838383.pdf', pages: 6 },
    products: [
      {
        id: 'lf',
        name: 'LeafFilter',
        color: '#4CBB17',
        lines: [
          'Combination #1 — 76 ft · Bronze · 2.5–3.4 Versa Max · Fascia',
          '1st Story · REAR: 76 ft',
          'Extras: 2 Corners (Filter)',
        ],
      },
      {
        id: 'soffit',
        name: 'Soffit',
        color: '#22C55E',
        lines: ["Vinyl: FULL 288' White HIDDEN VENT VINYL"],
      },
      {
        id: 'fascia',
        name: 'Fascia',
        color: '#8E33FF',
        lines: [
          "Wrap: 270' White · 80' 1X6 FULL Fascia Wrap",
          "Boards: 60' PINE 1X6 FULL Fascia Board",
        ],
      },
      {
        id: 'additional',
        name: 'Additional',
        color: '#FFAB00',
        lines: ['8 hours Additional Labor — "Drill soffit"'],
      },
    ],
  },
  {
    _id: 'mock-job-2',
    leadId: '665889',
    leadTime: '12NOON – 4PM ARRIVAL',
    leadDate: new Date().toISOString(),
    fullAddress: '8761 Castries Prt Pl, Tampa, FL 33619, USA',
    customerDetails: {
      firstName: 'Karen',
      lastName: 'Tell',
      phone: '+1 (594) 665-5446',
      email: 'k.tell@example.com',
    },
    resulted: true,
    status: 'resulted',
    notes: [
      {
        id: 'n1',
        author: 'Rep',
        at: 'at job build',
        body: 'Driveway is steep — park on the street.',
      },
    ],
    contract: {
      contractPrice: 9840,
      downPayment: 1000,
      downPaymentMethod: 'CARD',
      remainingBalance: 8840,
      balanceMethod: 'CASH',
      loanAuth: 'N/A',
    },
    packet: { fileName: 'Job_Packet_05838401.pdf', pages: 4 },
    products: [
      {
        id: 'lf',
        name: 'LeafFilter',
        color: '#4CBB17',
        lines: ['Combination #1 — 40 ft · White · 2.5–3.4 Versa Max · Fascia'],
      },
    ],
  },
];

/** Tomorrow's schedule — intentionally empty to exercise the empty state. */
export const MOCK_INSTALLER_JOBS_TOMORROW: InstallerJob[] = [];
