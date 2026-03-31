export type Lead = {
  _id: string;
  title: string;
  status: string;
  createdAt: string;
  customerName?: string;
  address?: string;
  scheduleTime?: { date: string; timeWindow?: string };
};
