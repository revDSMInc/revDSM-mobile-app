export const readChatId = (body: any): string | null => {
  const chat = body?.data?.chat || body?.data || body;
  if (typeof chat === 'string') return chat || null;
  const id = chat?.id || chat?._id;
  return typeof id === 'string' && id ? id : null;
};
