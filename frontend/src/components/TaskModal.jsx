import React, { useState } from "react";
import { api } from "./../api";

export default function TaskModal({ task, allTasks, onClose, onSaved }) {
  const isNew = task === null;
  const existing = task || {};

  const [title, setTitle] = useState(existing.title || "");
  const [description, setDescription] = useState(existing.description || "");
  const [startDate, setStartDate] = useState(
    existing.startDate || new Date().toISOString().slice(0, 10)
  );
  const [duration, setDuration] = useState(existing.duration || 3);
  const [selectedPrereqs, setSelectedPrereqs] = useState(
    new Set(existing.prerequisiteIds || [])
  );
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [aiError, setAiError] = useState(null);

  const otherTasks = allTasks.filter((t) => t.id !== existing.id);

  const togglePrereq = (id) => {
    setSelectedPrereqs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const runAiSuggest = async () => {
    if (!title.trim()) {
      setAiError("Add a title first so the AI has something to work with.");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.suggestDependencies(title, description);
      setSuggestions(res.suggestions || []);
      if ((res.suggestions || []).length === 0) {
        setAiError("No confident prerequisite suggestions found.");
      }
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  const acceptSuggestion = (s) => {
    setSelectedPrereqs((prev) => new Set(prev).add(s.id));
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  };
  const rejectSuggestion = (s) => {
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  };

  const save = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await api.createTask({
          title,
          description,
          startDate,
          duration: Number(duration),
          prerequisiteIds: [...selectedPrereqs],
        });
      } else {
        await api.updateTask(existing.id, {
          title,
          description,
          startDate,
          duration: Number(duration),
        });

        const before = new Set(existing.prerequisiteIds || []);
        const toAdd = [...selectedPrereqs].filter((id) => !before.has(id));
        const toRemove = [...before].filter((id) => !selectedPrereqs.has(id));

        for (const id of toAdd) {
          await api.addDependency(existing.id, id); // server rejects cycles with 409
        }
        for (const id of toRemove) {
          await api.removeDependency(existing.id, id);
        }
      }
      onSaved();
    } catch (e) {
      setError(e.message); // e.g. cycle-rejection message from the server
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${existing.title}"? This also removes its dependency links.`)) return;
    await api.deleteTask(existing.id);
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? "New Task" : "Edit Task"}</h2>

        {error && <div className="banner error">{error}</div>}

        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backend API" />

        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What is this task about?"
        />

        <div className="row">
          <div>
            <label>Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label>Duration (days)</label>
            <input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>

        <div className="prereq-section">
          <div className="prereq-header">
            <label>Prerequisites</label>
            <button type="button" className="ghost small" onClick={runAiSuggest} disabled={aiLoading}>
              {aiLoading ? "Thinking…" : "✨ Suggest with AI"}
            </button>
          </div>

          {aiError && <div className="hint">{aiError}</div>}

          {suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((s) => (
                <div key={s.id} className="suggestion">
                  <div>
                    <strong>{s.title}</strong>
                    <span className="confidence"> {Math.round(s.confidence * 100)}% confident</span>
                    <div className="reasoning">{s.reasoning}</div>
                  </div>
                  <div className="suggestion-actions">
                    <button type="button" onClick={() => acceptSuggestion(s)}>Accept</button>
                    <button type="button" className="ghost" onClick={() => rejectSuggestion(s)}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="prereq-list">
            {otherTasks.length === 0 && <div className="hint">No other tasks yet.</div>}
            {otherTasks.map((t) => (
              <label key={t.id} className="prereq-item">
                <input
                  type="checkbox"
                  checked={selectedPrereqs.has(t.id)}
                  onChange={() => togglePrereq(t.id)}
                />
                {t.title}
              </label>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
