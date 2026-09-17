import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLearnedFieldsForDomain,
  findCustomInformationValue,
  isMissingInformationRecord,
  saveLearnedValueToProfile,
  updateLearnedFieldStore,
} from './learnedFields.ts';
import {
  DEFAULT_FIELD_RECOGNITION_RULES_MD,
  getFieldRecognitionRules,
  upsertFieldRecognitionHint,
} from './fieldRecognitionRules.ts';
import { getChineseFieldLabel } from './fieldLabels.ts';

test('学习结果按网站和字段签名隔离并可覆盖更新', () => {
  const first = updateLearnedFieldStore({}, 'Jobs.Example.com', {
    signature: 'field-a', label: '毕业月份', value: '06月', updatedAt: '2026-08-01T00:00:00Z',
  });
  const second = updateLearnedFieldStore(first, 'jobs.example.com', {
    signature: 'field-a', label: '毕业月份', value: '6', updatedAt: '2026-08-02T00:00:00Z',
  });
  assert.equal(getLearnedFieldsForDomain(second, 'JOBS.EXAMPLE.COM')['field-a'].value, '6');
  assert.deepEqual(getLearnedFieldsForDomain(second, 'other.example.com'), {});
});

test('每个网站只保留最近的学习记录', () => {
  let store = {};
  for (let index = 0; index < 3; index++) {
    store = updateLearnedFieldStore(store, 'jobs.example.com', {
      signature: `field-${index}`, label: '', value: String(index), updatedAt: `2026-08-0${index + 1}T00:00:00Z`,
    }, 2);
  }
  assert.deepEqual(Object.keys(getLearnedFieldsForDomain(store, 'jobs.example.com')), ['field-2', 'field-1']);
});

test('缺失的基础字段答案会同步到个人资料', () => {
  const profile = {
    personal: { name: '张三', gender: '', birthDate: '', phone: '', email: '' },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
  } as any;
  const saved = saveLearnedValueToProfile(profile, 'wechat', '微信号', 'zhangsan-01');
  assert.equal(saved.profile.personal.wechat, 'zhangsan-01');
  assert.equal(saved.profilePath, 'personal.wechat');
});

test('紧急联系人等非固定字段会保存为可跨网站复用的自定义信息', () => {
  const profile = {
    personal: { name: '张三', gender: '', birthDate: '', phone: '', email: '' },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
  } as any;
  const first = saveLearnedValueToProfile(profile, 'unknown', '紧急联系电话（必填）', '13800001111');
  const second = saveLearnedValueToProfile(first.profile, 'unknown', '紧急联系电话', '13900002222');
  assert.equal(second.profile.customInformation.length, 1);
  assert.equal(second.profile.customInformation[0]?.name, '紧急联系电话');
  assert.equal(second.profile.customInformation[0]?.content, '13900002222');
  assert.equal(isMissingInformationRecord(second.profile.customInformation[0]), true);
  assert.equal(second.profilePath, 'customInformation[0].content');
  assert.equal(
    findCustomInformationValue(second.profile.customInformation, '紧急联系人手机号码'),
    '13900002222',
  );
});

test('失败问答中的内部英文字段键统一显示为中文', () => {
  assert.equal(getChineseFieldLabel('position', 'position'), '职位 / 岗位');
  assert.equal(getChineseFieldLabel('company_name', 'company'), '公司 / 机构');
  assert.equal(getChineseFieldLabel('unrecognized_internal_key', 'startDate'), '开始时间');
  assert.equal(getChineseFieldLabel('紧急联系电话', 'unknown'), '紧急联系电话');
});

test('字段识别规则默认包含紧急联系人保护规则', () => {
  assert.match(getFieldRecognitionRules(null), /紧急联系人电话/);
  assert.equal(getFieldRecognitionRules({ fieldRecognitionRules: '# 自定义' }), '# 自定义');
});

test('同一网站字段的 AI 纠正规则会更新而不是重复追加', () => {
  const first = upsertFieldRecognitionHint(
    DEFAULT_FIELD_RECOGNITION_RULES_MD,
    'Jobs.Example.com',
    'field-1',
    '紧急联系电话',
    '这是紧急联系人的电话，不是本人电话',
  );
  const second = upsertFieldRecognitionHint(
    first,
    'jobs.example.com',
    'field-1',
    '紧急联系电话',
    '必须读取自定义信息中的紧急联系电话',
  );
  assert.equal((second.match(/job-applymate-field-hint:/g) || []).length, 1);
  assert.doesNotMatch(second, /不是本人电话/);
  assert.match(second, /必须读取自定义信息中的紧急联系电话/);
});
