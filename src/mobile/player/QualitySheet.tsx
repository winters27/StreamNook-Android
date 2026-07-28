// Quality picker as a bottom sheet. Same store round-trip as the desktop menu:
// AppStore.availableQualities -> changeStreamQuality (the backend restarts the
// loopback stream at the chosen quality).
import React, { useState } from 'react';
import { Check } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { MobileSheet } from '../ui/MobileSheet';

export const QualitySheet: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const availableQualities = useAppStore((s) => s.availableQualities);
  const changeStreamQuality = useAppStore((s) => s.changeStreamQuality);
  const [selected, setSelected] = useState<string | null>(null);

  const pick = (quality: string) => {
    setSelected(quality);
    onClose();
    void changeStreamQuality(quality);
  };

  return (
    <MobileSheet open={open} onClose={onClose} title="Quality">
      {availableQualities.length === 0 ? (
        <div className="py-6 text-center text-sm text-textMuted">
          Quality options appear once the stream loads.
        </div>
      ) : (
        <div className="flex flex-col">
          {availableQualities.map((q) => (
            <button
              key={q}
              onClick={() => pick(q)}
              className="sn-touch flex items-center justify-between px-2 text-[15px] text-textPrimary active:opacity-70"
            >
              <span className="capitalize">{q}</span>
              {selected === q && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </MobileSheet>
  );
};
