import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/AppStore';
import { SettingsSection, SettingsRow, SegmentedSelect } from './_primitives';
import { MOD_LOG_CATEGORIES, MOD_LOG_STYLES, highlightContainerStyle } from '../../utils/modLogCategories';
import { Tooltip } from '../ui/Tooltip';
import { connectModRoomConsent, clearModeratedCache, loadModeratedChannelIds } from '../../services/modRoomService';

const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
  <button
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
      enabled ? 'bg-accent' : 'bg-gray-600'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const ModerationSettings = () => {
  const { settings, updateSettings } = useAppStore();
  const mod = settings.moderation ?? {};

  // Mod-room scoped consent: which account it belongs to, and the two actions.
  const [modRoomLogin, setModRoomLogin] = useState<string | null>(null);
  const [modRoomBusy, setModRoomBusy] = useState(false);
  useEffect(() => {
    invoke<{ connected: boolean; login: string | null }>('modroom_status')
      .then((s) => setModRoomLogin(s.connected ? s.login : null))
      .catch(() => {});
  }, []);
  const handleModRoomConnect = async () => {
    setModRoomBusy(true);
    try {
      const login = await connectModRoomConsent();
      if (login) setModRoomLogin(login);
    } catch {
      // cancelled / failed; leave the button
    } finally {
      setModRoomBusy(false);
    }
  };
  const handleModRoomDisconnect = async () => {
    setModRoomBusy(true);
    try {
      await invoke('modroom_disconnect');
      setModRoomLogin(null);
      clearModeratedCache();
      void loadModeratedChannelIds(true);
    } catch {
      // nothing to disconnect
    } finally {
      setModRoomBusy(false);
    }
  };

  const setMod = (patch: Partial<typeof mod>) =>
    updateSettings({ ...settings, moderation: { ...mod, ...patch } });

  // Stored in chat_design (read in the chat hot path), surfaced here because it's
  // a moderation choice. Migrates the deprecated drag_moderation_enabled boolean.
  const cd = settings.chat_design;
  const modActionStyle = cd?.mod_action_style ?? (cd?.drag_moderation_enabled === false ? 'buttons' : 'both');
  const setModActionStyle = (v: 'buttons' | 'drag' | 'both') =>
    updateSettings({ ...settings, chat_design: { ...settings.chat_design!, mod_action_style: v } });
  // Legacy 'slider' value (mode removed) resolves to the beside-chat column.
  const modDragLayout: 'column' | 'bar' = cd?.mod_drag_layout === 'bar' ? 'bar' : 'column';
  const setModDragLayout = (v: 'column' | 'bar') =>
    updateSettings({ ...settings, chat_design: { ...settings.chat_design!, mod_drag_layout: v } });
  // The inline Pin button is always on for mods; this only toggles the extra
  // drag-gesture Pin tile. Legacy 'drag' maps to 'both' (button + drag tile).
  const modPinStyle: 'inline' | 'both' = cd?.mod_pin_style === 'inline' ? 'inline' : 'both';
  const setModPinStyle = (v: 'inline' | 'both') =>
    updateSettings({ ...settings, chat_design: { ...settings.chat_design!, mod_pin_style: v } });

  return (
    <div className="space-y-8">
      <SettingsSection
        label="Moderation Actions"
        description="How you act on a chatter from chat. Buttons: the classic click delete/timeout/ban on the message hover dock (text stays selectable). Drag: grab a message anywhere and drop it on a color-coded action bucket — profile and whisper for everyone, plus delete, timeout, and ban for mods (text selection is off in this mode; use Copy). Both enables both. Mod actions require mod or broadcaster status in the channel."
      >
        <SettingsRow
          title="Action Style"
          description="Choose how moderation actions are triggered in chat."
        >
          <SegmentedSelect<'buttons' | 'drag' | 'both'>
            value={modActionStyle}
            onChange={setModActionStyle}
            options={[
              { value: 'buttons', label: 'Buttons' },
              { value: 'drag', label: 'Drag' },
              { value: 'both', label: 'Both' },
            ]}
          />
        </SettingsRow>

        {modActionStyle !== 'buttons' && (
          <SettingsRow
            title="Drag Style"
            description="Where the action buckets appear. Beside chat: a vertical bucket column to the left of chat, with bigger tiles kept clear of the player's controls. Above chat: a compact bucket cluster just above the message, for when there's less room."
          >
            <SegmentedSelect<'column' | 'bar'>
              value={modDragLayout}
              onChange={setModDragLayout}
              options={[
                { value: 'column', label: 'Beside chat' },
                { value: 'bar', label: 'Above chat' },
              ]}
            />
          </SettingsRow>
        )}

        <SettingsRow
          title="Pin Action"
          description="The inline Pin button (next to Copy on a message) is always available to moderators. This only controls whether a Pin tile ALSO appears in the drag-to-moderate gesture."
        >
          <SegmentedSelect<'inline' | 'both'>
            value={modPinStyle}
            onChange={setModPinStyle}
            options={[
              { value: 'inline', label: 'Button only' },
              { value: 'both', label: 'Button + drag tile' },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        id="settings-section-mod-reasons"
        label="Reasons"
        description="What gets recorded against a ban or timeout. Twitch shows these in the channel's mod view."
      >
        <SettingsRow
          title="Reason for /nuke"
          description="Written against every ban and timeout a /nuke issues. Leave empty to record just “/nuke”."
        >
          <input
            type="text"
            value={mod.nuke_reason ?? ''}
            onChange={(e) => setMod({ nuke_reason: e.target.value })}
            placeholder="/nuke"
            maxLength={140}
            className="glass-input w-full px-3 py-2 text-sm text-textPrimary placeholder-textSecondary"
          />
        </SettingsRow>
        <SettingsRow
          title="Saved reasons"
          description="Offered when you ban or time someone out from their card or a message. One per line; the first is filled in for you."
        >
          <textarea
            rows={4}
            value={(mod.saved_ban_reasons ?? []).join('\n')}
            onChange={(e) =>
              setMod({
                saved_ban_reasons: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={'Spam\nHate speech\nBackseating\nBan evasion'}
            className="glass-input w-full px-3 py-2 text-sm text-textPrimary placeholder-textSecondary resize-y scrollbar-thin"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        label="Mod Logs"
        description="Recent moderation activity surface."
      >
        <SettingsRow
          title="Show Mod Logs panel"
          description="Display the recent moderation actions sidebar inside chat (timeouts, bans, deletions)."
          control={
            <Toggle
              enabled={settings.show_mod_logs ?? false}
              onChange={() =>
                updateSettings({ ...settings, show_mod_logs: !(settings.show_mod_logs ?? false) })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        label="Mod Rooms"
        description="Private, encrypted chat rooms for the mod teams of channels you moderate. Rooms use a separate one-time Twitch consent that only proves which channels you moderate; it cannot act on your account."
      >
        <SettingsRow
          title="Connection"
          description={
            modRoomLogin
              ? `Connected as ${modRoomLogin}. Rooms verify mod status and open as this account. Disconnect to switch accounts or revoke access.`
              : 'Not connected. Grant the one-time consent to unlock rooms for the channels you moderate.'
          }
          control={
            modRoomLogin ? (
              <button
                onClick={handleModRoomDisconnect}
                disabled={modRoomBusy}
                className="px-3 py-1.5 text-xs font-medium text-textSecondary transition-colors hover:text-accent disabled:opacity-50"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleModRoomConnect}
                disabled={modRoomBusy}
                className="px-3 py-1.5 text-xs font-medium text-textSecondary transition-colors hover:text-accent disabled:opacity-50"
              >
                {modRoomBusy ? 'Opening browser...' : 'Connect'}
              </button>
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        label="Message Visibility"
        description="Controls how moderation events appear in chat. Defaults preserve the existing strikethrough behavior."
      >
        <SettingsRow
          title="Announce mod actions inline"
          description="Add an extra system row to chat when a mod times someone out, bans, or deletes a message. Stacks on top of the strikethrough you already see."
          control={
            <Toggle
              enabled={mod.show_mod_messages ?? false}
              onChange={() => setMod({ show_mod_messages: !(mod.show_mod_messages ?? false) })}
            />
          }
        />
        <SettingsRow
          title="Hide strikethrough on removed messages"
          description="Suppress the strikethrough overlay on banned, timed-out, or deleted messages so your backlog stays pristine."
          control={
            <Toggle
              enabled={mod.ignore_clear_chat ?? false}
              onChange={() => setMod({ ignore_clear_chat: !(mod.ignore_clear_chat ?? false) })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        label="Log Highlights"
        description="Color-code mod-log entries by severity. Choose how the highlight shows, then customize any category's color."
      >
        <SettingsRow
          title="Highlight style"
          description="How each entry is emphasized by severity. The previews use a sample event."
        >
          <div className="grid grid-cols-3 gap-2">
            {MOD_LOG_STYLES.map(({ key, label }) => {
              const active = (mod.mod_log_highlight_style ?? 'box') === key;
              const sample = '#e5484d'; // representative (ban) color
              return (
                <button
                  key={key}
                  onClick={() => setMod({ mod_log_highlight_style: key })}
                  className={`flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-all ${
                    active ? 'ring-1 ring-white/20 bg-glass/40' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <div
                    className="w-full rounded-md px-2 py-1.5 bg-secondary/60 border border-borderSubtle text-left"
                    style={highlightContainerStyle(key, sample)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: sample }}
                      />
                      <span
                        className={`text-[10px] font-semibold truncate ${key === 'box' ? 'text-text' : ''}`}
                        style={key === 'box' ? undefined : { color: sample }}
                      >
                        Banned
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] ${active ? 'text-text font-medium' : 'text-textSecondary'}`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsRow>
        {MOD_LOG_CATEGORIES.map((c) => {
          const current = mod.mod_log_colors?.[c.key] || c.defaultColor;
          const overridden = !!mod.mod_log_colors?.[c.key];
          return (
            <SettingsRow key={c.key} title={c.label}>
              <div className="flex items-center gap-2">
                <Tooltip content={`${c.label} color`}>
                <input
                  type="color"
                  value={current}
                  onChange={(e) =>
                    setMod({
                      mod_log_colors: { ...(mod.mod_log_colors ?? {}), [c.key]: e.target.value },
                    })
                  }
                  className="h-7 w-10 rounded cursor-pointer bg-transparent border border-borderSubtle"
                />
                </Tooltip>
                {overridden && (
                  <button
                    onClick={() => {
                      const next = { ...(mod.mod_log_colors ?? {}) };
                      delete next[c.key];
                      setMod({ mod_log_colors: next });
                    }}
                    className="text-[11px] text-textSecondary hover:text-text"
                  >
                    Reset
                  </button>
                )}
              </div>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection
        label="Mass Actions"
        description="Type these in any chat input. Mod-only — both commands no-op for non-mods."
      >
        <SettingsRow
          title="/nuke"
          description="Mass-action by phrase or /regex/flags. Pattern is the text to match. Action is delete, ban, or a duration like 10m. Past[:future] is the lookback window and an optional forward window that keeps matching new messages."
        >
          <div className="space-y-1.5 text-[12px] text-textSecondary leading-relaxed">
            <div>
              <code className="rounded bg-glass/50 px-1.5 py-0.5 font-mono text-textPrimary">
                /nuke spam ban 5m:1m
              </code>
              <span className="ml-2">Ban anyone whose recent 5 minutes contains &quot;spam&quot;, keep banning matches for the next minute.</span>
            </div>
            <div>
              <code className="rounded bg-glass/50 px-1.5 py-0.5 font-mono text-textPrimary">
                /nuke /raid|follow.?for.?follow/i 10m 10m
              </code>
              <span className="ml-2">10 minute timeout for raid/follow4follow patterns going back 10 minutes.</span>
            </div>
            <div>
              <code className="rounded bg-glass/50 px-1.5 py-0.5 font-mono text-textPrimary">
                /nuke bigotry delete 1h
              </code>
              <span className="ml-2">Delete every matching message in the last hour.</span>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow
          title="/undo"
          description="Reverses the most recent /nuke on this channel. Bans and timeouts are reversible. Deletes are permanent — Twitch doesn't allow message un-delete."
        />
      </SettingsSection>
    </div>
  );
};

export default ModerationSettings;
