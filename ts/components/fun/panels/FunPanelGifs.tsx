// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import type { Range } from '@tanstack/react-virtual';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { MouseEvent } from 'react';
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useId, VisuallyHidden } from 'react-aria';
import { LRUCache } from 'lru-cache';
import { FunItemButton } from '../base/FunItem';
import { FunPanel } from '../base/FunPanel';
import { FunScroller } from '../base/FunScroller';
import { FunSearch } from '../base/FunSearch';
import {
  FunSubNav,
  FunSubNavIcon,
  FunSubNavListBox,
  FunSubNavListBoxItem,
} from '../base/FunSubNav';
import { FunWaterfallContainer, FunWaterfallItem } from '../base/FunWaterfall';
import type { FunGifsSection } from '../constants';
import { FunGifsCategory, FunSectionCommon } from '../constants';
import { FunKeyboard } from '../keyboard/FunKeyboard';
import type { WaterfallKeyboardState } from '../keyboard/WaterfallKeyboardDelegate';
import { WaterfallKeyboardDelegate } from '../keyboard/WaterfallKeyboardDelegate';
import { useInfiniteQuery } from '../data/infinite';
import { missingCaseError } from '../../../util/missingCaseError';
import { strictAssert } from '../../../util/assert';
import type { GifsPaginated } from '../data/gifs';
import { drop } from '../../../util/drop';
import { useFunContext } from '../FunProvider';
import {
  FunResults,
  FunResultsButton,
  FunResultsFigure,
  FunResultsHeader,
  FunResultsSpinner,
} from '../base/FunResults';
import { FunStaticEmoji } from '../FunEmoji';
import { emojiVariantConstant } from '../data/emojis';
import {
  FunLightboxPortal,
  FunLightboxBackdrop,
  FunLightboxDialog,
  FunLightboxProvider,
  useFunLightboxKey,
} from '../base/FunLightbox';
import type { tenorDownload } from '../data/tenor';
import { FunGif } from '../FunGif';
import type { LocalizerType } from '../../../types/I18N';
import { isAbortError } from '../../../util/isAbortError';
import * as log from '../../../logging/log';
import * as Errors from '../../../types/errors';

const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB
const FunGifBlobCache = new LRUCache<string, Blob>({
  maxSize: MAX_CACHE_SIZE,
  sizeCalculation: blob => blob.size,
});
const FunGifBlobLiveCache = new WeakMap<GifMediaType, Blob>();

function readGifMediaFromCache(gifMedia: GifMediaType): Blob | null {
  return (
    FunGifBlobLiveCache.get(gifMedia) ??
    FunGifBlobCache.get(gifMedia.url) ??
    null
  );
}

function saveGifMediaToCache(gifMedia: GifMediaType, blob: Blob): void {
  FunGifBlobCache.set(gifMedia.url, blob);
  FunGifBlobLiveCache.set(gifMedia, blob);
}

const GIF_WATERFALL_COLUMNS = 2;
const GIF_WATERFALL_ITEM_WIDTH = 160;
const GIF_WATERFALL_ITEM_MARGIN = 2;
const GIF_WATERFALL_ITEM_TOTAL_WIDTH =
  GIF_WATERFALL_ITEM_WIDTH +
  GIF_WATERFALL_ITEM_MARGIN +
  GIF_WATERFALL_ITEM_MARGIN;

export type GifMediaType = Readonly<{
  url: string;
  width: number;
  height: number;
}>;

export type GifType = Readonly<{
  id: string;
  title: string;
  description: string;
  previewMedia: GifMediaType;
  attachmentMedia: GifMediaType;
}>;

type GifsQuery = Readonly<{
  selectedSection: FunGifsSection;
  searchQuery: string;
}>;

export type FunGifSelection = Readonly<{
  id: string;
  title: string;
  description: string;
  url: string;
  width: number;
  height: number;
}>;

export type FunPanelGifsProps = Readonly<{
  onSelectGif: (gifSelection: FunGifSelection) => void;
  onClose: () => void;
}>;

