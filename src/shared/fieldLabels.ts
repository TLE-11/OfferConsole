const FIELD_TYPE_LABELS: Record<string, string> = {
  name: '姓名',
  gender: '性别',
  birthDate: '出生日期',
  phone: '联系电话',
  email: '邮箱',
  wechat: '微信号',
  idCard: '身份证号',
  politicalStatus: '政治面貌',
  school: '学校',
  college: '学院 / 院系',
  educationType: '学习形式',
  major: '专业',
  majorCategory: '专业类别',
  degree: '学历层次',
  academicDegree: '学位',
  gpa: 'GPA / 成绩',
  selfEvaluation: '自我评价',
  educationStartDate: '入学时间',
  graduationDate: '毕业时间',
  company: '公司 / 机构',
  position: '职位 / 岗位',
  startDate: '开始时间',
  endDate: '结束时间',
  description: '经历描述',
  projectName: '项目名称',
  projectRole: '项目角色',
  projectStartDate: '项目开始时间',
  projectEndDate: '项目结束时间',
  projectDescription: '项目描述',
  projectAchievements: '项目成果',
  projectTechnologies: '项目技术栈',
  skills: '专业技能',
  resumeFile: '简历文件',
  aiMatched: 'AI 识别字段',
  unknown: '待补充信息',
};

const ENGLISH_LABELS: Record<string, string> = {
  name: '姓名',
  fullname: '姓名',
  gender: '性别',
  birthdate: '出生日期',
  birthday: '出生日期',
  phone: '联系电话',
  phonenumber: '联系电话',
  mobile: '手机号码',
  mobilenumber: '手机号码',
  email: '邮箱',
  emailaddress: '邮箱',
  wechat: '微信号',
  idcard: '身份证号',
  politicalstatus: '政治面貌',
  school: '学校',
  schoolname: '学校',
  university: '学校',
  college: '学院 / 院系',
  department: '学院 / 院系',
  major: '专业',
  degree: '学历层次',
  academicdegree: '学位',
  gpa: 'GPA / 成绩',
  company: '公司 / 机构',
  companyname: '公司 / 机构',
  employer: '公司 / 机构',
  position: '职位 / 岗位',
  positionname: '职位 / 岗位',
  jobtitle: '职位 / 岗位',
  jobposition: '职位 / 岗位',
  startdate: '开始时间',
  enddate: '结束时间',
  description: '经历描述',
  projectname: '项目名称',
  projectrole: '项目角色',
  skills: '专业技能',
  emergencycontact: '紧急联系人',
  emergencycontactname: '紧急联系人姓名',
  emergencycontactphone: '紧急联系人电话',
  emergencyphone: '紧急联系人电话',
  guardian: '监护人',
  guardianname: '监护人姓名',
  guardianphone: '监护人电话',
};

/** 将网页或内部使用的英文字段键转换成面向用户的中文标题。 */
export function getChineseFieldLabel(label: string, fieldType = ''): string {
  const cleaned = String(label || '')
    .replace(/^[\s*＊]+|[\s*＊：:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  if (/[\u3400-\u9fff]/.test(cleaned)) return cleaned;

  const normalized = cleaned
    .replace(/\[\d+\]|\d+$/g, '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();
  return ENGLISH_LABELS[normalized]
    || FIELD_TYPE_LABELS[fieldType]
    || (cleaned && !/^[a-z\d_.\-[\] ]+$/i.test(cleaned) ? cleaned : '待补充信息');
}
