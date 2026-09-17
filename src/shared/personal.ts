/** 将简历和旧数据中的政治面貌别名归一化为插件使用的标准值。 */
export function normalizePoliticalStatusValue(value?: string): string {
  const text = String(value || '').trim();
  if (/预备党员/.test(text)) return '中共预备党员';
  if (/中共党员|中国共产党党员|正式党员|^党员$/.test(text)) return '中共党员';
  if (/共青团员|^团员$/.test(text)) return '共青团员';
  if (/民主党派/.test(text)) return '民主党派';
  if (/无党派/.test(text)) return '无党派人士';
  if (/群众/.test(text)) return '群众';
  return text;
}

/**
 * 统一出生日期格式，并丢弃同一行中被误并入的电话等后续字段。
 * 无法识别为日期时保留原值，避免破坏用户自定义的特殊写法。
 */
export function normalizeBirthDateValue(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '';

  const date = text.match(
    /(?<!\d)((?:19|20)\d{2})\s*(?:年|[.\-/])\s*(0?[1-9]|1[0-2])(?:\s*(?:月|[.\-/])\s*(0?[1-9]|[12]\d|3[01])\s*日?)?(?!\d)/,
  );
  if (date) {
    const normalized = `${date[1]}-${date[2].padStart(2, '0')}`;
    return date[3] ? `${normalized}-${date[3].padStart(2, '0')}` : normalized;
  }

  const year = text.match(/(?<!\d)((?:19|20)\d{2})\s*年?(?!\d)/);
  return year ? year[1] : text;
}
