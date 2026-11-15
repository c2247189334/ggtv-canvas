import { HttpError } from './http.mjs';
import { isId } from './store/files.mjs';

export function characterFields(body, requireName = false) {
  const fields = {};
  if (requireName || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || [...name].length > 40) throw new HttpError(400, '人物名字要在 1 到 40 字之间。');
    fields.name = name;
  }
  if (requireName || body.description !== undefined) {
    const description = body.description === undefined && requireName ? '' : body.description;
    fields.description = characterDescription(description);
  }
  return fields;
}

export function characterDescription(value, required = false) {
  if (typeof value !== 'string') throw new HttpError(400, '人物描述要用文字填写。');
  const description = value.trim();
  if ([...description].length > 500 || (required && !description)) throw new HttpError(400, '人物描述要在 1 到 500 字之间。');
  return description;
}

export function characterImages(body, metadata) {
  if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 8) throw new HttpError(400, '人物要有 1 到 8 张图片。');
  const images = body.images.map((image, index) => {
    if (!image || !['upload', 'work'].includes(image.type) || !isId(image.id)) throw new HttpError(400, '人物图片的编号不对。');
    if (metadata(image)?.kind !== 'image') throw new HttpError(400, '有一张人物图片找不到了，或者它不是图片。');
    if (image.assetId !== undefined && (typeof image.assetId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(image.assetId))) {
      throw new HttpError(400, '真人素材编号格式不对，只能用 1 到 128 个英文字母、数字、点、下划线或横线。');
    }
    return { ref: { type: image.type, id: image.id }, label: `图 ${index + 1}`,
      ...(image.assetId === undefined ? {} : { assetId: image.assetId }) };
  });
  if (images.some(image => image.ref.type === 'upload') && body.authorized !== true) throw new HttpError(400, '先勾选授权');
  return images;
}

export function requireCharacter(characters, id) {
  if (!isId(id)) throw new HttpError(400, '人物编号不对。');
  const character = characters.read(id);
  if (!character) throw new HttpError(404, '这个人物已经不在了。');
  return character;
}
