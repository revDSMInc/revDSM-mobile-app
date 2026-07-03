export function reorderSections(sections: any[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return sections;
  const next = [...sections];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function canReorderSection(section: any) {
  return !section?.locked;
}
