import { createContext, useContext, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActiveWorkspace, setActiveWorkspace, createWorkspace, leaveWorkspace } from "@/lib/workspace.functions";

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "manager"
  | "employee"
  | "operator"
  | "accountant"
  | "partner";
export type PlanTier = "free" | "starter" | "pro" | "enterprise";

export type ActiveWorkspace = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  role: WorkspaceRole;
  plan_tier: PlanTier;
  plan_expires_at: string | null;
  seat_limit: number;
};

type Ctx = {
  workspace: ActiveWorkspace | null;
  workspaces: ActiveWorkspace[];
  isSuperAdmin: boolean;
  /** Super admin viewing a workspace they are not a member of. */
  isImpersonating: boolean;
  loading: boolean;
  switchWorkspace: (id: string) => Promise<void>;
  createNewWorkspace: (name: string) => Promise<string>;
  leaveWorkspaceById: (id: string) => Promise<string | null>;
};


const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getActiveWorkspace);
  const setFn = useServerFn(setActiveWorkspace);
  const createFn = useServerFn(createWorkspace);
  const leaveFn = useServerFn(leaveWorkspace);

  const { data, isLoading } = useQuery({
    queryKey: ["active-workspace"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const switchM = useMutation({
    mutationFn: async (id: string) => setFn({ data: { workspaceId: id } }),
    onSuccess: async () => {
      // Drop every cached query: nothing from the previous account may survive
      // the switch, even for a frame.
      qc.clear();
      // Refresh all workspace-scoped data
      window.location.reload();
    },
  });

  const createM = useMutation({
    mutationFn: async (name: string) => createFn({ data: { name } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["active-workspace"] });
    },
  });

  const leaveM = useMutation({
    mutationFn: async (id: string) => leaveFn({ data: { workspaceId: id } }),
  });

  const value: Ctx = {
    workspace: (data?.workspace as ActiveWorkspace | null) ?? null,
    workspaces: (data?.workspaces as ActiveWorkspace[]) ?? [],
    isSuperAdmin: !!data?.isSuperAdmin,
    isImpersonating: !!(data as { isImpersonating?: boolean } | undefined)?.isImpersonating,

    loading: isLoading,
    switchWorkspace: async (id) => { await switchM.mutateAsync(id); },
    createNewWorkspace: async (name) => (await createM.mutateAsync(name)).id,
    leaveWorkspaceById: async (id) => {
      const res = await leaveM.mutateAsync(id);
      return res.nextWorkspaceId ?? null;
    },
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** Non-throwing read — for previews rendered outside the provider. */
export function useWorkspaceOptional() {
  return useContext(WorkspaceContext);
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

