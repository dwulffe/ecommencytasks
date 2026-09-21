export type Priority = "High" | "Medium" | "Low";

export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export type Role = "admin" | "employee";

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  /** Optional contact email or domain used to match inbound emails to this client. */
  email: string;
  createdAt: string;
}

export interface Suggestion {
  id: string;
  clientId: string;
  title: string;
  priority: Priority;
  dueDate: string;
  /** Subject line of the email this came from, for context in the review UI. */
  sourceSubject: string;
  /** Who the email was from. */
  sourceFrom: string;
  createdAt: string;
}

export interface Task {
  id: string;
  clientId: string;
  title: string;
  priority: Priority;
  /** ISO date string (YYYY-MM-DD) or empty string if none. */
  dueDate: string;
  done: boolean;
  createdAt: string;
  completedAt: string;
  /** User id this task is assigned to, or "" if unassigned. */
  assigneeId: string;
  /** Display name of the assignee (filled on read), or "". */
  assigneeName: string;
  /** ISO timestamp the timer was started, or "" if not running. */
  timerStartedAt: string;
  /** Total seconds logged against this task (excludes any currently-running interval). */
  timeSpentSeconds: number;
}
