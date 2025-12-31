// Type definitions for CYOA events

export type EventId = string | number;

export interface Reward {
  count: "PACK" | number;
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

export const START_EVENT: EventId = "start_event";

