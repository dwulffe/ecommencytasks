export type Priority = "High" | "Medium" | "Low";

export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export interface Client {
  id: string;
  name: string;
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
}