export function FunPanelGifs({
  onSelectGif,
  onClose,
}: FunPanelGifsProps): JSX.Element {
  const fun = useFunContext();
  const {
    i18n,
    searchInput,
    onSearchInputChange,
    selectedGifsSection,
    onChangeSelectedSelectGifsSection,
    recentGifs,
    fetchGifsFeatured,
    fetchGifsSearch,
    fetchGif,
  } = fun;

  const scrollerRef = useRef<HTMLDivElement>(null);

  const searchQuery = useMemo(() => searchInput.trim(), [searchInput]);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  const handleSearchInputChange = useCallback(
    (nextSearchInput: string) => {
      if (nextSearchInput.trim() !== '') {
        onChangeSelectedSelectGifsSection(FunSectionCommon.SearchResults);
      } else if (recentGifs.length > 0) {
        onChangeSelectedSelectGifsSection(FunSectionCommon.Recents);
      } else {
        onChangeSelectedSelectGifsSection(FunGifsCategory.Trending);
      }
      onSearchInputChange(nextSearchInput);
    },
    [onSearchInputChange, recentGifs, onChangeSelectedSelectGifsSection]
  );

  const [debouncedQuery, setDebouncedQuery] = useState<GifsQuery>({
    selectedSection: selectedGifsSection,
    searchQuery,
  });

  useEffect(() => {
    if (
      debouncedQuery.searchQuery === searchQuery &&
      debouncedQuery.selectedSection === selectedGifsSection
    ) {
      // don't update twice
      return;
    }

    const query: GifsQuery = {
      selectedSection: selectedGifsSection,
      searchQuery,
    };
    // Set immediately if not a search
    if (searchQuery === '') {
      setDebouncedQuery(query);
      return;
    }
    // Defer searches
    const timeout = setTimeout(() => {
      setDebouncedQuery(query);
    }, 500);
    return () => {
      clearTimeout(timeout);
    };
  }, [debouncedQuery, searchQuery, selectedGifsSection]);

  const loader = useCallback(
    async (
      query: GifsQuery,
      previousPage: GifsPaginated | null,
      signal: AbortSignal
    ) => {
      const cursor = previousPage?.next ?? null;
      const limit = cursor != null ? 30 : 10;

      if (query.searchQuery !== '') {
        return fetchGifsSearch(query.searchQuery, limit, cursor, signal);
      }
      strictAssert(
        query.selectedSection !== FunSectionCommon.SearchResults,
        'Section is search results when not searching'
      );
      if (query.selectedSection === FunSectionCommon.Recents) {
        return { next: null, gifs: recentGifs };
      }
      if (query.selectedSection === FunGifsCategory.Trending) {
        return fetchGifsFeatured(limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.Celebrate) {
        return fetchGifsSearch('celebrate', limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.Love) {
        return fetchGifsSearch('love', limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.ThumbsUp) {
        return fetchGifsSearch('thumbs-up', limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.Surprised) {
        return fetchGifsSearch('surprised', limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.Excited) {
        return fetchGifsSearch('excited', limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.Sad) {
        return fetchGifsSearch('sad', limit, cursor, signal);
      }
      if (query.selectedSection === FunGifsCategory.Angry) {
        return fetchGifsSearch('angry', limit, cursor, signal);
      }

      throw missingCaseError(query.selectedSection);
    },
    [recentGifs, fetchGifsSearch, fetchGifsFeatured]
  );

  const hasNextPage = useCallback(
    (_query: GifsQuery, previousPage: GifsPaginated | null) => {
      return previousPage?.next != null;
    },
    []
  );

  const { queryState, fetchNextPage, revalidate } = useInfiniteQuery({
    query: debouncedQuery,
    loader,
    hasNextPage,
  });

  const items = useMemo(() => {
    return queryState.pages.flatMap(page => page.gifs);
  }, [queryState.pages]);

  const estimateSize = useCallback(
    (index: number) => {
      const gif = items[index];
      const aspectRatio = gif.previewMedia.width / gif.previewMedia.height;
      const baseHeight = GIF_WATERFALL_ITEM_WIDTH / aspectRatio;
      return baseHeight + GIF_WATERFALL_ITEM_MARGIN + GIF_WATERFALL_ITEM_MARGIN;
    },
    [items]
  );

  const count = items.length;

  // Override the range extractor to always include the first and last indexes
  // so the keyboard delegate has something to jump to.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (!indexes.includes(0)) {
        indexes.unshift(0); // always include first
      }
      if (!indexes.includes(count - 1)) {
        indexes.push(count - 1); // always include last
      }
      return indexes;
    },
    [count]
  );

  const getScrollElement = useCallback(() => {
    return scrollerRef.current;
  }, []);

  const getItemKey = useCallback(
    (index: number) => {
      return items[index].id;
    },
    [items]
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement,
    estimateSize,
    rangeExtractor,
    overscan: 4 * GIF_WATERFALL_COLUMNS,
    lanes: GIF_WATERFALL_COLUMNS,
    scrollPaddingStart: 20,
    scrollPaddingEnd: 20,
    getItemKey,
    initialOffset: 100,
  });

  // Scroll back to top when query changes
  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [queryState.query, virtualizer]);

  const lastIndex = virtualizer.range?.endIndex ?? -1;

  useEffect(() => {
    if (
      lastIndex === -1 ||
      count === 0 ||
      !queryState.hasNextPage ||
      queryState.pending
    ) {
      return;
    }

    const overscan = 4 * GIF_WATERFALL_COLUMNS;

    // if we're near the end of the list, fetch more
    if (lastIndex + overscan >= count - 1) {
      fetchNextPage();
    }
  }, [
    lastIndex,
    count,
    queryState.hasNextPage,
    queryState.pending,
    fetchNextPage,
  ]);

  const keyboard = useMemo(() => {
    return new WaterfallKeyboardDelegate(virtualizer);
  }, [virtualizer]);

  const handleSelectSection = useCallback(
    (key: string) => {
      onChangeSelectedSelectGifsSection(key as FunGifsCategory);
    },
    [onChangeSelectedSelectGifsSection]
  );

  const handleKeyboardStateChange = useCallback(
    (state: WaterfallKeyboardState) => {
      setSelectedItemKey(state.key);
    },
    []
  );

  const handlePressGif = useCallback(
    (_event: MouseEvent, gifSelection: FunGifSelection) => {
      onSelectGif(gifSelection);
      // Should always close, cannot select multiple
      onClose();
    },
    [onSelectGif, onClose]
  );

  const handleRetry = useCallback(() => {
    revalidate();
  }, [revalidate]);

  // When we're searching, wait until the pending query is updated before
  // changing the UI
  const visibleSelectedSection =
    debouncedQuery.selectedSection === FunSectionCommon.SearchResults
      ? queryState.query.selectedSection
      : debouncedQuery.selectedSection;

  return (
    <FunPanel>
      <FunSearch
        i18n={i18n}
        searchInput={searchInput}
        onSearchInputChange={handleSearchInputChange}
        placeholder={i18n('icu:FunPanelGifs__SearchPlaceholder--Tenor')}
        aria-label={i18n('icu:FunPanelGifs__SearchLabel--Tenor')}
      />
      {visibleSelectedSection !== FunSectionCommon.SearchResults && (
        <FunSubNav>
          <FunSubNavListBox
            aria-label={i18n('icu:FunPanelGifs__SubNavLabel')}
            selected={visibleSelectedSection}
            onSelect={handleSelectSection}
          >
            {recentGifs.length > 0 && (
              <FunSubNavListBoxItem
                id={FunSectionCommon.Recents}
                label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Recents')}
              >
                <FunSubNavIcon iconClassName="FunSubNav__Icon--Recents" />
              </FunSubNavListBoxItem>
            )}
            <FunSubNavListBoxItem
              id={FunGifsCategory.Trending}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Trending')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Trending" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.Celebrate}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Celebrate')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Celebrate" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.Love}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Love')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Love" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.ThumbsUp}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--ThumbsUp')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--ThumbsUp" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.Surprised}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Surprised')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Surprised" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.Excited}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Excited')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Excited" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.Sad}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Sad')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Sad" />
            </FunSubNavListBoxItem>
            <FunSubNavListBoxItem
              id={FunGifsCategory.Angry}
              label={i18n('icu:FunPanelGifs__SubNavCategoryLabel--Angry')}
            >
              <FunSubNavIcon iconClassName="FunSubNav__Icon--Angry" />
            </FunSubNavListBoxItem>
          </FunSubNavListBox>
        </FunSubNav>
      )}
      <FunScroller ref={scrollerRef} sectionGap={0}>
        {count === 0 && (
          <FunResults aria-busy={queryState.pending}>
            {queryState.pending && (
              <>
                <FunResultsFigure>
                  <FunResultsSpinner />
                </FunResultsFigure>
                <VisuallyHidden>
                  <FunResultsHeader>
                    {i18n('icu:FunPanelGifs__SearchResults__LoadingLabel')}
                  </FunResultsHeader>
                </VisuallyHidden>
              </>
            )}
            {queryState.rejected && (
              <>
                <FunResultsHeader>
                  {i18n('icu:FunPanelGifs__SearchResults__ErrorHeading')}
                </FunResultsHeader>
                <FunResultsButton onPress={handleRetry}>
                  {i18n('icu:FunPanelGifs__SearchResults__ErrorRetryButton')}
                </FunResultsButton>
              </>
            )}
            {!queryState.pending && !queryState.rejected && (
              <FunResultsHeader>
                {i18n('icu:FunPanelGifs__SearchResults__EmptyHeading')}{' '}
                <FunStaticEmoji
                  size={16}
                  role="presentation"
                  emoji={emojiVariantConstant('\u{1F641}')}
                />
              </FunResultsHeader>
            )}
          </FunResults>
        )}
        {count !== 0 && (
          <FunLightboxProvider containerRef={scrollerRef}>
            <GifsLightbox i18n={i18n} items={items} />
            <FunKeyboard
              scrollerRef={scrollerRef}
              keyboard={keyboard}
              onStateChange={handleKeyboardStateChange}
            >
              <FunWaterfallContainer totalSize={virtualizer.getTotalSize()}>
                {virtualizer.getVirtualItems().map(item => {
                  const gif = items[item.index];
                  const key = String(item.key);
                  const isTabbable =
                    selectedItemKey != null
                      ? key === selectedItemKey
                      : item.index === 0;
                  return (
                    <Item
                      key={key}
                      gif={gif}
                      itemKey={key}
                      itemHeight={item.size}
                      itemOffset={item.start}
                      itemLane={item.lane}
                      isTabbable={isTabbable}
                      onPressGif={handlePressGif}
                      fetchGif={fetchGif}
                    />
                  );
                })}
              </FunWaterfallContainer>
            </FunKeyboard>
          </FunLightboxProvider>
        )}
      </FunScroller>
    </FunPanel>
  );
}

