import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
}

test('npm test 使用仓库内受版本控制的 tsx 依赖，而不是 npx 临时下载', async () => {
  const packageJson = await readJson(path.join(repoRoot, 'package.json')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // 仓库统一使用 pnpm（pnpm-workspace.yaml），锁定文件为 pnpm-lock.yaml
  const pnpmLock = await readFile(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');

  assert.equal(typeof packageJson.scripts?.test, 'string');
  assert.doesNotMatch(packageJson.scripts!.test, /\bnpx\b/);
  assert.match(packageJson.scripts!.test, /\bnpm run test:sidepanel\b/);
  assert.equal(typeof packageJson.scripts?.['test:sidepanel'], 'string');
  assert.match(packageJson.scripts!['test:sidepanel'], /\btsx\b/);
  assert.doesNotMatch(packageJson.scripts!['test:sidepanel'], /\bnpx\b/);
  assert.ok(packageJson.devDependencies?.tsx, 'package.json 应声明 tsx 为 devDependency');
  const tsxSpecifier = packageJson.devDependencies!.tsx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    pnpmLock,
    new RegExp(`\\n +tsx:\\n +specifier: ${tsxSpecifier}\\n`),
    'pnpm-lock.yaml 应将 tsx 锁定为与 package.json 一致的版本范围',
  );
  assert.match(pnpmLock, /\n {2}tsx@/, 'pnpm-lock.yaml 应包含 tsx 的解析记录');
  assert.match(packageJson.scripts?.build || '', /vite\.content\.config\.ts/);
});
