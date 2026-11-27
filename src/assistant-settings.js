import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { escapeHtml } from './workspace-view.js';

export const assistantSettingsSchema = `
  CREATE TABLE IF NOT EXISTS assistant_settings (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('openai', 'local')),
    model TEXT NOT NULL,
    api_key BLOB,
    CHECK((provider = 'openai' AND api_key IS NOT NULL) OR (provider = 'local' AND api_key IS NULL))
  ) STRICT;
  PRAGMA user_version = 13;
`;

export function assistantSettingsStore(db, workspaceKey) {
  const key = createHmac('sha256', workspaceKey).update('nri-assistant-settings-v1').digest();
  const get = db.prepare('SELECT provider, model, api_key FROM assistant_settings WHERE account_id = ?');
  const set = db.prepare(`
    INSERT INTO assistant_settings VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET provider=excluded.provider, model=excluded.model,
      api_key=excluded.api_key
  `);
  const updateModel = db.prepare("UPDATE assistant_settings SET model = ? WHERE account_id = ? AND provider = 'openai'");
  const clear = db.prepare('DELETE FROM assistant_settings WHERE account_id = ?');
  return {
    summary(accountId) {
      const row = get.get(accountId);
      return row ? { provider: row.provider, model: row.model, hasKey: row.api_key !== null } : { provider: 'offline', model: '', hasKey: false };
    },
    save(accountId, provider, model, apiKey) {
      if (provider === 'offline') {
        clear.run(accountId);
        return true;
      }
      if (!['openai', 'local'].includes(provider) || !/^[A-Za-z0-9][A-Za-z0-9./:_-]{0,119}$/.test(model)) return false;
      if (provider === 'local' && apiKey) return false;
      if (apiKey && !/^[!-~]{1,512}$/.test(apiKey)) return false;
      // Bind ciphertext to the account and keep key retention inside the atomic update.
      if (provider === 'openai' && !apiKey) {
        return Boolean(updateModel.run(model, accountId).changes);
      }
      let encrypted = null;
      if (apiKey) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(accountId));
        const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
        encrypted = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
      }
      set.run(accountId, provider, model, encrypted);
      return true;
    },
    configuration(accountId) {
      const row = get.get(accountId);
      if (!row) return undefined;
      if (!row.api_key) return { provider: row.provider, model: row.model };
      const encrypted = Buffer.from(row.api_key);
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
      decipher.setAAD(Buffer.from(accountId));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const apiKey = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8');
      return { provider: row.provider, model: row.model, apiKey };
    },
  };
}

export function handleAssistantSettings({ reply, redirect, lang, form, store, account }) {
  const ar = lang === 'ar';
  const t = (en, arabic) => ar ? arabic : en;
  const path = '/workspace/assistant/settings';
  let status = 200;
  if (form) {
    if (store.assistantSettings.save(account.id, form.get('provider'), (form.get('model') ?? '').trim(), form.get('api-key') ?? '')) {
      redirect(path + '?lang=' + lang);
      return;
    }
    status = 422;
  }
  const { provider, model, hasKey } = store.assistantSettings.summary(account.id);
  const option = (value, label) => `<option value="${value}"${provider === value ? ' selected' : ''}>${label}</option>`;
  const title = t('Assistant provider settings', 'إعدادات مزوّد المساعد');
  reply(status, {
    title, path,
    html: `<section class="surface panel detail workspace-page">
      <h1>${title}</h1>
      <p><a href="/workspace/assistant?lang=${lang}">${t('Back to source review', 'العودة إلى مراجعة المصادر')}</a></p>
      <p>${t('These settings are saved locally. Local answers require a configured loopback server. OpenAI generation is pending.', 'تُحفظ هذه الإعدادات محليًا. تتطلب الإجابات المحلية خادمًا محليًا مُعدًّا. توليد الإجابات عبر OpenAI قيد التطوير.')}</p>
      ${status === 422 ? `<p role="alert">${t('Check the provider, model and key. OpenAI requires a key.', 'تحقق من المزوّد والنموذج والمفتاح. يتطلب OpenAI مفتاحًا.')}</p>` : ''}
      <form class="workspace-form" method="post" action="${path}?lang=${lang}">
        <label>${t('Provider', 'المزوّد')}<select name="provider">
          ${option('offline', t('Offline source review', 'مراجعة المصادر محليًا'))}
          ${option('openai', 'OpenAI')}
          ${option('local', t('Local OpenAI-compatible server', 'خادم محلي متوافق مع OpenAI'))}
        </select></label>
        <label>${t('Model ID', 'معرّف النموذج')}<input name="model" dir="ltr" maxlength="120" value="${escapeHtml(model)}"></label>
        <label>${t('OpenAI API key', 'مفتاح OpenAI API')}<input name="api-key" type="password" autocomplete="new-password" maxlength="512"></label>
        <small>${hasKey ? t('Key stored. Leave blank to keep it with OpenAI.', 'المفتاح محفوظ. اترك الحقل فارغًا للاحتفاظ به مع OpenAI.') : t('No API key stored.', 'لا يوجد مفتاح API محفوظ.')}</small>
        <small>${t('Saving Offline or Local removes the stored OpenAI key.', 'يؤدي حفظ وضع المراجعة أو الخادم المحلي إلى حذف مفتاح OpenAI المحفوظ.')}</small>
        <button class="action">${t('Save settings', 'حفظ الإعدادات')}</button>
      </form>
    </section>`,
  });
}
