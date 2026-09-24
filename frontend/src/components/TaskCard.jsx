import React from "react";
import { Draggable } from "@hello-pangea/dnd";

export default function TaskCard({ task, index, allTasks, isCritical, onClick }) {
  const prereqTitles = (task.prerequisiteIds || [])
    .map((id) => allTasks.find((t) => t.id === id)?.title)
    .filter(Boolean);

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`task-card ${snapshot.isDragging ? "dragging" : ""} ${
            isCritical ? "critical" : ""
          }`}
          onClick={onClick}
        >
          <div className="task-title">{task.title}</div>
          {task.status !== "done" && (
            <span className={`badge ${task.blocked ? "blocked" : "ready"}`}>
              {task.blocked ? "Blocked" : "Ready"}
            </span>
          )}
          <div className="task-dates">
            {task.startDate} → {task.endDate} ({task.duration}d)
          </div>
          {prereqTitles.length > 0 && (
            <div className="task-prereqs" title={prereqTitles.join(", ")}>
              ⛓ {prereqTitles.length} prereq{prereqTitles.length > 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}
