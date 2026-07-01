import { renderHook } from '@testing-library/react-native';
import { useTeamChannelPermission } from '../../src/hooks/useTeamChannelPermission';

describe('useTeamChannelPermission', () => {
  test('returns false access for null channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission(null));
    expect(result.current.hasTeamChannelAccess).toBe(false);
    expect(result.current.canPost).toBe(false);
    expect(result.current.canReact).toBe(false);
    expect(result.current.canReply).toBe(false);
  });

  test('returns false access for undefined channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission(undefined));
    expect(result.current.hasTeamChannelAccess).toBe(false);
    expect(result.current.canPost).toBe(false);
  });

  test('blocks posting for announcements channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'announcements' }));
    expect(result.current.canPost).toBe(false);
    expect(result.current.hasTeamChannelAccess).toBe(true);
  });

  test('blocks posting for files channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'files' }));
    expect(result.current.canPost).toBe(false);
  });

  test('blocks posting for commission-sheets channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'commission-sheets' }));
    expect(result.current.canPost).toBe(false);
  });

  test('allows posting for sales-wins channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'sales-wins' }));
    expect(result.current.canPost).toBe(true);
  });

  test('allows posting for general channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'general' }));
    expect(result.current.canPost).toBe(true);
  });

  test('allows posting for questions channel', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'questions' }));
    expect(result.current.canPost).toBe(true);
  });

  test('defaults to true for unknown channel types', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ channelType: 'random-channel' }));
    expect(result.current.canPost).toBe(true);
  });

  test('canReact and canReply mirror canPost', async () => {
    const { result: restricted } = await renderHook(() => useTeamChannelPermission({ channelType: 'announcements' }));
    expect(restricted.current.canReact).toBe(restricted.current.canPost);
    expect(restricted.current.canReply).toBe(restricted.current.canPost);

    const { result: allowed } = await renderHook(() => useTeamChannelPermission({ channelType: 'general' }));
    expect(allowed.current.canReact).toBe(allowed.current.canPost);
    expect(allowed.current.canReply).toBe(allowed.current.canPost);
  });

  test('handles channel with _id and no channelType', async () => {
    const { result } = await renderHook(() => useTeamChannelPermission({ _id: 'chan-1' }));
    expect(result.current.hasTeamChannelAccess).toBe(true);
    expect(result.current.canPost).toBe(true);
  });
});
