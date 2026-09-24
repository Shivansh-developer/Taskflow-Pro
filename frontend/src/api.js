const BASE = "/api";

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  listTasks: () => fetch(`${BASE}/tasks`).then(handle),
  criticalPath: () => fetch(`${BASE}/tasks/critical-path`).then(handle),
  createTask: (payload) =>
    fetch(`${BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(handle),
  updateTask: (id, payload) =>
    fetch(`${BASE}/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(handle),
  deleteTask: (id) => fetch(`${BASE}/tasks/${id}`, { method: "DELETE" }),
  addDependency: (taskId, prerequisiteId) =>
    fetch(`${BASE}/tasks/${taskId}/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prerequisiteId }),
    }).then(handle),
  removeDependency: (taskId, prerequisiteId) =>
    fetch(`${BASE}/tasks/${taskId}/dependencies/${prerequisiteId}`, {
      method: "DELETE",
    }).then(handle),
  suggestDependencies: (title, description) =>
    fetch(`${BASE}/ai/suggest-dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    }).then(handle),
};
