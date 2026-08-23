export type Priority = "High" | "Medium" | "Low";

export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

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
}
