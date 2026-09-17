import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProfileForResume,
  createResumeProfileSnapshot,
  createResumeVariant,
  getResumeLibrary,
  LEGACY_RESUME_ID,
  normalizeResumeLibrary,
  removeResumeVariant,
  resolveResumeSelection,
  upsertResumeVariant,
} from './resumes.ts';

const legacyResume = {
  fileName: '产品经理-张三.pdf',
  fileData: 'data:application/pdf;base64,QQ==',
  fileType: 'pdf',
  uploadDate: '2026-09-07T00:00:00.000Z',
};

test('旧版单简历自动迁移为默认分类且保留原文件名', () => {
  const library = getResumeLibrary({ resume: legacyResume });
  assert.equal(library[0]?.id, LEGACY_RESUME_ID);
  assert.equal(library[0]?.category, '默认简历');
  assert.equal(library[0]?.fileName, '产品经理-张三.pdf');
});

test('显式空简历库不会重新恢复旧版简历', () => {
  assert.deepEqual(getResumeLibrary({ resume: legacyResume, resumes: [] }), []);
});

test('同一文件重复添加时更新原条目而不是追加副本', () => {
  const oldResume = createResumeVariant(legacyResume, { id: 'old', category: '旧分类' });
  const newResume = createResumeVariant(legacyResume, { id: 'new', category: '新分类' });
  const result = upsertResumeVariant([oldResume], newResume);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 'old');
  assert.equal(result[0]?.category, '新分类');
});

test('删除最后一份简历会清空兼容字段且不会复活', () => {
  const resume = createResumeVariant(legacyResume, { id: 'only', category: '默认简历' });
  const profile = {
    personal: {}, education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resume: legacyResume,
    resumes: [resume],
  } as any;
  const removed = removeResumeVariant(profile, 'only');
  assert.deepEqual(removed.resumes, []);
  assert.equal(removed.resume, undefined);
  assert.deepEqual(getResumeLibrary(removed), []);
});

test('本次可明确选择不上传或指定简历', () => {
  const profile = {
    resume: legacyResume,
    resumes: [
      { ...legacyResume, id: 'pm', category: '产品岗' },
      { ...legacyResume, id: 'operation', category: '运营岗', fileName: '运营版.pdf' },
    ],
  };
  assert.equal(resolveResumeSelection(profile, null), undefined);
  assert.equal(resolveResumeSelection(profile, 'operation')?.fileName, '运营版.pdf');
  assert.equal(resolveResumeSelection(profile, 'missing'), undefined);
  assert.equal(resolveResumeSelection(profile, undefined)?.fileName, legacyResume.fileName);
});

test('插件分类不会改写简历原文件名', () => {
  const variant = createResumeVariant(legacyResume, { id: 'pm', category: '  产品岗  ' });
  assert.equal(variant.category, '产品岗');
  assert.equal(variant.fileName, '产品经理-张三.pdf');
});

test('每份简历保留独立经历，但基础资料始终跟随设置页', () => {
  const productProfile = createResumeProfileSnapshot({
    rawText: '产品版',
    personal: { name: '张三', email: 'product@example.com' },
    education: [],
    experience: [{ company: '甲公司', position: '产品经理' }],
    projects: [],
    skills: ['原型设计'],
  });
  const operationProfile = createResumeProfileSnapshot({
    rawText: '运营版',
    personal: { name: '张三' },
    education: [],
    experience: [{ company: '乙公司', position: '内容运营' }],
    projects: [],
    skills: ['用户增长'],
  });
  const profile = {
    personal: { name: '默认姓名', email: 'base@example.com' },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resumes: [
      createResumeVariant(legacyResume, { id: 'pm', category: '产品岗', parsedProfile: productProfile }),
      createResumeVariant({ ...legacyResume, fileName: '运营版.pdf' }, { id: 'ops', category: '运营岗', parsedProfile: operationProfile }),
    ],
  } as any;

  const product = buildProfileForResume(profile, 'pm');
  const operation = buildProfileForResume(profile, 'ops');
  assert.equal(product.experience[0]?.position, '产品经理');
  assert.equal(product.personal.name, '默认姓名');
  assert.equal(product.personal.email, 'base@example.com');
  assert.equal(operation.experience[0]?.position, '内容运营');
  assert.equal(operation.personal.email, 'base@example.com');
  assert.deepEqual(operation.skills, ['用户增长']);
});

test('设置页基础资料覆盖简历误识别值，自我评价仍随简历切换', () => {
  const parsedProfile = createResumeProfileSnapshot({
    rawText: '出生日期：2002.9 电话：17684515539',
    personal: {
      birthDate: '2002.9 电话：17684515539',
      phone: '17684515539',
      selfEvaluation: '面向产品岗位的自我评价',
    },
    education: [], experience: [], projects: [], skills: [],
  });
  const profile = {
    personal: {
      name: '张三',
      birthDate: '2002-09-16',
      phone: '13900001111',
      selfEvaluation: '默认评价',
    },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resumes: [createResumeVariant(legacyResume, { id: 'pm', parsedProfile })],
  } as any;

  const selected = buildProfileForResume(profile, 'pm');
  assert.equal(selected.personal.birthDate, '2002-09-16');
  assert.equal(selected.personal.phone, '13900001111');
  assert.equal(selected.personal.selfEvaluation, '面向产品岗位的自我评价');
});

