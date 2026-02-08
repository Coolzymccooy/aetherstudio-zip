export const getCleanPeerId = (roomId: string, role: 'host' | 'client') => {
  // Remove all non-alphanumeric characters and lowercase it
  // "Joshua's Room!" -> "joshuasroom"
  const cleanRoom = roomId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `aether-studio-${cleanRoom}-${role}`;
};



export const generateRoomId = () => {
  // Generate a simple 4-character code (easy to type)
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};