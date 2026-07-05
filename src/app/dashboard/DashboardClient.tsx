"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import styles from "./dashboard.module.css";

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  url: string;
  private: boolean;
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
  matchField: string;
  matchValue: string;
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
  aiSummary: string | null;
  aiLabel: string | null;
  createdAt: string;
}

interface DashboardClientProps {
  user: {
    name: string;
    email: string;
    image: string;
  };
  githubRepos: GitHubRepo[];
  connectedRepos: ConnectedRepo[];
  initialEvents: WebhookEvent[];
  fetchError: string | null;
}

export default function DashboardClient({
  user,
  githubRepos,
  connectedRepos: initialConnectedRepos,
  initialEvents,
  fetchError,
}: DashboardClientProps) {
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>(initialConnectedRepos);
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"rules" | "logs">("rules");
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>(initialEvents);
  
  // Connection states
  const [selectedGithubRepo, setSelectedGithubRepo] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectMessage, setConnectMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Rule Form / Edit states
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [matchField, setMatchField] = useState<string>("title");
  const [matchValue, setMatchValue] = useState<string>("");
  const [action, setAction] = useState<string>("label");
  const [label, setLabel] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [slackTemplate, setSlackTemplate] = useState<string>(
    "🔔 *{event}* event triggered on repo *{repo}* by {author}.\nTitle: {title}\nLink: {url}"
  );
  const [isSubmittingRule, setIsSubmittingRule] = useState<boolean>(false);
  const [ruleMessage, setRuleMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Active connected repo object
  const activeRepo = connectedRepos.find(r => r.id === selectedRepoId);

  // Load rules when repository selection changes
  useEffect(() => {
    if (!selectedRepoId) return;

    const fetchRules = async () => {
      try {
        const res = await fetch(`/api/rules?repoId=${selectedRepoId}`);
        if (res.ok) {
          const data = await res.json();
          setRules(data);
        }
      } catch (err) {
        console.error("Error fetching rules:", err);
      }
    };

    const fetchRepoEvents = async () => {
      try {
        const res = await fetch(`/api/events?repoId=${selectedRepoId}`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data);
        }
      } catch (err) {
        console.error("Error fetching events:", err);
      }
    };

    fetchRules();
    fetchRepoEvents();
    handleCancelEdit(); // reset rule form on repo switch
  }, [selectedRepoId]);

  // Periodic events logging polling (every 10 seconds if tab is logs)
  useEffect(() => {
    if (!selectedRepoId || activeTab !== "logs") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/events?repoId=${selectedRepoId}`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data);
        }
      } catch (err) {
        console.error("Error refreshing events:", err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [selectedRepoId, activeTab]);

  // Handle repository connection
  const handleConnectRepo = async () => {
    if (!selectedGithubRepo) return;
    setIsConnecting(true);
    setConnectMessage(null);

    try {
      const res = await fetch("/api/repos/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: selectedGithubRepo }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to connect repository");
      }

      setConnectedRepos(prev => [
        {
          id: data.repo.id,
          userId: data.repo.userId,
          repoFullName: data.repo.repoFullName,
          webhookId: data.repo.webhookId,
          createdAt: data.repo.createdAt,
        },
        ...prev,
      ]);
      setSelectedRepoId(data.repo.id);
      setSelectedGithubRepo("");
      setConnectMessage({ text: `Successfully connected ${data.repo.repoFullName}!`, isError: false });
    } catch (err: any) {
      setConnectMessage({ text: err.message || "An error occurred", isError: true });
    } finally {
      setIsConnecting(false);
    }
  };

  // Rule Form Edit Handlers
  const handleStartEditRule = (rule: Rule) => {
    setEditingRuleId(rule.id);
    setMatchField(rule.matchField);
    setMatchValue(rule.matchValue);
    setAction(rule.action);
    setLabel(rule.label || "");
    setComment(rule.comment || "");
    setSlackTemplate(rule.slackMessageTemplate || "");
    setRuleMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingRuleId(null);
    setMatchField("title");
    setMatchValue("");
    setAction("label");
    setLabel("");
    setComment("");
    setSlackTemplate("🔔 *{event}* event triggered on repo *{repo}* by {author}.\nTitle: {title}\nLink: {url}");
    setRuleMessage(null);
  };

  // Handle adding or updating a rule
  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoId || !matchValue) return;
    setIsSubmittingRule(true);
    setRuleMessage(null);

    const isEditing = !!editingRuleId;
    const url = "/api/rules";
    const method = isEditing ? "PUT" : "POST";
    const body = {
      id: editingRuleId,
      repoId: selectedRepoId,
      matchField,
      matchValue,
      action,
      label: (action === "label" || action === "all") ? label : null,
      comment: (action === "comment" || action === "all") ? comment : null,
      slackMessageTemplate: (action === "slack" || action === "all") ? slackTemplate : null,
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save rule");
      }

      if (isEditing) {
        setRules(prev => prev.map(r => r.id === data.id ? data : r));
        setRuleMessage({ text: "Rule updated successfully!", isError: false });
        handleCancelEdit();
      } else {
        setRules(prev => [data, ...prev]);
        setMatchValue("");
        setLabel("");
        setComment("");
        setRuleMessage({ text: "Rule created successfully!", isError: false });
      }
    } catch (err: any) {
      setRuleMessage({ text: err.message || "Failed to save rule", isError: true });
    } finally {
      setIsSubmittingRule(false);
    }
  };

  // Handle deleting a rule
  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;

    try {
      const res = await fetch(`/api/rules?id=${ruleId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete rule");
      }

      setRules(prev => prev.filter(r => r.id !== ruleId));
      if (editingRuleId === ruleId) {
        handleCancelEdit();
      }
    } catch (err: any) {
      alert(err.message || "An error occurred while deleting the rule");
    }
  };

  // Filter out GitHub repositories that are already connected
  const unconnectedGithubRepos = githubRepos.filter(
    gr => !connectedRepos.some(cr => cr.repoFullName === gr.fullName)
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoInfo}>
          <span className={styles.botIcon}>🤖</span>
          <span className={styles.logoText}>GitAutomate Dashboard</span>
        </div>
        <div className={styles.userInfo}>
          <div className={styles.userProfile}>
            {user.image && (
              <img
                src={user.image}
                alt={user.name}
                width={32}
                height={32}
                className={styles.avatar}
              />
            )}
            <span className={styles.userName}>{user.name}</span>
          </div>
          <button className={styles.signOutBtn} onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign Out
          </button>
        </div>
      </header>

      <div className={styles.mainLayout}>
        <aside className={styles.sidebar}>
          <div className={styles.connectSection}>
            <h2 className={styles.sectionTitle}>Connect Repository</h2>
            {fetchError ? (
              <div style={{ fontSize: "12px", color: "#f87171", marginBottom: "8px" }}>{fetchError}</div>
            ) : unconnectedGithubRepos.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#6b7280", fontStyle: "italic" }}>No new repositories to connect</div>
            ) : (
              <div>
                <select
                  value={selectedGithubRepo}
                  onChange={e => setSelectedGithubRepo(e.target.value)}
                  disabled={isConnecting}
                >
                  <option value="">Select a repository...</option>
                  {unconnectedGithubRepos.map(gr => (
                    <option key={gr.id} value={gr.fullName}>
                      {gr.fullName} {gr.private ? "🔒" : ""}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.btnPrimary}
                  onClick={handleConnectRepo}
                  disabled={isConnecting || !selectedGithubRepo}
                >
                  {isConnecting ? "Connecting..." : "Connect Repo"}
                </button>
              </div>
            )}
            {connectMessage && (
              <div
                style={{
                  fontSize: "12px",
                  marginTop: "8px",
                  color: connectMessage.isError ? "#f87171" : "#34d399",
                }}
              >
                {connectMessage.text}
              </div>
            )}
          </div>

          <div>
            <h2 className={styles.sectionTitle}>Connected Repositories</h2>
            {connectedRepos.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#6b7280", fontStyle: "italic", textAlign: "center", padding: "12px" }}>
                No connected repositories yet
              </div>
            ) : (
              <div className={styles.repoList}>
                {connectedRepos.map(repo => (
                  <div
                    key={repo.id}
                    className={`${styles.repoItem} ${
                      selectedRepoId === repo.id ? styles.repoItemActive : ""
                    }`}
                    onClick={() => setSelectedRepoId(repo.id)}
                  >
                    <div className={styles.repoItemName}>{repo.repoFullName}</div>
                    <div className={styles.repoItemMeta}>
                      Connected on {new Date(repo.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className={styles.contentArea}>
          {!selectedRepoId ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🤖</span>
              <h2>Welcome to GitAutomate</h2>
              <p style={{ marginTop: "8px", maxWidth: "460px" }}>
                Select a connected repository from the left sidebar to edit automation rules or view webhook ingestion event logs. If you haven't connected any yet, select one from the dropdown above.
              </p>
            </div>
          ) : (
            <div className={styles.dashboardGrid}>
              <div className={styles.repoHeader}>
                <h1 className={styles.repoTitle}>{activeRepo?.repoFullName}</h1>
                <div className={styles.tabs}>
                  <button
                    className={`${styles.tab} ${activeTab === "rules" ? styles.tabActive : ""}`}
                    onClick={() => setActiveTab("rules")}
                  >
                    Automation Rules
                  </button>
                  <button
                    className={`${styles.tab} ${activeTab === "logs" ? styles.tabActive : ""}`}
                    onClick={() => setActiveTab("logs")}
                  >
                    Ingested Event Logs
                  </button>
                </div>
              </div>

              {activeTab === "rules" ? (
                <div>
                  <div className={styles.card}>
                    <h2 className={styles.cardTitle}>{editingRuleId ? "Edit Rule" : "Create New Rule"}</h2>
                    <form onSubmit={handleSaveRule} className={styles.ruleForm}>
                      <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                          <label>Match Trigger Field</label>
                          <select value={matchField} onChange={e => setMatchField(e.target.value)}>
                            <option value="title">Issue / PR Title</option>
                            <option value="body">Issue / PR Body</option>
                            <option value="branch">Push Branch Name</option>
                          </select>
                        </div>
                        <div className={styles.formGroup}>
                          <label>Match Substring (Case-Insensitive)</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. bug, hotfix, docs"
                            value={matchValue}
                            onChange={e => setMatchValue(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className={styles.formGroup}>
                        <label>Action to Take</label>
                        <select value={action} onChange={e => setAction(e.target.value)}>
                          <option value="label">Apply GitHub Label</option>
                          <option value="comment">Create GitHub Comment</option>
                          <option value="slack">Trigger Slack Notification</option>
                          <option value="all">Apply Label + Comment + Slack Alert</option>
                        </select>
                      </div>

                      {(action === "label" || action === "all") && (
                        <div className={styles.formGroup}>
                          <label>GitHub Label Name</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. bug, triage, high-priority"
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                          />
                        </div>
                      )}

                      {(action === "comment" || action === "all") && (
                        <div className={styles.formGroup}>
                          <label>GitHub Comment Body</label>
                          <textarea
                            required
                            rows={3}
                            placeholder="Hello! A rule matched this issue/PR, so we are automatically responding..."
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                          />
                        </div>
                      )}

                      {(action === "slack" || action === "all") && (
                        <div className={styles.formGroup}>
                          <label>Slack Message Template</label>
                          <textarea
                            required
                            rows={3}
                            value={slackTemplate}
                            onChange={e => setSlackTemplate(e.target.value)}
                          />
                          <div className={styles.formHelper}>
                            Placeholders: <code>{`{event}`}</code>, <code>{`{repo}`}</code>, <code>{`{title}`}</code>, <code>{`{author}`}</code>, <code>{`{url}`}</code>
                          </div>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "12px" }}>
                        <button type="submit" disabled={isSubmittingRule} className={styles.btnPrimary}>
                          {isSubmittingRule ? "Saving..." : (editingRuleId ? "Update Rule" : "Save Rule")}
                        </button>
                        {editingRuleId && (
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className={styles.signOutBtn}
                            style={{ background: "rgba(255,255,255,0.05)", color: "#fff", borderColor: "rgba(255,255,255,0.1)", flex: "1" }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>

                      {ruleMessage && (
                        <div
                          style={{
                            fontSize: "13px",
                            color: ruleMessage.isError ? "#f87171" : "#34d399",
                          }}
                        >
                          {ruleMessage.text}
                        </div>
                      )}
                    </form>
                  </div>

                  <div style={{ marginTop: "24px" }}>
                    <h2 className={styles.cardTitle}>Configured Rules</h2>
                    {rules.length === 0 ? (
                      <div style={{ fontSize: "14px", color: "#6b7280", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                        No automation rules configured for this repo yet. Add one above!
                      </div>
                    ) : (
                      <div className={styles.rulesList}>
                        {rules.map(rule => (
                          <div key={rule.id} className={styles.ruleItem}>
                            <div className={styles.ruleInfo}>
                              <div className={styles.ruleCondition}>
                                If <code style={{ color: "#a78bfa" }}>{rule.matchField}</code> contains{" "}
                                <code style={{ color: "#34d399" }}>"{rule.matchValue}"</code>
                              </div>
                              <div className={styles.ruleActionLabel}>
                                Action: {rule.action.toUpperCase()}{" "}
                                {rule.label && `[Label: "${rule.label}"]`}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                className={styles.signOutBtn}
                                style={{ background: "rgba(255, 255, 255, 0.05)", color: "#fff", borderColor: "rgba(255, 255, 255, 0.1)", padding: "6px 12px", fontSize: "12px", borderRadius: "4px" }}
                                onClick={() => handleStartEditRule(rule)}
                              >
                                Edit
                              </button>
                              <button
                                className={styles.btnDanger}
                                onClick={() => handleDeleteRule(rule.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={styles.card} style={{ padding: "0", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}>
                    <h2 style={{ fontSize: "16px", fontWeight: "600", margin: "0", color: "#fff" }}>Ingested Deliveries (Latest 50)</h2>
                    <button
                      className={styles.signOutBtn}
                      style={{ background: "rgba(255, 255, 255, 0.05)", color: "#fff", borderColor: "rgba(255, 255, 255, 0.1)" }}
                      onClick={async () => {
                        const res = await fetch(`/api/events?repoId=${selectedRepoId}`);
                        if (res.ok) {
                          const data = await res.json();
                          setEvents(data);
                        }
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                  {events.length === 0 ? (
                    <div style={{ fontSize: "14px", color: "#6b7280", fontStyle: "italic", textAlign: "center", padding: "40px" }}>
                      No events received yet. Make a push, open an issue, or create a pull request on your GitHub repo!
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className={styles.logsTable}>
                        <thead>
                          <tr>
                            <th>Received At</th>
                            <th>Event</th>
                            <th>Status</th>
                            <th>Delivery ID</th>
                            <th>AI Insights</th>
                            <th>Actions taken / Errors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {events.map(event => (
                            <tr key={event.id}>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {new Date(event.createdAt).toLocaleString()}
                              </td>
                              <td style={{ fontWeight: "600", textTransform: "capitalize" }}>
                                {event.eventType}
                              </td>
                              <td>
                                <span
                                  className={`${styles.badge} ${
                                    event.status === "received"
                                      ? styles.badgeReceived
                                      : event.status === "processing"
                                      ? styles.badgeProcessing
                                      : event.status === "done"
                                      ? styles.badgeDone
                                      : styles.badgeFailed
                                  }`}
                                >
                                  {event.status}
                                </span>
                                {event.status === "failed" && event.retryCount > 0 && (
                                  <div style={{ fontSize: "10px", color: "#f87171", marginTop: "2px" }}>
                                    Retry #{event.retryCount}/5
                                  </div>
                                )}
                              </td>
                              <td style={{ fontFamily: "monospace", color: "#9ca3af", fontSize: "12px" }}>
                                {event.deliveryId.substring(0, 8)}...
                              </td>
                              <td>
                                {event.aiLabel || event.aiSummary ? (
                                  <div style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {event.aiLabel && (
                                      <div>
                                        <span style={{ background: "rgba(167, 139, 250, 0.15)", color: "#a78bfa", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "600", textTransform: "lowercase" }}>
                                          {event.aiLabel}
                                        </span>
                                      </div>
                                    )}
                                    {event.aiSummary && (
                                      <div style={{ color: "#9ca3af", fontStyle: "italic", fontSize: "11px", maxWidth: "200px" }}>
                                        "{event.aiSummary}"
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: "#4b5563", fontSize: "12px" }}>n/a</span>
                                )}
                              </td>
                              <td>
                                <div
                                  title={event.error || ""}
                                  style={{
                                    fontSize: "12px",
                                    color: event.status === "failed" ? "#f87171" : "#34d399",
                                    whiteSpace: "pre-wrap",
                                    fontFamily: "monospace",
                                    maxHeight: "60px",
                                    overflowY: "auto",
                                  }}
                                >
                                  {event.error || "Stored in received state"}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
