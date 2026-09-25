import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useReduceMotion } from '@/renderer/lib/icons/iconMotionContext';
import {
  isMeshcoreHopCorrected,
  meshcoreChatHopUiKey,
  subscribeMeshcoreHopCorrected,
} from '@/renderer/lib/meshcoreLateRfHopEnrichment';

export interface ChatRfHopLabelProps {
  rxHops: number;
  msg: {
    storeId?: string;
    id?: number;
    sender_id: number;
    timestamp: number;
    channel: number;
  };
  /**
   * The count is the sender's current distance rather than this message's own
   * path — see resolveChatHopDisplay. Marked with a leading ~ so a estimate is
   * never read as a measurement.
   */
  approximate?: boolean;
}

/** Class/title for the hop pill when a late RF correction mark is active. */
export function chatRfHopLabelPresentation(
  corrected: boolean,
  reduceMotion: boolean,
): { className: string; refined: boolean } {
  // gray-400 (#9ca3af) on chat slate-800 (#1e293b) keeps 4.5:1+ for text-[10px].
  if (!corrected) {
    return {
      className: 'text-[10px] text-gray-400 transition-colors duration-500',
      refined: false,
    };
  }
  if (reduceMotion) {
    return {
      className: 'text-[10px] text-gray-400 transition-colors duration-500',
      refined: true,
    };
  }
  return {
    className: 'text-[10px] text-amber-400/80 transition-colors duration-500',
    refined: true,
  };
}

/** Incoming RF hop count; briefly accents when late event 136 corrected a stored value. */
export function ChatRfHopLabel({ rxHops, msg, approximate = false }: ChatRfHopLabelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const uiKey = meshcoreChatHopUiKey(msg);
  const corrected = useSyncExternalStore(
    subscribeMeshcoreHopCorrected,
    () => isMeshcoreHopCorrected(uiKey),
    () => false,
  );
  const { className, refined } = chatRfHopLabelPresentation(corrected, reduceMotion);
  const title = approximate
    ? t('chatPanel.hopCountFromSenderDistance')
    : refined
      ? t('chatPanel.hopCountRefinedFromRf')
      : t('nodeDetailModal.hopsFromRoutingTitle');

  // The "~" is composed here rather than kept as a locale string. A string
  // that is nothing but a placeholder has no translatable content, and sending
  // one to the machine translator corrupted it in five locales at once — it
  // read "~{{hops}}" as a pH value and emitted "pH0", destroying the
  // interpolation. The tooltip below carries the explanation in-language.
  const count = t('nodeDetailModal.hopLabel', { count: rxHops });
  return (
    <span className={className} title={title} aria-label={title}>
      {approximate ? `~${count}` : count}
    </span>
  );
}
