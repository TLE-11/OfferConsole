/**
 * 刷题题目页识别器（L2 一键打卡）。
 *
 * 纯解析 URL 与 document.title，不发起任何网络请求——
 * 牛客/CodeTop 无开放 API，页面内容本身就是最稳的数据源。
 */

export interface DetectedProblem {
  platform: '牛客' | 'LeetCode' | 'CodeTop';
  problemId: string;
  title: string;
  url: string;
}

interface UrlMatch {
  platform: DetectedProblem['platform'];
  problemId: string;
}

const URL_RULES: Array<{ pattern: RegExp; platform: DetectedProblem['platform']; idGroup: number }> = [
  // 牛客练习题目页：nowcoder.com/practice/{id} 、questionTerminal/{id}
  { pattern: /nowcoder\.com\/(?:practice|questionTerminal)\/([A-Za-z0-9]+)/, platform: '牛客', idGroup: 1 },
  // 牛客 OJ 考试页：nowcoder.com/exam/oj?...questionId=123（? 可能被任意参数序列包围）
  { pattern: /nowcoder\.com\/exam\/oj.*[?&]questionId=(\d+)/, platform: '牛客', idGroup: 1 },
  // LeetCode 中英文站：leetcode.cn / leetcode.com /problems/{slug}
  { pattern: /leetcode(?:\.cn|\.com)\/problems\/([a-z0-9-]+)/i, platform: 'LeetCode', idGroup: 1 },
  // CodeTop：题目聚合站，无稳定单题 URL，仅识别域名
  { pattern: /codetop\.cc/, platform: 'CodeTop', idGroup: 0 },
];

export function matchProblemUrl(url: string): UrlMatch | null {
  for (const rule of URL_RULES) {
    const matched = rule.pattern.exec(url);
    if (matched) {
      return {
        platform: rule.platform,
        problemId: rule.idGroup > 0 ? matched[rule.idGroup] : '',
      };
    }
  }
  return null;
}

/** 各站 document.title 的噪声后缀清理 */
const TITLE_NOISE: Array<{ platform: DetectedProblem['platform']; pattern: RegExp }> = [
  { platform: '牛客', pattern: /\s*[-_]\s*(牛客题霸|牛客网|Nowcoder).*$/i },
  { platform: 'LeetCode', pattern: /\s*-\s*力扣（LeetCode）\s*$/i },
  { platform: 'LeetCode', pattern: /\s*-\s*LeetCode\s*$/i },
  { platform: 'CodeTop', pattern: /\s*[-_|]\s*CodeTop.*$/i },
];

export function cleanProblemTitle(platform: DetectedProblem['platform'], docTitle: string): string {
  let title = docTitle.trim();
  for (const rule of TITLE_NOISE) {
    if (rule.platform === platform) title = title.replace(rule.pattern, '');
  }
  return title.trim();
}

/** content 侧入口：结合 URL 与页面标题给出题目信息；无法识别返回 null */
export function detectProblemFromPage(url: string, docTitle: string): DetectedProblem | null {
  const matched = matchProblemUrl(url);
  if (!matched) return null;
  const title = cleanProblemTitle(matched.platform, docTitle);
  if (matched.platform !== 'CodeTop' && !title) return null;
  return {
    platform: matched.platform,
    problemId: matched.problemId,
    title,
    url,
  };
}
