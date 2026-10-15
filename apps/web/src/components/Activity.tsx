import type { ActivityProps, ToolActivity } from "../types.ts";

const labels: Record<ToolActivity["status"], string> = {
  requested: "Requested",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  unknown: "Outcome unknown",
};
const icons = { requested: "○", running: "◌", completed: "✓", failed: "✕", unknown: "?" };

export function Activity({ activities }: ActivityProps) {
  return (
    <div className="tool-activity" aria-label="Tool activity">
      <div className="activity-label">Activity</div>
      {activities.map((activity) => (
        <details className="tool-action" key={activity.id}>
          <summary>
            <span className="tool-icon" aria-hidden="true">
              {icons[activity.status]}
            </span>
            <span className="tool-name">
              {activity.name}
              {activity.target ? " · " + activity.target : ""}
            </span>
            <span className="tool-status">{labels[activity.status]}</span>
          </summary>
          {activity.detail && <p className="tool-detail">{activity.detail}</p>}
        </details>
      ))}
    </div>
  );
}