const Item = memo(function Item(props: {
  gif: GifType;
  itemKey: string;
  itemHeight: number;
  itemOffset: number;
  itemLane: number;
  isTabbable: boolean;
  onPressGif: (event: MouseEvent, gifSelection: FunGifSelection) => void;
  fetchGif: typeof tenorDownload;
}) {
  const { onPressGif, fetchGif } = props;

  const handleClick = useCallback(
    async (event: MouseEvent) => {
      onPressGif(event, {
        id: props.gif.id,
        title: props.gif.title,
        description: props.gif.description,
        url: props.gif.attachmentMedia.url,
        width: props.gif.attachmentMedia.width,
        height: props.gif.attachmentMedia.height,
      });
    },
    [props.gif, onPressGif]
  );

  const descriptionId = `FunGifsPanelItem__GifDescription--${props.gif.id}`;
  const [src, setSrc] = useState<string | null>(() => {
    const cached = readGifMediaFromCache(props.gif.previewMedia);
    return cached != null ? URL.createObjectURL(cached) : null;
  });

  useEffect(() => {
    if (src != null) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    async function download() {
      try {
        const bytes = await fetchGif(props.gif.previewMedia.url, signal);
        const blob = new Blob([bytes]);
        saveGifMediaToCache(props.gif.previewMedia, blob);
        setSrc(URL.createObjectURL(blob));
      } catch (error) {
        if (!isAbortError(error)) {
          log.error('Failed to download gif', Errors.toLogFormat(error));
        }
      }
    }

    drop(download());

    return () => {
      controller.abort();
    };
  }, [props.gif, src, fetchGif]);

  useEffect(() => {
    return () => {
      if (src != null) {
        URL.revokeObjectURL(src);
      }
    };
  }, [src]);

  return (
    <FunWaterfallItem
      data-key={props.itemKey}
      width={GIF_WATERFALL_ITEM_TOTAL_WIDTH}
      height={props.itemHeight}
      offsetY={props.itemOffset}
      offsetX={GIF_WATERFALL_ITEM_TOTAL_WIDTH * props.itemLane}
    >
      <FunItemButton
        aria-label={props.gif.title}
        onClick={handleClick}
        tabIndex={props.isTabbable ? 0 : -1}
      >
        {src != null && (
          <FunGif
            src={src}
            width={props.gif.previewMedia.width}
            height={props.gif.previewMedia.height}
            aria-describedby={descriptionId}
          />
        )}
        <VisuallyHidden id={descriptionId}>
          {props.gif.description}
        </VisuallyHidden>
      </FunItemButton>
    </FunWaterfallItem>
  );
});

