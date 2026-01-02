// Type definitions for CYOA events

export type EventId = string | number;

export interface Reward {
  count: "PACK" | "PACK_CHOICE" | number;
  sets?: string[];
  query?: string;
}

export interface Option {
  requiredSelections: EventId[];
  optionLabel: string;
  postSelectionText: string;
  rewards: Reward[];
  nextEvent: EventId;
}

export interface Event {
  mainText: string;
  id: EventId;
  options: Option[];
}

export interface CyoaData {
  onLossEvents: Event[];
  onWinEvents: Event[];
}

export const START_EVENT: EventId = "START_EVENT";
export const COMPLETED_EVENT: EventId = "COMPLETED"; // Terminal event for players with 5 losses

