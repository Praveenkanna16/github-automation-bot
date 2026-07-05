"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";
import {
  GitBranch,
  Zap,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Settings,
  LogOut,
  ChevronRight,
  Copy,
  Check,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  Activity,
  Bot,
  Layers,
} from "lucide-react";
import styles from "./dashboard.module.css";

// ─── Types ────────────────────────────────────────────────────────────
interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch?: string;
}

interface ConnectedRepo {
  id: string;
  userId: string;
  repoFullName: string;
  webhookId: string | null;
  createdAt: string;
}

interface Rule {
  id: string;
  repoId: string;
  enabled: boolean;
  matchField: string;
  matchValue: string;
  eventType: string;
  action: string;
  label: string | null;
  comment: string | null;
  slackMessageTemplate: string | null;
}

interface WebhookEvent {
  id: string;
  repoId: string;
  deliveryId: string;
  eventType: string;
  payload: any;
  status: string;
  error: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  processingMs: number | null;
  aiSummary: string | null;
  aiLabel: string | null;
  aiPriority: string | null;
  aiReasoning: string | null;
  aiConfidence: number | null;
  createdAt: string;
}

interface Stats {
  connectedReposCount: number;
  activeRulesCount: number;
  totalEvents: number;
  failedEvents: number;
  successRate: number;
  retryQueueDepth: number;
  avgProcessingMs: number | null;
  lastSuccessfulWebhook: string | null;
  lastFailedWebhook: string | null;
}

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface DashboardClientProps {
  user: { name: string; email: string; image: string };
  githubRepos: GitHubRepo[];
  connectedRepos: ConnectedRepo[];
  initialEvents: WebhookEvent[];
  fetchError: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function fmtDuration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── CopyButton ───────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button className={styles.copyBtn} onClick={copy} title="Copy" aria-label="Copy to clipboard">
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={styles.toggle} title={label} aria-label={label}>
      <input
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span className={styles.toggleTrack} />
      <span className={styles.toggleThumb} />
    </label>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "done" ? styles.badgeDone :
    status === "failed" ? styles.badgeFailed :
    status === "processing" ? styles.badgeProcessing :
    styles.badgeReceived;
  return <span className={`${styles.badge} ${cls}`}>{status}</span>;
}

// ─── EventTypeBadge ───────────────────────────────────────────────────
function EventTypeBadge({ type }: { type: string }) {
  return (
    <span className={`${styles.badge} ${styles.badgeReceived}`}
      style={{ background: "#eff6ff", color: "#1e40af", borderColor: "#bfdbfe" }}>
      {type}
    </span>
  );
}

