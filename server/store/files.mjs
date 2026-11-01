// 硬盘读写的小工具：原子写 JSON、安全读 JSON、生成和检查编号。
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 编号只能是我们自己生成的 uuid 形状（小写），挡掉拿编号做路径穿越。 */
export function isId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function newId() {
  return randomUUID();
}

/** 先写临时文件再改名盖过去：写到一半断电，旧文件还是完整的。失败了把临时文件删掉再报错，不留垃圾。 */
export function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** 读不到、读坏了都返回 null，不抛。 */
export function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
