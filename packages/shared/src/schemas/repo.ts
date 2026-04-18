import { z } from 'zod';

export const repoSchema = z.object({
  nameWithOwner: z.string(),
  description: z.string().optional(),
  updatedAt: z.string(),
  isPrivate: z.boolean(),
});
export type Repo = z.infer<typeof repoSchema>;

export const reposResponseSchema = z.object({
  repos: z.array(repoSchema),
});
export type ReposResponse = z.infer<typeof reposResponseSchema>;
