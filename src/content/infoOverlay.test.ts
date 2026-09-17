import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSections, clampOverlayPosition } from './infoOverlay.ts';
import type { UserProfile } from '../shared/types.ts';

test('悬浮窗位置始终限制在可见区域内', () => {
  assert.deepEqual(
    clampOverlayPosition({ left: 900, top: -50 }, { width: 1000, height: 700 }, { width: 420, height: 600 }),
    { left: 568, top: 12 },
  );
  assert.deepEqual(
    clampOverlayPosition({ left: -200, top: 300 }, { width: 1000, height: 700 }, { width: 420, height: 600 }),
    { left: 12, top: 88 },
  );
});

test('自动学习的缺失信息在悬浮窗中单独成栏，手动自定义信息保持原栏', () => {
  const profile: UserProfile = {
    personal: { name: '', gender: '', birthDate: '', phone: '', email: '' },
    education: [], experience: [], projects: [], skills: [], certifications: [],
    customInformation: [
      { id: 'learned-emergency', name: '紧急联系电话', content: '13800001111' },
      { id: 'custom-hobby', name: '兴趣爱好', content: '摄影' },
    ],
  };
  const sections = buildSections(profile);
  const missing = sections.find(section => section.title === '缺失信息填补');
  const custom = sections.find(section => section.title === '自定义信息');

  assert.deepEqual(missing?.groups[0]?.fields.map(field => field.label), ['紧急联系电话']);
  assert.deepEqual(custom?.groups[0]?.fields.map(field => field.label), ['兴趣爱好']);
});
