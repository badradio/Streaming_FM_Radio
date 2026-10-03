import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** Station copy only — not a track library, not per-song pages. */
const station = defineCollection({
  loader: glob({ base: './src/content/station', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { station };
