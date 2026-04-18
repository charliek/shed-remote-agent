import { z } from 'zod';

export const workspaceSchema = z.object({
  name: z.string(),
  path: z.string(),
  is_git_repo: z.boolean(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspacesResponseSchema = z.object({
  root: z.string(),
  user: z.string(),
  workspaces: z.array(workspaceSchema),
});
export type WorkspacesResponse = z.infer<typeof workspacesResponseSchema>;