// ─── AI Priority Badge ─────────────────────────────────────────────────
function PriorityBadge({ p }: { p: string | null }) {
  if (!p) return null;
  const map: Record<string, { bg: string; color: string; border: string }> = {
    high:   { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
    medium: { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
    low:    { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  };
  const s = map[p] ?? map.low;
  return (
    <span className={styles.badge}
      style={{ background: s.bg, color: s.color, borderColor: s.border, borderWidth: 1 }}>
      {p}
    </span>
  );
}

// ─── Toast Container ──────────────────────────────────────────────────
function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div className={styles.toastContainer} aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`${styles.toast} ${
            t.type === "success" ? styles.toastSuccess :
            t.type === "error" ? styles.toastError : styles.toastInfo
          }`}
        >
          {t.type === "success" ? <CheckCircle2 size={15} /> :
           t.type === "error"   ? <AlertCircle size={15} />  :
           <Activity size={15} />}
          <span style={{ flex: 1 }}>{t.message}</span>
          <button onClick={() => dismiss(t.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", display: "flex" }}
            aria-label="Dismiss toast"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────
function ConfirmDialog({
  title, desc, confirmLabel = "Confirm", danger = true,
  onConfirm, onCancel,
}: {
  title: string; desc: string; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-labelledby="dialog-title">
      <div className={styles.dialog}>
        <p className={styles.dialogTitle} id="dialog-title">{title}</p>
        <p className={styles.dialogDesc}>{desc}</p>
        <div className={styles.dialogActions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onCancel}>Cancel</button>
          <button
            className={`${styles.btn} ${danger ? styles.btnDanger : styles.btnPrimary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr>
      {[1,2,3,4,5,6,7].map(i => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <div className={styles.skeleton} style={{ height: 14, width: `${50 + i * 5}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────
export default function DashboardClient({
  user,
  githubRepos,
  connectedRepos: initialConnectedRepos,
  initialEvents,
  fetchError,
}: DashboardClientProps) {
  // Core state
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>(initialConnectedRepos);
  const [githubReposList, setGithubReposList] = useState<GitHubRepo[]>(githubRepos);
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"rules" | "logs">("rules");

  // User Settings
  const [aiEnabled, setAiEnabled] = useState(true);

  // Stats State
  const [stats, setStats] = useState<Stats | null>(null);

  // Rules state
  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [matchField, setMatchField] = useState("title");
  const [matchValue, setMatchValue] = useState("");
  const [eventType, setEventType] = useState("all");
  const [action, setAction] = useState("label");
  const [label, setLabel] = useState("");
  const [comment, setComment] = useState("");
  const [slackTemplate, setSlackTemplate] = useState(
    "🔔 *{event}* on *{repo}* by {author}\nTitle: {title}\n{url}"
  );
  const [isSubmittingRule, setIsSubmittingRule] = useState(false);
  const [ruleFormMsg, setRuleFormMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Events state
  const [events, setEvents] = useState<WebhookEvent[]>(initialEvents);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEventType, setFilterEventType] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Repository Sync / Disconnect state
  const [isSyncingRepos, setIsSyncingRepos] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);

  // Connect state
  const [selectedGithubRepo, setSelectedGithubRepo] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  // Toast
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  const dismissToast = (id: string) => setToasts(p => p.filter(t => t.id !== id));

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      const url = selectedRepoId ? `/api/stats?repoId=${selectedRepoId}` : "/api/stats";
      const res = await fetch(url);
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  }, [selectedRepoId]);

  // Keyboard shortcut: R to refresh events
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "r" &&
        !e.metaKey &&
        !e.ctrlKey &&
        activeTab === "logs" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        fetchEvents();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedRepoId]);

  // Derived
  const activeRepo = connectedRepos.find(r => r.id === selectedRepoId);
  const unconnectedRepos = githubReposList.filter(
    gr => !connectedRepos.some(cr => cr.repoFullName === gr.fullName)
  );

  // Filtered events (retrieved max 100 bounded)
  const filteredEvents = events.filter(e => {
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterEventType !== "all" && e.eventType !== filterEventType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        e.deliveryId.toLowerCase().includes(q) ||
        e.eventType.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q) ||
        (e.aiSummary?.toLowerCase().includes(q) ?? false) ||
        (e.error?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const pagedEvents = filteredEvents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredEvents.length / PAGE_SIZE);

  // Fetch helpers
  const fetchRules = useCallback(async (repoId: string) => {
    setRulesLoading(true);
    try {
      const res = await fetch(`/api/rules?repoId=${repoId}`);
      if (res.ok) setRules(await res.json());
    } catch { /* silent */ }
    finally { setRulesLoading(false); }
  }, []);

  const fetchEvents = useCallback(async () => {
    if (!selectedRepoId) return;
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/events?repoId=${selectedRepoId}`);
      if (res.ok) setEvents(await res.json());
    } catch { /* silent */ }
    finally { setEventsLoading(false); }
  }, [selectedRepoId]);

  // Load user settings on mount
  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.aiEnabled === "boolean") {
          setAiEnabled(data.aiEnabled);
        }
      })
      .catch(() => {});
  }, []);

  // Update user setting
  const handleToggleAi = async (val: boolean) => {
    setAiEnabled(val);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiEnabled: val }),
      });
      if (res.ok) {
        addToast("info", `AI triage ${val ? "enabled" : "disabled"}`);
      } else {
        throw new Error("Failed to save settings");
      }
    } catch {
      setAiEnabled(!val);
      addToast("error", "Failed to update AI setting");
    }
  };

  // Sync repos list from GitHub
  const handleSyncGithubRepos = async () => {
    setIsSyncingRepos(true);
    try {
      const res = await fetch("/api/repos?sync=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setGithubReposList(data.githubRepos);
      addToast("success", "GitHub repositories list updated successfully");
    } catch (e: any) {
      addToast("error", e.message || "Failed to sync repositories");
    } finally {
      setIsSyncingRepos(false);
    }
  };

  // Disconnect repo from local and remove webhook on GitHub
  const handleDisconnectRepo = async () => {
    if (!selectedRepoId) return;
    try {
      const res = await fetch(`/api/repos?id=${selectedRepoId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to disconnect");
      }
      setConnectedRepos(p => p.filter(r => r.id !== selectedRepoId));
      setSelectedRepoId("");
      addToast("success", "Disconnected repository successfully");
      fetchStats();
    } catch (e: any) {
      addToast("error", e.message || "Failed to disconnect repository");
    }
    setDisconnectConfirm(false);
  };

  // Load on repo selection
  useEffect(() => {
    if (!selectedRepoId) {
      fetchStats();
      return;
    }
    fetchRules(selectedRepoId);
    fetchEvents();
    fetchStats();
    setPage(0);
    setSearchQuery("");
    setFilterStatus("all");
    setFilterEventType("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId]);

  // Auto-refresh events + stats
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (selectedRepoId && activeTab === "logs") {
      intervalRef.current = setInterval(() => {
        fetchEvents();
        fetchStats();
      }, 6000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [selectedRepoId, activeTab, fetchEvents, fetchStats]);

  // Connect repo
  const handleConnect = async () => {
    if (!selectedGithubRepo) return;
    setIsConnecting(true);
    try {
      const res = await fetch("/api/repos/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: selectedGithubRepo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      setConnectedRepos(prev => [{
        id: data.repo.id,
        userId: data.repo.userId,
        repoFullName: data.repo.repoFullName,
        webhookId: data.repo.webhookId,
        createdAt: data.repo.createdAt,
      }, ...prev]);
      setSelectedRepoId(data.repo.id);
      setSelectedGithubRepo("");
      addToast("success", `Connected ${data.repo.repoFullName}`);
    } catch (e: any) {
      addToast("error", e.message || "Failed to connect repository");
    } finally {
      setIsConnecting(false);
    }
  };

  // Rule form helpers
  const resetRuleForm = () => {
    setEditingRuleId(null);
    setMatchField("title");
    setMatchValue("");
    setEventType("all");
    setAction("label");
    setLabel("");
    setComment("");
    setSlackTemplate("🔔 *{event}* on *{repo}* by {author}\nTitle: {title}\n{url}");
    setRuleFormMsg(null);
  };

  const handleStartEdit = (rule: Rule) => {
    setEditingRuleId(rule.id);
    setMatchField(rule.matchField);
    setMatchValue(rule.matchValue);
    setEventType(rule.eventType);
    setAction(rule.action);
    setLabel(rule.label || "");
    setComment(rule.comment || "");
    setSlackTemplate(rule.slackMessageTemplate || "");
    setRuleFormMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoId || !matchValue.trim()) return;
    setIsSubmittingRule(true);
    setRuleFormMsg(null);
    const body = {
      id: editingRuleId,
      repoId: selectedRepoId,
      matchField,
      matchValue: matchValue.trim(),
      eventType,
      action,
      label: (action === "label" || action === "all") ? label : null,
      comment: (action === "comment" || action === "all") ? comment : null,
      slackMessageTemplate: (action === "slack" || action === "all") ? slackTemplate : null,
    };
    try {
      const res = await fetch("/api/rules", {
        method: editingRuleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.issues
          ? data.issues.map((i: any) => `Path "${i.path.join(".")}": ${i.message}`).join(", ")
          : (data.error || "Failed to save rule");
        throw new Error(errorMsg);
      }
      if (editingRuleId) {
        setRules(prev => prev.map(r => r.id === data.id ? data : r));
        addToast("success", "Rule updated");
        resetRuleForm();
      } else {
        setRules(prev => [data, ...prev]);
        setMatchValue("");
        setLabel("");
        setComment("");
        addToast("success", "Rule created");
      }
      fetchStats();
    } catch (err: any) {
      setRuleFormMsg({ text: err.message, isError: true });
    } finally {
      setIsSubmittingRule(false);
    }
  };

  const handleToggleRule = async (rule: Rule) => {
    try {
      const res = await fetch("/api/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRules(prev => prev.map(r => r.id === data.id ? data : r));
      addToast("info", `Rule ${data.enabled ? "enabled" : "disabled"}`);
      fetchStats();
    } catch (err: any) {
      addToast("error", err.message || "Failed to toggle rule");
    }
  };

  const handleDuplicateRule = async (rule: Rule) => {
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: rule.repoId,
          matchField: rule.matchField,
          matchValue: rule.matchValue + " (copy)",
          eventType: rule.eventType,
          action: rule.action,
          label: rule.label,
          comment: rule.comment,
          slackMessageTemplate: rule.slackMessageTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRules(prev => [data, ...prev]);
      addToast("success", "Rule duplicated");
      fetchStats();
    } catch (err: any) {
      addToast("error", err.message || "Failed to duplicate rule");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/rules?id=${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Delete failed");
      }
      setRules(prev => prev.filter(r => r.id !== ruleId));
      if (editingRuleId === ruleId) resetRuleForm();
      addToast("success", "Rule deleted");
      fetchStats();
    } catch (err: any) {
      addToast("error", err.message || "Failed to delete rule");
    }
    setDeleteConfirm(null);
  };

  const lastEvent = events[0];
  const webhookActive = !!lastEvent;

  // Extracted calculations
  const localFailedCount = events.filter(e => e.status === "failed").length;
  const localDoneCount   = events.filter(e => e.status === "done").length;
  const localSuccessRate = events.length > 0
    ? Math.round((localDoneCount / events.length) * 100)
    : 100;
  const localRetryQueue  = events.filter(e => e.status === "failed" && e.retryCount < 5).length;

  const displaySuccessRate = stats ? stats.successRate : localSuccessRate;
  const displayFailedCount = stats ? stats.failedEvents : localFailedCount;
  const displayRetryQueue  = stats ? stats.retryQueueDepth : localRetryQueue;

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logoRow}>
          <span className={styles.logoIcon}>
            <GitBranch size={16} strokeWidth={2.5} />
          </span>
          <span className={styles.logoText}>GitAutomate</span>
        </div>
        <div className={styles.headerRight}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginRight: 16 }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <Bot size={13} />
              AI TRIAGE
            </span>
            <Toggle checked={aiEnabled} onChange={handleToggleAi} label="Toggle AI Triage execution" />
          </div>

          <div className={styles.userChip}>
            {user.image && (
              <img src={user.image} alt={user.name} width={24} height={24} className={styles.avatar} />
            )}
            <span className={styles.userName}>{user.name}</span>
          </div>
          <button
            className={styles.signOutBtn}
            onClick={() => signOut({ callbackUrl: "/login" })}
            aria-label="Sign out"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </header>

      {/* Body */}
      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Connect repo */}
          <div className={styles.sidebarSection}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p className={styles.sidebarLabel}>Connect Repository</p>
              <button
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                style={{ padding: 4 }}
                onClick={handleSyncGithubRepos}
                title="Sync from GitHub"
                disabled={isSyncingRepos}
                aria-label="Sync repositories from GitHub"
              >
                <RefreshCw size={13} style={isSyncingRepos ? { animation: "spin 0.6s linear infinite" } : {}} />
              </button>
            </div>
            {fetchError ? (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--danger)", padding: "var(--space-2)" }}>
                {fetchError}
              </div>
            ) : unconnectedRepos.length === 0 ? (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", padding: "var(--space-2)" }}>
                All repositories connected
              </div>
            ) : (
              <div className={styles.connectForm}>
                <select
                  value={selectedGithubRepo}
                  onChange={e => setSelectedGithubRepo(e.target.value)}
                  disabled={isConnecting}
                  className={styles.connectSelect}
                  aria-label="Select a repository to connect"
                >
                  <option value="">Select repository…</option>
                  {unconnectedRepos.map(r => (
                    <option key={r.id} value={r.fullName}>
                      {r.fullName}{r.private ? " 🔒" : ""}
                    </option>
                  ))}
                </select>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={handleConnect}
                  disabled={isConnecting || !selectedGithubRepo}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {isConnecting ? (
                    <><span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", animation: "spin 0.6s linear infinite", display: "inline-block" }} /> Connecting…</>
                  ) : (
                    <><Plus size={14} /> Connect Repo</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Repo list */}
          <div className={styles.sidebarSection}>
            <p className={styles.sidebarLabel}>Repositories</p>
            {connectedRepos.length === 0 ? (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", padding: "var(--space-2)" }}>
                No connected repositories
              </div>
            ) : (
              <div className={styles.repoList}>
                {connectedRepos.map(repo => (
                  <div
                    key={repo.id}
                    className={`${styles.repoItem} ${selectedRepoId === repo.id ? styles.repoItemActive : ""}`}
                    onClick={() => { setSelectedRepoId(repo.id); resetRuleForm(); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter") { setSelectedRepoId(repo.id); resetRuleForm(); } }}
                    aria-selected={selectedRepoId === repo.id}
                  >
                    <GitBranch className={styles.repoItemIcon} size={16} />
                    <div className={styles.repoItemBody}>
                      <div className={styles.repoItemName}>{repo.repoFullName.split("/")[1]}</div>
                      <div className={styles.repoItemMeta}>{repo.repoFullName.split("/")[0]}</div>
                    </div>
                    {selectedRepoId === repo.id && <ChevronRight size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className={styles.content}>
          {!selectedRepoId ? (
            <div className={styles.emptyState} style={{ flex: 1 }}>
              <Layers className={styles.emptyIcon} size={48} strokeWidth={1.2} />
              <p className={styles.emptyTitle}>Select a repository</p>
              <p className={styles.emptyDesc}>
                Connect a repository from the sidebar, then select it to manage rules and view webhook events.
              </p>
            </div>
          ) : (
            <>
              {/* Stats row */}
              <div className={styles.statsRow}>
                <div className={styles.statCard}>
                  <p className={styles.statLabel}>Connected Repos</p>
                  <p className={styles.statValue}>{stats ? stats.connectedReposCount : connectedRepos.length}</p>
                </div>
                <div className={styles.statCard}>
                  <p className={styles.statLabel}>Events Ingested</p>
                  <p className={styles.statValue}>{stats ? stats.totalEvents : events.length}</p>
                </div>
                <div className={styles.statCard}>
                  <p className={styles.statLabel}>Active Rules</p>
                  <p className={styles.statValue}>{stats ? stats.activeRulesCount : rules.filter(r => r.enabled).length}</p>
                </div>
                <div className={styles.statCard}>
                  <p className={styles.statLabel}>Success Rate</p>
                  <p className={`${styles.statValue} ${displaySuccessRate >= 80 ? styles.statValueSuccess : displaySuccessRate < 50 ? styles.statValueDanger : ""}`}>
                    {displaySuccessRate}%
                  </p>
                </div>
                <div className={styles.statCard}>
                  <p className={styles.statLabel}>Failed Events</p>
                  <p className={`${styles.statValue} ${displayFailedCount > 0 ? styles.statValueDanger : ""}`}>
                    {displayFailedCount}
                  </p>
                </div>
                <div className={styles.statCard}>
                  <p className={styles.statLabel}>Retry Queue</p>
                  <p className={`${styles.statValue} ${displayRetryQueue > 0 ? styles.statValueDanger : ""}`}>
                    {displayRetryQueue}
                  </p>
                </div>
              </div>

              {/* Repo header */}
              <div className={styles.repoHeader}>
                <div>
                  <div className={styles.repoTitleRow}>
                    <h1 className={styles.repoTitle}>{activeRepo?.repoFullName}</h1>
                  </div>
                  <div className={styles.webhookHealth} style={{ marginTop: 6 }}>
                    <span className={`${styles.healthDot} ${webhookActive ? styles.healthDotActive : styles.healthDotInactive}`} />
                    {webhookActive
                      ? `Webhook active · Last event ${fmtDate(lastEvent.createdAt)}`
                      : "Awaiting first webhook delivery"
                    }
                  </div>
                </div>
                <div className={styles.repoActions}>
                  <button
                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                    onClick={() => setDisconnectConfirm(true)}
                  >
                    Disconnect Repository
                  </button>
                </div>
              </div>

              {/* Extra Stats Observability Cards */}
              {stats && (stats.avgProcessingMs !== null || stats.lastSuccessfulWebhook !== null) && (
                <div className={styles.statsRow} style={{ marginTop: -12 }}>
                  <div className={styles.statCard} style={{ padding: "var(--space-3) var(--space-4)" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", fontWeight: 500 }}>
                      Avg Duration: <strong>{fmtDuration(stats.avgProcessingMs)}</strong>
                    </span>
                  </div>
                  <div className={styles.statCard} style={{ padding: "var(--space-3) var(--space-4)" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", fontWeight: 500 }}>
                      Last Success: <strong>{stats.lastSuccessfulWebhook ? fmtDate(stats.lastSuccessfulWebhook) : "—"}</strong>
                    </span>
                  </div>
                  <div className={styles.statCard} style={{ padding: "var(--space-3) var(--space-4)" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", fontWeight: 500 }}>
                      Last Failure: <strong>{stats.lastFailedWebhook ? fmtDate(stats.lastFailedWebhook) : "—"}</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className={styles.tabs} role="tablist">
                <button
                  role="tab"
                  aria-selected={activeTab === "rules"}
                  className={`${styles.tab} ${activeTab === "rules" ? styles.tabActive : ""}`}
                  onClick={() => setActiveTab("rules")}
                >
                  <Settings size={14} />
                  Automation Rules
                  {rules.length > 0 && (
                    <span style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: "0 6px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                      {rules.length}
                    </span>
                  )}
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === "logs"}
                  className={`${styles.tab} ${activeTab === "logs" ? styles.tabActive : ""}`}
                  onClick={() => setActiveTab("logs")}
                >
                  <Activity size={14} />
                  Event Log
                  {displayFailedCount > 0 && (
                    <span style={{ background: "var(--danger-subtle)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-full)", padding: "0 6px", fontSize: "var(--text-xs)", color: "var(--danger-text)" }}>
                      {displayFailedCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Rules tab */}
              {activeTab === "rules" && (
                <div>
                  {/* Rule form card */}
                  <div className={styles.statCard} style={{ marginBottom: 24 }}>
                    <div style={{ padding: "var(--space-5) var(--space-6)", borderBottom: "1px solid var(--border)" }}>
                      <p style={{ fontWeight: 600, fontSize: "var(--text-md)", color: "var(--text-primary)" }}>
                        {editingRuleId ? "Edit Rule" : "Create New Rule"}
                      </p>
                    </div>
                    <form onSubmit={handleSaveRule} className={styles.ruleForm} style={{ padding: "var(--space-5) var(--space-6)" }}>
                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Trigger Field</label>
                          <select
                            value={matchField}
                            onChange={e => setMatchField(e.target.value)}
                            className={styles.formSelect}
                          >
                            <option value="title">Issue / PR Title</option>
                            <option value="body">Issue / PR Body</option>
                            <option value="branch">Push Branch</option>
                            <option value="author">Author (GitHub login)</option>
                            <option value="aiLabel">AI Suggested Label</option>
                          </select>
                        </div>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Match Keyword</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. bug, hotfix, docs"
                            value={matchValue}
                            onChange={e => setMatchValue(e.target.value)}
                            className={styles.formInput}
                          />
                        </div>
                      </div>

                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Event Type</label>
                          <select
                            value={eventType}
                            onChange={e => setEventType(e.target.value)}
                            className={styles.formSelect}
                          >
                            <option value="all">All Events</option>
                            <option value="issues">Issues only</option>
                            <option value="pull_request">Pull Requests only</option>
                            <option value="push">Push only</option>
                          </select>
                        </div>
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Action</label>
                          <select
                            value={action}
                            onChange={e => setAction(e.target.value)}
                            className={styles.formSelect}
                          >
                            <option value="label">Apply GitHub Label</option>
                            <option value="comment">Post GitHub Comment</option>
                            <option value="slack">Slack Notification</option>
                            <option value="all">Label + Comment + Slack</option>
                          </select>
                        </div>
                      </div>

                      {(action === "label" || action === "all") && (
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Label Name</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. bug, triage, high-priority"
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            className={styles.formInput}
                          />
                        </div>
                      )}

                      {(action === "comment" || action === "all") && (
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Comment Body</label>
                          <textarea
                            required
                            rows={3}
                            placeholder="Thanks for the report! We'll look into this soon."
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            className={styles.formTextarea}
                          />
                        </div>
                      )}

                      {(action === "slack" || action === "all") && (
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>Slack Message Template</label>
                          <textarea
                            required
                            rows={3}
                            value={slackTemplate}
                            onChange={e => setSlackTemplate(e.target.value)}
                            className={styles.formTextarea}
                          />
                          <p className={styles.formHint}>
                            Placeholders: <code>{`{event}`}</code>, <code>{`{repo}`}</code>, <code>{`{title}`}</code>, <code>{`{author}`}</code>, <code>{`{url}`}</code>
                          </p>
                        </div>
                      )}

                      <div className={styles.formActions}>
                        <button
                          type="submit"
                          disabled={isSubmittingRule}
                          className={`${styles.btn} ${styles.btnPrimary}`}
                        >
                          {isSubmittingRule ? "Saving…" : editingRuleId ? "Update Rule" : "Create Rule"}
                        </button>
                        {editingRuleId && (
                          <button
                            type="button"
                            onClick={resetRuleForm}
                            className={`${styles.btn} ${styles.btnSecondary}`}
                          >
                            Cancel
                          </button>
                        )}
                        {ruleFormMsg && (
                          <span style={{ fontSize: "var(--text-sm)", color: ruleFormMsg.isError ? "var(--danger)" : "var(--success)" }}>
                            {ruleFormMsg.text}
                          </span>
                        )}
                      </div>
                    </form>
                  </div>

                  {/* Rules list */}
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "var(--text-md)", color: "var(--text-primary)", marginBottom: 12 }}>
                      Configured Rules
                    </p>
                    {rulesLoading ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[1,2,3].map(i => (
                          <div key={i} className={styles.ruleCard}>
                            <div className={styles.skeleton} style={{ width: 200, height: 16 }} />
                            <div className={styles.skeleton} style={{ width: 120, height: 14, marginTop: 4 }} />
                          </div>
                        ))}
                      </div>
                    ) : rules.length === 0 ? (
                      <div className={styles.emptyState} style={{ padding: "var(--space-10)" }}>
                        <Zap className={styles.emptyIcon} size={36} strokeWidth={1.2} />
                        <p className={styles.emptyTitle}>No rules yet</p>
                        <p className={styles.emptyDesc}>Create a rule above to start automating label, comment, and Slack actions on incoming webhook events.</p>
                      </div>
                    ) : (
                      <div className={styles.rulesList}>
                        {rules.map(rule => (
                          <div
                            key={rule.id}
                            className={`${styles.ruleCard} ${!rule.enabled ? styles.ruleCardDisabled : ""}`}
                          >
                            <div className={styles.ruleCardBody}>
                              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-4)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ background: "var(--accent-subtle)", color: "var(--accent-text)", border: "1px solid var(--accent-border)", fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "var(--radius-sm)", textTransform: "uppercase", letterSpacing: "0.02em" }}>IF</span>
                                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                                    {rule.matchField === "title" ? "Issue/PR Title" :
                                     rule.matchField === "body" ? "Issue/PR Body" :
                                     rule.matchField === "branch" ? "Git Branch" :
                                     rule.matchField === "author" ? "Event Creator" : "AI Suggested Category"}
                                  </span>
                                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>contains</span>
                                  <span className={styles.ruleConditionCode}>"{rule.matchValue}"</span>
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ background: "var(--success-subtle)", color: "var(--success-text)", border: "1px solid var(--success-border)", fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "var(--radius-sm)", textTransform: "uppercase", letterSpacing: "0.02em" }}>THEN</span>
                                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 500 }}>
                                    {rule.action === "label" ? `Apply label "${rule.label}"` :
                                     rule.action === "comment" ? "Post issue comment" :
                                     rule.action === "slack" ? "Send Slack alert" :
                                     `Apply label "${rule.label}" + post comment + alert Slack`}
                                  </span>
                                </div>
                              </div>
                              {rule.eventType !== "all" && (
                                <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
                                  <span>Scope:</span>
                                  <span className={styles.ruleConditionCode}>{rule.eventType === "pull_request" ? "Pull Requests" : rule.eventType === "issues" ? "Issues" : rule.eventType}</span>
                                </div>
                              )}
                            </div>
                            <div className={styles.ruleCardActions}>
                              <Toggle
                                checked={rule.enabled}
                                onChange={() => handleToggleRule(rule)}
                                label={`${rule.enabled ? "Disable" : "Enable"} rule`}
                              />
                              <button
                                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                onClick={() => handleDuplicateRule(rule)}
                                title="Duplicate rule"
                                aria-label="Duplicate rule"
                              >
                                <Copy size={13} />
                              </button>
                              <button
                                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                onClick={() => handleStartEdit(rule)}
                                title="Edit rule"
                                aria-label="Edit rule"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                                onClick={() => setDeleteConfirm(rule.id)}
                                title="Delete rule"
                                aria-label="Delete rule"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Logs tab */}
              {activeTab === "logs" && (
                <div className={styles.statCard} style={{ overflow: "hidden" }}>
                  {/* Toolbar */}
                  <div className={styles.logToolbar}>
                    <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
                      <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
                      <input
                        type="text"
                        placeholder="Search by ID, type, status, summary…"
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
                        className={styles.logSearch}
                        style={{ paddingLeft: 30 }}
                        aria-label="Search events"
                      />
                    </div>
                    <select
                      value={filterStatus}
                      onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
                      className={styles.logFilter}
                      aria-label="Filter by status"
                    >
                      <option value="all">All statuses</option>
                      <option value="done">Done</option>
                      <option value="failed">Failed</option>
                      <option value="processing">Processing</option>
                      <option value="received">Received</option>
                    </select>
                    <select
                      value={filterEventType}
                      onChange={e => { setFilterEventType(e.target.value); setPage(0); }}
                      className={styles.logFilter}
                      aria-label="Filter by event type"
                    >
                      <option value="all">All types</option>
                      <option value="issues">Issues</option>
                      <option value="pull_request">Pull Request</option>
                      <option value="push">Push</option>
                    </select>
                    <button
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                      onClick={fetchEvents}
                      disabled={eventsLoading}
                      title="Refresh (R)"
                      aria-label="Refresh events"
                    >
                      <RefreshCw size={13} style={eventsLoading ? { animation: "spin 0.6s linear infinite" } : {}} />
                      Refresh
                    </button>
                  </div>

                  {/* Table */}
                  <div style={{ overflowX: "auto" }}>
                    <table className={styles.logTable}>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Event</th>
                          <th>Status</th>
                          <th>Delivery ID</th>
                          <th>AI Insights</th>
                          <th>Duration</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eventsLoading && events.length === 0 ? (
                          <>{[1,2,3,4,5].map(i => <SkeletonRow key={i} />)}</>
                        ) : pagedEvents.length === 0 ? (
                          <tr>
                            <td colSpan={7}>
                              <div className={styles.emptyState}>
                                <Activity className={styles.emptyIcon} size={32} strokeWidth={1.2} />
                                <p className={styles.emptyTitle}>No events found</p>
                                <p className={styles.emptyDesc}>
                                  {searchQuery || filterStatus !== "all" || filterEventType !== "all"
                                    ? "Try adjusting your search or filters."
                                    : "Open an issue, PR, or push a commit to your connected repo to see events here."}
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          pagedEvents.map(event => (
                            <>
                              <tr
                                key={event.id}
                                className={expandedRow === event.id ? styles.expandedRow : ""}
                                onClick={() => setExpandedRow(expandedRow === event.id ? null : event.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === "Enter") setExpandedRow(expandedRow === event.id ? null : event.id); }}
                                aria-expanded={expandedRow === event.id}
                              >
                                <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
                                  {fmtDate(event.createdAt)}
                                </td>
                                <td>
                                  <EventTypeBadge type={event.eventType} />
                                </td>
                                <td>
                                  <StatusBadge status={event.status} />
                                  {event.status === "failed" && event.retryCount > 0 && (
                                    <div style={{ fontSize: "var(--text-xs)", color: "var(--danger)", marginTop: 2 }}>
                                      Retry {event.retryCount}/5
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                                      {event.deliveryId.substring(0, 8)}…
                                    </span>
                                    <CopyButton text={event.deliveryId} />
                                  </div>
                                </td>
                                <td>
                                  {event.aiLabel || event.aiPriority ? (
                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                      {event.aiLabel && (
                                        <span style={{ background: "#f5f3ff", color: "#6d28d9", border: "1px solid #ddd6fe", borderRadius: "var(--radius-full)", padding: "1px 7px", fontSize: "var(--text-xs)", fontWeight: 600 }}>
                                          {event.aiLabel}
                                        </span>
                                      )}
                                      <PriorityBadge p={event.aiPriority} />
                                    </div>
                                  ) : (
                                    <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>—</span>
                                  )}
                                </td>
                                <td style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
                                  {fmtDuration(event.processingMs)}
                                </td>
                                <td>
                                  <div
                                    title={event.error || ""}
                                    style={{
                                      fontSize: "var(--text-xs)",
                                      color: event.status === "failed" ? "var(--danger)" : "var(--text-tertiary)",
                                      maxWidth: 200,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {event.error || "—"}
                                  </div>
                                </td>
                              </tr>

                              {expandedRow === event.id && (
                                <tr key={`${event.id}-expanded`} className={styles.expandedDetail}>
                                  <td colSpan={7} style={{ padding: 0 }}>
                                    <div className={styles.expandedDetailInner}>
                                      {/* AI card */}
                                      {(event.aiSummary || event.aiLabel) && (
                                        <div>
                                          <div className={styles.aiCard}>
                                            <div className={styles.aiCardHeader}>
                                              <Bot size={13} />
                                              AI Triage
                                            </div>
                                            {event.aiLabel && <p className={styles.aiField}><span className={styles.aiFieldLabel}>Label:</span> {event.aiLabel}</p>}
                                            {event.aiPriority && <p className={styles.aiField}><span className={styles.aiFieldLabel}>Priority:</span> {event.aiPriority}</p>}
                                            {event.aiSummary && <p className={styles.aiField}><span className={styles.aiFieldLabel}>Summary:</span> {event.aiSummary}</p>}
                                            {event.aiReasoning && <p className={styles.aiField}><span className={styles.aiFieldLabel}>Reasoning:</span> {event.aiReasoning}</p>}
                                            {event.aiConfidence != null && <p className={styles.aiField}><span className={styles.aiFieldLabel}>Confidence:</span> {Math.round(event.aiConfidence * 100)}%</p>}
                                          </div>
                                          {event.error && (
                                            <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--danger-subtle)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius)", fontSize: "var(--text-xs)", color: "var(--danger-text)", fontFamily: "var(--font-mono)" }}>
                                              {event.error}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {/* Payload */}
                                      <div>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                          <h4 style={{ fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)" }}>
                                            Payload
                                          </h4>
                                          <CopyButton text={JSON.stringify(event.payload, null, 2)} />
                                        </div>
                                        <pre className={styles.jsonViewer}>
                                          {JSON.stringify(event.payload, null, 2)}
                                        </pre>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className={styles.pagination}>
                      <button
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        Previous
                      </button>
                      <span className={styles.pageInfo}>
                        Page {page + 1} of {totalPages} · {filteredEvents.length} events
                      </span>
                      <button
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <ConfirmDialog
          title="Delete rule?"
          desc="This rule will be permanently removed and no longer match incoming webhook events."
          confirmLabel="Delete rule"
          danger
          onConfirm={() => handleDeleteRule(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {/* Disconnect repository dialog */}
      {disconnectConfirm && (
        <ConfirmDialog
          title="Disconnect Repository?"
          desc={`Are you sure you want to disconnect ${activeRepo?.repoFullName}? GitAutomate will remove its registered webhook from GitHub and delete all rules associated with it.`}
          confirmLabel="Disconnect Repository"
          danger
          onConfirm={handleDisconnectRepo}
          onCancel={() => setDisconnectConfirm(false)}
        />
      )}

      {/* Toast container */}
      <ToastContainer toasts={toasts} dismiss={dismissToast} />

      {/* Spin keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
