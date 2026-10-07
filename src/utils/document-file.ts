const PDF_NAME_KEYS = ['name', 'fileName', 'filePath', 'uri', 'url', 'secureUrl', 'displayUrl'];

export const isPdfFile = (f: any): boolean => {
  const type = f?.contentType || f?.mimeType || f?.fileData?.contentType || '';
  if (String(type).includes('pdf')) return true;

  return PDF_NAME_KEYS.some((key) => {
    const value = f?.[key];
    return typeof value === 'string' && value.split(/[?#]/)[0].toLowerCase().endsWith('.pdf');
  });
};
