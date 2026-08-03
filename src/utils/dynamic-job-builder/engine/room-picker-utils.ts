import { ROOMS, BATH_SPACES } from '../constants/color-palettes';

export function createRoomOption(label = 'New Room') {
  return {
    key: `room_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    label,
  };
}

export function createDefaultRoomOptions(roomSet = 'rooms') {
  const labels = roomSet === 'bath' ? BATH_SPACES : ROOMS;
  return labels.map((label) => ({
    key: label.toLowerCase().replace(/\s+/g, '_'),
    label,
  }));
}

export function resolveRoomPickerOptions(field: any = {}) {
  if (field.roomOptions?.length) {
    return field.roomOptions.map((opt: any) => (typeof opt === 'string' ? opt : opt.label));
  }

  const roomSet = field.roomSet || 'rooms';
  return roomSet === 'bath' ? [...BATH_SPACES] : [...ROOMS];
}

export function createDefaultRoomPickerConfig(roomSet = 'rooms') {
  return {
    roomOptions: createDefaultRoomOptions(roomSet),
  };
}
