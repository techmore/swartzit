export function preferredCommunity(communities, selectedCommunity = '') {
  const list = Array.isArray(communities) ? communities : [];
  return list.find(item => item.slug === selectedCommunity)?.slug
    || list.find(item => item.slug === 'x_imports')?.slug
    || list[0]?.slug
    || '';
}

export function selectedCommunityState(item) {
  const slug = String(item?.slug || '');
  return { value: slug, query: slug, open: false };
}
