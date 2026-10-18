// Model IDs and supported minimum sizes: https://docs.volcengine.com/docs/ark/seedream-4-0-5-0
export const imageModelCatalog = Object.freeze([
  Object.freeze({
    id: 'doubao-seedream-5-0-flash-260915',
    label: 'Seedream 5.0 Flash',
    size: '1K',
  }),
  Object.freeze({ id: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5', size: '2K' }),
  Object.freeze({ id: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0', size: '1K' }),
]);
export function imageModelLabel(id) {
  const known = imageModelCatalog.find((model) => model.id === id);
  if (known) return known.label;
  const match = /^doubao-seedream-(\d+)-(\d+)(?:-(flash|lite|pro))?(?:-\d+)?$/.exec(id || '');
  return match
    ? 'Seedream ' +
        match[1] +
        '.' +
        match[2] +
        (match[3] ? ' ' + match[3][0].toUpperCase() + match[3].slice(1) : '')
    : id;
}
export function imageModelSize(id) {
  return (
    imageModelCatalog.find((model) => model.id === id)?.size ||
    (/^doubao-seedream-5-0-(?:lite-)?260128$/.test(id) ? '2K' : '1K')
  );
}
export function imageModelOptions(configured) {
  const options = [];
  if (configured) options.push({ id: configured, label: imageModelLabel(configured) });
  for (const { id, label } of imageModelCatalog)
    if (!options.some((model) => model.id === id)) options.push({ id, label });
  return options;
}
