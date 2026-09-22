import type { UserProfile } from '../../shared/types.ts';

/**
 * PII 脱敏（底线 L4）。
 *
 * 所有发往模型服务的文本在出站前经过这里：先按模式正则识别手机号/邮箱/身份证，
 * 再按调用方提供的已知值（姓名、微信号等）精确替换，统一换成语义占位符
 * （如【姓名】【手机号】）。语义占位符保留了字段类型信息，AI 仍能理解
 * 「这个字段该填哪类值」；响应返回后调用 restoreText 把占位符还原为真实值，
 * 因此填充结果与未脱敏时一致。
 *
 * 取舍说明：已知值替换采用简单的全字串替换，不区分上下文。姓名若为常见词
 * （如「刘洋」出现在「刘洋种」一类误配中）可能被过度脱敏——对安全功能而言，
 * 宁可误伤、不可漏脱。
 */

export interface PiiEntry {
  /** 占位符语义标签，如「姓名」「微信号」 */
  label: string;
  /** 需要替换的真实值列表 */
  values: string[];
}

export interface PiiRedactor {
  redactText(text: string): string;
  restoreText(text: string): string;
  /** 本次替换发生的总次数（模式 + 精确值），用于测试与诊断 */
  readonly replacementCount: number;
}

interface Replacement {
  placeholder: string;
  original: string;
}

/** 模式识别规则：无需已知值即可识别的高置信 PII */
const PATTERN_RULES: Array<{ label: string; pattern: RegExp }> = [
  // 身份证号 18 位（含末位 X），前后不能再是数字
  { label: '身份证', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  // 手机号 11 位，前后不能再是数字（避免误伤更长的数字串）
  { label: '手机号', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  // 邮箱
  { label: '邮箱', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];

/** 精确值替换的最小长度：短于该长度的值误伤率过高，不予替换 */
const MIN_LITERAL_LENGTH = 2;

export function createPiiRedactor(entries: PiiEntry[] = []): PiiRedactor {
  const replacements: Replacement[] = [];
  const labelCounters = new Map<string, number>();

  const nextPlaceholder = (label: string): string => {
    const count = (labelCounters.get(label) ?? 0) + 1;
    labelCounters.set(label, count);
    return count === 1 ? `【${label}】` : `【${label}·${count}】`;
  };

  const register = (label: string, original: string): string => {
    const placeholder = nextPlaceholder(label);
    replacements.push({ placeholder, original });
    return placeholder;
  };

  const redactText = (text: string): string => {
    if (!text) return text;
    let output = text;

    for (const rule of PATTERN_RULES) {
      rule.pattern.lastIndex = 0;
      output = output.replace(rule.pattern, matched => register(rule.label, matched));
    }

    const literals = entries
      .flatMap(entry => entry.values
        .filter(value => typeof value === 'string' && value.trim().length >= MIN_LITERAL_LENGTH)
        .map(value => ({ label: entry.label, value: value.trim() })))
      // 长值优先，避免「张三」先把「张三丰」截断
      .sort((a, b) => b.value.length - a.value.length);

    for (const { label, value } of literals) {
      if (!output.includes(value)) continue;
      // 与模式规则已产生的占位符冲突检查：该值可能已被模式规则替换掉，无需再登记
      const placeholder = register(label, value);
      output = output.split(value).join(placeholder);
    }

    return output;
  };

  const restoreText = (text: string): string => {
    if (!text || replacements.length === 0) return text;
    let output = text;
    // 长占位符优先（【手机号·12】先于【手机号】语义无关，但保持确定性）
    const ordered = [...replacements].sort((a, b) => b.placeholder.length - a.placeholder.length);
    for (const { placeholder, original } of ordered) {
      output = output.split(placeholder).join(original);
    }
    return output;
  };

  return {
    redactText,
    restoreText,
    get replacementCount() {
      return replacements.length;
    },
  };
}

/**
 * 从用户资料中收集需要精确替换的 PII 已知值。
 *
 * 只收集个人身份与联系方式类字段；学校、公司、项目名属于公开履历信息，
 * AI 需要理解其内容才能完成字段匹配与答案生成，不做脱敏。
 */
export function collectProfilePiiEntries(profile: UserProfile | null | undefined): PiiEntry[] {
  const personal = profile?.personal;
  if (!personal) return [];
  return [
    { label: '姓名', values: [personal.name].filter(Boolean) as string[] },
    { label: '手机号', values: [personal.phone].filter(Boolean) as string[] },
    { label: '邮箱', values: [personal.email].filter(Boolean) as string[] },
    { label: '微信号', values: [personal.wechat].filter(Boolean) as string[] },
    { label: '身份证', values: [personal.idCard].filter(Boolean) as string[] },
    { label: '籍贯', values: [personal.hometown].filter(Boolean) as string[] },
    { label: '现居地', values: [personal.currentAddress].filter(Boolean) as string[] },
    { label: '出生日期', values: [personal.birthDate].filter(Boolean) as string[] },
  ].filter(entry => entry.values.length > 0);
}
