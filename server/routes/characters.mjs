import { HttpError, readJson, sendJson } from '../http.mjs';
import { keyFilled } from '../config.mjs';
import { characterImageJob, characterVideo } from '../characterPolicy.mjs';
import { characterDescription, characterFields, characterImages, requireCharacter } from '../characterInput.mjs';

export function characterRoutes(router, { characters, jobs, queue, uploads, works, readEnv, fake }) {
  const metadata = ref => ref.type === 'upload' ? uploads.metadata(ref.id) : works.metadata(ref.id);
  const workIndex = () => new Map(works.list().map(work => [work.id, work]));
  const view = (character, index = workIndex()) => ({ ...character,
    images: character.images.filter(image => metadata(image.ref)?.kind === 'image')
      .map(image => ({ ...image, video: characterVideo(image, index.get(image.ref.id)) })) });

  function collect(character) {
    if (character.status !== 'generating') return character;
    const job = jobs.read(character.jobId);
    if (!job) return characters.patch(character.id, { status: 'failed', error: '这单的记录找不到了。' });
    if (job.status === 'succeeded' && job.works?.length) {
      return characters.patch(character.id, { status: 'ready', error: undefined,
        images: [{ ref: { type: 'work', id: job.works[0] }, label: '设定图' }] });
    }
    if (['failed', 'uncertain', 'missing', 'succeeded'].includes(job.status)) {
      return characters.patch(character.id, { status: 'failed', error: job.error ?? '这单没有找到生成结果。' });
    }
    return character;
  }

  router.add('GET', '/api/characters', async ({ res }) => {
    const index = workIndex();
    sendJson(res, 200, characters.list().map(character => view(collect(character), index)));
  });

  router.add('POST', '/api/characters', async ({ req, res }) => {
    const body = await readJson(req);
    const fields = characterFields(body ?? {}, true);
    const images = characterImages(body ?? {}, metadata);
    sendJson(res, 200, view(characters.create({ ...fields, images, status: 'ready' })));
  });

  router.add('PATCH', '/api/characters', async ({ req, res }) => {
    const body = await readJson(req);
    const character = requireCharacter(characters, body?.id);
    sendJson(res, 200, view(characters.patch(character.id, characterFields(body))));
  });

  router.add('DELETE', '/api/characters', async ({ query, res }) => {
    const character = requireCharacter(characters, query.get('id'));
    characters.remove(character.id);
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/api/characters/generate', async ({ req, res }) => {
    if (!fake && !keyFilled(readEnv())) throw new HttpError(400, '.env.local 里还没填 ARK_API_KEY，这单没发出去。');
    const body = await readJson(req);
    const description = characterDescription(body?.description, true);
    const previous = body?.id === undefined ? null : requireCharacter(characters, body.id);
    if (previous && previous.status !== 'failed') throw new HttpError(400, '只有生成失败的人物才能重新生成。');
    const changes = { description, images: [], status: 'generating', jobId: undefined, error: undefined };
    const character = previous ? characters.patch(previous.id, changes) : characters.create({
      ...changes, name: [...description].slice(0, 8).join('')
    });
    const job = queue.submit(characterImageJob(character.id, description));
    sendJson(res, 200, view(characters.patch(character.id, { jobId: job.id })));
  });
}
