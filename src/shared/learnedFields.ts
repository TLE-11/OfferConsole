import type { CustomInformation, LearnedFieldValue, PersonalInfo, UserProfile } from './types.ts';

export type LearnedFieldStore = Record<string, Record<string, LearnedFieldValue>>;

export function isMissingInformationRecord(record: CustomInformation): boolean {
  return record.id.startsWith('learned-');
}

export function getLearnedFieldsForDomain(
  store: LearnedFieldStore,
  domain: string,
): Record<string, LearnedFieldValue> {
  return store[domain.trim().toLowerCase()] || {};
}

export function updateLearnedFieldStore(
  store: LearnedFieldStore,
  domain: string,
  entry: LearnedFieldValue,
  limit = 200,
): LearnedFieldStore {
  const normalizedDomain = domain.trim().toLowerCase();
  const domainEntries = { ...(store[normalizedDomain] || {}), [entry.signature]: entry };
  return {
    ...store,
    [normalizedDomain]: Object.fromEntries(
      Object.entries(domainEntries)
        .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit),
    ),
  };
}

const PERSONAL_FIELD_PATHS: Record<string, keyof PersonalInfo> = {
  name: 'name',
  gender: 'gender',
  birthDate: 'birthDate',
  phone: 'phone',
  email: 'email',
  wechat: 'wechat',
  idCard: 'idCard',
  politicalStatus: 'politicalStatus',
  ethnicity: 'ethnicity',
  hometown: 'hometown',
  currentAddress: 'currentAddress',
  selfEvaluation: 'selfEvaluation',
};

/**
 * 将失败补填中新增加的答案写回个人资料。
 * 基础字段进入 personal；无法安全定位到固定结构的字段进入“自定义信息”，
 * 这样其它网站的 AI 也能读取，而不只局限于当前页面签名。
 */
export function saveLearnedValueToProfile(
  profile: UserProfile,
  fieldType: string | undefined,
  label: string,
  value: string,
): { profile: UserProfile; profilePath: string } {
  const personalKey = fieldType ? PERSONAL_FIELD_PATHS[fieldType] : undefined;
  if (personalKey) {
    return {
      profile: {
        ...profile,
        personal: { ...profile.personal, [personalKey]: value },
      },
      profilePath: `personal.${personalKey}`,
    };
  }

  const name = cleanLearnedLabel(label) || '补填信息';
  const normalizedName = normalizeLearnedLabel(name);
  const customInformation = [...(profile.customInformation || [])];
  const existingIndex = customInformation.findIndex(item => (
    normalizeLearnedLabel(item.name) === normalizedName
  ));
  if (existingIndex >= 0) {
    customInformation[existingIndex] = { ...customInformation[existingIndex], name, content: value };
    return {
      profile: { ...profile, customInformation },
      profilePath: `customInformation[${existingIndex}].content`,
    };
  }

  const index = customInformation.length;
  customInformation.push({ id: `learned-${hashText(normalizedName)}`, name, content: value });
  return {
    profile: { ...profile, customInformation },
    profilePath: `customInformation[${index}].content`,
  };
}

/** 在未识别字段中按语义标签查找用户保存的自定义信息，支持常见紧急联系人别名。 */
export function findCustomInformationValue(
  records: CustomInformation[],
  fieldLabel: string,
): string {
  const target = normalizeLearnedLabel(fieldLabel);
  if (!target) return '';
  const match = records.find(record => (
    normalizeLearnedLabel(record.name) === target && record.content.trim()
  ));
  return match?.content.trim() || '';
}

function cleanLearnedLabel(value: string): string {
  return String(value || '')
    .replace(/^[\s*＊]+|[\s*＊：:]+$/g, '')
    .replace(/^(?:请输入|请填写|请选择|请选取)\s*/i, '')
    .replace(/\s*[（(]?(?:必填|required)[）)]?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeLearnedLabel(value: string): string {
  return cleanLearnedLabel(value)
    .replace(/[\s_\-/：:（）()]/g, '')
    .toLowerCase()
    .replace(/(?:紧急|应急)(?:联系|联络)人?(?:手机号码?|电话号码?|联系电话|电话|号码|联系方式?)/g, '紧急联系人电话')
    .replace(/(?:紧急|应急)(?:联系|联络)人?(?:姓名|名字)?$/g, '紧急联系人姓名');
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
