import { validateSettings } from '../../admin/settings-model.js';
import { conflict, withoutRevision } from './common.js';

export function settingsVersion(aggregate, { workspace = false } = {}) {
  if (!aggregate) return null;
  const selected = workspace ? aggregate.draft ?? aggregate.published : aggregate.published;
  return selected ? { ...selected, revision: aggregate.revision, ...(workspace && aggregate.draft ? { pendingPublication: true } : {}) } : null;
}

export function createSettingsMethods({ read, write, next }) {
  return {
    async getPublishedSettings() { return settingsVersion(await read('settings', 'site')); },
    async saveSettings(input, { actor } = {}) {
      const settings = validateSettings(input);
      const previous = await read('settings', 'site');
      if (previous ? settings.revision !== previous.revision : settings.revision) throw conflict();
      const value = next(previous, { published: withoutRevision(settings), draft: null });
      await write('settings', 'site', value, previous, { actor });
      return { settings: settingsVersion(value) };
    },
  };
}
