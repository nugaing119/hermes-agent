import { useEffect, useMemo, useState } from "react";
import { Eye, History, RefreshCw, RotateCcw, Shield, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import type {
  NoosphereActionResponse,
  NoosphereAuditSummary,
  NoosphereMaintenanceItem,
  NoosphereOverrideEntry,
} from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { Toast } from "@/components/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  open: "warning",
  applied: "success",
  ignored: "secondary",
  rolled_back: "destructive",
};

const EVENT_VARIANT: Record<string, "warning" | "destructive" | "secondary" | "success"> = {
  override: "warning",
  rollback: "destructive",
  lock: "secondary",
  unlock: "secondary",
};

type StatusFilter = "all" | "open" | "applied" | "ignored" | "rolled_back";

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function extractNotesPreview(body?: string | null): string {
  if (!body) return "";
  const marker = "## Notes";
  const idx = body.indexOf(marker);
  const text = idx >= 0 ? body.slice(idx + marker.length) : body;
  return text.trim().slice(0, 260);
}

function SummaryStat({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: string | number;
  variant?: "default" | "warning" | "success" | "destructive";
}) {
  return (
    <div className="flex items-center justify-between border border-border px-3 py-2">
      <span className="font-display text-[0.75rem] tracking-[0.12em] uppercase text-muted-foreground">
        {label}
      </span>
      <Badge variant={variant === "default" ? "outline" : variant}>{String(value)}</Badge>
    </div>
  );
}

function ActionResult({ result }: { result: NoosphereActionResponse | null }) {
  if (!result) return null;
  return (
    <div className="mt-3 border border-border bg-background/70 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={result.ok ? "success" : "destructive"}>{result.ok ? "ok" : "failed"}</Badge>
        <span className="font-display text-[0.72rem] tracking-[0.12em] uppercase text-muted-foreground">
          exit {result.exit_code}
        </span>
      </div>
      {result.stdout && (
        <pre className="mb-2 overflow-x-auto whitespace-pre-wrap text-xs text-foreground/80">
          {result.stdout}
        </pre>
      )}
      {result.stderr && (
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-destructive/80">
          {result.stderr}
        </pre>
      )}
    </div>
  );
}

