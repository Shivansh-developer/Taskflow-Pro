import React, { useEffect, useState, useCallback } from "react";
import { DragDropContext } from "@hello-pangea/dnd";
import { api } from "./api";
import Column from "./components/Column";
import TaskModal from "./components/TaskModal";

const COLUMNS = [
  { id: "backlog", title: "Backlog" },
  { id: "in_progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalTask, setModalTask] = useState(undefined); // undefined = closed, null = "new"
  const [criticalIds, setCriticalIds] = useState(new Set());
  const [showCritical, setShowCritical] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTasks();
      setTasks(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleCriticalPath = async () => {
    if (!showCritical) {
      try {
        const cp = await api.criticalPath();
        setCriticalIds(new Set(cp.taskIds));
      } catch (e) {
        setError(e.message);
      }
    }
    setShowCritical((s) => !s);
  };

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    // Optimistic UI update
    const prevTasks = tasks;
    const moved = tasks.find((t) => t.id === draggableId);
    const newStatus = destination.droppableId;
    const optimistic = tasks.map((t) =>
      t.id === draggableId ? { ...t, status: newStatus } : t
    );
    setTasks(optimistic);

    try {
      await api.updateTask(draggableId, {
        status: newStatus,
        position: destination.index,
      });
      await refresh(); // pick up any recomputed blocked/ready + propagated dates
    } catch (e) {
      setTasks(prevTasks); // rollback on failure
      setError(e.message);
    }
  };

  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.id] = tasks
      .filter((t) => t.status === col.id)
      .sort((a, b) => a.position - b.position);
    return acc;
  }, {});

  return (
    <div className="app">
      <header className="app-header">
        <h1>TaskFlow Pro</h1>
        <div className="header-actions">
          <button className={`ghost ${showCritical ? "active" : ""}`} onClick={toggleCriticalPath}>
            {showCritical ? "Hide" : "Show"} Critical Path
          </button>
          <button className="primary" onClick={() => setModalTask(null)}>
            + New Task
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {loading ? (
        <div className="banner">Loading board…</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="board">
            {COLUMNS.map((col) => (
              <Column
                key={col.id}
                column={col}
                tasks={grouped[col.id] || []}
                allTasks={tasks}
                criticalIds={showCritical ? criticalIds : new Set()}
                onTaskClick={(t) => setModalTask(t)}
              />
            ))}
          </div>
        </DragDropContext>
      )}

      {modalTask !== undefined && (
        <TaskModal
          task={modalTask}
          allTasks={tasks}
          onClose={() => setModalTask(undefined)}
          onSaved={async () => {
            setModalTask(undefined);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
