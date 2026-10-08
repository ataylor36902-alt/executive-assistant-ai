import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStudyPlansQueryKey, useCreateStudyPlan, useDeleteStudyPlan,
  useImportStudyPlans, useListStudyPlans, useUpdateStudyPlan,
} from "@workspace/api-client-react";
import type { LegacyStudyPlan } from "@workspace/api-client-react";

const queryKey = getListStudyPlansQueryKey();

function readLegacy(key: string): LegacyStudyPlan[] | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 1000 || value.some(task =>
    typeof task !== "object" || task === null ||
    typeof task.id !== "string" || !task.id || task.id.length > 100 ||
    typeof task.text !== "string" || !task.text.trim() || task.text.length > 500 ||
    typeof task.completed !== "boolean"
  )) throw new Error("Local study tasks could not be imported. They remain on this device.");
  return value as LegacyStudyPlan[];
}

export function useStudyPlans() {
  const { user } = useUser();
  const userId = user?.id;
  const key = userId ? `classscribe_plans_${userId}` : null;
  const [migratedKey, setMigratedKey] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState("");
  const client = useQueryClient();
  const importer = useImportStudyPlans();
  const create = useCreateStudyPlan();
  const update = useUpdateStudyPlan();
  const remove = useDeleteStudyPlan();
  const ready = !!key && migratedKey === key;
  const list = useListStudyPlans({ query: { enabled: ready, queryKey: [...queryKey, userId], staleTime: 0, refetchOnMount: "always" } });

  useEffect(() => {
    if (!key) return;
    let active = true;
    setMigrationError("");
    (async () => {
      try {
        const legacy = readLegacy(key);
        if (legacy) {
          await importer.mutateAsync({ data: { source: "web", tasks: legacy } });
          // Keep the old copy if the import fails; once acknowledged, never reimport deleted tasks.
          localStorage.removeItem(key);
        }
        if (active) {
          await client.invalidateQueries({ queryKey });
          setMigratedKey(key);
        }
      } catch (error) {
        if (active) setMigrationError(error instanceof Error ? error.message : "Could not import local study tasks.");
      }
    })();
    return () => { active = false; };
    // Importer mutation object changes on render; only the account key should trigger migration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client]);

  const refresh = () => client.invalidateQueries({ queryKey });
  return {
    tasks: ready ? list.data ?? [] : [],
    loading: !migrationError && (!ready || list.isLoading),
    error: migrationError || (list.isError ? "Could not load study plans. Try reloading." : ""),
    busy: create.isPending || update.isPending || remove.isPending,
    add: async (text: string) => { await create.mutateAsync({ data: { text } }); await refresh(); },
    toggle: async (id: string, completed: boolean) => { await update.mutateAsync({ id, data: { completed } }); await refresh(); },
    deleteTask: async (id: string) => { await remove.mutateAsync({ id }); await refresh(); },
  };
}