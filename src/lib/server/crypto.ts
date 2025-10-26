import bcrypt from 'bcryptjs';

export async function hashCode(code: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(code, salt);
}
export async function verifyCode(code: string, codeHash: string) {
  return bcrypt.compare(code, codeHash);
}