const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

const pad = (n: string | number): string => String(n).padStart(2, '0');

export const INSTALL_DATE_TBD = 'TBD';

export const formatInstallDate = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === '') return INSTALL_DATE_TBD;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return INSTALL_DATE_TBD;
    return `${pad(raw.getMonth() + 1)}/${pad(raw.getDate())}/${raw.getFullYear()}`;
  }

  const text = String(raw).trim();
  if (!text || text.toUpperCase() === INSTALL_DATE_TBD) return INSTALL_DATE_TBD;

  const us = US_DATE.exec(text);
  if (us) return `${pad(us[1])}/${pad(us[2])}/${us[3]}`;

  const iso = ISO_DATE.exec(text);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return INSTALL_DATE_TBD;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
};
