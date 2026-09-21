export const profileFields = [
  {
    label: 'Email',
    value: 'avery@example.test',
    href: 'mailto:avery@example.test',
  },
  {
    label: 'Phone',
    value: '(312) 555-0142',
    href: 'tel:+13125550142',
  },
];

export const renderProfileFields = (fields) =>
  fields
    .map(({ label, value, href }) => `<dt>${label}</dt><dd><a href="${href}">${value}</a></dd>`)
    .join('');
