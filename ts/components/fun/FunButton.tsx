// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import React, { useMemo } from 'react';
import { VisuallyHidden } from 'react-aria';
import { Button } from 'react-aria-components';
import type { LocalizerType } from '../../types/I18N';
import {
  type EmojiVariantKey,
  getEmojiParentByKey,
  getEmojiParentKeyByVariantKey,
  getEmojiVariantByKey,
} from './data/emojis';
import { FunStaticEmoji } from './FunEmoji';

/**
 * Fun Picker Button
 */

export type FunPickerButtonProps = Readonly<{
  i18n: LocalizerType;
}>;

export function FunPickerButton(props: FunPickerButtonProps): JSX.Element {
  const { i18n } = props;
  return (
    <Button className="FunButton">
      <span className="FunButton__Icon FunButton__Icon--FunPicker" />
      <VisuallyHidden>{i18n('icu:FunButton__Label--FunPicker')}</VisuallyHidden>
    </Button>
  );
}

/**
 * Emoji Picker Button
 */

export type FunEmojiPickerButtonProps = Readonly<{
  selectedEmoji?: EmojiVariantKey | null;
  i18n: LocalizerType;
}>;

export function FunEmojiPickerButton(
  props: FunEmojiPickerButtonProps
): JSX.Element {
  const { i18n } = props;

  const selectedEmojiData = useMemo(() => {
    if (props.selectedEmoji == null) {
      return null;
    }

    const variantKey = props.selectedEmoji;
    const variant = getEmojiVariantByKey(variantKey);
    const parentKey = getEmojiParentKeyByVariantKey(variantKey);
    const parent = getEmojiParentByKey(parentKey);
    return { variant, parent };
  }, [props.selectedEmoji]);

  return (
    <Button className="FunButton">
      {selectedEmojiData ? (
        <FunStaticEmoji
          role="img"
          size={20}
          aria-label={selectedEmojiData.parent.englishShortNameDefault}
          emoji={selectedEmojiData.variant}
        />
      ) : (
        <span className="FunButton__Icon FunButton__Icon--EmojiPicker" />
      )}
      <VisuallyHidden>
        {i18n('icu:FunButton__Label--EmojiPicker')}
      </VisuallyHidden>
    </Button>
  );
}

/**
 * Sticker Picker Button
 */

export type FunStickerPickerButtonProps = Readonly<{
  i18n: LocalizerType;
}>;

export function FunStickerPickerButton(
  props: FunStickerPickerButtonProps
): JSX.Element {
  const { i18n } = props;
  return (
    <Button className="FunButton">
      <span className="FunButton__Icon FunButton__Icon--StickerPicker" />
      <VisuallyHidden>
        {i18n('icu:FunButton__Label--StickerPicker')}
      </VisuallyHidden>
    </Button>
  );
}
