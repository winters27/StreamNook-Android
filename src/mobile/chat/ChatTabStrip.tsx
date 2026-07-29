// Chat room tabs. Hidden entirely while only the watched stream's chat is open,
// so the single-chat case keeps every pixel of height it has now.
import React from 'react';
import { X, Broadcast } from 'phosphor-react';
import { useChatTabsStore } from './chatTabsStore';

export const ChatTabStrip: React.FC = () => {
  const tabs = useChatTabsStore((s) => s.tabs);
  const activeChannel = useChatTabsStore((s) => s.activeChannel);
  const setActive = useChatTabsStore((s) => s.setActive);
  const removeTab = useChatTabsStore((s) => s.removeTab);

  if (tabs.length < 2) return null;

  return (
    <div className="shrink-0 flex gap-1 px-2 py-1.5 overflow-x-auto border-b border-borderSubtle">
      {tabs.map((tab) => {
        const active = tab.channel === activeChannel;
        return (
          <div
            key={tab.channel}
            className={`shrink-0 flex items-center rounded-full pl-2.5 pr-1 h-8 ${
              active ? 'glass-button-active' : 'glass-button-static'
            }`}
          >
            <button
              onClick={() => setActive(tab.channel)}
              className="flex items-center gap-1 pr-1 max-w-[128px]"
            >
              {tab.pinnedToStream && (
                <Broadcast size={12} weight="fill" className="text-accent shrink-0" />
              )}
              <span
                className={`text-[13px] truncate ${
                  active ? 'text-textPrimary font-semibold' : 'text-textSecondary'
                }`}
              >
                {tab.label}
              </span>
            </button>
            {/* The stream tab follows the player and is not closable. */}
            {tab.pinnedToStream ? (
              <span className="w-1.5" />
            ) : (
              <button
                onClick={() => removeTab(tab.channel)}
                className="w-6 h-6 flex items-center justify-center text-textMuted active:text-textPrimary"
                aria-label={`Close ${tab.label} chat`}
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
