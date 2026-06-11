// Created and developed by Jai Singh
// Minimal ambient types for troika-three-text (ships untyped). Only the
// configuration entry point the scene engine uses is declared.
declare module 'troika-three-text' {
  export interface TextBuilderOptions {
    /** Build SDF glyph atlases on the main thread instead of a blob worker. */
    useWorker?: boolean
    /** Glyph SDF texture size. */
    sdfGlyphSize?: number
  }
  export function configureTextBuilder(options: TextBuilderOptions): void
}