function GifsLightbox(props: {
  i18n: LocalizerType;
  items: ReadonlyArray<GifType>;
}) {
  const { i18n } = props;
  const key = useFunLightboxKey();
  const descriptionId = useId();

  const result = useMemo(() => {
    if (key == null) {
      return null;
    }
    const gif = props.items.find(item => {
      return item.id === key;
    });
    strictAssert(gif, `Must have gif for "${key}"`);
    const blob = readGifMediaFromCache(gif.previewMedia);
    strictAssert(blob, 'Missing media');
    const url = URL.createObjectURL(blob);
    return { gif, url };
  }, [props.items, key]);

  useEffect(() => {
    return () => {
      if (result != null) {
        URL.revokeObjectURL(result.url);
      }
    };
  }, [result]);

  if (result == null) {
    return null;
  }

  return (
    <FunLightboxPortal>
      <FunLightboxBackdrop>
        <FunLightboxDialog
          aria-label={i18n('icu:FunPanelGifs__LightboxDialog__Label')}
        >
          <FunGif
            src={result.url}
            width={result.gif.previewMedia.width}
            height={result.gif.previewMedia.height}
            aria-describedby={descriptionId}
            ignoreReducedMotion
          />
          <VisuallyHidden id={descriptionId}>
            {result.gif.description}
          </VisuallyHidden>
        </FunLightboxDialog>
      </FunLightboxBackdrop>
    </FunLightboxPortal>
  );
}
