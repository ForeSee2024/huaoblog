import { createPersistence } from './common.js';
import { createPostMethods, postVersion } from './posts.js';
import { createSettingsMethods, settingsVersion } from './settings.js';
import { createMediaMethods, mediaView } from './media.js';
import { createRecoveryMethods } from './recovery.js';
import { createSnapshotMethods } from './snapshots.js';
import { createSearchMethods } from './search.js';
export { CONTENT_SCHEMA } from './schema.js';
export { validateSnapshot } from './snapshots.js';

export function createContentStore(database, options = {}) {
  const persistence = createPersistence(database, options);
  return {
    ...createPostMethods(persistence),
    ...createSettingsMethods(persistence),
    ...createMediaMethods(persistence),
    ...createRecoveryMethods(persistence),
    ...createSnapshotMethods(persistence),
    ...createSearchMethods(persistence),
    async getWorkspace() {
      const rows = await database.all("SELECT json_remove(payload_json, '$.published.body', '$.draft.body') AS payload_json FROM content_documents WHERE kind = 'post' ORDER BY id");
      const [settings, media] = await Promise.all([persistence.read('settings', 'site'), persistence.list('media')]);
      return { settings: settingsVersion(settings, { workspace: true }), posts: rows.flatMap(row => { const value = JSON.parse(row.payload_json); return ['draft', 'published'].map(status => postVersion(value, status, { metadata: true })).filter(Boolean); }), media: media.filter(value => !value.deletedAt).map(mediaView), releases: [] };
    },
  };
}
