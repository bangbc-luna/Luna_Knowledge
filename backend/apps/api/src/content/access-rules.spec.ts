import { contentRoleAtLeast, effectiveRole } from '@luna/db';

describe('effectiveRole', () => {
  it.each([
    [null, null, null],
    ['ADMIN', null, 'OWNER'],
    ['MEMBER', null, 'EDITOR'],
    ['VIEWER', null, 'VIEWER'],
    [null, 'EDITOR', 'OWNER'],
    [null, 'VIEWER', 'VIEWER'],
    ['VIEWER', 'EDITOR', 'OWNER'],
    ['MEMBER', 'EDITOR', 'OWNER'],
    ['MEMBER', 'VIEWER', 'EDITOR'],
    ['ADMIN', 'VIEWER', 'OWNER'],
    ['UNKNOWN', null, null],
    [null, 'UNKNOWN', null],
  ])('member %s + share %s → %s', (member_role, share_role, expected) => {
    expect(effectiveRole({ member_role, share_role })).toBe(expected);
  });
});

describe('contentRoleAtLeast', () => {
  it('so sánh theo thứ bậc VIEWER < EDITOR < OWNER', () => {
    expect(contentRoleAtLeast('OWNER', 'EDITOR')).toBe(true);
    expect(contentRoleAtLeast('EDITOR', 'EDITOR')).toBe(true);
    expect(contentRoleAtLeast('VIEWER', 'EDITOR')).toBe(false);
    expect(contentRoleAtLeast(null, 'VIEWER')).toBe(false);
    expect(contentRoleAtLeast(undefined, 'VIEWER')).toBe(false);
  });
});