export default function ReviewPage() {
  const [summary, setSummary] = useState<NoosphereAuditSummary | null>(null);
  const [items, setItems] = useState<NoosphereMaintenanceItem[]>([]);
  const [overrides, setOverrides] = useState<NoosphereOverrideEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<NoosphereActionResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<NoosphereMaintenanceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { toast, showToast } = useToast();

  const load = async (filter: StatusFilter, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [summaryResp, maintenanceResp, overrideResp] = await Promise.all([
        api.getNoosphereAuditSummary(),
        api.getNoosphereMaintenance(filter),
        api.getNoosphereOverrides(20),
      ]);
      setSummary(summaryResp);
      setItems(maintenanceResp.items);
      setOverrides(overrideResp.items);
    } catch (err) {
      showToast(`Failed to load Noosphere audit: ${err}`, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedItem(null);
      return;
    }
    setDetailLoading(true);
    api
      .getNoosphereMaintenanceItem(selectedId)
      .then((resp) => setSelectedItem(resp.item))
      .catch((err) => showToast(`Failed to load detail: ${err}`, "error"))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const openCount = summary?.maintenance.open ?? 0;
  const filteredLabel = useMemo(() => {
    return statusFilter === "all" ? "All artifacts" : `${statusFilter} artifacts`;
  }, [statusFilter]);

  const runAction = async (kind: "apply" | "rollback", item: NoosphereMaintenanceItem) => {
    const maintenanceId = item.maintenance_id;
    const actionKey = `${kind}:${maintenanceId}`;
    setActioning(actionKey);
    setLastResult(null);
    try {
      const note = `${kind} via Hermes dashboard`;
      const result =
        kind === "apply"
          ? await api.applyNoosphereMaintenance(maintenanceId, note)
          : await api.rollbackNoosphereMaintenance(maintenanceId, note);
      setLastResult(result);
      showToast(`${kind === "apply" ? "Applied" : "Rolled back"} ${maintenanceId}`, "success");
      await load(statusFilter, true);
    } catch (err) {
      showToast(`Action failed: ${err}`, "error");
    } finally {
      setActioning(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Toast toast={toast} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Noosphere Audit Surface
            </CardTitle>
            {summary?.repo_root && (
              <div className="mt-1 text-xs text-muted-foreground">{summary.repo_root}</div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => void load(statusFilter, true)}
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryStat label="Open" value={openCount} variant="warning" />
          <SummaryStat label="Applied" value={summary?.maintenance.applied ?? 0} variant="success" />
          <SummaryStat label="Ignored" value={summary?.maintenance.ignored ?? 0} />
          <SummaryStat label="Rolled Back" value={summary?.maintenance.rolled_back ?? 0} variant="destructive" />
          <SummaryStat label="Overrides" value={summary?.recent_overrides_count ?? 0} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4" />
              Maintenance
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              {(["open", "all", "applied", "ignored", "rolled_back"] as StatusFilter[]).map((status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                >
                  {status}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="text-xs text-muted-foreground">{filteredLabel}</div>
            {items.length === 0 && (
              <div className="border border-border px-4 py-6 text-sm text-muted-foreground">
                No maintenance artifacts for this filter.
              </div>
            )}
            {items.map((item) => {
              const canAct = item.status === "open";
              const applyKey = `apply:${item.maintenance_id}`;
              const rollbackKey = `rollback:${item.maintenance_id}`;
              return (
                <Card key={item.maintenance_id}>
                  <CardContent className="flex flex-col gap-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
                      <Badge variant="outline">{item.kind}</Badge>
                      <span className="font-mono-ui text-[0.72rem] text-muted-foreground">
                        {item.maintenance_id}
                      </span>
                    </div>

                    <div>
                      <div className="text-sm font-medium">{item.summary || "Untitled maintenance artifact"}</div>
                      {item.suggested_action && (
                        <p className="mt-1 text-sm text-muted-foreground">{item.suggested_action}</p>
                      )}
                    </div>

                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>Created: {formatTime(item.created_at)}</div>
                      <div>Author: {item.created_by || "—"}</div>
                    </div>

                    {extractNotesPreview(item.body) && (
                      <div className="border border-border px-3 py-2 text-xs text-foreground/75">
                        {extractNotesPreview(item.body)}
                        {item.body.length > 260 && <span className="text-muted-foreground">...</span>}
                      </div>
                    )}

                    {item.target_notes && item.target_notes.length > 0 && (
                      <div className="text-xs">
                        <div className="mb-1 font-display uppercase tracking-[0.12em] text-muted-foreground">
                          Targets
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {item.target_notes.map((target) => (
                            <Badge key={target} variant="outline">{target}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedId(item.maintenance_id)}
                    >
                      <Eye className="h-3 w-3" />
                      Inspect
                    </Button>

                    {canAct && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={actioning === applyKey}
                          onClick={() => void runAction("apply", item)}
                        >
                          <Wrench className="h-3 w-3" />
                          {actioning === applyKey ? "Applying..." : "Apply"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={actioning === rollbackKey}
                          onClick={() => void runAction("rollback", item)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          {actioning === rollbackKey ? "Rolling Back..." : "Rollback"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            <ActionResult result={lastResult} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {selectedId ? <Eye className="h-4 w-4" /> : <History className="h-4 w-4" />}
              {selectedId ? "Maintenance Detail" : "Recent Overrides"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {selectedId ? (
              detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : selectedItem ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[selectedItem.status] ?? "outline"}>{selectedItem.status}</Badge>
                    <Badge variant="outline">{selectedItem.kind}</Badge>
                    <span className="font-mono-ui text-[0.72rem] text-muted-foreground">
                      {selectedItem.maintenance_id}
                    </span>
                  </div>
                  <div className="text-sm font-medium">{selectedItem.summary || "Untitled maintenance artifact"}</div>
                  <div className="text-xs text-muted-foreground">
                    <div>Created: {formatTime(selectedItem.created_at)}</div>
                    <div>Author: {selectedItem.created_by || "—"}</div>
                    {selectedItem.run_id && <div>Run: {selectedItem.run_id}</div>}
                  </div>
                  {selectedItem.suggested_action && (
                    <div className="border border-border px-3 py-2 text-sm text-foreground/85">
                      {selectedItem.suggested_action}
                    </div>
                  )}
                  <pre className="overflow-x-auto whitespace-pre-wrap border border-border px-3 py-3 text-xs text-foreground/80">
                    {selectedItem.body}
                  </pre>
                  <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
                    Back to Overrides
                  </Button>
                </div>
              ) : (
                <div className="border border-border px-4 py-6 text-sm text-muted-foreground">
                  Maintenance artifact not found.
                </div>
              )
            ) : overrides.length === 0 ? (
              <div className="border border-border px-4 py-6 text-sm text-muted-foreground">
                No override trace entries.
              </div>
            ) : (
              overrides.map((item) => (
              <div key={item.event_id} className="border border-border px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={EVENT_VARIANT[item.event_type] ?? "outline"}>{item.event_type}</Badge>
                  <span className="font-mono-ui text-[0.72rem] text-muted-foreground">{item.target}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <div>{formatTime(item.created_at)}</div>
                  {item.related_session_id && <div className="mt-1">session: {item.related_session_id}</div>}
                  {item.reason && <div className="mt-1 text-foreground/80">{item.reason}</div>}
                </div>
              </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
