import type { AgendaEvent, MonitoredTitleState } from "@/server/agenda/types";

export class PriorityMonitorService {
  async checkMonitoredTitle(
    _userId: string,
    _state: MonitoredTitleState,
  ): Promise<AgendaEvent[]> {
    return [];
  }
}

export const priorityMonitorService = new PriorityMonitorService();
