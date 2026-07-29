// The menu behind the composer's trailing button when there is nothing to send.
// Send and this share one slot, so the composer never carries a dead button.
import React from 'react';
import { ArrowsClockwise, ChatsCircle, ShieldCheck, X } from 'phosphor-react';
import { MobileSheet } from '../ui/MobileSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Null when no chat is open. */
  activeChannel: string | null;
  activeLabel: string | null;
  isModerator: boolean;
  modToolsOn: boolean;
  onToggleModTools: () => void;
  onAddChat: () => void;
  onReload: () => void;
  /** Absent for the stream-following tab, which is not closable. */
  onCloseChat?: () => void;
}

export const ComposerMenuSheet: React.FC<Props> = ({
  open,
  onClose,
  activeChannel,
  activeLabel,
  isModerator,
  modToolsOn,
  onToggleModTools,
  onAddChat,
  onReload,
  onCloseChat,
}) => {
  const row =
    'sn-touch flex items-center gap-3 px-2 text-[15px] text-textPrimary active:opacity-70 disabled:opacity-45';

  return (
    <MobileSheet open={open} onClose={onClose} title={activeLabel ?? 'Chat'} maxHeightFraction={0.5}>
      <div className="flex flex-col">
        <button
          onClick={() => {
            onAddChat();
            onClose();
          }}
          className={row}
        >
          <ChatsCircle size={19} className="text-textSecondary shrink-0" />
          <span className="flex-1 text-left">Add a chat</span>
        </button>

        <button
          onClick={() => {
            onReload();
            onClose();
          }}
          disabled={!activeChannel}
          className={row}
        >
          <ArrowsClockwise size={19} className="text-textSecondary shrink-0" />
          <span className="flex-1 text-left">Reload this chat</span>
        </button>

        {/* Only offered where the actions would actually succeed: Helix rejects
            them without mod powers in this specific channel. */}
        {isModerator && (
          <button onClick={onToggleModTools} className={row}>
            <ShieldCheck
              size={19}
              weight={modToolsOn ? 'fill' : 'regular'}
              className={modToolsOn ? 'text-accent shrink-0' : 'text-textSecondary shrink-0'}
            />
            <span className="flex-1 text-left">Moderator tools</span>
            <span className="text-[12.5px] text-textMuted">{modToolsOn ? 'On' : 'Off'}</span>
          </button>
        )}

        {onCloseChat && (
          <button
            onClick={() => {
              onCloseChat();
              onClose();
            }}
            className={`${row} !text-error`}
          >
            <X size={19} className="shrink-0" />
            <span className="flex-1 text-left">Close this chat</span>
          </button>
        )}

        {isModerator && modToolsOn && (
          <div className="mt-2 px-2 text-[12.5px] text-textMuted leading-snug">
            Long-press any message for delete, timeout and ban.
          </div>
        )}
      </div>
    </MobileSheet>
  );
};