test('简历没有解析出项目、经历或技能时使用个人信息页的数据', () => {
  const parsedProfile = createResumeProfileSnapshot({
    rawText: '未识别到结构化经历',
    personal: {},
    education: [],
    experience: [],
    projects: [],
    skills: [],
  });
  const profile = {
    personal: { name: '张三' },
    education: [],
    experience: [{ id: 'manual-exp', company: '手动填写公司', position: '实习生' }],
    projects: [{ id: 'manual-project', name: '个人信息页项目', role: '负责人' }],
    customInformation: [],
    skills: ['Python'],
    certifications: [],
    resumes: [createResumeVariant(legacyResume, { id: 'empty-parsed', parsedProfile })],
  } as any;

  const selected = buildProfileForResume(profile, 'empty-parsed');
  assert.equal(selected.experience[0]?.company, '手动填写公司');
  assert.equal(selected.projects[0]?.name, '个人信息页项目');
  assert.deepEqual(selected.skills, ['Python']);
});

test('简历包含有效项目时仍使用当前简历的独立项目', () => {
  const parsedProfile = createResumeProfileSnapshot({
    rawText: '项目经历',
    personal: {}, education: [], experience: [], skills: [],
    projects: [{ name: '简历定制项目', role: '负责人' }],
  });
  const profile = {
    personal: { name: '张三' }, education: [], experience: [], customInformation: [], skills: [], certifications: [],
    projects: [{ id: 'manual-project', name: '个人信息页项目', role: '成员' }],
    resumes: [createResumeVariant(legacyResume, { id: 'project-resume', parsedProfile })],
  } as any;

  const selected = buildProfileForResume(profile, 'project-resume');
  assert.equal(selected.projects.length, 1);
  assert.equal(selected.projects[0]?.name, '简历定制项目');
});

test('旧简历快照中的出生日期脏数据会在加载时自动清理', () => {
  const resumes = normalizeResumeLibrary({
    resumes: [{
      ...legacyResume,
      id: 'old-date',
      category: '默认简历',
      parsedProfile: {
        personal: { birthDate: '2002.9 电话：17684515539' },
        education: [], experience: [], projects: [], skills: [],
      },
    }],
  });
  assert.equal(resumes[0]?.parsedProfile?.personal.birthDate, '2002-09');
});

test('旧简历没有独立资料时继续使用全局资料', () => {
  const profile = {
    personal: { name: '旧版用户' },
    education: [], experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resume: legacyResume,
  } as any;
  assert.equal(buildProfileForResume(profile, LEGACY_RESUME_ID).personal.name, '旧版用户');
});

test('旧简历的硕士字段迁移为独立的学历层次和学位', () => {
  const resumes = normalizeResumeLibrary({
    resumes: [{
      ...legacyResume,
      id: 'old-master',
      category: '默认简历',
      parsedProfile: {
        personal: {},
        education: [{ id: 'edu-1', school: '新疆大学', major: '能源动力', degree: '硕士', startDate: '', endDate: '' }],
        experience: [],
        projects: [],
        skills: [],
      },
    }],
  });
  assert.equal(resumes[0]?.parsedProfile?.education[0]?.degree, '硕士研究生');
  assert.equal(resumes[0]?.parsedProfile?.education[0]?.academicDegree, '硕士');
});

test('简历解析缺少学院时按学校和学历层次使用手动资料补全', () => {
  const profile = {
    personal: { name: '张三' },
    education: [
      { id: 'base-undergraduate', school: '山东科技大学', college: '智能装备学院', major: '过程装备与控制工程', majorCategory: '机械类', degree: '本科', academicDegree: '工学学士', startDate: '', endDate: '' },
      { id: 'base-master', school: '新疆大学', college: '电气工程学院', major: '能源动力', majorCategory: '动力工程及工程热物理', degree: '硕士研究生', academicDegree: '工程硕士', startDate: '', endDate: '' },
    ],
    experience: [], projects: [], customInformation: [], skills: [], certifications: [],
    resumes: [{
      ...legacyResume,
      id: 'target',
      category: '目标岗位',
      parsedProfile: {
        personal: {},
        education: [
          { id: 'resume-master', school: '新疆大学', college: '', major: '能源动力', degree: '硕士研究生', startDate: '', endDate: '' },
          { id: 'resume-undergraduate', school: '山东科技大学', college: '', major: '过程装备与控制工程', degree: '本科', startDate: '', endDate: '' },
        ],
        experience: [], projects: [], skills: [],
      },
    }],
  } as any;
  const selected = buildProfileForResume(profile, 'target');
  assert.equal(selected.education[0]?.college, '电气工程学院');
  assert.equal(selected.education[0]?.majorCategory, '动力工程及工程热物理');
  assert.equal(selected.education[1]?.college, '智能装备学院');
  assert.equal(selected.education[1]?.academicDegree, '工学学士');
});
