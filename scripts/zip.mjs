// 纯 Node 的 zip 写、读：打整合包和冒烟解包不再依赖系统 tar.exe
//（11-01 GitHub Windows 云电脑上 System32\tar.exe 压 zip 时崩溃 0xC0000005，本机没事）。
// 只支持基本格式（单个包 < 4GB、条目 < 65535），文件名一律 UTF-8（标志位 0x0800），内容 deflate 压缩。
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as zlib from 'node:zlib';

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;

let table;
export function crc32(data) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(data) >>> 0;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const d = date.getFullYear() < 1980 ? new Date(1980, 0, 1) : date;
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function walk(root, prefix = '') {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const file = prefix ? `${prefix}/${name}` : name, stat = lstatSync(join(root, file));
    if (stat.isSymbolicLink()) throw Error(`不允许链接：${file}`);
    return stat.isDirectory() ? walk(root, file) : [file];
  });
}

/** 把条目 [{ name, data, mtime? }] 写成 zip；name 用 / 分隔。 */
export function writeZip(entries, zipFile) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data, mtime = new Date() } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    if (!nameBytes.length || nameBytes.length > 0xffff) throw Error(`zip 条目名不合法：${name}`);
    const method = data.length ? 8 : 0, packed = method ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const crc = crc32(data), { time, date } = dosTime(mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10); entry.writeUInt16LE(time, 12); entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, packed); central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  if (entries.length > 0xffff || offset + directory.length > 0xffffffff) throw Error('zip 太大，超出基本格式');
  end.writeUInt32LE(END, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = Buffer.concat([...parts, directory, end]);
  writeFileSync(zipFile, bytes);
  return { entries: entries.length, bytes: bytes.length };
}

/** 把整个文件夹压成 zip，条目名前面加 prefix/（解压出来就是一个同名文件夹）。 */
export function zipDirectory(sourceDir, zipFile, prefix = '') {
  const entries = walk(sourceDir).map(file => ({
    name: prefix ? `${prefix}/${file}` : file, data: readFileSync(join(sourceDir, file)), mtime: statSync(join(sourceDir, file)).mtime,
  }));
  return writeZip(entries, zipFile);
}

function readCentral(buffer) {
  let at = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === END) { at = i; break; }
  }
  if (at < 0) throw Error('不是 zip 文件（找不到结尾记录）');
  const count = buffer.readUInt16LE(at + 10);
  let position = buffer.readUInt32LE(at + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(position) !== CENTRAL) throw Error('zip 目录损坏');
    const nameLength = buffer.readUInt16LE(position + 28);
    const skip = nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
    entries.push({ method: buffer.readUInt16LE(position + 10), crc: buffer.readUInt32LE(position + 16),
      packedSize: buffer.readUInt32LE(position + 20), size: buffer.readUInt32LE(position + 24),
      offset: buffer.readUInt32LE(position + 42), name: buffer.toString('utf8', position + 46, position + 46 + nameLength) });
    position += 46 + skip;
  }
  return entries;
}

// 条目名只许相对路径：不许 ..、空段、反斜杠、盘符、开头的 /，否则能写到目标文件夹外面。
function assertSafeName(name) {
  const segments = name.replace(/\/$/, '').split('/');
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes(':') || segments.some(part => part === '' || part === '..' || part === '.')) {
    throw Error(`zip 条目路径不安全：${name}`);
  }
}

export function listZip(zipFile) {
  return readCentral(readFileSync(zipFile)).map(entry => entry.name);
}

/** 解压到 destination；每个条目先查路径安全再查校验和。 */
export function unzipTo(zipFile, destination) {
  const buffer = readFileSync(zipFile), entries = readCentral(buffer);
  destination = resolve(destination);
  for (const entry of entries) {
    assertSafeName(entry.name);
    const target = join(destination, ...entry.name.split('/'));
    if (entry.name.endsWith('/')) { mkdirSync(target, { recursive: true }); continue; }
    if (buffer.readUInt32LE(entry.offset) !== LOCAL) throw Error(`zip 条目损坏：${entry.name}`);
    const start = entry.offset + 30 + buffer.readUInt16LE(entry.offset + 26) + buffer.readUInt16LE(entry.offset + 28);
    const packed = buffer.subarray(start, start + entry.packedSize);
    let data;
    if (entry.method === 8) data = zlib.inflateRawSync(packed);
    else if (entry.method === 0) data = packed;
    else throw Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw Error(`zip 条目校验不符：${entry.name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return entries.map(entry => entry.name);
}
