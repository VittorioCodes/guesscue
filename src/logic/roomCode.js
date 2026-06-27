const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRoomCode(length = 5) {
  let code = '';
  crypto.getRandomValues(new Uint32Array(length)).forEach((value) => {
    code += ALPHABET[value % ALPHABET.length];
  });
  return code;
}
