import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listActivationTypes,
  upsertActivationType,
  deleteActivationType,
  type ActivationType,
} from "@/lib/commission.functions";

export const ACTIVATION_TYPES_KEY = ["activation-types"];

export function useActivationTypes() {
  const fetchTypes = useServerFn(listActivationTypes);
  return useQuery({ queryKey: ACTIVATION_TYPES_KEY, queryFn: () => fetchTypes() });
}

export function ActivationTypesCard() {
  const qc = useQueryClient();
  const doUpsert = useServerFn(upsertActivationType);
  const doDelete = useServerFn(deleteActivationType);
  const { data, isLoading } = useActivationTypes();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ACTIVATION_TYPES_KEY });

  const add = useMutation({
    mutationFn: () => doUpsert({ data: { name, code: code || null } }),
    onSuccess: () => {
      setName("");
      setCode("");
      toast.success("Activation type added");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => doDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Activation type removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const types = (data ?? []) as ActivationType[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activation Types</CardTitle>
        <CardDescription>
          Define the activation types your commission schemes are priced against — for example MNP, New SIM, or Device Bundle.
          A slab can target one type, or apply to every type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="Type name, e.g. MNP"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            className="max-w-[160px]"
            placeholder="Code (optional)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}>
            <Plus className="h-4 w-4" /> Add type
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : types.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No activation types yet. Slabs will apply to every activation until you add one.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <Badge key={t.id} variant="secondary" className="gap-2 py-1.5 pl-3 pr-1.5 text-xs">
                {t.name}
                {t.code ? <span className="opacity-60">· {t.code}</span> : null}
                <button
                  type="button"
                  aria-label={`Remove ${t.name}`}
                  className="rounded-full p-1 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => remove.mutate(t.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
