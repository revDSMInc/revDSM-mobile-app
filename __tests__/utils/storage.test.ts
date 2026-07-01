jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn(),
    getAllKeys: jest.fn(),
  })),
}));

import { storage, reduxPersistStorage, Storage } from '../../src/utils/storage';

const mockSet = storage.set as jest.Mock;
const mockGetString = storage.getString as jest.Mock;
const mockRemove = storage.remove as jest.Mock;
const mockContains = storage.contains as jest.Mock;
const mockGetAllKeys = storage.getAllKeys as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('storage (MMKV instance)', () => {
  test('set calls mmkv.set', () => {
    storage.set('key1', 'value1');
    expect(mockSet).toHaveBeenCalledWith('key1', 'value1');
  });

  test('getString calls mmkv.getString', () => {
    mockGetString.mockReturnValue('stored-value');
    expect(storage.getString('key1')).toBe('stored-value');
    expect(mockGetString).toHaveBeenCalledWith('key1');
  });

  test('remove calls mmkv.remove', () => {
    storage.remove('key1');
    expect(mockRemove).toHaveBeenCalledWith('key1');
  });

  test('contains calls mmkv.contains', () => {
    mockContains.mockReturnValue(true);
    expect(storage.contains('key1')).toBe(true);
    expect(mockContains).toHaveBeenCalledWith('key1');
  });

  test('getAllKeys calls mmkv.getAllKeys', () => {
    mockGetAllKeys.mockReturnValue(['key1', 'key2']);
    expect(storage.getAllKeys()).toEqual(['key1', 'key2']);
  });
});

describe('reduxPersistStorage', () => {
  test('setItem resolves after calling storage.set', async () => {
    await expect(reduxPersistStorage.setItem('k', 'v')).resolves.toBeUndefined();
    expect(mockSet).toHaveBeenCalledWith('k', 'v');
  });

  test('getItem resolves with value from storage.getString', async () => {
    mockGetString.mockReturnValue('stored');
    await expect(reduxPersistStorage.getItem('k')).resolves.toBe('stored');
  });

  test('getItem resolves with null when undefined', async () => {
    mockGetString.mockReturnValue(undefined);
    await expect(reduxPersistStorage.getItem('k')).resolves.toBeNull();
  });

  test('removeItem resolves after calling storage.remove', async () => {
    await expect(reduxPersistStorage.removeItem('k')).resolves.toBeUndefined();
    expect(mockRemove).toHaveBeenCalledWith('k');
  });
});

describe('Storage (convenience wrapper)', () => {
  test('getItem returns null for undefined', () => {
    mockGetString.mockReturnValue(undefined);
    expect(Storage.getItem('k')).toBeNull();
  });

  test('getItem returns string value', () => {
    mockGetString.mockReturnValue('hello');
    expect(Storage.getItem('k')).toBe('hello');
  });

  test('setItem calls storage.set', () => {
    Storage.setItem('k', 'v');
    expect(mockSet).toHaveBeenCalledWith('k', 'v');
  });

  test('removeItem calls storage.remove', () => {
    Storage.removeItem('k');
    expect(mockRemove).toHaveBeenCalledWith('k');
  });

  test('contains calls storage.contains', () => {
    mockContains.mockReturnValue(true);
    expect(Storage.contains('k')).toBe(true);
    expect(mockContains).toHaveBeenCalledWith('k');
  });

  test('getAllKeys calls storage.getAllKeys', () => {
    mockGetAllKeys.mockReturnValue(['a', 'b']);
    expect(Storage.getAllKeys()).toEqual(['a', 'b']);
  });
});
