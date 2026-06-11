// Created and developed by Jai Singh
/**
 * Variant dispatch — given a `BoardCard`, render the right card
 * component. The renderer is the single seam between the BentoGrid
 * (layout) and the per-variant content (presentation).
 *
 * If a sixth variant lands, add it here + register it in
 * `card-variant.ts` (`CARD_VARIANTS`, `VARIANT_DEFAULT_SIZE`,
 * `VARIANT_LABEL`, `VARIANT_DESCRIPTION`, `VARIANT_MAX_W`, etc.) +
 * add a swatch in `<BoardCardVariantPicker>`.
 */
import type {
  BoardCard,
  BannerVariantConfig,
  GalleryVariantConfig,
} from './card-variant'
import { BannerCard } from './cards/banner-card'
import type { SharedCardProps } from './cards/card-shared-utils'
import { ClassicCard } from './cards/classic-card'
import { GalleryCard } from './cards/gallery-card'
import { QuoteCard } from './cards/quote-card'
import { SpotlightCard } from './cards/spotlight-card'

export interface CardRendererProps extends Omit<
  SharedCardProps,
  'postKind' | 'post'
> {
  card: BoardCard
}

export function CardRenderer({ card, ...rest }: CardRendererProps) {
  const shared: SharedCardProps = {
    postKind: card.postKind,
    post: card.post,
    isTv: rest.isTv,
    showEditAffordances: rest.showEditAffordances,
    onEdit: rest.onEdit,
    onAcknowledge: rest.onAcknowledge,
    disableInteractions: rest.disableInteractions,
  }

  switch (card.cardVariant) {
    case 'banner':
      return (
        <BannerCard
          {...shared}
          config={card.variantConfig as BannerVariantConfig}
        />
      )
    case 'gallery':
      return (
        <GalleryCard
          {...shared}
          config={card.variantConfig as GalleryVariantConfig}
        />
      )
    case 'spotlight':
      return <SpotlightCard {...shared} />
    case 'quote':
      return <QuoteCard {...shared} />
    case 'classic':
    default:
      return <ClassicCard {...shared} />
  }
}

// Created and developed by Jai Singh
